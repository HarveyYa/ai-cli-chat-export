#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adapters, adapterById } from "./adapters/index.js";
import { renderMarkdown } from "./render/markdown.js";
import { Conversation } from "./types.js";
import { dateStamp, deriveTitle, ensureDir, exists, slug, truncate } from "./util.js";

interface Args {
  out: string;
  formats: Set<string>;
  sources: string[] | null;
  since?: string;
  until?: string;
  includeThinking: boolean;
  full: boolean;
  list: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    out: path.resolve("ai-conversations-export"),
    formats: new Set(["md", "json"]),
    sources: null,
    since: undefined,
    until: undefined,
    includeThinking: false,
    full: false,
    list: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "-o":
      case "--out":
        a.out = path.resolve(next());
        break;
      case "-f":
      case "--format":
        a.formats = new Set(next().split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
        break;
      case "-s":
      case "--source":
        a.sources = next().split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--since":
        a.since = next();
        break;
      case "--until":
        a.until = next();
        break;
      case "--include-thinking":
        a.includeThinking = true;
        break;
      case "--full":
      case "--force":
        a.full = true;
        break;
      case "-l":
      case "--list":
        a.list = true;
        break;
      case "-h":
      case "--help":
        a.help = true;
        break;
      default:
        process.stderr.write(`Unknown option: ${arg}\n`);
        a.help = true;
    }
  }
  return a;
}

const HELP = `ai-chat-export — one-command exporter for local AI conversation history

USAGE
  ai-chat-export [options]

OPTIONS
  -o, --out <dir>        Output directory (default: ./ai-conversations-export)
  -f, --format <list>    Comma list: md,json (default: md,json)
  -s, --source <list>    Only these sources (default: all)
                         ids: ${adapters.map((x) => x.id).join(", ")}
      --since <date>     Only conversations updated on/after YYYY-MM-DD
      --until <date>     Only conversations updated on/before YYYY-MM-DD
      --include-thinking Include model reasoning/thinking blocks
      --full             Re-export everything, ignoring incremental state
                         (alias: --force). Default is incremental: only new
                         or changed conversations are written.
  -l, --list             List what would be exported; write nothing
  -h, --help             Show this help

EXAMPLES
  ai-chat-export                          # incremental export to ./ai-conversations-export
  ai-chat-export --list                   # see what's new/changed/unchanged
  ai-chat-export --full                   # force a full re-export
  ai-chat-export -s claude-code,codex     # only two sources
  ai-chat-export --since 2026-01-01 -f md

Read-only: never modifies or deletes source files. Nothing is uploaded.
Incremental: re-running skips conversations already exported and unchanged.
`;

function inRange(c: Conversation, since?: string, until?: string): boolean {
  const stamp = c.updatedAt || c.createdAt;
  if (!stamp) return true; // undated: keep
  const d = stamp.slice(0, 10);
  if (since && d < since) return false;
  if (until && d > until) return false;
  return true;
}

// ── Incremental state ──────────────────────────────────────────────────────
// A small manifest kept in the output directory so re-running only writes
// conversations that are new or whose content changed. Keyed by "source:id".
const STATE_FILE = ".export-state.json";

interface StateEntry {
  source: string;
  updatedAt?: string;
  /** Content hash; "" means seeded from a legacy index.json (hash unknown). */
  hash: string;
  /** Stable filename stem (no dir, no extension), reused across runs. */
  base: string;
  files: { md?: string; json?: string };
}
interface ExportState {
  version: number;
  entries: Record<string, StateEntry>;
}

type ExportStatus = "new" | "updated" | "skip";

/** Content fingerprint: changes when the conversation's substance changes. */
function contentHash(c: Conversation): string {
  const h = createHash("sha1");
  h.update(`${c.title || ""}\0${c.model || ""}`);
  for (const m of c.messages) h.update(`\0${m.role}\0${m.text}`);
  return h.digest("hex");
}

function shortId(id: string): string {
  return createHash("sha1").update(id).digest("hex").slice(0, 6);
}

function baseFromRel(rel?: string): string {
  if (!rel) return "";
  return path.basename(rel).replace(/\.(md|json)$/i, "");
}

/** Load prior state; if absent, seed from an existing index.json so a
 *  pre-incremental export isn't re-written wholesale on first upgrade. */
async function loadState(out: string): Promise<ExportState> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(out, STATE_FILE), "utf8"));
    if (parsed && parsed.entries) return { version: 1, entries: parsed.entries };
  } catch {
    /* no state file — try legacy seed below */
  }
  const entries: Record<string, StateEntry> = {};
  try {
    const idx = JSON.parse(await fs.readFile(path.join(out, "index.json"), "utf8"));
    for (const r of idx.conversations || []) {
      if (!r.id || !r.source) continue;
      const files = r.files || {};
      entries[`${r.source}:${r.id}`] = {
        source: r.source,
        updatedAt: r.updatedAt,
        hash: "", // unknown until we re-hash on this run
        base: baseFromRel(files.md || files.json),
        files,
      };
    }
  } catch {
    /* no legacy index either — start empty */
  }
  return { version: 1, entries };
}

async function allFormatFilesPresent(out: string, files: StateEntry["files"], formats: Set<string>): Promise<boolean> {
  for (const f of formats) {
    const rel = (files as any)[f];
    if (!rel || !(await exists(path.join(out, rel)))) return false;
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const home = os.homedir();
  const selected = args.sources ? adapters.filter((x) => args.sources!.includes(x.id)) : adapters;
  if (args.sources) {
    const unknown = args.sources.filter((id) => !adapterById(id));
    if (unknown.length) process.stderr.write(`Unknown source(s): ${unknown.join(", ")}\n`);
  }

  process.stdout.write("Scanning AI conversation sources…\n\n");
  const all: Conversation[] = [];
  for (const adapter of selected) {
    let found: Conversation[] = [];
    try {
      found = await adapter.discover({ includeThinking: args.includeThinking, home });
    } catch (e: any) {
      process.stderr.write(`  ✗ ${adapter.label}: ${e?.message}\n`);
    }
    for (const c of found) c.title = deriveTitle(c.title, c.messages, c.id);
    const kept = found.filter((c) => inRange(c, args.since, args.until));
    process.stdout.write(`  ${kept.length ? "✓" : "·"} ${adapter.label.padEnd(28)} ${kept.length} conversation(s)\n`);
    all.push(...kept);
  }

  all.sort((x, y) => (y.updatedAt || y.createdAt || "").localeCompare(x.updatedAt || x.createdAt || ""));
  const totalMsgs = all.reduce((n, c) => n + c.messages.length, 0);
  process.stdout.write(`\nTotal: ${all.length} conversation(s), ${totalMsgs} message(s).\n`);

  // Plan the export against prior incremental state.
  const state = await loadState(args.out);
  const usedBases = new Set<string>();
  for (const e of Object.values(state.entries)) if (e.base) usedBases.add(`${e.source}/${e.base}`);

  interface PlanItem { c: Conversation; status: ExportStatus; base: string; }
  const plan: PlanItem[] = [];
  for (const c of all) {
    const key = `${c.source}:${c.id}`;
    const prev = state.entries[key];
    const h = contentHash(c);

    // Stable filename stem: reuse the prior one; disambiguate new collisions
    // deterministically so names never drift between runs.
    let base = prev?.base;
    if (!base) {
      base = `${dateStamp(c.updatedAt || c.createdAt)}-${slug(c.title || c.id)}`;
      if (usedBases.has(`${c.source}/${base}`)) base = `${base}-${shortId(c.id)}`;
      usedBases.add(`${c.source}/${base}`);
    }

    let status: ExportStatus;
    if (args.full || !prev) {
      status = prev ? "updated" : "new";
    } else if (prev.hash && prev.hash === h) {
      // Unchanged — skippable only if every requested format is still on disk.
      status = (await allFormatFilesPresent(args.out, prev.files, args.formats)) ? "skip" : "updated";
    } else if (prev.hash === "") {
      // Seeded from a legacy index without a hash: adopt if its files remain.
      status = (await allFormatFilesPresent(args.out, prev.files, args.formats)) ? "skip" : "new";
    } else {
      status = "updated";
    }
    plan.push({ c, status, base });

    // Refresh the entry now; file paths are filled in during the write pass.
    state.entries[key] = { source: c.source, updatedAt: c.updatedAt, hash: h, base, files: prev?.files || {} };
  }

  const counts = { new: 0, updated: 0, skip: 0 };
  for (const p of plan) counts[p.status]++;
  const summary = `${counts.new} new, ${counts.updated} updated · ${counts.skip} unchanged (skipped)`;

  if (args.list) {
    process.stdout.write("\n");
    for (const p of plan) {
      const tag = p.status === "new" ? "＋ new    " : p.status === "updated" ? "~ updated" : "· skip   ";
      process.stdout.write(`  ${tag} [${p.c.sourceLabel}] ${dateStamp(p.c.updatedAt || p.c.createdAt)}  ${truncate(p.c.title || p.c.id, 66)}\n`);
    }
    process.stdout.write(`\nWould write: ${summary}.\n(--list: nothing written)\n`);
    return;
  }

  if (all.length === 0) {
    process.stdout.write("\nNothing to export.\n");
    return;
  }

  await ensureDir(args.out);
  const manifest: any[] = [];

  for (const { c, status, base } of plan) {
    const sourceDir = path.join(args.out, c.source);
    const write = status !== "skip";
    if (write) await ensureDir(sourceDir);
    const record: any = {
      id: c.id,
      source: c.source,
      sourceLabel: c.sourceLabel,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      projectPath: c.projectPath,
      model: c.model,
      messageCount: c.messages.length,
      sourceFile: c.sourceFile,
      files: {},
    };
    const files: StateEntry["files"] = {};
    for (const ext of ["md", "json"] as const) {
      if (!args.formats.has(ext)) continue;
      const p = path.join(sourceDir, `${base}.${ext}`);
      if (write) await fs.writeFile(p, ext === "md" ? renderMarkdown(c) : JSON.stringify(c, null, 2), "utf8");
      const rel = path.relative(args.out, p);
      files[ext] = rel;
      record.files[ext] = rel;
    }
    state.entries[`${c.source}:${c.id}`].files = files;
    manifest.push(record);
  }

  await fs.writeFile(path.join(args.out, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), count: manifest.length, conversations: manifest }, null, 2), "utf8");
  await writeIndexMd(args.out, manifest);
  await fs.writeFile(path.join(args.out, STATE_FILE), JSON.stringify(state, null, 2), "utf8");

  process.stdout.write(`\n✅ Exported to ${args.out}\n   ${summary}  •  Formats: ${[...args.formats].join(", ")}  •  index.json + index.md written.\n`);
}

async function writeIndexMd(out: string, manifest: any[]): Promise<void> {
  const bySource = new Map<string, any[]>();
  for (const r of manifest) {
    if (!bySource.has(r.sourceLabel)) bySource.set(r.sourceLabel, []);
    bySource.get(r.sourceLabel)!.push(r);
  }
  const lines: string[] = ["# AI Conversation Export", "", `Generated ${new Date().toISOString()} — ${manifest.length} conversation(s).`, ""];
  for (const [label, items] of bySource) {
    lines.push(`## ${label} (${items.length})`, "");
    for (const r of items) {
      const link = r.files.md ? `[${truncate(r.title || r.id, 70)}](${r.files.md})` : truncate(r.title || r.id, 70);
      lines.push(`- ${dateStamp(r.updatedAt || r.createdAt)} — ${link} _(${r.messageCount} msgs)_`);
    }
    lines.push("");
  }
  await fs.writeFile(path.join(out, "index.md"), lines.join("\n"), "utf8");
}

// node:sqlite (used by the opencode adapter) needs Node ≥22.5. On 22.5–23 it
// requires the --experimental-sqlite flag; re-exec ourselves once with it so
// the user never has to think about it. Node ≥24 has it stable (no flag).
function sqliteAvailable(): boolean {
  try {
    createRequire(import.meta.url)("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

if (!sqliteAvailable() && !process.env.__AIEXPORT_REEXEC) {
  const self = fileURLToPath(import.meta.url);
  const r = spawnSync(process.execPath, ["--experimental-sqlite", self, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, __AIEXPORT_REEXEC: "1" },
  });
  process.exit(r.status ?? 0);
} else {
  main().catch((e) => {
    process.stderr.write(`\nFatal: ${e?.stack || e}\n`);
    process.exit(1);
  });
}

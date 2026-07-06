#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adapters, adapterById } from "./adapters/index.js";
import { renderMarkdown } from "./render/markdown.js";
import { Conversation } from "./types.js";
import { dateStamp, deriveTitle, ensureDir, slug, truncate } from "./util.js";

interface Args {
  out: string;
  formats: Set<string>;
  sources: string[] | null;
  since?: string;
  until?: string;
  includeThinking: boolean;
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
  -l, --list             List what would be exported; write nothing
  -h, --help             Show this help

EXAMPLES
  ai-chat-export                          # export everything to ./ai-conversations-export
  ai-chat-export --list                   # see what's on this machine
  ai-chat-export -s claude-code,codex     # only two sources
  ai-chat-export --since 2026-01-01 -f md

Read-only: never modifies or deletes source files. Nothing is uploaded.
`;

function inRange(c: Conversation, since?: string, until?: string): boolean {
  const stamp = c.updatedAt || c.createdAt;
  if (!stamp) return true; // undated: keep
  const d = stamp.slice(0, 10);
  if (since && d < since) return false;
  if (until && d > until) return false;
  return true;
}

async function uniquePath(dir: string, base: string, ext: string): Promise<string> {
  let name = `${base}.${ext}`;
  let n = 1;
  while (true) {
    const full = path.join(dir, name);
    try {
      await fs.access(full);
      name = `${base}-${++n}.${ext}`;
    } catch {
      return full;
    }
  }
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

  if (args.list) {
    process.stdout.write("\n");
    for (const c of all) {
      process.stdout.write(`  [${c.sourceLabel}] ${dateStamp(c.updatedAt || c.createdAt)}  ${truncate(c.title || c.id, 70)}\n`);
    }
    process.stdout.write("\n(--list: nothing written)\n");
    return;
  }

  if (all.length === 0) {
    process.stdout.write("\nNothing to export.\n");
    return;
  }

  await ensureDir(args.out);
  const manifest: any[] = [];

  for (const c of all) {
    const sourceDir = path.join(args.out, c.source);
    await ensureDir(sourceDir);
    const base = `${dateStamp(c.updatedAt || c.createdAt)}-${slug(c.title || c.id)}`;
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
    if (args.formats.has("md")) {
      const p = await uniquePath(sourceDir, base, "md");
      await fs.writeFile(p, renderMarkdown(c), "utf8");
      record.files.md = path.relative(args.out, p);
    }
    if (args.formats.has("json")) {
      const p = await uniquePath(sourceDir, base, "json");
      await fs.writeFile(p, JSON.stringify(c, null, 2), "utf8");
      record.files.json = path.relative(args.out, p);
    }
    manifest.push(record);
  }

  await fs.writeFile(path.join(args.out, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), count: all.length, conversations: manifest }, null, 2), "utf8");
  await writeIndexMd(args.out, manifest);

  process.stdout.write(`\n✅ Exported to ${args.out}\n   Formats: ${[...args.formats].join(", ")}  •  index.json + index.md written.\n`);
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

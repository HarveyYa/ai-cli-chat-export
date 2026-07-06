import { promises as fs } from "node:fs";
import path from "node:path";

/** Convert epoch (seconds or ms) or ISO string to an ISO-8601 string. */
export function toIso(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") {
    // Heuristic: values below 1e12 are seconds, above are milliseconds.
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

export function truncate(s: string, n = 60): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= n ? clean : clean.slice(0, n).trimEnd() + "…";
}

/** Filesystem-safe slug, keeps unicode letters/numbers. */
export function slug(s: string, max = 50): string {
  const base = s
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") // ANSI escape sequences
    .replace(/[\x00-\x1f\x7f]/g, "") // other control chars
    .replace(/[\/\\:*?"<>|\[\]]/g, "-") // filesystem-unsafe → dash
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "untitled").slice(0, max);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string> {
  return fs.readFile(p, "utf8");
}

/** Parse a JSONL file into records, skipping blank/corrupt lines silently. */
export async function readJsonl(p: string): Promise<any[]> {
  const raw = await readText(p);
  const out: any[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/** Recursively list files under a dir, tolerating missing dirs. */
export async function walk(dir: string, filter?: (p: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full, filter)));
    } else if (!filter || filter(full)) {
      out.push(full);
    }
  }
  return out;
}

export function dateStamp(iso?: string): string {
  if (!iso) return "unknown-date";
  return iso.slice(0, 10);
}

// System-injected message wrappers that make poor conversation titles.
const WRAPPER = /^\s*<(command-message|command-name|command-args|local-command-caveat|environment_context|system-reminder|user-prompt-submit-hook|user-memory-input)[\s>]/i;

/** Strip ANSI codes and XML-ish tags, collapse whitespace, for a clean title. */
function stripTags(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick a human-meaningful title: prefer an existing non-wrapper title, else the
 * first user message that isn't a system-injected wrapper, else best effort.
 */
export function deriveTitle(title: string | undefined, messages: { role: string; text: string }[], id: string): string {
  if (title && !WRAPPER.test(title)) return truncate(stripTags(title), 120);
  for (const m of messages) {
    if (m.role !== "user" || WRAPPER.test(m.text)) continue;
    const t = stripTags(m.text);
    if (t) return truncate(t, 120);
  }
  if (title) return truncate(stripTags(title), 120);
  const first = messages[0];
  return first ? truncate(stripTags(first.text), 120) : id;
}

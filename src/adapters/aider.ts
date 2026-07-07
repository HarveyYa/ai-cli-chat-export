import { promises as fs } from "node:fs";
import path from "node:path";
import { Adapter, Conversation, DiscoverOptions, Message, Role } from "../types.js";
import { exists, readText, toIso } from "../util.js";

// Aider writes a human-readable Markdown transcript per project, at the repo
// root: .aider.chat.history.md (overridable via $AIDER_CHAT_HISTORY_FILE).
// There is no central store, so we scan a bounded slice of $HOME for the file.
//
// Transcript shape (aider's own format):
//   # aider chat started at 2026-07-01 09:12:03     ← session boundary
//   #### a user message line                        ← user input (#### prefix)
//   #### more user input
//   assistant reply text, plain markdown…           ← assistant output (no prefix)
//
// ⚠️  BEST-EFFORT / UNVERIFIED against real data. The prefix/heading heuristics
//     below follow aider's documented format but may need tuning once a sample
//     exists. Never throws for a single bad file.

const HISTORY_NAME = ".aider.chat.history.md";
const MAX_DEPTH = 6;
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "Library", ".Trash", ".cache", ".npm",
  ".cargo", ".rustup", ".gradle", ".m2", "dist", "build", ".next", "vendor",
  "venv", ".venv", "__pycache__", ".pnpm-store", "Applications", "go",
]);

const SESSION_RE = /^#\s+aider chat started at\s+(.+)$/i;
const USER_RE = /^####\s?(.*)$/;

/** Bounded DFS of $HOME for .aider.chat.history.md, pruning heavy dirs. */
async function findHistories(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile()) {
        if (e.name === HISTORY_NAME) found.push(full);
      } else if (e.isDirectory() && depth < maxDepth && !SKIP_DIRS.has(e.name)) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(root, 0);
  return found;
}

/** Split one transcript file into sessions, each into role-tagged messages. */
function parseTranscript(file: string, text: string): Conversation[] {
  const projectPath = path.dirname(file);
  const lines = text.split("\n");

  interface Sess { started?: string; blocks: { role: Role; lines: string[] }[]; }
  const sessions: Sess[] = [];
  let cur: Sess | null = null;

  const push = (role: Role, line: string) => {
    if (!cur) cur = { blocks: [] };
    const last = cur.blocks[cur.blocks.length - 1];
    if (last && last.role === role) last.lines.push(line);
    else cur.blocks.push({ role, lines: [line] });
  };

  for (const raw of lines) {
    const sm = raw.match(SESSION_RE);
    if (sm) {
      if (cur) sessions.push(cur);
      cur = { started: sm[1].trim(), blocks: [] };
      continue;
    }
    const um = raw.match(USER_RE);
    if (um) push("user", um[1]);
    else push("assistant", raw);
  }
  if (cur) sessions.push(cur);

  const out: Conversation[] = [];
  sessions.forEach((s, i) => {
    const messages: Message[] = [];
    for (const b of s.blocks) {
      const t = b.lines.join("\n").trim();
      if (t) messages.push({ role: b.role, text: t, timestamp: i === 0 ? toIso(s.started) : undefined });
    }
    if (messages.length === 0) return;
    const started = toIso(s.started);
    out.push({
      id: `${projectPath}#${s.started || i}`,
      source: "aider",
      sourceLabel: "Aider",
      title: messages.find((m) => m.role === "user")?.text,
      createdAt: started,
      updatedAt: started,
      projectPath,
      messages,
      sourceFile: file,
    });
  });
  return out;
}

export const aider: Adapter = {
  id: "aider",
  label: "Aider",
  async discover(opts: DiscoverOptions): Promise<Conversation[]> {
    const files = new Set<string>();

    const envPath = process.env.AIDER_CHAT_HISTORY_FILE;
    if (envPath) {
      const abs = path.resolve(opts.home, envPath);
      if (await exists(abs)) files.add(abs);
    }
    for (const f of await findHistories(opts.home, MAX_DEPTH)) files.add(f);

    const out: Conversation[] = [];
    for (const f of files) {
      try {
        out.push(...parseTranscript(f, await readText(f)));
      } catch {
        /* skip bad file */
      }
    }
    return out;
  },
};

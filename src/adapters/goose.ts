import { createRequire } from "node:module";
import path from "node:path";
import { Adapter, Conversation, DiscoverOptions, Message, Role } from "../types.js";
import { exists, readJsonl, toIso, walk } from "../util.js";

// Goose (Block) stores sessions under ~/.local/share/goose/sessions/
//   • v1.10.0+  →  sessions.db  (SQLite; schema_version table, currently ~13)
//   • older     →  one <id>.jsonl per session
//
// ⚠️  BEST-EFFORT / UNVERIFIED. Written to Goose's *documented* shape (a session
//     carries id / description / working_dir / a message list; each message is
//     { role, content:[{type:"text", text}] }). The exact SQLite column names and
//     JSONL line shape vary by version and have NOT been checked against real
//     data yet — this adapter probes defensively and must be corrected once a
//     sample is available. Never throws for a single bad file/row.

const SESS_DIR = [".local", "share", "goose", "sessions"];

function loadSqlite(): any | null {
  try {
    return createRequire(import.meta.url)("node:sqlite");
  } catch {
    return null;
  }
}

/** Flatten a Goose message's content (string, or array of {type,text} parts). */
function messageText(content: any, includeThinking: boolean): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (typeof content.text === "string") return content.text;
    return "";
  }
  const out: string[] = [];
  for (const part of content) {
    if (typeof part === "string") out.push(part);
    else if (part?.type === "text" && part.text) out.push(String(part.text));
    else if (part?.type === "thinking" || part?.type === "reasoning") {
      if (includeThinking && (part.text || part.thinking)) out.push(`> 💭 ${String(part.text ?? part.thinking).replace(/\n/g, "\n> ")}`);
    } else if (part?.type === "toolRequest" || part?.type === "tool_use" || part?.toolCall) {
      const name = part?.toolCall?.name || part?.name || "tool";
      out.push(`**[tool → ${name}]**`);
    } else if (part?.type === "toolResponse" || part?.type === "tool_result") {
      out.push(`**[tool result]**`);
    } else if (part?.text) out.push(String(part.text));
  }
  return out.join("\n\n");
}

function normRole(r: unknown): Role {
  const s = String(r ?? "").toLowerCase();
  if (s === "user" || s === "human") return "user";
  if (s === "assistant" || s === "model" || s === "goose") return "assistant";
  if (s === "tool" || s === "function") return "tool";
  if (s === "system") return "system";
  return "assistant";
}

/** Build a Conversation from a parsed message array + session metadata. */
function fromMessages(id: string, rawMessages: any[], meta: any, file: string, includeThinking: boolean): Conversation | null {
  const messages: Message[] = [];
  for (const m of rawMessages) {
    const text = messageText(m?.content ?? m?.text ?? m?.message, includeThinking);
    if (text.trim()) messages.push({ role: normRole(m?.role ?? m?.type), text, timestamp: toIso(m?.created ?? m?.timestamp ?? m?.created_at) });
  }
  if (messages.length === 0) return null;
  return {
    id,
    source: "goose",
    sourceLabel: "Goose",
    title: meta?.description || meta?.title || messages.find((m) => m.role === "user")?.text,
    createdAt: toIso(meta?.created_at ?? meta?.created) ?? messages[0].timestamp,
    updatedAt: toIso(meta?.updated_at ?? meta?.updated) ?? messages[messages.length - 1].timestamp,
    projectPath: meta?.working_dir ?? meta?.working_directory ?? meta?.cwd,
    messages,
    sourceFile: file,
  };
}

/** Read the SQLite sessions.db, probing for the sessions table/columns. */
function fromSqlite(dbPath: string, includeThinking: boolean): Conversation[] {
  const mod = loadSqlite();
  if (!mod) return [];
  const out: Conversation[] = [];
  let db: any;
  try {
    db = new mod.DatabaseSync(dbPath, { readOnly: true });
    const tables: any[] = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map((t) => String(t.name));
    // Prefer a table literally named 'sessions', else any table carrying a
    // conversation/messages column.
    const table = names.includes("sessions") ? "sessions" : names.find((n) => {
      try {
        return db.prepare(`PRAGMA table_info(${JSON.stringify(n)})`).all().some((c: any) => /conversation|messages/i.test(c.name));
      } catch {
        return false;
      }
    });
    if (!table) return [];
    const cols: any[] = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all();
    const colNames = cols.map((c) => String(c.name));
    const convCol = colNames.find((c) => /^(conversation|messages)$/i.test(c)) ?? colNames.find((c) => /conversation|messages/i.test(c));
    if (!convCol) return [];
    const idCol = colNames.find((c) => c === "id") ?? colNames[0];
    const rows: any[] = db.prepare(`SELECT * FROM ${JSON.stringify(table)}`).all();
    for (const row of rows) {
      let conv: any = row[convCol];
      if (typeof conv === "string") {
        try {
          conv = JSON.parse(conv);
        } catch {
          continue;
        }
      }
      const list = Array.isArray(conv) ? conv : Array.isArray(conv?.messages) ? conv.messages : [];
      const c = fromMessages(String(row[idCol]), list, row, dbPath, includeThinking);
      if (c) out.push(c);
    }
  } catch {
    /* corrupt/locked db or unexpected schema — skip */
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
  return out;
}

export const goose: Adapter = {
  id: "goose",
  label: "Goose",
  async discover(opts: DiscoverOptions): Promise<Conversation[]> {
    const dir = path.join(opts.home, ...SESS_DIR);
    const out: Conversation[] = [];

    const dbPath = path.join(dir, "sessions.db");
    if (await exists(dbPath)) out.push(...fromSqlite(dbPath, opts.includeThinking));

    // Legacy per-session JSONL files (each line a message or an event).
    const jsonlFiles = await walk(dir, (p) => p.endsWith(".jsonl"));
    for (const f of jsonlFiles) {
      try {
        const rows = await readJsonl(f);
        if (rows.length === 0) continue;
        // Some versions put session metadata on the first line.
        const first = rows[0];
        const meta = first && !first.role && !first.content ? first : {};
        const msgs = first === meta ? rows.slice(1) : rows;
        const id = String(meta?.id ?? path.basename(f).replace(/\.jsonl$/, ""));
        const c = fromMessages(id, msgs, meta, f, opts.includeThinking);
        if (c) out.push(c);
      } catch {
        /* skip bad file */
      }
    }
    return out;
  },
};

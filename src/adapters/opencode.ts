import { createRequire } from "node:module";
import path from "node:path";
import { Adapter, Conversation, DiscoverOptions, Message, Role } from "../types.js";
import { exists, toIso } from "../util.js";

// opencode stores conversations in SQLite at
// ~/.local/share/opencode/opencode.db
//   session(id, title, directory, time_created)
//   message(id, session_id, time_created, data)   data.role, data.model...
//   part(id, message_id, session_id, time_created, data)  data.type/text
// Read via Node's built-in node:sqlite (no external dependency). If the
// runtime can't load it (Node < 22.5 without the flag), degrade gracefully.

let sqliteWarned = false;

function loadSqlite(): any | null {
  try {
    return createRequire(import.meta.url)("node:sqlite");
  } catch {
    if (!sqliteWarned) {
      sqliteWarned = true;
      process.stderr.write(
        "  ⚠ opencode: skipped — needs Node ≥22.5 with SQLite support.\n" +
          "    Retry with:  node --experimental-sqlite <cmd>\n",
      );
    }
    return null;
  }
}

function partText(data: any, includeThinking: boolean): string | null {
  if (!data || typeof data !== "object") return null;
  switch (data.type) {
    case "text":
      return typeof data.text === "string" ? data.text : null;
    case "reasoning":
      return includeThinking && data.text ? `> 💭 ${String(data.text).replace(/\n/g, "\n> ")}` : null;
    case "tool": {
      const name = data.tool || data.name || "tool";
      return `**[tool → ${name}]**`;
    }
    default:
      return null;
  }
}

export const opencode: Adapter = {
  id: "opencode",
  label: "opencode",
  async discover(opts: DiscoverOptions): Promise<Conversation[]> {
    const dbPath = path.join(opts.home, ".local", "share", "opencode", "opencode.db");
    if (!(await exists(dbPath))) return [];
    const mod = loadSqlite();
    if (!mod) return [];

    const out: Conversation[] = [];
    let db: any;
    try {
      db = new mod.DatabaseSync(dbPath, { readOnly: true });
      const sessions = db.prepare("SELECT id, title, directory, time_created FROM session").all();
      const msgStmt = db.prepare("SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC");
      const partStmt = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC, id ASC");

      for (const s of sessions) {
        const messages: Message[] = [];
        let model: string | undefined;
        const rows = msgStmt.all(s.id);
        for (const m of rows) {
          let mdata: any = {};
          try {
            mdata = JSON.parse(m.data);
          } catch {
            /* skip */
          }
          const role = (mdata.role as Role) || "assistant";
          if (!model && (mdata.modelID || mdata.model?.modelID)) model = mdata.modelID || mdata.model?.modelID;
          const chunks: string[] = [];
          for (const p of partStmt.all(m.id)) {
            let pdata: any;
            try {
              pdata = JSON.parse(p.data);
            } catch {
              continue;
            }
            const t = partText(pdata, opts.includeThinking);
            if (t && t.trim()) chunks.push(t);
          }
          const text = chunks.join("\n\n");
          if (text.trim()) messages.push({ role, text, timestamp: toIso(m.time_created) });
        }
        if (messages.length === 0) continue;
        out.push({
          id: s.id,
          source: "opencode",
          sourceLabel: "opencode",
          title: s.title || messages.find((m) => m.role === "user")?.text,
          createdAt: toIso(s.time_created) ?? messages[0].timestamp,
          updatedAt: messages[messages.length - 1].timestamp,
          projectPath: s.directory,
          model,
          messages,
          sourceFile: dbPath,
        });
      }
    } catch {
      /* corrupt or locked db — skip */
    } finally {
      try {
        db?.close();
      } catch {
        /* ignore */
      }
    }
    return out;
  },
};

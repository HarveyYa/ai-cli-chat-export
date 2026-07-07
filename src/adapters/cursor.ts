import path from "node:path";
import { Adapter, Conversation, DiscoverOptions, Message, Role } from "../types.js";
import { readText, toIso, walk } from "../util.js";

// Cursor CLI (`cursor-agent`) keeps session history under ~/.cursor/chats/.
//
// ⚠️  BEST-EFFORT / UNVERIFIED. The on-disk layout under ~/.cursor/chats/ is not
//     publicly documented in detail; this adapter assumes one JSON file per chat
//     holding a message list under one of the common keys (messages / bubbles /
//     conversation) or a top-level array. Roles are read from role/type/author,
//     text from text/content/body. Must be corrected against a real sample.
//     Never throws for a single bad file.

const CHATS_DIR = [".cursor", "chats"];

function normRole(v: unknown): Role {
  const s = String(v ?? "").toLowerCase();
  if (s === "user" || s === "human" || s === "1") return "user";
  if (s === "assistant" || s === "ai" || s === "model" || s === "2") return "assistant";
  if (s === "tool" || s === "function") return "tool";
  if (s === "system") return "system";
  return "assistant";
}

/** Pull readable text out of a message-like object of unknown shape. */
function extractText(m: any, includeThinking: boolean): string {
  if (m == null) return "";
  if (typeof m === "string") return m;
  const direct = m.text ?? m.content ?? m.body ?? m.message;
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) {
    const out: string[] = [];
    for (const p of direct) {
      if (typeof p === "string") out.push(p);
      else if (p?.text) out.push(String(p.text));
      else if ((p?.type === "thinking" || p?.type === "reasoning") && includeThinking && p.text) out.push(`> 💭 ${String(p.text).replace(/\n/g, "\n> ")}`);
    }
    return out.join("\n\n");
  }
  return "";
}

/** Find the most plausible message array within an arbitrary chat object. */
function findMessageList(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  for (const key of ["messages", "bubbles", "conversation", "history", "turns"]) {
    if (Array.isArray(raw?.[key])) return raw[key];
  }
  return [];
}

export const cursor: Adapter = {
  id: "cursor",
  label: "Cursor CLI",
  async discover(opts: DiscoverOptions): Promise<Conversation[]> {
    const dir = path.join(opts.home, ...CHATS_DIR);
    const files = await walk(dir, (p) => p.endsWith(".json"));
    const out: Conversation[] = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(await readText(f));
        const list = findMessageList(raw);
        const messages: Message[] = [];
        for (const m of list) {
          const text = extractText(m, opts.includeThinking);
          if (text.trim()) messages.push({ role: normRole(m?.role ?? m?.type ?? m?.author), text, timestamp: toIso(m?.timestamp ?? m?.createdAt ?? m?.time) });
        }
        if (messages.length === 0) continue;
        const id = String(raw?.id ?? raw?.chatId ?? raw?.sessionId ?? path.basename(f).replace(/\.json$/, ""));
        out.push({
          id,
          source: "cursor",
          sourceLabel: "Cursor CLI",
          title: raw?.title ?? raw?.name ?? messages.find((m) => m.role === "user")?.text,
          createdAt: toIso(raw?.createdAt ?? raw?.created) ?? messages[0].timestamp,
          updatedAt: toIso(raw?.updatedAt ?? raw?.updated) ?? messages[messages.length - 1].timestamp,
          projectPath: raw?.workspacePath ?? raw?.cwd ?? raw?.directory,
          model: raw?.model,
          messages,
          sourceFile: f,
        });
      } catch {
        /* skip bad file */
      }
    }
    return out;
  },
};

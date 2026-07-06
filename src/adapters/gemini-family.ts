import path from "node:path";
import { Adapter, Conversation, DiscoverOptions, Message, Role } from "../types.js";
import { readText, toIso, walk } from "../util.js";

// Gemini CLI and its forks (Qwen Code) store per-project working data under
//   <root>/tmp/<projectHash>/
// Two shapes appear across versions:
//   • logs.json      — array of { sessionId, messageId, type:"user", message, timestamp }
//                      (older gemini-cli logs prompts; may be user-only)
//   • checkpoint*.json — array of Content { role:"user"|"model", parts:[{text}|{functionCall}...] }
//                      (a full replayable history)
// NOTE: no local data was present on the build machine, so this adapter is
// written to the documented upstream format and is best-effort / untested here.

function partsText(parts: any[], includeThinking: boolean): string {
  if (!Array.isArray(parts)) return "";
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p === "string") out.push(p);
    else if (p?.text) out.push(String(p.text));
    else if (p?.functionCall) out.push(`**[tool → ${p.functionCall.name}]**\n\n\`\`\`json\n${JSON.stringify(p.functionCall.args ?? {}, null, 2)}\n\`\`\``);
    else if (p?.functionResponse) out.push(`**[tool result]**\n\n${JSON.stringify(p.functionResponse.response ?? {}, null, 2)}`);
    else if (p?.thought && includeThinking) out.push(`> 💭 ${String(p.thought).replace(/\n/g, "\n> ")}`);
  }
  return out.join("\n\n");
}

function normRole(r: string): Role {
  if (r === "model" || r === "assistant" || r === "gemini" || r === "qwen") return "assistant";
  if (r === "user" || r === "human") return "user";
  if (r === "tool" || r === "function") return "tool";
  return "assistant";
}

function fromCheckpoint(file: string, id: string, source: string, label: string, includeThinking: boolean, raw: any): Conversation | null {
  const history: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.history) ? raw.history : [];
  const messages: Message[] = [];
  for (const c of history) {
    const text = partsText(c?.parts, includeThinking);
    if (text.trim()) messages.push({ role: normRole(c?.role), text });
  }
  if (messages.length === 0) return null;
  return {
    id,
    source,
    sourceLabel: label,
    title: messages.find((m) => m.role === "user")?.text,
    messages,
    sourceFile: file,
  };
}

function fromLogs(file: string, source: string, label: string, raw: any): Conversation[] {
  const entries: any[] = Array.isArray(raw) ? raw : [];
  const bySession = new Map<string, Message[]>();
  const created = new Map<string, string | undefined>();
  for (const e of entries) {
    const sid = String(e?.sessionId ?? "session");
    if (!bySession.has(sid)) {
      bySession.set(sid, []);
      created.set(sid, toIso(e?.timestamp));
    }
    const text = typeof e?.message === "string" ? e.message : partsText(e?.message?.parts, false);
    if (text?.trim()) bySession.get(sid)!.push({ role: normRole(e?.type ?? "user"), text, timestamp: toIso(e?.timestamp) });
  }
  const out: Conversation[] = [];
  for (const [sid, messages] of bySession) {
    if (messages.length === 0) continue;
    out.push({
      id: sid,
      source,
      sourceLabel: label,
      title: messages.find((m) => m.role === "user")?.text,
      createdAt: created.get(sid) ?? messages[0].timestamp,
      updatedAt: messages[messages.length - 1].timestamp,
      messages,
      sourceFile: file,
    });
  }
  return out;
}

function makeAdapter(id: string, label: string, rootDir: string): Adapter {
  return {
    id,
    label,
    async discover(opts: DiscoverOptions): Promise<Conversation[]> {
      const root = path.join(opts.home, rootDir, "tmp");
      const files = await walk(root, (p) => {
        const b = path.basename(p);
        return b === "logs.json" || (b.startsWith("checkpoint") && b.endsWith(".json"));
      });
      const out: Conversation[] = [];
      for (const f of files) {
        try {
          const raw = JSON.parse(await readText(f));
          const b = path.basename(f);
          if (b === "logs.json") out.push(...fromLogs(f, id, label, raw));
          else {
            const cid = `${path.basename(path.dirname(f))}-${b.replace(/\.json$/, "")}`;
            const c = fromCheckpoint(f, cid, id, label, opts.includeThinking, raw);
            if (c) out.push(c);
          }
        } catch {
          /* skip */
        }
      }
      return out;
    },
  };
}

export const gemini = makeAdapter("gemini", "Gemini CLI", ".gemini");
export const qwen = makeAdapter("qwen", "Qwen Code", ".qwen");

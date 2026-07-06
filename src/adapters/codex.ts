import path from "node:path";
import { Adapter, Conversation, DiscoverOptions, Message, Role } from "../types.js";
import { readJsonl, toIso, walk } from "../util.js";

// Codex CLI stores one JSONL "rollout" file per session under
// ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
// Records: { timestamp, type, payload }. Conversational content lives in
// type "response_item" with payload.type "message" (role + content blocks).
// A leading "session_meta" record carries id/cwd/model_provider.

function normRole(r: unknown): Role {
  switch (r) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "system":
    case "developer":
      return "system";
    case "tool":
    case "function":
      return "tool";
    default:
      return "assistant";
  }
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => (b && typeof b === "object" && typeof b.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

async function parseSession(file: string, includeThinking: boolean): Promise<Conversation | null> {
  const records = await readJsonl(file);
  const messages: Message[] = [];
  let id = path.basename(file, ".jsonl");
  let cwd: string | undefined;
  let model: string | undefined;
  let created: string | undefined;

  for (const r of records) {
    const ts = toIso(r?.timestamp);
    const p = r?.payload;
    if (r?.type === "session_meta" && p) {
      if (p.id) id = p.id;
      if (p.cwd) cwd = p.cwd;
      if (p.model) model = p.model;
      else if (p.model_provider) model = p.model_provider;
      created = created ?? toIso(p.timestamp) ?? ts;
      continue;
    }
    if (r?.type !== "response_item" || !p) continue;
    if (p.type === "message" && p.role) {
      const text = flattenContent(p.content);
      if (!text.trim()) continue;
      messages.push({ role: normRole(p.role), text, timestamp: ts });
    } else if (p.type === "reasoning" && includeThinking) {
      const text = flattenContent(p.content ?? p.summary);
      if (text.trim()) messages.push({ role: "assistant", text: `> 💭 ${text.replace(/\n/g, "\n> ")}`, timestamp: ts });
    } else if (p.type === "function_call" && p.name) {
      messages.push({ role: "tool", text: `**[tool → ${p.name}]**\n\n\`\`\`\n${p.arguments ?? ""}\n\`\`\``, timestamp: ts });
    }
  }

  if (messages.length === 0) return null;
  const firstUser = messages.find((m) => m.role === "user");
  return {
    id,
    source: "codex",
    sourceLabel: "Codex CLI",
    title: firstUser?.text,
    createdAt: created ?? messages[0].timestamp,
    updatedAt: messages[messages.length - 1].timestamp,
    projectPath: cwd,
    model,
    messages,
    sourceFile: file,
  };
}

export const codex: Adapter = {
  id: "codex",
  label: "Codex CLI",
  async discover(opts: DiscoverOptions): Promise<Conversation[]> {
    const root = path.join(opts.home, ".codex", "sessions");
    const files = await walk(root, (p) => p.endsWith(".jsonl") && path.basename(p).startsWith("rollout-"));
    const out: Conversation[] = [];
    for (const f of files) {
      try {
        const c = await parseSession(f, opts.includeThinking);
        if (c) out.push(c);
      } catch {
        /* skip */
      }
    }
    return out;
  },
};

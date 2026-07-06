import path from "node:path";
import { Adapter, Conversation, DiscoverOptions, Message, Role } from "../types.js";
import { readJsonl, toIso, walk } from "../util.js";

// Claude Code stores one JSONL file per session under
// ~/.claude/projects/<slugified-cwd>/<sessionId>.jsonl
// Each line is a record; conversational lines have type "user"|"assistant"
// with a `message` object. Other lines (meta, summary, snapshots) are skipped.

function flatten(content: unknown, includeThinking: boolean): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as any;
    switch (b.type) {
      case "text":
        if (b.text) parts.push(String(b.text));
        break;
      case "thinking":
        if (includeThinking && b.thinking) parts.push(`> 💭 ${String(b.thinking).replace(/\n/g, "\n> ")}`);
        break;
      case "tool_use":
        parts.push(`**[tool → ${b.name}]**\n\n\`\`\`json\n${JSON.stringify(b.input ?? {}, null, 2)}\n\`\`\``);
        break;
      case "tool_result": {
        const c = b.content;
        let text = "";
        if (typeof c === "string") text = c;
        else if (Array.isArray(c)) text = c.map((x: any) => x?.text ?? "").join("\n");
        parts.push(`**[tool result]**\n\n${text}`);
        break;
      }
      case "image":
        parts.push("_[image]_");
        break;
    }
  }
  return parts.join("\n\n");
}

async function parseSession(file: string, includeThinking: boolean): Promise<Conversation | null> {
  const records = await readJsonl(file);
  const messages: Message[] = [];
  let sessionId = path.basename(file, ".jsonl");
  let cwd: string | undefined;
  let summary: string | undefined;

  for (const r of records) {
    if (r?.type === "summary" && r.summary) {
      summary = summary ?? String(r.summary);
      continue;
    }
    if ((r?.type === "user" || r?.type === "assistant") && r.message) {
      const role = (r.message.role as Role) || (r.type as Role);
      const text = flatten(r.message.content, includeThinking);
      if (!text.trim()) continue;
      if (r.sessionId) sessionId = r.sessionId;
      if (r.cwd) cwd = r.cwd;
      messages.push({ role, text, timestamp: toIso(r.timestamp) });
    }
  }

  if (messages.length === 0) return null;
  const firstUser = messages.find((m) => m.role === "user");
  return {
    id: sessionId,
    source: "claude-code",
    sourceLabel: "Claude Code",
    title: summary || firstUser?.text,
    createdAt: messages[0].timestamp,
    updatedAt: messages[messages.length - 1].timestamp,
    projectPath: cwd,
    messages,
    sourceFile: file,
  };
}

export const claudeCode: Adapter = {
  id: "claude-code",
  label: "Claude Code",
  async discover(opts: DiscoverOptions): Promise<Conversation[]> {
    const root = path.join(opts.home, ".claude", "projects");
    const files = await walk(root, (p) => p.endsWith(".jsonl"));
    const out: Conversation[] = [];
    for (const f of files) {
      try {
        const c = await parseSession(f, opts.includeThinking);
        if (c) out.push(c);
      } catch {
        /* skip unreadable session */
      }
    }
    return out;
  },
};

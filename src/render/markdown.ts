import { Conversation, Message } from "../types.js";

const ROLE_LABEL: Record<Message["role"], string> = {
  user: "🧑 User",
  assistant: "🤖 Assistant",
  system: "⚙️ System",
  tool: "🔧 Tool",
};

export function renderMarkdown(c: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${c.title || "(untitled conversation)"}`);
  lines.push("");
  const meta: string[] = [`**Source:** ${c.sourceLabel}`];
  if (c.model) meta.push(`**Model:** ${c.model}`);
  if (c.createdAt) meta.push(`**Created:** ${c.createdAt}`);
  if (c.updatedAt && c.updatedAt !== c.createdAt) meta.push(`**Updated:** ${c.updatedAt}`);
  if (c.projectPath) meta.push(`**Project:** \`${c.projectPath}\``);
  meta.push(`**Messages:** ${c.messages.length}`);
  lines.push(meta.join("  \n"));
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const m of c.messages) {
    const ts = m.timestamp ? `  \n_${m.timestamp}_` : "";
    lines.push(`### ${ROLE_LABEL[m.role] ?? "💬 " + m.role}${ts}`);
    lines.push("");
    lines.push(m.text);
    lines.push("");
  }
  return lines.join("\n");
}

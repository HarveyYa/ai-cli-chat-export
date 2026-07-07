---
name: export-ai-chats
description: Exports the user's local command-line AI assistant conversation history — Claude Code, Codex CLI, opencode, Gemini/Qwen CLI, Aider, Cursor CLI, Goose — into portable Markdown + JSON. Use when the user wants to back up, export, archive, save, or migrate their local AI CLI chat logs, or asks where their past CLI AI conversations are stored. Read-only and fully local; not for web chats (ChatGPT/Claude.ai) which have no local file.
---

# Export local CLI AI chat history

Runs [`ai-cli-chat-export`](https://github.com/HarveyYa/ai-cli-chat-export), a
zero-dependency, **read-only** CLI that discovers conversation logs left on disk
by local command-line AI tools and exports them to portable Markdown + JSON.

## When to use

Trigger when the user wants to **back up / export / archive / migrate** their
**local** AI CLI conversations, or asks where past sessions are stored. It covers
Claude Code, Codex CLI, opencode, Gemini CLI, Qwen Code, Aider, Cursor CLI, and
Goose. It does **not** handle web chats (ChatGPT, Claude.ai) — those live on the
provider's servers with no local file to read.

## How to run

Use `npx` so nothing needs to be installed first.

1. **Preview** what's on the machine (writes nothing):
   ```bash
   npx ai-cli-chat-export --list
   ```
   Report the per-source counts back to the user before writing anything.

2. **Export** (incremental by default — re-running only writes new or changed
   conversations, never duplicates):
   ```bash
   npx ai-cli-chat-export
   ```
   Output goes to `./ai-conversations-export/` unless the user names another dir.

## Useful options

- `-o <dir>` — output directory (default `./ai-conversations-export`)
- `-s <list>` — limit sources: `claude-code, codex, opencode, gemini, qwen, aider, cursor, goose`
- `-f <md|json>` — format (default: both)
- `--since / --until YYYY-MM-DD` — date-filter conversations
- `--include-thinking` — include model reasoning/thinking blocks
- `--full` — force a complete re-export, ignoring incremental state

## After exporting

Point the user to `<out>/index.md` (human-browsable table of contents) and
`<out>/index.json` (machine-readable manifest). Summarize how many conversations
were exported and from which sources. Never modify or delete the source logs —
this tool only reads them.

> [简体中文](https://github.com/HarveyYa/ai-cli-chat-export/blob/main/README.md) · **English**

# ai-cli-chat-export

[![npm](https://img.shields.io/npm/v/ai-cli-chat-export?logo=npm&color=cb3837)](https://www.npmjs.com/package/ai-cli-chat-export)

One command to export **all** your AI conversation history from the command-line
tools on your machine into portable Markdown + JSON. For **web** chats (ChatGPT,
Claude.ai, …) see the companion [`ai-web-chat-export`](https://github.com/HarveyYa/ai-web-chat-export)
userscript.

- **Read-only.** Never modifies or deletes source files.
- **Local-only.** Nothing is uploaded anywhere.
- **Incremental by default.** Re-running writes only new or changed conversations; already-exported, unchanged ones are skipped — no duplicate copies.
- **Zero runtime dependencies.** Pure Node (uses the built-in `node:sqlite`).

## Supported sources

| Source | Where it reads | Status |
|---|---|---|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | ✅ verified against real data |
| **Codex CLI** | `~/.codex/sessions/**/rollout-*.jsonl` | ✅ verified against real data |
| **opencode** | `~/.local/share/opencode/opencode.db` (SQLite) | ✅ verified against real data |
| **Gemini CLI** | `~/.gemini/tmp/**/{logs.json,checkpoint*.json}` | ⚠️ best-effort (upstream format; no local data to verify) |
| **Qwen Code** | `~/.qwen/tmp/**/{logs.json,checkpoint*.json}` | ⚠️ best-effort (upstream format; no local data to verify) |
| **Aider** | per-project `.aider.chat.history.md` (override via `AIDER_CHAT_HISTORY_FILE`) | ⚠️ best-effort (not yet verified against real data) |
| **Cursor CLI** | `~/.cursor/chats/` | ⚠️ best-effort (not yet verified against real data) |
| **Goose** | `~/.local/share/goose/sessions/` (SQLite `sessions.db`; legacy `*.jsonl`) | ⚠️ best-effort (not yet verified against real data) |

This tool is **local CLI only** — it reads conversation logs that command-line
AI tools leave on your disk. **Web conversations** (ChatGPT, Claude.ai, …) live on
the provider's servers with no local file to read; they are handled by a separate
companion **userscript** (browser extension) project, which exports the page you
are looking at, from within your own logged-in session.

## Install

Published on npm: [`ai-cli-chat-export`](https://www.npmjs.com/package/ai-cli-chat-export).

```bash
# No install, just run (best for one-off use)
npx ai-cli-chat-export

# Global install, then use the short command
npm install -g ai-cli-chat-export
```

A global install gives you two equivalent commands: the full `ai-cli-chat-export`
and the short alias **`acx`**. They do exactly the same thing — type `acx` for short.

## Usage

> Examples below use the short alias **`acx`** (identical to the full
> `ai-cli-chat-export`). Without a global install, replace `acx` with
> `npx ai-cli-chat-export`.

```bash
# Export everything found on this machine → ./ai-conversations-export
acx

# See what's here without writing anything
acx --list

# Only specific sources
acx --source claude-code,codex

# Filter by date, Markdown only, include model reasoning
acx --since 2026-01-01 --format md --include-thinking
```

### Options

```
-o, --out <dir>        Output directory (default: ./ai-conversations-export)
-f, --format <list>    md,json (default: both)
-s, --source <list>    Restrict to sources: claude-code, codex, opencode,
                       gemini, qwen, aider, cursor, goose
    --since <date>     Only conversations updated on/after YYYY-MM-DD
    --until <date>     Only conversations updated on/before YYYY-MM-DD
    --include-thinking Include model reasoning/thinking blocks
    --full             Re-export everything, ignoring incremental state
                       (alias: --force)
-l, --list             List what would be exported (tagged new/updated/skip);
                       write nothing
-h, --help             Show help
```

### Incremental export

Incremental **by default**: an `.export-state.json` in the output directory records each
conversation's update time and a content hash. On re-run, only **new** or **content-changed**
conversations are written (overwriting in place); the rest are skipped — no more `-2`/`-3`
copies like earlier versions produced. Pass `--full` to force a complete re-export. An existing
pre-incremental export directory is adopted automatically from its `index.json` on the first
incremental run, so nothing is re-exported wholesale.

## Use as a Claude Code plugin

This repo is itself a Claude Code marketplace, with a bundled `/export-ai-chats`
skill. Inside Claude Code:

```
/plugin marketplace add HarveyYa/ai-cli-chat-export
/plugin install ai-cli-chat-export@ai-cli-chat-export
```

Once installed, just tell Claude "export my local AI chat history" or type
`/export-ai-chats`, and it runs this tool for you.

## Output layout

```
ai-conversations-export/
├── index.md                # human-browsable table of contents
├── index.json              # machine-readable manifest
├── claude-code/
│   └── 2026-07-06-<title>.md / .json
├── codex/
├── opencode/
└── gemini/ …
```

Each conversation becomes one Markdown file (readable) and/or one JSON file
(lossless canonical form: `{ id, source, title, createdAt, model, messages[] }`).

## Requirements

Node ≥ 22.5 (for the built-in SQLite reader used by the opencode adapter).
On Node 22.5–23 the tool transparently re-execs itself with
`--experimental-sqlite`; on Node ≥ 24 SQLite is stable and no flag is needed.

## Extending

Add a new tool in one file: implement the `Adapter` interface
(`src/types.ts`) — `discover()` returns `Conversation[]` in the canonical
schema — and register it in `src/adapters/index.ts`. Renderers and the CLI
need no changes.

## Development

```bash
npm install      # dev deps only (typescript, @types/node)
npm run build    # → dist/
node dist/cli.js --list
```

## License

MIT

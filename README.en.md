> [简体中文](./README.md) · **English**

# ai-cli-chat-export

One command to export **all** your AI conversation history from the command-line
tools on your machine into portable Markdown + JSON. For **web** chats (ChatGPT,
Claude.ai, …) see the companion [`ai-web-chat-export`](../ai-web-chat-export)
userscript.

- **Read-only.** Never modifies or deletes source files.
- **Local-only.** Nothing is uploaded anywhere.
- **Zero runtime dependencies.** Pure Node (uses the built-in `node:sqlite`).

## Supported sources

| Source | Where it reads | Status |
|---|---|---|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | ✅ verified against real data |
| **Codex CLI** | `~/.codex/sessions/**/rollout-*.jsonl` | ✅ verified against real data |
| **opencode** | `~/.local/share/opencode/opencode.db` (SQLite) | ✅ verified against real data |
| **Gemini CLI** | `~/.gemini/tmp/**/{logs.json,checkpoint*.json}` | ⚠️ best-effort (upstream format; no local data to verify) |
| **Qwen Code** | `~/.qwen/tmp/**/{logs.json,checkpoint*.json}` | ⚠️ best-effort (upstream format; no local data to verify) |

This tool is **local CLI only** — it reads conversation logs that command-line
AI tools leave on your disk. **Web conversations** (ChatGPT, Claude.ai, …) live on
the provider's servers with no local file to read; they are handled by a separate
companion **userscript** (browser extension) project, which exports the page you
are looking at, from within your own logged-in session.

## Usage

> Installs two equivalent commands: the full `ai-cli-chat-export` and the short
> alias **`acx`**. Examples below use the full name; type `acx` for short.

```bash
# Export everything found on this machine → ./ai-conversations-export
npx ai-cli-chat-export

# See what's here without writing anything
npx ai-cli-chat-export --list

# Only specific sources
npx ai-cli-chat-export --source claude-code,codex

# Filter by date, Markdown only, include model reasoning
npx ai-cli-chat-export --since 2026-01-01 --format md --include-thinking
```

### Options

```
-o, --out <dir>        Output directory (default: ./ai-conversations-export)
-f, --format <list>    md,json (default: both)
-s, --source <list>    Restrict to sources: claude-code, codex, opencode,
                       gemini, qwen
    --since <date>     Only conversations updated on/after YYYY-MM-DD
    --until <date>     Only conversations updated on/before YYYY-MM-DD
    --include-thinking Include model reasoning/thinking blocks
-l, --list             List what would be exported; write nothing
-h, --help             Show help
```

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

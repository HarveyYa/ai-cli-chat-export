> **简体中文** · [English](https://github.com/HarveyYa/ai-cli-chat-export/blob/main/README.en.md)

# ai-cli-chat-export

[![npm](https://img.shields.io/npm/v/ai-cli-chat-export?logo=npm&color=cb3837)](https://www.npmjs.com/package/ai-cli-chat-export)

一条命令，把你机器上各种**命令行 AI 工具**的对话历史**全部**导出成便携的
Markdown + JSON。**网页版**对话（ChatGPT、Claude.ai 等）请用配套的
[`ai-web-chat-export`](https://github.com/HarveyYa/ai-web-chat-export) 油猴脚本。

- **只读。** 绝不修改或删除源文件。
- **纯本地。** 不上传任何东西到任何地方。
- **默认增量。** 重复运行只写新增或有改动的对话，已导出且未变化的跳过，不产生重复副本。
- **零运行时依赖。** 纯 Node（使用内置的 `node:sqlite`）。

## 支持的来源

| 来源 | 读取位置 | 状态 |
|---|---|---|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | ✅ 已用真实数据验证 |
| **Codex CLI** | `~/.codex/sessions/**/rollout-*.jsonl` | ✅ 已用真实数据验证 |
| **opencode** | `~/.local/share/opencode/opencode.db`（SQLite） | ✅ 已用真实数据验证 |
| **Gemini CLI** | `~/.gemini/tmp/**/{logs.json,checkpoint*.json}` | ⚠️ 尽力而为（上游格式，无本地数据可验证） |
| **Qwen Code** | `~/.qwen/tmp/**/{logs.json,checkpoint*.json}` | ⚠️ 尽力而为（上游格式，无本地数据可验证） |
| **Aider** | 各项目根目录的 `.aider.chat.history.md`（可用 `AIDER_CHAT_HISTORY_FILE` 覆盖） | ⚠️ 尽力而为（尚未用真实数据验证） |
| **Cursor CLI** | `~/.cursor/chats/` | ⚠️ 尽力而为（尚未用真实数据验证） |
| **Goose** | `~/.local/share/goose/sessions/`（新版 SQLite `sessions.db`，旧版 `*.jsonl`） | ⚠️ 尽力而为（尚未用真实数据验证） |

本工具**只管本地 CLI**——读取命令行 AI 工具留在你磁盘上的对话日志。**网页版对话**
（ChatGPT、Claude.ai 等）存在服务商服务器上，本地没有文件可读；它们由配套的独立
**油猴脚本**（浏览器扩展）项目处理，在你自己已登录的会话里导出你正在看的页面。

## 安装

已发布到 npm：[`ai-cli-chat-export`](https://www.npmjs.com/package/ai-cli-chat-export)。

```bash
# 免安装，直接跑（临时使用推荐）
npx ai-cli-chat-export

# 全局安装，之后可直接用短命令
npm install -g ai-cli-chat-export
```

全局安装后会得到两个等价命令：完整名 `ai-cli-chat-export` 和短别名 **`acx`**。
两者功能完全相同，日常直接敲 `acx` 最省事。

## 用法

> 下方示例用短别名 **`acx`**（等价于完整名 `ai-cli-chat-export`）。
> 若没有全局安装，把 `acx` 换成 `npx ai-cli-chat-export` 即可。

```bash
# 导出本机找到的所有对话 → ./ai-conversations-export
acx

# 只看有什么、不写任何文件
acx --list

# 只导指定来源
acx --source claude-code,codex

# 按日期筛选、只要 Markdown、包含模型思考过程
acx --since 2026-01-01 --format md --include-thinking
```

### 选项

```
-o, --out <dir>        输出目录（默认：./ai-conversations-export）
-f, --format <list>    md,json（默认：两者都要）
-s, --source <list>    限定来源：claude-code, codex, opencode,
                       gemini, qwen, aider, cursor, goose
    --since <date>     只要在 YYYY-MM-DD 当天或之后更新的对话
    --until <date>     只要在 YYYY-MM-DD 当天或之前更新的对话
    --include-thinking 包含模型的推理/思考块
    --full             全量重导，忽略增量状态（别名 --force）
-l, --list             列出将导出什么（标注 新增/更新/跳过）；不写任何文件
-h, --help             显示帮助
```

### 增量导出

默认**增量**：输出目录里维护一份 `.export-state.json`，记录每段对话的更新时间与内容哈希。
重复运行时，只有**新增**或**内容有变化**的对话会被（覆盖）写入，其余跳过——不再像早期版本那样产生
`-2`、`-3` 副本。想强制全量重导时加 `--full`。已有的旧导出目录首次增量运行会自动沿用其
`index.json`，不会把存量全部当成新增。

## 输出结构

```
ai-conversations-export/
├── index.md                # 人类可浏览的目录
├── index.json              # 机器可读的清单
├── claude-code/
│   └── 2026-07-06-<title>.md / .json
├── codex/
├── opencode/
└── gemini/ …
```

每段对话生成一个 Markdown 文件（易读）和/或一个 JSON 文件（无损的规范形式：
`{ id, source, title, createdAt, model, messages[] }`）。

## 环境要求

Node ≥ 22.5（opencode 适配器用到的内置 SQLite 读取器需要）。
在 Node 22.5–23 上，工具会透明地用 `--experimental-sqlite` 重新执行自身；
在 Node ≥ 24 上 SQLite 已稳定，无需任何标志。

## 扩展

新增一个工具只需一个文件：实现 `Adapter` 接口（`src/types.ts`）——
`discover()` 返回规范 schema 的 `Conversation[]`——并在
`src/adapters/index.ts` 里注册。渲染器和 CLI 都无需改动。

## 开发

```bash
npm install      # 仅开发依赖（typescript, @types/node）
npm run build    # → dist/
node dist/cli.js --list
```

## 许可证

MIT

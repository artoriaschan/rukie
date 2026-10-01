# Neant

Neant 是桌面端 coding agent。先做 headless agent：负责 agent loop、工具、MCP、skills 和上下文注入。之后桌面 UI 会通过 server 驱动同一个 agent。

## Language

### 运行

**Agent Core**:
headless 的 agent 运行时。CLI 等前端（以后还有 server）通过它来运行 session。
_Avoid_: engine, backend

**Session**:
用户与 agent 在同一个工作目录下的一段连续对话，可以凭 id 恢复。
_Avoid_: conversation, thread, chat

**Transcript**:
一个 session 中按顺序排列的消息，只追加不修改。模型当时看到的内容，原样记录在里面。
_Avoid_: history, log

**Turn**:
一次模型调用，加上这次调用返回的工具调用。
_Avoid_: step, round

**Run**:
处理一条用户 prompt，直到 agent 停下为止。一个 run 包含一个或多个 turn。
_Avoid_: task, job

**Session Store**:
transcript 的持久化位置。headless CLI 存成 JSONL 文件，桌面端存到 SQLite。
_Avoid_: database, history store

### 给模型的上下文

**System Prompt**:
固定的指令，规定 agent 的身份和行为方式。所有项目都用同一份。
_Avoid_: preamble

**System Reminder**:
harness 注入给模型、用户看不到的上下文，用 `<system-reminder>` 包裹，附在 user 消息或 tool result 上。注入之后就成为 transcript 的一部分。
_Avoid_: hint, injected context, attachment

**Project Instructions**:
用户为项目写的说明（`AGENTS.md`，没有时用 `CLAUDE.md`），以 system reminder 的形式交给模型。
_Avoid_: memory, rules file

### 能力

**Tool**:
模型可以调用的动作。来源有三种：内置、来自 MCP server，或者是用来加载 skill 的那个工具。
_Avoid_: function, command

**Skill**:
由 `SKILL.md` 定义的一个指令目录，遵循 Agent Skills 规范。模型一开始只看到它的 name 和 description，需要时才加载正文。
_Avoid_: plugin, recipe

**MCP Server**:
通过 Model Context Protocol 提供工具的外部进程或 endpoint。它的工具命名为 `mcp__<server>__<tool>`。
_Avoid_: connector, integration

**Trusted Project**:
用户明确表示信任的项目目录。只有 trusted project，其项目级 `.mcp.json` 才会被加载。项目级配置任何情况下都不能定义 provider。
_Avoid_: safe project, whitelisted repo

**Skill Invocation**:
用户在 prompt 开头写 `/name`，主动展开一个 skill。展开的正文以 system reminder 形式附在消息上。
_Avoid_: slash command, macro

**Permission Decision**:
对单次工具调用在执行前做出的判定：`allow`、`deny` 或 `ask`。headless 模式下 `ask` 按 `deny` 处理。
_Avoid_: approval, consent

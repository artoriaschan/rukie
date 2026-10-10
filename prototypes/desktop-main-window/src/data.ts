// PROTOTYPE fake data. Shapes loosely follow Agent Core: permission replies are
// allow | deny | allow-session; permission modes are ask | auto-review | full-access.

export type Connection = "connected" | "reconnecting" | "disconnected";
export type PermissionMode = "ask" | "auto-review" | "full-access";
export type PermissionReply = "allow" | "deny" | "allow-session";
export type Tool = "Read" | "Bash" | "Edit" | "Grep";

/** projectId null: a chat in the default workspace, not bound to a project directory. */
export interface SessionItem {
  id: string;
  title: string;
  projectId: string | null;
  pinned: boolean;
  /** Minutes since last update; the Recent group sorts by this. */
  updatedMin: number;
  /** Minutes since creation; the alternative Recent sort order. */
  createdMin: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
}

export interface Step {
  kind: "step";
  id: string;
  tool: Tool;
  title: string;
  status: "done" | "error" | "running";
  ms: number;
  output?: string[];
  diff?: { sign: "+" | "-" | " "; text: string }[];
}

export interface Permission {
  kind: "permission";
  id: string;
  tool: Tool;
  command: string;
  reason: string;
}

export type TurnItem = { kind: "text"; id: string; text: string } | Step | Permission;

export interface Turn {
  id: string;
  prompt: string;
  /** done: collapsed to its final reply; stopped: user aborted; live: the current Run. */
  status: "done" | "stopped" | "live";
  elapsed: string;
  items: TurnItem[];
}

export const projects: Project[] = [
  { id: "rukie", name: "rukie", path: "~/Desktop/Work/person/rukie" },
  { id: "pi", name: "pi", path: "~/Desktop/Work/open_sources/pi" },
  { id: "dsh", name: "dsh-TUI", path: "~/Desktop/Work/open_sources/dsh-TUI" },
  { id: "zcode", name: "ZCode", path: "~/Desktop/Work/open_sources/ZCode" },
];

/** s1 is the fully scripted Session; the rest show a placeholder history. */
export const initialSessions: SessionItem[] = [
  { id: "s1", title: "修复 Session resume 后的 Todo 丢失", projectId: "rukie", pinned: true, updatedMin: 2, createdMin: 4300 },
  { id: "s2", title: "桌面端 wire 协议草稿", projectId: "rukie", pinned: false, updatedMin: 65, createdMin: 900 },
  { id: "c1", title: "解释 Effect 的 Layer 与 ManagedRuntime", projectId: null, pinned: true, updatedMin: 180, createdMin: 200 },
  { id: "s3", title: "TUI 小终端下的状态栏截断", projectId: "rukie", pinned: false, updatedMin: 1500, createdMin: 8000 },
  { id: "c2", title: "写一封周报邮件", projectId: null, pinned: false, updatedMin: 2900, createdMin: 2950 },
  { id: "s4", title: "梳理 pi-durable lease 实现", projectId: "pi", pinned: false, updatedMin: 4400, createdMin: 4500 },
  { id: "s5", title: "对照 dsh-TUI 滚动跟随行为", projectId: "dsh", pinned: false, updatedMin: 7300, createdMin: 12000 },
  { id: "c3", title: "比较 SQLite 与 JSONL 的写放大", projectId: null, pinned: false, updatedMin: 10100, createdMin: 10200 },
];

export const turns: Turn[] = [
  {
    id: "turn1",
    prompt: "resume 一个有 Todo 的 Session 后，Todo 列表是空的。帮我定位原因。",
    status: "done",
    elapsed: "1分钟 12秒",
    items: [
      { kind: "text", id: "x1", text: "先看 Todo 状态如何持久化，以及 resume 时从哪里重建。" },
      { kind: "step", id: "t1", tool: "Grep", title: '"todo" packages/agent/src', status: "done", ms: 120, output: ["packages/agent/src/tools/todo/state.ts:14", "packages/agent/src/tools/todo/index.ts:41", "packages/agent/src/session/resume.ts:88"] },
      { kind: "step", id: "t2", tool: "Read", title: "packages/agent/src/session/resume.ts", status: "done", ms: 40, output: ["… 212 行"] },
      { kind: "text", id: "x2", text: "原因在 `resume.ts`：重建 Tool State 时跳过了 `todo` 的 snapshot 条目，所以恢复后 Todo 为空。修复只需删掉这个跳过分支。" },
    ],
  },
  {
    id: "turn2",
    prompt: "按这个方案修复，并跑相关测试。",
    status: "stopped",
    elapsed: "19秒",
    items: [
      { kind: "text", id: "x3", text: "我先改 `resume.ts`，再跑 resume 测试。" },
      { kind: "step", id: "t3", tool: "Edit", title: "packages/agent/src/session/resume.ts", status: "done", ms: 15, diff: [
        { sign: " ", text: "  for (const entry of snapshot.toolState) {" },
        { sign: "-", text: '    if (entry.tool === "todo") continue;' },
        { sign: "+", text: "    toolState.restore(entry.tool, entry.value);" },
        { sign: " ", text: "  }" },
      ] },
    ],
  },
  {
    id: "turn3",
    prompt: "继续，把测试跑通。",
    status: "live",
    elapsed: "42秒",
    items: [
      { kind: "step", id: "t4", tool: "Bash", title: "bun test packages/agent/tests/session/resume.test.ts", status: "error", ms: 2310, output: ["✗ restores todo items after resume", "  Expected: 2 items", "  Received: 0 items", "1 fail · 14 pass"] },
      { kind: "text", id: "x4", text: "还有一处缓存没有失效。修复后需要重新生成测试 fixture，这条命令会写入 `tests/fixtures/`。" },
      { kind: "permission", id: "p1", tool: "Bash", command: "bun scripts/regen-fixtures.ts --write tests/fixtures/sessions", reason: "写入不受允许规则覆盖的路径。" },
    ],
  },
];

/** Pinned Session summary: facts derivable from the Transcript and the project working tree. */
export const summary = {
  project: "rukie",
  branch: "fix/session-resume-todo",
  changes: [
    { path: "packages/agent/src/session/resume.ts", add: 1, del: 1 },
    { path: "packages/agent/src/tools/todo/state.ts", add: 6, del: 2 },
  ],
  todos: [
    { text: "定位 Todo 丢失原因", done: true },
    { text: "修复 resume 重建", done: true },
    { text: "重新生成 fixture 并跑通测试", done: false },
  ],
  subagents: { done: 2, running: 1 },
  sources: ["docs/adr/0009-subagent-resume-outcomes.md", "packages/agent/tests/session/resume.test.ts"],
};

/** Thinking levels the model accepts, a subset of Agent Core's THINKING_LEVELS. */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Model catalog row; provider definitions come from user settings, the composer only lists them. */
export interface ModelItem {
  id: string;
  name: string;
  provider: string;
  descriptionKey: "model.sonnet" | "model.opus" | "model.haiku" | "model.gpt" | "model.deepseek";
  contextWindow: number;
  input: ("text" | "image")[];
  thinking: ThinkingLevel[];
}

export const models: ModelItem[] = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "Anthropic", descriptionKey: "model.sonnet", contextWindow: 1_000_000, input: ["text", "image"], thinking: ["off", "low", "medium", "high", "max"] },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "Anthropic", descriptionKey: "model.opus", contextWindow: 1_000_000, input: ["text", "image"], thinking: ["off", "low", "medium", "high", "max"] },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "Anthropic", descriptionKey: "model.haiku", contextWindow: 200_000, input: ["text", "image"], thinking: ["off", "low", "medium", "high"] },
  { id: "gpt-6", name: "GPT-6", provider: "OpenAI", descriptionKey: "model.gpt", contextWindow: 400_000, input: ["text", "image"], thinking: ["minimal", "low", "medium", "high", "xhigh"] },
  { id: "deepseek-v4", name: "DeepSeek V4", provider: "DeepSeek", descriptionKey: "model.deepseek", contextWindow: 128_000, input: ["text"], thinking: ["off", "high"] },
];

/** Context usage for the scripted Session, split the way Pencil C08 shows it. */
export const contextUsage = { system: 5_200, tools: 7_400, toolCount: 23, messages: 228_000, opening: 16_000, compactAt: 0.8 };

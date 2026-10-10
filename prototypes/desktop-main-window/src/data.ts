// PROTOTYPE fake data. Shapes loosely follow Agent Core: permission replies are
// allow | deny | allow-session; permission modes are ask | auto-review | full-access.

export type Connection = "connected" | "reconnecting" | "disconnected";
export type PermissionMode = "ask" | "auto-review" | "full-access";
export type PermissionReply = "allow" | "deny" | "allow-session";

export interface SessionItem {
  id: string;
  title: string;
  updated: string;
  running?: boolean;
  waiting?: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  sessions: SessionItem[];
}

export type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; tool: "Read" | "Bash" | "Edit" | "Grep"; title: string; status: "done" | "error" | "running"; ms?: number; output?: string[]; diff?: { sign: "+" | "-" | " "; text: string }[] }
  | { kind: "permission"; id: string; tool: string; command: string; reason: string };

export const projects: Project[] = [
  {
    id: "rukie",
    name: "rukie",
    path: "~/Desktop/Work/person/rukie",
    sessions: [
      { id: "s1", title: "修复 Session resume 后的 Todo 丢失", updated: "2 分钟前", running: true, waiting: true },
      { id: "s2", title: "桌面端 wire 协议草稿", updated: "1 小时前" },
      { id: "s3", title: "TUI 小终端下的状态栏截断", updated: "昨天" },
    ],
  },
  {
    id: "pi",
    name: "pi",
    path: "~/Desktop/Work/open_sources/pi",
    sessions: [{ id: "s4", title: "梳理 pi-durable lease 实现", updated: "3 天前" }],
  },
];

export const transcript: Item[] = [
  { kind: "user", id: "u1", text: "resume 一个有 Todo 的 Session 后，Todo 列表是空的。帮我定位并修复。" },
  { kind: "assistant", id: "a1", text: "先看 Todo 状态如何持久化，以及 resume 时从哪里重建。" },
  { kind: "tool", id: "t1", tool: "Grep", title: 'Grep "todo" packages/agent/src/tools', status: "done", ms: 120, output: ["packages/agent/src/tools/todo/state.ts:14", "packages/agent/src/tools/todo/index.ts:41", "packages/agent/src/session/resume.ts:88"] },
  { kind: "tool", id: "t2", tool: "Read", title: "Read packages/agent/src/session/resume.ts", status: "done", ms: 40, output: ["… 212 行"] },
  {
    kind: "assistant",
    id: "a2",
    text: "原因找到了：`resume.ts` 重建 Tool State 时跳过了 `todo` 的 snapshot 条目。我补上这个分支，然后跑相关测试。",
  },
  {
    kind: "tool",
    id: "t3",
    tool: "Edit",
    title: "Edit packages/agent/src/session/resume.ts",
    status: "done",
    ms: 15,
    diff: [
      { sign: " ", text: "  for (const entry of snapshot.toolState) {" },
      { sign: "-", text: '    if (entry.tool === "todo") continue;' },
      { sign: "+", text: "    toolState.restore(entry.tool, entry.value);" },
      { sign: " ", text: "  }" },
    ],
  },
  { kind: "tool", id: "t4", tool: "Bash", title: "bun test packages/agent/tests/session/resume.test.ts", status: "error", ms: 2310, output: ["✗ restores todo items after resume", "  Expected: 2 items", "  Received: 0 items", "1 fail · 14 pass"] },
  { kind: "assistant", id: "a3", text: "还有一处缓存没有失效。修复后需要重新生成测试 fixture，这条命令会写入 `tests/fixtures/`。" },
  { kind: "permission", id: "p1", tool: "Bash", command: "bun scripts/regen-fixtures.ts --write tests/fixtures/sessions", reason: "写入项目目录外不受规则覆盖的路径，需要确认。" },
];

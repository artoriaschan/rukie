import { renderComponent } from "../../helpers/render-component";
import { afterEach, expect, test } from "bun:test";
import { createRef, useState } from "react";
import {
  Box,
  ThemedText,
  ThemeProvider,
  dark,
  light,
  useInput,
  type ScrollBoxHandle,
} from "../../../../src/ink/index.ts";
import type { McpServerView } from "@rukie/shared";
import { McpPanel, GoalTodoPanel, SubagentPanel } from "../../../../src/tui/components";
import {
  mcpPanelChoices,
  mcpPanelHeight,
  type McpPanelProps,
  type McpPanelPage,
} from "../../../../src/tui/components/mcp-panel";
import { createTerminal } from "../../helpers/terminal";

const server = (name: string, scope: "user" | "project" = "user"): McpServerView => ({
  name,
  scope,
  configPath: scope === "user" ? "/home/.rukie/mcp.json" : "/work/.mcp.json",
  transport: "stdio",
  command: "mcp-command",
  status: "connected",
  auth: "none",
  toolCount: 0,
  tools: [],
});

test("loading resolves from props and empty configuration shows both paths and trust guidance", async () => {
  const page = {
    kind: "servers",
    snapshot: null,
    configPaths: { user: "/home/.rukie/mcp.json", project: "/work/.mcp.json" },
  } as const;
  const terminal = await mount({ page });
  expect(terminal.screen().join("\n")).toContain("Reading MCP status…");
  terminal.update({ page: { ...page, snapshot: { servers: [], configErrors: [] } } });
  await terminal.waitFor(() => terminal.screen().join("\n").includes("No MCP servers configured"));
  const screen = terminal.screen().join("\n");
  expect(screen).toContain("/home/.rukie/mcp.json");
  expect(screen).toContain("/work/.mcp.json");
  expect(screen).toContain("trusted project");
});

test("file diagnostics remain beside legal servers and expose a localized retry entry", async () => {
  const terminal = await mount({
    locale: "zh",
    selected: "retry",
    page: {
      kind: "servers",
      snapshot: {
        servers: [server("usable")],
        configErrors: [
          {
            scope: "project",
            path: "/work/.mcp.json",
            error: "invalid file",
            errorData: { code: "mcp-config-file-invalid", params: { source: "/work/.mcp.json" } },
          },
        ],
      },
      configPaths: { user: "user.json", project: "project.json" },
    },
  });
  const screen = terminal.screen().join("\n");
  expect(screen).toContain("usable");
  expect(screen).toContain("必须包含 mcpServers 对象");
  expect(screen).toContain("❯ 重试");
  const y = terminal.screen().findIndex((line) => line.includes("❯ 重试"));
  terminal.stdin.write(`\x1b[<0;5;${y + 1}M\x1b[<0;5;${y + 1}m`);
  await terminal.waitFor(() => terminal.activated.length > 0);
  expect(terminal.activated).toEqual(["retry"]);
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function mount(overrides: Partial<McpPanelProps> = {}, columns = 80, rows = 24) {
  const terminal = createTerminal(columns, rows);
  let update = (_patch: Partial<McpPanelProps>) => {};
  const activated: string[] = [];
  function View() {
    const [props, setProps] = useState<McpPanelProps>({
      page: {
        kind: "servers",
        snapshot: {
          servers: [server("zeta"), server("beta", "project"), server("alpha", "project")],
          configErrors: [],
        },
        configPaths: { user: "/home/.rukie/mcp.json", project: "/work/.mcp.json" },
      },
      selected: "server:alpha",
      columns,
      maxHeight: 14,
      locale: "en",
      onActivate: (key) => activated.push(key),
      ...overrides,
    });
    update = (patch) => setProps((current) => ({ ...current, ...patch }));
    useInput((_input, _key, event) => {
      if (event.isPasted || !["up", "down"].includes(event.keypress.name ?? "")) return;
      setProps((current) => {
        const choices = mcpPanelChoices(current.page);
        const index = choices.indexOf(current.selected);
        const selected =
          choices[
            (index + (event.keypress.name === "down" ? 1 : -1) + choices.length) % choices.length
          ];
        return selected ? { ...current, selected } : current;
      });
    });
    return (
      <ThemeProvider>
        <Box flexDirection="column">
          <McpPanel {...props} />
          <ThemedText>next-field</ThemedText>
        </Box>
      </ThemeProvider>
    );
  }
  const app = renderComponent(<View />, { ...terminal });
  cleanups.push(async () => {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  });
  await terminal.flush();
  return { ...terminal, update, activated };
}

test("server list groups project before user, sorts names, and uses the current picker theme", async () => {
  const terminal = await mount();
  const lines = terminal.screen();
  expect(lines.join("\n")).toContain("Manage MCP servers (3)");
  expect(lines.findIndex((line) => line.includes("Project · /work/.mcp.json"))).toBeLessThan(
    lines.findIndex((line) => line.includes("User · /home/.rukie/mcp.json")),
  );
  expect(lines.findIndex((line) => line.includes("alpha"))).toBeLessThan(
    lines.findIndex((line) => line.includes("beta")),
  );
  expect(lines.join("\n")).toContain("connected · 0 tools");
  const y = lines.findIndex((line) => line.includes("❯ alpha"));
  expect(y).toBeGreaterThan(0);
  const row = terminal.terminal.buffer.active.getLine(y)!;
  expect(row.getCell(4)!.getFgColor()).toBe(Number.parseInt(dark.suggestion.slice(1), 16));
  expect(row.getCell(4)!.isBold()).toBeFalsy();
  expect(lines.findIndex((line) => line.includes("next-field"))).toBeLessThanOrEqual(14);
});

test("a bounded focus window stays in the screen budget and hover only activates on click", async () => {
  const servers = Array.from({ length: 30 }, (_, index) =>
    server(`server-${String(index).padStart(2, "0")}`),
  );
  const terminal = await mount(
    {
      page: {
        kind: "servers",
        snapshot: { servers, configErrors: [] },
        configPaths: { user: "user.json", project: "project.json" },
      },
      maxHeight: 8,
      selected: "server:server-15",
    },
    40,
    12,
  );
  const lines = terminal.screen();
  expect(lines.findIndex((line) => line.includes("next-field"))).toBe(8);
  expect(lines.join("\n")).toContain("❯ server-15");
  expect(lines.join("\n")).toContain("↑");
  expect(lines.join("\n")).toContain("↓");
  expect(lines.join("\n")).not.toContain("server-00");
  const y = lines.findIndex((line) => line.includes("server-16"));
  expect(y).toBeGreaterThan(0);
  terminal.stdin.write(`\x1b[<35;5;${y + 1}M`);
  await terminal.waitFor(
    () =>
      terminal.terminal.buffer.active.getLine(y)!.getCell(4)!.getBgColor() ===
      Number.parseInt(dark.badgeHoverBackground.slice(1), 16),
  );
  expect(terminal.screen().join("\n")).toContain("❯ server-15");
  expect(terminal.activated).toEqual([]);
  terminal.stdin.write(`\x1b[<0;5;${y + 1}M\x1b[<0;5;${y + 1}m`);
  await terminal.waitFor(() => terminal.activated.length > 0);
  expect(terminal.activated).toEqual(["server:server-16"]);
  terminal.update({ selected: "server:server-29" });
  await terminal.waitFor(() => terminal.screen().join("\n").includes("❯ server-29"));
  expect(terminal.screen().findIndex((line) => line.includes("next-field"))).toBe(8);
});

test("server details localize authentication failures, pin actions and expose a separate body reader", async () => {
  const scrollRef = createRef<ScrollBoxHandle>();
  const remote: McpServerView = {
    ...server("remote"),
    transport: "http",
    auth: "oauth",
    status: "needs-auth",
    url: "https://example.test/mcp",
    error: "unknown server",
    errorData: { code: "mcp-unknown-server", params: { server: "remote" } },
  };
  const terminal = await mount(
    {
      page: { kind: "server", server: remote },
      locale: "zh",
      selected: "login",
      scrollRef,
      focus: "body",
      maxHeight: 10,
    },
    40,
    12,
  );
  const initial = terminal.screen();
  expect(initial.join("\n")).toContain("状态: 需要授权");
  expect(initial.join("\n")).toContain("登录");
  expect(initial.join("\n")).toContain("正文");
  expect(initial.join("\n")).toContain("Tab");
  expect(initial.join("\n")).toContain("Esc");
  expect(initial.join("\n")).not.toContain("❯ 登录");
  scrollRef.current!.scrollToBottom();
  await terminal.waitFor(() => terminal.screen().join("\n").includes("未知 MCP 服务器"));
  expect(terminal.screen().findIndex((line) => line.includes("remote"))).toBe(
    initial.findIndex((line) => line.includes("remote")),
  );
  terminal.update({ focus: "actions" });
  await terminal.waitFor(() => terminal.screen().join("\n").includes("❯ 登录"));
  expect(terminal.screen().join("\n")).toContain("操作");
});

test("tool details retain full description and formatted schema while scrolling, resizing and updating", async () => {
  const scrollRef = createRef<ScrollBoxHandle>();
  const tool = {
    name: "long-schema",
    description: Array.from({ length: 20 }, (_, i) => `description-${i}`).join("\n"),
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "schema-tail" } },
      required: ["query"],
    },
  };
  const terminal = await mount(
    {
      page: { kind: "tool", server: server("local"), tool },
      scrollRef,
      focus: "body",
      maxHeight: 9,
    },
    40,
    12,
  );
  expect(terminal.screen().join("\n")).toContain("description-0");
  expect(terminal.screen().join("\n")).not.toContain("schema-tail");
  const title = terminal.screen().findIndex((line) => line.includes("long-schema"));
  const back = terminal.screen().findIndex((line) => line.trim() === "Back");
  scrollRef.current!.scrollBy(8);
  await terminal.waitFor(
    () =>
      terminal.screen().join("\n").includes("description-8") &&
      scrollRef.current!.getScrollTop() === 8,
  );
  const top = scrollRef.current!.getScrollTop();
  terminal.resize(60, 18);
  terminal.update({ columns: 60, maxHeight: 12 });
  await terminal.waitFor(() => scrollRef.current!.getViewportHeight() === 6);
  expect(scrollRef.current!.getScrollTop()).toBe(top);
  scrollRef.current!.scrollToBottom();
  await terminal.waitFor(() => terminal.screen().join("\n").includes('"required": ['));
  scrollRef.current!.scrollBy(-5);
  await terminal.waitFor(() => terminal.screen().join("\n").includes("schema-tail"));
  expect(terminal.screen().join("\n")).toContain('"type": "string"');
  terminal.update({
    page: {
      kind: "tool",
      server: server("local"),
      tool: { ...tool, description: "short description", inputSchema: {} },
    },
  });
  await terminal.waitFor(() => terminal.screen().join("\n").includes("short description"));
  expect(scrollRef.current!.getScrollTop()).toBe(0);
  expect(title).toBe(3);
  expect(back).toBe(7);
});

test("the tool list follows protocol identities, wraps keyboard focus and renders inactive descriptions", async () => {
  const tools = [
    { name: "z:tool", description: "last tool", inputSchema: {} },
    { name: "a:tool", description: "first line\nsecond line", inputSchema: {} },
  ];
  const terminal = await mount({
    page: { kind: "tools", server: { ...server("srv:one"), tools, toolCount: 2 } },
    selected: "tool:z:tool",
  });
  const lines = terminal.screen();
  const first = lines.findIndex((line) => line.includes("a:tool"));
  expect(first).toBeLessThan(lines.findIndex((line) => line.includes("z:tool")));
  expect(lines[first + 1]).toContain("first line second line");
  expect(
    terminal.terminal.buffer.active
      .getLine(first + 1)!
      .getCell(4)!
      .getFgColor(),
  ).toBe(Number.parseInt(dark.inactive.slice(1), 16));
  terminal.stdin.write("\x1b[B");
  await terminal.waitFor(() => terminal.screen().join("\n").includes("❯ Back"));
  terminal.stdin.write("\x1b[B");
  await terminal.waitFor(() => terminal.screen().join("\n").includes("❯ a:tool"));
  const y = terminal.screen().findIndex((line) => line.includes("❯ a:tool"));
  terminal.stdin.write(`\x1b[<0;5;${y + 1}M\x1b[<0;5;${y + 1}m`);
  await terminal.waitFor(() => terminal.activated.length > 0);
  expect(terminal.activated).toEqual(["tool:a:tool"]);
});

test("the tool list provides mouse return to its server even when no tools remain", async () => {
  const terminal = await mount({
    page: { kind: "tools", server: server("local") },
    selected: "back",
  });
  expect(terminal.screen().join("\n")).toContain("No tools available");
  const y = terminal.screen().findIndex((line) => line.includes("Back") && !line.includes("Esc"));
  expect(y).toBeGreaterThan(0);
  terminal.stdin.write(`\x1b[<0;5;${y + 1}M\x1b[<0;5;${y + 1}m`);
  await terminal.waitFor(() => terminal.activated.length > 0);
  expect(terminal.activated).toEqual(["back"]);
});

test("busy management cannot repeat while tool browsing and mouse back remain available", async () => {
  const terminal = await mount({
    page: {
      kind: "server",
      server: {
        ...server("local"),
        tools: [{ name: "read", description: "", inputSchema: {} }],
        toolCount: 1,
      },
    },
    selected: "reconnect",
    busy: true,
  });
  const click = (label: string) => {
    const y = terminal.screen().findIndex((line) => line.includes(label));
    expect(y).toBeGreaterThan(0);
    const x = terminal.screen()[y]!.indexOf(label) + (label === "Reconnect" ? label.length - 1 : 0);
    terminal.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
  };
  expect(terminal.screen().join("\n")).toContain("Working…");
  click("Reconnect");
  click("View tools");
  await terminal.waitFor(() => terminal.activated.length > 0);
  expect(terminal.activated).toEqual(["tools"]);
  click("Back");
  await terminal.waitFor(() => terminal.activated.length === 2);
  expect(terminal.activated).toEqual(["tools", "back"]);
  terminal.update({ busy: false, result: "Operation cancelled" });
  await terminal.waitFor(() => terminal.screen().join("\n").includes("Operation cancelled"));
  expect(terminal.screen().join("\n")).not.toContain("Working…");
});

test("body wheel uses the reader rectangle, saved top restores on return, and paused callbacks stay inactive", async () => {
  const scrollRef = createRef<ScrollBoxHandle>();
  const tool = {
    name: "reader",
    description: Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n"),
    inputSchema: {},
  };
  const page: McpPanelPage = { kind: "tool", server: server("local"), tool };
  const wheels: number[] = [];
  const terminal = await mount({
    page,
    selected: "back",
    focus: "body",
    maxHeight: 9,
    scrollRef,
    onBodyWheel: (delta) => {
      wheels.push(delta);
    },
  });
  const bodyY = scrollRef.current!.getViewportTop();
  terminal.stdin.write(`\x1b[<65;5;${bodyY + 1}M`);
  await terminal.waitFor(() => terminal.screen().join("\n").includes("line-1"));
  expect(wheels).toEqual([3]);
  scrollRef.current!.scrollBy(5);
  await terminal.waitFor(() => terminal.screen().join("\n").includes("line-8"));
  terminal.update({ page: { kind: "server", server: server("local") } });
  await terminal.waitFor(() => terminal.screen().join("\n").includes("Status:"));
  terminal.update({ page, initialTop: 8, interactive: false });
  await terminal.waitFor(() => terminal.screen().join("\n").includes("line-8"));
  expect(terminal.screen().join("\n")).not.toContain("line-0");
  expect(terminal.screen().join("\n")).not.toContain("❯ Back");
  const backY = terminal.screen().findIndex((line) => line.trim() === "Back");
  terminal.stdin.write(`\x1b[<65;5;${bodyY + 1}M\x1b[<0;5;${backY + 1}M\x1b[<0;5;${backY + 1}m`);
  terminal.update({ interactive: true, focus: "actions" });
  await terminal.waitFor(() => terminal.screen().join("\n").includes("❯ Back"));
  terminal.stdin.write(`\x1b[<65;5;${bodyY + 1}M`);
  await terminal.waitFor(() => wheels.length === 2 && scrollRef.current!.getScrollTop() === 11);
  expect(scrollRef.current!.getScrollTop()).toBe(11);
  expect(wheels).toEqual([3, 3]);
  expect(terminal.activated).toEqual([]);
});

test.each([0, 1, 2, 3, 4, 5, 6, 14, 30])(
  "screen budget %s is authoritative even with result feedback",
  async (budget) => {
    const props: McpPanelProps = {
      page: { kind: "server", server: server("local") },
      columns: 40,
      locale: "en",
      maxHeight: budget,
      selected: "back",
      busy: true,
      onActivate() {},
    };
    const terminal = await mount(props, 40, 24);
    const actual = terminal.screen().findIndex((line) => line.includes("next-field"));
    expect(actual).toBeLessThanOrEqual(Math.min(14, budget));
    expect(actual).toBe(mcpPanelHeight(props));
  },
);

test.each([
  { busy: true, result: undefined, feedback: "Working…" },
  { busy: false, result: "Operation succeeded", feedback: "Operation succeeded" },
  { busy: false, result: "Operation failed", feedback: "Operation failed" },
  { busy: false, result: "Operation cancelled", feedback: "Operation cancelled" },
])(
  "five rows retain reading and mouse actions with $feedback",
  async ({ busy, result, feedback }) => {
    const scrollRef = createRef<ScrollBoxHandle>();
    const terminal = await mount(
      {
        page: {
          kind: "server",
          server: {
            ...server("local"),
            tools: [{ name: "read", description: "", inputSchema: {} }],
            toolCount: 1,
          },
        },
        maxHeight: 5,
        selected: "tools",
        scrollRef,
        busy,
        result,
      },
      40,
      12,
    );
    const screen = () => terminal.screen().join("\n");
    const click = (label: string) => {
      const y = terminal.screen().findIndex((line) => line.includes(label));
      expect(y).toBeGreaterThanOrEqual(0);
      terminal.stdin.write(`\x1b[<0;5;${y + 1}M\x1b[<0;5;${y + 1}m`);
    };
    expect(screen()).toContain(feedback);
    expect(screen()).toContain("Status: connected");
    expect(screen()).toContain("❯ View tools");
    expect(terminal.screen().findIndex((line) => line.includes("next-field"))).toBe(5);
    click("View tools");
    await terminal.waitFor(() => terminal.activated.length === 1);
    expect(terminal.activated).toEqual(["tools"]);
    terminal.update({ focus: "body" });
    await terminal.waitFor(() => screen().includes("Tab Actions"));
    expect(screen()).not.toContain("❯ View tools");
    scrollRef.current!.scrollBy(1);
    await terminal.waitFor(() => screen().includes("Transport: stdio"));
    expect(screen()).toContain(feedback);
    terminal.resize(60, 18);
    terminal.update({ columns: 60, maxHeight: 8 });
    await terminal.waitFor(() => terminal.screen().some((row) => row.includes("Transport: stdio")));
    expect(scrollRef.current!.getScrollTop()).toBe(1);
    terminal.resize(40, 12);
    terminal.update({ columns: 40, maxHeight: 5, focus: "actions" });
    await terminal.waitFor(() => screen().includes("❯ View tools"));
    expect(screen()).toContain("Transport: stdio");
    terminal.stdin.write("\x1b[A");
    await terminal.waitFor(() => screen().includes("❯ Back"));
    expect(screen()).toContain(feedback);
    click("Back");
    await terminal.waitFor(() => terminal.activated.length === 2);
    expect(terminal.activated).toEqual(["tools", "back"]);
    expect(terminal.screen().findIndex((line) => line.includes("next-field"))).toBe(5);
  },
);

test("a 40 by 12 allocation keeps MCP, Goal, Todo, Subagent previews and prompt visible in the current theme", async () => {
  const terminal = createTerminal(40, 12);
  const props: McpPanelProps = {
    page: {
      kind: "servers",
      snapshot: {
        servers: Array.from({ length: 20 }, (_, index) => server(`long-server-name-${index}`)),
        configErrors: [],
      },
      configPaths: { user: "user.json", project: "project.json" },
    },
    columns: 40,
    locale: "en",
    maxHeight: 6,
    selected: "server:long-server-name-1",
    onActivate() {},
  };
  const app = renderComponent(
    <ThemeProvider theme={light}>
      <Box flexDirection="column">
        <Box height={12 - mcpPanelHeight(props) - 5}>
          <ThemedText>reading anchor</ThemedText>
        </Box>
        <McpPanel {...props} />
        <GoalTodoPanel
          goal={{
            id: "goal",
            objective: "goal",
            phase: "active",
            roundsStarted: 0,
            maxRounds: 10,
            armed: true,
          }}
          todos={[{ content: "todo preview", status: "in_progress" }]}
          working
          collapsed={false}
          onToggle={() => {}}
          maxHeight={2}
          locale="en"
        />
        <SubagentPanel
          subagents={[
            {
              agentId: "child",
              childSessionId: "session",
              description: "subagent preview",
              subagentType: "worker",
              status: "running",
              startedAt: 0,
              durationMs: 0,
              tokens: 0,
              toolCalls: [],
              outputLines: [],
            },
          ]}
          collapsed={false}
          onToggle={() => {}}
          onOpen={() => {}}
          locale="en"
          maxHeight={1}
        />
        <ThemedText>prompt divider</ThemedText>
        <ThemedText>❯ draft</ThemedText>
      </Box>
    </ThemeProvider>,
    { ...terminal },
  );
  cleanups.push(async () => {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  });
  await terminal.flush();
  const screen = terminal.screen().join("\n");
  for (const text of [
    "reading anchor",
    "Manage MCP",
    "long-server-name-1",
    "goal",
    "todo preview",
    "Subagents",
    "❯ draft",
  ])
    expect(screen).toContain(text);
  const titleY = terminal.screen().findIndex((line) => line.includes("Manage MCP"));
  expect(terminal.terminal.buffer.active.getLine(titleY)!.getCell(1)!.getFgColor()).toBe(
    Number.parseInt(light.remember.slice(1), 16),
  );
  expect(terminal.screen()[11]).toBe("❯ draft");
});

test("a growing tool schema retains its reading position after a previously fitting body", async () => {
  const scrollRef = createRef<ScrollBoxHandle>();
  const tool = { name: "growing", description: "short", inputSchema: {} };
  const terminal = await mount({
    page: { kind: "tool", server: server("local"), tool },
    scrollRef,
    focus: "body",
  });
  expect(terminal.screen().join("\n")).toContain("short");
  expect(scrollRef.current!.getScrollTop()).toBe(0);
  terminal.update({
    page: {
      kind: "tool",
      server: server("local"),
      tool: {
        ...tool,
        description: Array.from({ length: 30 }, (_, i) => `expanded-${i}`).join("\n"),
      },
    },
  });
  // Layout commits before xterm finishes consuming the updated frame.
  await terminal.waitFor(
    () =>
      scrollRef.current!.getScrollHeight() > 30 &&
      terminal.screen().join("\n").includes("expanded-0"),
  );
  expect(scrollRef.current!.getScrollTop()).toBe(0);
  expect(terminal.screen().join("\n")).toContain("expanded-0");
});

test("global read failure pins retry without pretending to be empty configuration", async () => {
  const terminal = await mount({
    page: {
      kind: "servers",
      snapshot: null,
      error: "External MCP discovery failed",
      configPaths: { user: "user.json", project: "project.json" },
    },
    selected: "retry",
  });
  const screen = terminal.screen().join("\n");
  expect(screen).toContain("External MCP discovery failed");
  expect(screen).toContain("❯ Retry");
  expect(screen).not.toContain("No MCP servers configured");
  expect(screen).not.toContain("Reading MCP status");
});

test("OAuth warning uses the existing theme and a failed server stays selectable", async () => {
  const warning = {
    ...server("remote"),
    status: "needs-auth" as const,
    transport: "http" as const,
    auth: "oauth" as const,
  };
  const failed = { ...server("broken"), status: "failed" as const, error: "external failure" };
  const terminal = await mount({
    page: {
      kind: "servers",
      snapshot: { servers: [warning, failed], configErrors: [] },
      configPaths: { user: "user.json", project: "project.json" },
    },
    selected: "server:broken",
  });
  const lines = terminal.screen();
  expect(lines.join("\n")).toContain("❯ broken · failed");
  const y = lines.findIndex((line) => line.includes("remote"));
  const x = Bun.stringWidth(lines[y]!.slice(0, lines[y]!.indexOf("⚠")));
  expect(terminal.terminal.buffer.active.getLine(y)!.getCell(x)!.getFgColor()).toBe(
    Number.parseInt(dark.warning.slice(1), 16),
  );
  const brokenY = lines.findIndex((line) => line.includes("❯ broken"));
  terminal.stdin.write(`\x1b[<0;5;${brokenY + 1}M\x1b[<0;5;${brokenY + 1}m`);
  await terminal.waitFor(() => terminal.activated.length > 0);
  expect(terminal.activated).toEqual(["server:broken"]);
});

test("long CJK names keep the footer and native selection in place across resize and snapshot insertion", async () => {
  const selectedName = "名字".repeat(30) + "\nserver:with:colons";
  const page: McpPanelPage = {
    kind: "servers",
    snapshot: { servers: [server("before"), server(selectedName)], configErrors: [] },
    configPaths: { user: "user.json", project: "project.json" },
  };
  const terminal = await mount({ page, selected: `server:${selectedName}`, maxHeight: 6 }, 40, 12);
  const footer = terminal.screen().findIndex((line) => line.includes("Esc Close"));
  expect(footer).toBe(5);
  expect(terminal.screen()[4]).toStartWith(" ❯ 名字");
  terminal.resize(60, 18);
  terminal.update({
    columns: 60,
    page: {
      ...page,
      snapshot: {
        servers: [server("new"), server("before"), server(selectedName)],
        configErrors: [],
      },
    },
  });
  await terminal.waitFor(
    () => terminal.screen()[4]!.includes("❯ 名字") && Bun.stringWidth(terminal.screen()[4]!) > 40,
  );
  expect(terminal.screen().findIndex((line) => line.includes("Esc Close"))).toBe(footer);
  expect(terminal.screen().findIndex((line) => line.includes("next-field"))).toBe(6);
  const y = terminal.screen().findIndex((line) => line.includes("❯ 名字"));
  terminal.stdin.write(`\x1b[<0;5;${y + 1}M\x1b[<0;5;${y + 1}m`);
  await terminal.waitFor(() => terminal.activated.length > 0);
  expect(terminal.activated).toEqual([`server:${selectedName}`]);
});

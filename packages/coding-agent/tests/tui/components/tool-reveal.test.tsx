import { expect, test } from "bun:test";
import { act, useEffect } from "react";
import { Box, SmoothRevealProvider, useTerminalFocus } from "../../../src/ink/index.ts";
import { ToolCall } from "../../../src/tui/components/tool-call/tool-call";
import { renderComponent } from "../helpers/render-component";
import { createTerminal } from "../helpers/terminal";
import FakeTimers from "@sinonjs/fake-timers";

test("pending cards in independent apps share the same reveal deadline", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminals = [
    createTerminal(80, 20, (ms) => act(() => clock.tick(ms))),
    createTerminal(80, 20, (ms) => act(() => clock.tick(ms))),
  ];
  const apps: ReturnType<typeof renderComponent>[] = [];
  const card = (
    <Box width={80} flexDirection="column">
      <SmoothRevealProvider>
        <ToolCall
          id="pending"
          name="edit"
          summary="Edit"
          status="running"
          locale="en"
          callView={{
            kind: "edit",
            card: "diff",
            diffs: [
              {
                path: "code.txt",
                oldText: "before-0\nbefore-1\nbefore-2\n",
                newText: "after-0\nafter-1\nafter-2\n",
              },
            ],
          }}
        />
      </SmoothRevealProvider>
    </Box>
  );
  const flush = () => Promise.all(terminals.map((terminal) => terminal.flush()));
  try {
    // act commits both roots at frozen time; no Session filesystem work advances the clock.
    act(() => {
      for (const terminal of terminals)
        apps.push(renderComponent(card, { ...terminal, patchConsole: false }));
    });
    await flush();
    act(() => clock.tick(32));
    await flush();
    for (const terminal of terminals)
      expect(terminal.screen().join("\n")).not.toContain("before-0");
    act(() => clock.tick(1));
    // Both focused renderers paint the shared reveal update on their next 16ms frame.
    act(() => clock.tick(16));
    const deadline = process.hrtime.bigint() + 1_000_000_000n;
    while (
      !terminals.every((terminal) => terminal.screen().some((row) => row.includes("before-1")))
    ) {
      if (process.hrtime.bigint() >= deadline)
        throw new Error(
          `Both cards did not paint at the shared deadline: ${terminals.map((t) => t.screen().join("\n")).join("\nNEXT\n")}`,
        );
      await flush();
    }
    for (const terminal of terminals) {
      expect(terminal.screen().filter((row) => /^ ⎿|^   [-+]/.test(row))).toHaveLength(3);
      expect(terminal.screen().join("\n")).not.toContain("after-2");
    }
    expect(terminals[0]!.screen()).toEqual(terminals[1]!.screen());
  } finally {
    try {
      act(() => {
        for (const app of apps) app.unmount();
      });
      await Promise.all(apps.map((app) => app.waitUntilExit()));
      for (const app of apps) app.cleanup();
    } finally {
      clock.uninstall();
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
      for (const terminal of terminals) terminal.dispose();
    }
  }
});

test.each([80, 120])("pending card paints reveal boundaries at %s columns", async (columns) => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });

  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(columns, 20, (ms) => act(() => clock.tick(ms)));
  const blurred = Promise.withResolvers<void>();
  const mounted = Promise.withResolvers<void>();
  function Screen({ running = false }: { running?: boolean }) {
    const focused = useTerminalFocus();
    useEffect(() => {
      if (!focused) blurred.resolve();
    }, [focused]);
    useEffect(() => {
      if (running) mounted.resolve();
    }, [running]);
    return (
      <Box width={columns} flexDirection="column">
        <SmoothRevealProvider>
          {running && (
            <ToolCall
              id="pending"
              name="edit"
              summary="Edit"
              status="running"
              locale="en"
              callView={{
                kind: "edit",
                card: "diff",
                diffs: [
                  {
                    path: "code.txt",
                    oldText: "before-0\nbefore-1\nbefore-2\n",
                    newText: "after-0\nafter-1\nafter-2\n",
                  },
                ],
              }}
            />
          )}
        </SmoothRevealProvider>
      </Box>
    );
  }
  let app: ReturnType<typeof renderComponent> | undefined;
  async function painted(predicate: () => boolean) {
    const deadline = process.hrtime.bigint() + 1_000_000_000n;
    do {
      await terminal.flush();
      if (predicate()) return;
    } while (process.hrtime.bigint() < deadline);
    throw new Error(`Card did not paint at the frozen deadline:\n${terminal.screen().join("\n")}`);
  }
  try {
    act(() => {
      app = renderComponent(<Screen />, { ...terminal, patchConsole: false });
    });
    await terminal.flush();
    // Focus loss silences status blinking; source reveal retains its own 30fps clock.
    await act(async () => {
      terminal.stdin.write("\x1b[O");
    });
    await blurred.promise;
    act(() => app!.rerender(<Screen running />));
    await mounted.promise;
    await terminal.flush();
    act(() => clock.tick(32));
    await terminal.flush();
    expect(terminal.screen().join("\n")).not.toContain("before-0");
    act(() => clock.tick(1));
    await painted(() => terminal.screen().some((row) => row.includes("before-1")));
    expect(terminal.screen().join("\n")).not.toContain("after-2");
    if (columns === 120)
      expect(
        terminal.screen().some((row) => row.includes("before-1") && row.includes("after-1")),
      ).toBe(true);
    else expect(terminal.screen().filter((row) => /^ ⎿|^   [-+]/.test(row))).toHaveLength(3);
    act(() => clock.tick(32));
    await terminal.flush();
    expect(terminal.screen().join("\n")).not.toContain("after-2");
    act(() => clock.tick(1));
    await painted(() =>
      terminal.screen().some((row) => row.includes(columns === 120 ? "after-2" : "after-1")),
    );
    if (columns === 120) expect(terminal.screen().join("\n")).toContain("after-2");
    else expect(terminal.screen().filter((row) => /^ ⎿|^   [-+]/.test(row))).toHaveLength(6);
  } finally {
    if (app) {
      act(() => app!.unmount());
      await app.waitUntilExit();
      app.cleanup();
    }
    terminal.dispose();
    clock.uninstall();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  }
});

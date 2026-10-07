import { expect, test } from "bun:test";
import { act, useEffect } from "react";
import { Box, SmoothRevealProvider, useTerminalFocus } from "../../../src/ink/index.ts";
import { ToolCall } from "../../../src/tui/components/tool-call/tool-call";
import { renderComponent } from "../helpers/render-component";
import { createTerminal } from "../helpers/terminal";
import FakeTimers from "@sinonjs/fake-timers";

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

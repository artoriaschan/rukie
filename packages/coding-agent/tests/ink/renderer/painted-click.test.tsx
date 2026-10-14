import { expect, onTestFinished, test } from "bun:test";
import type { ReactNode } from "react";
import { testClock } from "../../tui/helpers/test-clock";
import { AlternateScreen, Box, Text, renderSync, useInput, type BoxProps } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

type Click = NonNullable<BoxProps["onClick"]>;
function Fixture({
  shifted = false,
  visible = true,
  replaced = false,
  overlay = false,
  passive = false,
  hidden = false,
  click,
  parentClick,
}: {
  shifted?: boolean;
  visible?: boolean;
  replaced?: boolean;
  overlay?: boolean;
  passive?: boolean;
  hidden?: boolean;
  click: Click;
  parentClick?: Click;
}) {
  useInput(() => {});
  return (
    <AlternateScreen>
      <Box flexDirection="column" onClick={parentClick}>
        {shifted && <Text>new allocation</Text>}
        {visible && (
          <Box
            key={replaced ? "replacement" : "original"}
            height={hidden ? 0 : 1}
            overflow={hidden ? "hidden" : undefined}
            onClick={passive ? undefined : click}
          >
            <Text>Child B</Text>
          </Box>
        )}
        {overlay && (
          <Box position="absolute" top={0} width={30} height={3} onClick={click}>
            <Text>menu</Text>
          </Box>
        )}
      </Box>
    </AlternateScreen>
  );
}

// The runner and test body share shutdown, including failed setup and timed-out parser waits.
async function withPaintedFixture(
  node: ReactNode,
  run: (
    app: ReturnType<typeof renderSync>,
    terminal: ReturnType<typeof createTerminal>,
  ) => Promise<void>,
) {
  let ownsClock = false;
  let terminal: ReturnType<typeof createTerminal> | undefined;
  let app: ReturnType<typeof renderSync> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      try {
        app?.unmount();
        await app?.waitUntilExit();
      } finally {
        try {
          app?.cleanup();
        } finally {
          try {
            terminal?.dispose();
          } finally {
            if (ownsClock) testClock.useRealTimers();
          }
        }
      }
    })());
  onTestFinished(cleanup);
  try {
    testClock.useFakeTimers();
    ownsClock = true;
    testClock.setSystemTime(1000);
    terminal = createTerminal(30, 8);
    app = renderSync(node, terminal);
    await run(app, terminal);
  } finally {
    await cleanup();
  }
}

// The renderer throttle is the contract under test; xterm parsing stays real IO.
test.each(["batch", "separate", "painted"])(
  "a %s release activates the pressed painted owner with its local coordinates",
  async (delivery) => {
    const clicks: string[] = [];
    const click: Click = (event) => clicks.push(`old ${event.localCol},${event.localRow}`);
    const parentClick: Click = (event) => clicks.push(`parent ${event.localCol},${event.localRow}`);
    await withPaintedFixture(
      <Fixture click={click} parentClick={parentClick} />,
      async (app, terminal) => {
        await terminal.flush();
        expect(terminal.screen()[0]).toBe("Child B");
        app.rerender(
          <Fixture
            shifted
            click={(event) =>
              clicks.push(
                `new ${event.localCol},${event.localRow} ${event.pressLocalCol},${event.pressLocalRow}`,
              )
            }
            parentClick={parentClick}
          />,
        );
        await terminal.flush();
        expect(terminal.screen()[0]).toBe("Child B");
        if (delivery === "painted") {
          testClock.advanceTimersByTime(16);
          await terminal.flush();
        }
        const row = delivery === "painted" ? 1 : 0;
        const press = `\x1b[<0;3;${row + 1}M`;
        const release = `\x1b[<0;3;${row + 1}m`;
        if (delivery === "separate") {
          terminal.stdin.write(press);
          await terminal.flush();
          terminal.stdin.write(release);
        } else terminal.stdin.write(press + release);
        await terminal.flush();
        expect(clicks).toEqual(["new 2,0 2,0", `parent 2,${row}`]);
        expect(terminal.screen().slice(0, 2)).toEqual(["new allocation", "Child B"]);
      },
    );
  },
);

test.each([
  "removed",
  "hidden",
  "release-moved",
  "replaced",
  "overlay",
  "moved",
  "keyboard",
  "wheel",
  "resize",
  "screen",
  "passive",
])("a %s owner cannot transfer its held gesture to a new target", async (change) => {
  let clicks = 0;
  const click: Click = () => {
    clicks++;
  };
  await withPaintedFixture(
    <Fixture passive={change === "passive"} click={click} />,
    async (app, terminal) => {
      await terminal.flush();
      terminal.stdin.write("\x1b[<0;3;1M");
      await terminal.flush();
      app.rerender(
        change === "screen" ? (
          <Text>other screen</Text>
        ) : (
          <Fixture
            visible={change !== "removed"}
            hidden={change === "hidden"}
            replaced={change === "replaced"}
            overlay={change === "overlay"}
            click={click}
          />
        ),
      );
      testClock.advanceTimersByTime(16);
      await terminal.flush();
      if (change === "moved") terminal.stdin.write("\x1b[<32;4;1M\x1b[<32;3;1M");
      if (change === "keyboard") terminal.stdin.write("a");
      if (change === "wheel") terminal.stdin.write("\x1b[<65;3;1M");
      if (change === "resize") terminal.resize(31, 8);
      await terminal.flush();
      terminal.stdin.write(change === "release-moved" ? "\x1b[<0;4;1m" : "\x1b[<0;3;1m");
      await terminal.flush();
      expect(clicks).toBe(0);
    },
  );
});

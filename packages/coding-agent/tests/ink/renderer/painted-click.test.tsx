import { expect, test } from "bun:test";
import FakeTimers from "@sinonjs/fake-timers";
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

// The renderer throttle is the contract under test; xterm parsing stays real IO.
test.each(["batch", "separate", "painted"])(
  "a %s release activates the pressed painted owner with its local coordinates",
  async (delivery) => {
    const clock = FakeTimers.install({
      now: 1000,
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const terminal = createTerminal(30, 8);
    const clicks: string[] = [];
    const click: Click = (event) => clicks.push(`old ${event.localCol},${event.localRow}`);
    const parentClick: Click = (event) => clicks.push(`parent ${event.localCol},${event.localRow}`);
    const app = renderSync(<Fixture click={click} parentClick={parentClick} />, terminal);
    try {
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
        clock.tick(16);
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
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
      clock.uninstall();
    }
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
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const terminal = createTerminal(30, 8);
  let clicks = 0;
  const click: Click = () => {
    clicks++;
  };
  const app = renderSync(<Fixture passive={change === "passive"} click={click} />, terminal);
  try {
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
    clock.tick(16);
    await terminal.flush();
    if (change === "moved") terminal.stdin.write("\x1b[<32;4;1M\x1b[<32;3;1M");
    if (change === "keyboard") terminal.stdin.write("a");
    if (change === "wheel") terminal.stdin.write("\x1b[<65;3;1M");
    if (change === "resize") terminal.resize(31, 8);
    await terminal.flush();
    terminal.stdin.write(change === "release-moved" ? "\x1b[<0;4;1m" : "\x1b[<0;3;1m");
    await terminal.flush();
    expect(clicks).toBe(0);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
    clock.uninstall();
  }
});

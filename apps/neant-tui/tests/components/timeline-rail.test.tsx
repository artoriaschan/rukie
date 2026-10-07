import { expect, test } from "bun:test";
import { Box, render } from "@neant/tui";
import { TimelineRail } from "../../src/components";
import { createTerminal } from "../helpers/terminal";

test("large input timeline centers its active tick and strict chevrons seek reachable source inputs", async () => {
  const terminal = createTerminal(2, 7);
  const seeks: string[] = [];
  const inputs = Array.from({ length: 10000 }, (_, i) => ({
    id: `input-${i}`,
    text: `prompt-${i}`,
    top: i * 10,
  }));
  const app = render(
    <Box height={7}>
      <TimelineRail
        inputs={inputs}
        snapshot={{ x: 0, y: 0, width: 78, height: 7, top: 5000, total: 100000, following: false }}
        enabled
        onSeek={(id) => seeks.push(id)}
      />
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual([" ▴", " ─", " ─", "━━", " ─", " ─", " ▾"]);
    terminal.stdin.write("\x1b[<0;1;1M\x1b[<0;1;1m");
    expect(seeks).toEqual(["input-499"]);
    terminal.stdin.write("\x1b[<0;1;7M\x1b[<0;1;7m");
    expect(seeks).toEqual(["input-499", "input-501"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test.each([true, false])(
  "timeline chevrons exclude unreachable tail inputs and respect enabled=%s",
  async (enabled) => {
    const terminal = createTerminal(2, 7);
    const seeks: string[] = [];
    const app = render(
      <Box height={7}>
        <TimelineRail
          inputs={[
            { id: "first", text: "one", top: 0 },
            { id: "second", text: "two", top: 90 },
            { id: "unreachable", text: "three", top: 95 },
          ]}
          snapshot={{ x: 0, y: 0, width: 78, height: 7, top: 90, total: 100, following: false }}
          enabled={enabled}
          onSeek={(id) => seeks.push(id)}
        />
      </Box>,
      { ...terminal, fullscreen: true },
    );
    try {
      await terminal.flush();
      terminal.stdin.write("\x1b[<0;1;6M\x1b[<0;1;6m");
      expect(seeks).toEqual([]);
      terminal.stdin.write("\x1b[<0;1;2M\x1b[<0;1;2m");
      expect(seeks).toEqual(enabled ? ["first"] : []);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  },
);

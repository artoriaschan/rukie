import { expect, test } from "bun:test";
import { AlternateScreen, Box, Text, renderSync, useInput, useApp } from "../../../src/ink/index";
import { createTerminal } from "../helpers/terminal";

test("absolute pointer owners survive another root's paint and overlay replacement", async () => {
  const a = createTerminal(20, 8);
  const b = createTerminal(20, 8);
  const clicks: string[] = [];
  const renderers = new Map<string, ReturnType<typeof useApp>["renderer"]>();
  function Content({ owner, row = 1 }: { owner: string; row?: number }) {
    useInput(() => {});
    renderers.set(owner, useApp().renderer);
    return (
      <Box height={1} marginTop={3} flexShrink={0}>
        <Text>under {owner}</Text>
        <Box
          position="absolute"
          top={row - 3}
          left={0}
          width={10}
          height={1}
          onClick={() => clicks.push(owner)}
        >
          <Text>{owner} overlay</Text>
        </Box>
      </Box>
    );
  }
  const tree = (owner: string, row = 1) => (
    <AlternateScreen>
      <Content owner={owner} row={row} />
    </AlternateScreen>
  );
  const first = renderSync(tree("A"), { ...a, patchConsole: false, exitOnCtrlC: false });
  const second = renderSync(tree("B"), { ...b, patchConsole: false, exitOnCtrlC: false });
  try {
    await a.waitFor(() => a.screen()[1] === "A overlay");
    await b.waitFor(() => b.screen()[1] === "B overlay");
    second.rerender(tree("B2"));
    await b.waitFor(() => b.screen()[1] === "B2 overlay");
    expect(renderers.get("A")!.dispatchClick(1, 1)).toBe(true);
    expect(clicks).toEqual(["A"]);
    clicks.length = 0;
    a.stdin.write("\x1b[<0;2;2M\x1b[<0;2;2m");
    await a.flush();
    expect(clicks).toEqual(["A"]);
    first.rerender(tree("A", 2));
    await a.waitFor(() => a.screen()[2] === "A overlay" && a.screen()[1] === "");
    b.stdin.write("\x1b[<0;2;2M\x1b[<0;2;2m");
    await b.flush();
    expect(clicks).toEqual(["A", "B2"]);
    expect(b.screen()[1]).toBe("B2 overlay");
  } finally {
    first.unmount();
    second.unmount();
    await Promise.all([first.waitUntilExit(), second.waitUntilExit()]);
    first.cleanup();
    second.cleanup();
    a.dispose();
    b.dispose();
  }
});

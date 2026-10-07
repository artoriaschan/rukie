import { expect, test } from "bun:test";
import { act } from "react";
import FakeTimers from "@sinonjs/fake-timers";
import {
  SmoothRevealProvider,
  useSmoothText,
  AlternateScreen,
  TooltipProvider,
  Tooltip,
  ThemedText,
  SplitDiffView,
  renderSync,
  useInput,
  type DOMElement,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("split rows expose paired app reading identities and exclude gutter clicks", async () => {
  const terminal = createTerminal(24, 6);
  const sources = new Map<string, DOMElement>();
  let toggles = 0;
  function View() {
    useInput(() => {});
    return (
      <SplitDiffView
        width={24}
        rows={[
          {
            old: [{ text: " before" }],
            new: [{ text: "after" }],
            scrollAnchorId: "old",
            alternateScrollAnchorId: "new",
          },
        ]}
        onToggle={() => toggles++}
        onSourceMount={(id, element) => {
          if (element) sources.set(id, element);
          else sources.delete(id);
        }}
      />
    );
  }
  const app = renderSync(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    expect([...sources.keys()].sort()).toEqual(["new", "old"]);
    expect(sources.get("new")).not.toBe(sources.get("old"));
    terminal.stdin.write("\x1b[<0;3;1M\x1b[<0;3;1m");
    await terminal.waitFor(() => toggles === 1);
    terminal.stdin.write(
      "\x1b[<0;11;1M\x1b[<0;11;1m\x1b[<0;1;1M\x1b[<0;1;1m\x1b[<0;2;1M\x1b[<0;2;1m\x1b[<0;9;1M\x1b[<0;9;1m",
    );
    await terminal.flush();
    expect(toggles).toBe(1);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    expect(sources.size).toBe(0);
    terminal.dispose();
  }
});

test("a tooltip paints at its virtual dwell deadline and dismisses with native input", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(24, 8, (ms) => act(() => clock.tick(ms)));
  let app!: ReturnType<typeof renderSync>;
  try {
    act(() => {
      app = renderSync(
        <AlternateScreen>
          <TooltipProvider>
            <Tooltip content="hidden Unicode 中文">
              <ThemedText>title</ThemedText>
            </Tooltip>
          </TooltipProvider>
        </AlternateScreen>,
        terminal,
      );
    });
    await terminal.flush();
    await act(async () => {
      terminal.stdin.write("\x1b[<35;2;1M");
      await terminal.flush();
    });
    act(() => clock.tick(599));
    await terminal.flush();
    expect(terminal.screen().join("\n")).not.toContain("hidden");
    act(() => clock.tick(1));
    await terminal.waitFor(() => terminal.screen().join("\n").includes("hidden Unicode 中文"));
    expect(terminal.screen()[0]).toBe("title");
    await act(async () => {
      terminal.stdin.write("x");
      await terminal.flush();
    });
    await terminal.waitFor(() => !terminal.screen().join("\n").includes("hidden"));
    await act(async () => {
      terminal.stdin.write("\x1b[<35;20;8M\x1b[<35;2;1M");
      await terminal.flush();
    });
    await act(async () => {
      terminal.resize(20, 6);
      await terminal.flush();
    });
    act(() => clock.tick(600));
    await terminal.flush();
    expect(terminal.screen().join("\n")).not.toContain("hidden");
  } finally {
    if (app) {
      act(() => app.unmount());
      await app.waitUntilExit();
      app.cleanup();
    }
    terminal.dispose();
    clock.uninstall();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  }
});

test("smooth reveal paints its own frame boundary and retains completed identity after remount", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(24, 6, (ms) => act(() => clock.tick(ms)));
  function Reveal() {
    return <ThemedText>{useSmoothText("row", "abc", true)}</ThemedText>;
  }
  const tree = (show: boolean) => (
    <AlternateScreen>
      <SmoothRevealProvider>{show && <Reveal />}</SmoothRevealProvider>
    </AlternateScreen>
  );
  let app!: ReturnType<typeof renderSync>;
  try {
    act(() => {
      app = renderSync(tree(true), terminal);
    });
    await terminal.flush();
    act(() => clock.tick(32));
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("");
    act(() => clock.tick(1));
    await terminal.waitFor(() => terminal.screen()[0] === "abc");
    act(() => app.rerender(tree(false)));
    await terminal.flush();
    act(() => app.rerender(tree(true)));
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("abc");
  } finally {
    if (app) {
      act(() => app.unmount());
      await app.waitUntilExit();
      app.cleanup();
    }
    terminal.dispose();
    clock.uninstall();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  }
});

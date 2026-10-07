import { expect, test } from "bun:test";
import FakeTimers from "@sinonjs/fake-timers";
import { act, useLayoutEffect, useState } from "react";
import { AlternateScreen, Text, renderSync } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("separate commits paint their final content and pending updates stop after unmount", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(12, 3, (ms) => act(() => clock.tick(ms)));
  let update = (_text: string) => {};
  let committed = "";
  function View() {
    const [text, setText] = useState("initial");
    useLayoutEffect(() => {
      update = setText;
      committed = text;
    });
    return <Text>{text}</Text>;
  }
  let app!: ReturnType<typeof renderSync>;
  act(() => {
    app = renderSync(
      <AlternateScreen>
        <View />
      </AlternateScreen>,
      terminal,
    );
  });
  try {
    await terminal.flush();
    for (const text of ["first", "second", "latest"]) {
      act(() => update(text));
      expect(committed).toBe(text);
    }
    await terminal.waitFor(() => terminal.screen()[0] === "latest");
    expect(terminal.screen()).toEqual(["latest", "", ""]);
    act(() => update("pending"));
    act(() => app.unmount());
    await app.waitUntilExit();
    await terminal.flush();
    const afterUnmount = terminal.bytesWritten();
    act(() => clock.tick(100));
    act(() => update("late"));
    await terminal.flush();
    expect(terminal.bytesWritten()).toBe(afterUnmount);
    expect(terminal.terminal.buffer.active.type).toBe("normal");
  } finally {
    act(() => app.unmount());
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
    clock.uninstall();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  }
});

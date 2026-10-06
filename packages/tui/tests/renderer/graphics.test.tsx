import { expect, test } from "bun:test";
import { useState } from "react";
import { Box, Image, Text, render, useInput, useTerminalGraphics } from "../../src";
import { createTerminal } from "../helpers/terminal";

const reply = "\x1b_Gi=2147483647;OK\x1b\\\x1b[6;20;10t";

test("runtime graphics reports split replies without inserting them into user input", async () => {
  const terminal = createTerminal(40, 12);
  function View() {
    const graphics = useTerminalGraphics();
    const [input, setInput] = useState("");
    useInput((event) => {
      if (event.type === "key") setInput((value) => value + event.input);
    });
    return (
      <Text>{`${graphics.supported}:${graphics.cellWidth}x${graphics.cellHeight}:${input}`}</Text>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true, env: {} });
  try {
    await terminal.flush();
    expect(terminal.output()).toContain("a=q");
    for (const part of [reply.slice(0, 1), reply.slice(1, 7), reply.slice(7, 30), reply.slice(30)])
      terminal.stdin.write(part);
    terminal.stdin.write("hello");
    await terminal.waitFor(() => terminal.screen()[0] === "true:10x20:hello");
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0XkAAAAASUVORK5CYII=";

test("PNG placements share one upload and delete their resources on unmount", async () => {
  const terminal = createTerminal(40, 12);
  const app = render(
    <Box>
      <Image
        data={png}
        mimeType="image/png"
        sourceWidth={1}
        sourceHeight={1}
        width={4}
        height={2}
      />
      <Image
        data={png}
        mimeType="image/png"
        sourceWidth={1}
        sourceHeight={1}
        width={4}
        height={2}
      />
    </Box>,
    { ...terminal, fullscreen: true, env: {} },
  );
  try {
    terminal.stdin.write(reply);
    await terminal.waitFor(() => terminal.output().includes("a=p"));
    expect(terminal.output().match(/a=t,/g)?.length).toBe(1);
    expect(terminal.output().match(/a=p,/g)?.length).toBe(2);
    expect(terminal.output()).toContain("f=100");
    app.unmount();
    await terminal.flush();
    expect(terminal.output()).toContain("a=d,d=I");
    expect(terminal.output().lastIndexOf("a=d,d=I")).toBeLessThan(
      terminal.output().lastIndexOf("?1049l"),
    );
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

import { expect, test } from "bun:test";
import { useState } from "react";
import {
  Box,
  Image,
  ScrollBox,
  Text,
  render,
  useInput,
  useTerminalGraphics,
  type ScrollHandle,
} from "../../../src/ink";
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

test("held primary motion reaches the preview as drag coordinates", async () => {
  const terminal = createTerminal(40, 12);
  let motion = "";
  function View() {
    useInput((event) => {
      if (event.type === "move") motion = `${event.x},${event.y},${event.button}`;
    });
    return <Text>drag</Text>;
  }
  const app = render(<View />, { ...terminal, fullscreen: true, env: {} });
  try {
    terminal.stdin.write("\x1b[<32;7;9M");
    expect(motion).toBe("6,8,0");
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

const widePng =
  "iVBORw0KGgoAAAANSUhEUgAAAGQAAABQCAIAAABga0e4AAAA40lEQVR4nO3OUQkAIABEsetfWiv4Nx4IC7Cd7XvkByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByEXk28ikm30KOAAAAAASUVORK5CYII=";

test("source crop follows scroll clipping without reupload, deletes offscreen and repaints after resize", async () => {
  const terminal = createTerminal(40, 12);
  const scroll = { current: null as ScrollHandle | null };
  const app = render(
    <Box height={6} flexDirection="column">
      <Text>header</Text>
      <ScrollBox ref={scroll} height={4} flexGrow={0} initialFollow={false}>
        <Image
          data={widePng}
          mimeType="image/png"
          sourceWidth={100}
          sourceHeight={80}
          width={10}
          height={8}
          crop={{ x: 20, y: 16, width: 60, height: 48 }}
        />
        <Text>{"tail\ntail\ntail\ntail"}</Text>
      </ScrollBox>
      <Text>dock</Text>
    </Box>,
    { ...terminal, fullscreen: true, env: {} },
  );
  try {
    terminal.stdin.write(reply);
    await terminal.waitFor(() => terminal.output().includes("x=20,y=16,w=60,h=24,c=10,r=2"));
    expect(terminal.output()).toContain("\x1b[4;1H\x1b_Ga=p");
    scroll.current!.scrollBy(2);
    await terminal.waitFor(() => terminal.output().includes("x=20,y=16,w=60,h=48,c=10,r=4"));
    expect(terminal.output().match(/a=t,/g)?.length).toBe(1);
    scroll.current!.scrollToBottom();
    await terminal.waitFor(() => terminal.output().includes("a=d,d=I"));
    scroll.current!.scrollBy(-20);
    await terminal.waitFor(() => (terminal.output().match(/a=t,/g)?.length ?? 0) === 2);
    terminal.resize(44, 12);
    await terminal.waitFor(() => (terminal.output().match(/a=t,/g)?.length ?? 0) === 3);
    expect(terminal.screen()[5]).toBe("dock");
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("Kitty support is independent of metrics; inline and multiplexers keep geometry without protocol", async () => {
  for (const options of [
    { fullscreen: false, env: {} },
    { fullscreen: true, env: { TMUX: "active" } },
    { fullscreen: true, env: { STY: "active" } },
  ]) {
    const terminal = createTerminal(40, 12);
    const app = render(
      <Box flexDirection="column">
        <Image
          data={png}
          mimeType="image/png"
          sourceWidth={1}
          sourceHeight={1}
          width={4}
          height={2}
        />
        <Text>after</Text>
      </Box>,
      { ...terminal, ...options },
    );
    try {
      await terminal.flush();
      expect(terminal.output()).not.toContain("a=q");
      expect(terminal.screen()[2]).toBe("after");
    } finally {
      app.unmount();
      terminal.dispose();
    }
  }
  const terminal = createTerminal(40, 12);
  function Capability() {
    const g = useTerminalGraphics();
    return <Text>{`${g.supported}:${g.cellWidth}`}</Text>;
  }
  const app = render(<Capability />, { ...terminal, fullscreen: true, env: {} });
  try {
    terminal.stdin.write("\x1b_Gi=2147483647;OK\x1b\\");
    await terminal.waitFor(() => terminal.screen()[0] === "true:undefined");
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("PNG transfers are bounded chunks; rejected media and control bytes never reach graphics output", async () => {
  const terminal = createTerminal(40, 12);
  const longPng = Buffer.concat([Buffer.from(png, "base64"), Buffer.alloc(9000)]).toString(
    "base64",
  );
  const app = render(
    <Box>
      <Image
        data={longPng}
        mimeType="image/png"
        sourceWidth={1}
        sourceHeight={1}
        width={4}
        height={2}
      />
      <Image
        data={`${png}\x1b[31mINJECT`}
        mimeType="image/png"
        sourceWidth={1}
        sourceHeight={1}
        width={4}
        height={2}
      />
      <Image
        data={png}
        mimeType="image/jpeg"
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
    // oxlint-disable-next-line no-control-regex -- inspect protocol at its public output seam
    const transfers = [...terminal.output().matchAll(/\x1b_G([^;]*m=[01]);([^\x1b]*)\x1b\\/g)];
    expect(transfers).toHaveLength(3);
    expect(transfers.map((part) => part[2]).join("")).toBe(longPng);
    expect(transfers[0]![2]!.length).toBe(4096);
    expect(transfers[1]![2]!.length).toBe(4096);
    expect(transfers[2]![1]).toBe("m=0");
    expect(terminal.output()).not.toContain("INJECT");
    expect(terminal.output().match(/a=p,/g)).toHaveLength(1);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("the largest admitted PNG fits the resource budget and visible uploads stay bounded", async () => {
  const terminal = createTerminal(40, 12);
  const large = Buffer.from(
    await Bun.file(new URL("../fixtures/8000x8000.png", import.meta.url)).arrayBuffer(),
  ).toString("base64");
  const app = render(
    <Image
      data={large}
      mimeType="image/png"
      sourceWidth={8000}
      sourceHeight={8000}
      width={24}
      height={12}
    />,
    { ...terminal, fullscreen: true, env: {} },
  );
  try {
    terminal.stdin.write(reply);
    await terminal.waitFor(() => terminal.output().includes("w=8000,h=8000,c=24,r=12"));
  } finally {
    app.unmount();
    terminal.dispose();
  }
  const boundedTerminal = createTerminal(40, 12);
  const variants = Array.from({ length: 33 }, (_, n) =>
    Buffer.concat([Buffer.from(png, "base64"), Buffer.from([n])]).toString("base64"),
  );
  const bounded = render(
    <Box width={40} height={12}>
      {variants.map((data) => (
        <Image
          key={data}
          data={data}
          mimeType="image/png"
          sourceWidth={1}
          sourceHeight={1}
          position="absolute"
          top={0}
          left={0}
          width={1}
          height={1}
        />
      ))}
    </Box>,
    { ...boundedTerminal, fullscreen: true, env: {} },
  );
  try {
    boundedTerminal.stdin.write(reply);
    await boundedTerminal.waitFor(() => boundedTerminal.output().includes("a=p"));
    expect(boundedTerminal.output().match(/a=t,/g)).toHaveLength(32);
    bounded.unmount();
    await boundedTerminal.flush();
    expect(boundedTerminal.output().match(/a=d,d=I/g)).toHaveLength(32);
  } finally {
    bounded.unmount();
    boundedTerminal.dispose();
  }
});

test("late terminal responses and DA never become text and graphics are deleted on paint failure", async () => {
  const terminal = createTerminal(40, 12);
  let fail = () => {};
  let input = "";
  function View() {
    const [broken, setBroken] = useState(false);
    fail = () => setBroken(true);
    useInput((event) => {
      if (event.type === "key") input += event.input;
    });
    return (
      <Box>
        <Image
          data={png}
          mimeType="image/png"
          sourceWidth={1}
          sourceHeight={1}
          width={4}
          height={2}
        />
        <Text color={broken ? "#invalid" : undefined}>label</Text>
      </Box>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true, env: {} });
  try {
    terminal.stdin.write(reply);
    await terminal.waitFor(() => terminal.output().includes("a=p"));
    terminal.stdin.write("a\x1b_Gi=");
    await new Promise<void>((resolve) => setImmediate(resolve));
    terminal.stdin.write("9;ENOENT\x1b");
    await new Promise<void>((resolve) => setImmediate(resolve));
    terminal.stdin.write("\\\x1b[?1;2c\x1b[6;20;10tb");
    expect(input).toBe("ab");
    fail();
    await expect(app.waitUntilExit()).rejects.toThrow("Invalid text color");
    await terminal.flush();
    expect(terminal.output()).toContain("a=d,d=I");
    expect(terminal.terminal.buffer.active.type).toBe("normal");
    expect(terminal.stdin.isRaw).toBe(false);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("scroll clipping removes fitted image padding before source pixels", async () => {
  const terminal = createTerminal(40, 12);
  const square = Buffer.from(
    await Bun.file(new URL("../fixtures/100x100.png", import.meta.url)).arrayBuffer(),
  ).toString("base64");
  const scroll = { current: null as ScrollHandle | null };
  const app = render(
    <Box height={3}>
      <ScrollBox ref={scroll} height={3} initialFollow={false}>
        <Image
          data={square}
          mimeType="image/png"
          sourceWidth={100}
          sourceHeight={100}
          width={4}
          height={4}
        />
        <Text>{"tail\ntail\ntail"}</Text>
      </ScrollBox>
    </Box>,
    { ...terminal, fullscreen: true, env: {} },
  );
  try {
    terminal.stdin.write("\x1b_Gi=2147483647;OK\x1b\\\x1b[6;16;8t");
    await terminal.waitFor(() => terminal.output().includes("a=p"));
    expect(terminal.output()).toContain("x=0,y=0,w=100,h=100,c=4,r=2");
    expect(terminal.output()).toContain("\x1b[2;1H\x1b_Ga=p");
    scroll.current!.scrollBy(1);
    await terminal.waitFor(() => terminal.output().includes("\x1b[1;1H\x1b_Ga=p"));
    expect(terminal.output().match(/x=0,y=0,w=100,h=100,c=4,r=2/g)).toHaveLength(2);
    scroll.current!.scrollBy(1);
    await terminal.waitFor(() => terminal.output().includes("x=0,y=50,w=100,h=50,c=4,r=1"));
    expect(terminal.output().match(/a=t,/g)).toHaveLength(1);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

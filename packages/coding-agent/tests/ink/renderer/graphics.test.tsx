import { expect, spyOn, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { useState, type ReactNode } from "react";
import {
  AlternateScreen,
  Box,
  Image,
  ScrollBox,
  Text,
  renderSync,
  useInput,
  useTerminalImages,
  useTerminalImageCellSize,
  useTerminalImageProtocol,
  type ScrollBoxHandle,
  type TerminalImageSource,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

type Terminal = ReturnType<typeof createTerminal>;
function source(width = 8, height = 8, seed = 1): TerminalImageSource {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = seed;
    data[i + 1] = 50;
    data[i + 2] = 100;
    data[i + 3] = 255;
  }
  return { data, width, height };
}
function Demand({ children }: { children: ReactNode }) {
  useTerminalImages();
  useInput(() => {});
  return children;
}
const tree = (children: ReactNode) => (
  <AlternateScreen>
    <Demand>{children}</Demand>
  </AlternateScreen>
);
function mount(terminal: Terminal, children: ReactNode, onFrame?: () => void) {
  return renderSync(tree(children), { ...terminal, terminalImages: true, onFrame });
}
async function dispose(
  app: ReturnType<typeof renderSync>,
  terminal: Terminal,
  expectedFailure?: Error,
) {
  app.unmount();
  try {
    await app.waitUntilExit();
  } catch (error) {
    if (error !== expectedFailure) throw error;
  } finally {
    app.cleanup();
    await terminal.flush();
    terminal.dispose();
  }
}
async function negotiate(
  terminal: Terminal,
  protocol: "kitty" | "sixel" = "kitty",
  metrics = true,
  cell = { width: 10, height: 20 },
) {
  await terminal.waitFor(() => terminal.output().includes("a=q"));
  terminal.stdin.write(
    `\x1b_Gi=31;${protocol === "kitty" ? "OK" : "ENOTSUP"}\x1b\\${metrics ? `\x1b[6;${cell.height};${cell.width}t` : ""}\x1b[?1;${protocol === "sixel" ? 4 : 2}c`,
  );
  if (protocol === "sixel") {
    await terminal.waitFor(() => terminal.output().includes("80$p"));
    terminal.stdin.write("\x1b[?80;2$y\x1b[?1;4c\x1b[?1;4c");
  }
}
interface Packet {
  fields: Record<string, string>;
  payload: string;
}
function packets(output: string): Packet[] {
  // oxlint-disable-next-line no-control-regex -- Parse complete real Kitty APC packets.
  return Array.from(output.matchAll(/\x1b_G([^;]*);([^\x1b]*)\x1b\\/g), (match) => ({
    fields: Object.fromEntries(match[1]!.split(",").map((field) => field.split("="))),
    payload: match[2]!,
  }));
}
const placements = (terminal: Terminal) =>
  packets(terminal.output()).filter(({ fields }) => fields.a === "p");
function uploads(output: string) {
  const result: { fields: Record<string, string>; pixels: Uint8Array; chunks: string[] }[] = [];
  let pending: { fields: Record<string, string>; chunks: string[] } | undefined;
  for (const packet of packets(output)) {
    if (packet.fields.a === "t") pending = { fields: packet.fields, chunks: [] };
    if (!pending || (packet.fields.a && packet.fields.a !== "t")) continue;
    pending.chunks.push(packet.payload);
    if (packet.fields.m === "0") {
      result.push({
        ...pending,
        pixels: inflateSync(Buffer.from(pending.chunks.join(""), "base64")),
      });
      pending = undefined;
    }
  }
  return result;
}
const lastPlacement = (terminal: Terminal) => placements(terminal).at(-1)!.fields;
const rasterCount = (terminal: Terminal) =>
  // oxlint-disable-next-line no-control-regex -- Observe actual sixel raster DCS at terminal IO.
  Array.from(terminal.output().matchAll(/\x1bP[^\x1b]*q[^\x1b]*\x1b\\/g)).length;

test("runtime graphics reports split replies without inserting them into user input", async () => {
  const terminal = createTerminal(40, 12);
  function View() {
    const supported = useTerminalImages();
    const cell = useTerminalImageCellSize();
    const protocol = useTerminalImageProtocol();
    const [input, setInput] = useState("");
    useInput((input) => setInput((value) => value + input));
    return <Text>{`${supported}:${protocol}:${cell?.width}x${cell?.height}:${input}`}</Text>;
  }
  const app = mount(terminal, <View />);
  try {
    await terminal.waitFor(() => terminal.output().includes("a=q"));
    const reply = "\x1b_Gi=31;OK\x1b\\\x1b[6;20;10t\x1b[?1;2c";
    terminal.stdin.write("a");
    for (const part of [reply.slice(0, 1), reply.slice(1, 7), reply.slice(7, 24), reply.slice(24)])
      terminal.stdin.write(part);
    terminal.stdin.write("hello");
    await terminal.waitFor(() => terminal.screen()[0] === "true:kitty:10x20:ahello");
    expect(terminal.screen()[0]).toBe("true:kitty:10x20:ahello");
  } finally {
    await dispose(app, terminal);
  }
});

test("RGBA placements share one upload and delete their resources on unmount", async () => {
  const terminal = createTerminal(40, 12);
  const rgba = source(40, 40);
  const content = (second = true) => (
    <Box>
      <Image source={rgba} alt="first" width={4} height={2} />
      {second && <Image source={rgba} alt="second" width={4} height={2} />}
    </Box>
  );
  const app = mount(terminal, content());
  try {
    await negotiate(terminal);
    await terminal.waitFor(() => placements(terminal).length === 2);
    const sent = uploads(terminal.output());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.fields.f).toBe("32");
    expect(sent[0]!.fields.o).toBe("z");
    expect(sent[0]!.pixels).toEqual(rgba.data);
    const first = placements(terminal)[0]!.fields;
    const second = placements(terminal)[1]!.fields;
    expect(second.i).toBe(first.i);
    expect(second.p).not.toBe(first.p);
    app.rerender(tree(content(false)));
    await terminal.waitFor(() =>
      packets(terminal.output()).some(
        ({ fields }) => fields.a === "d" && fields.d === "i" && fields.p === second.p,
      ),
    );
    expect(uploads(terminal.output())).toHaveLength(1);
    app.unmount();
    await app.waitUntilExit();
    await terminal.flush();
    expect(terminal.output().lastIndexOf("a=d,d=I")).toBeLessThan(
      terminal.output().lastIndexOf("?1049l"),
    );
    expect(
      packets(terminal.output()).some(
        ({ fields }) => fields.a === "d" && fields.d === "I" && fields.i === first.i,
      ),
    ).toBe(true);
  } finally {
    await dispose(app, terminal);
  }
});

test("held primary motion reaches the preview as captured drag coordinates", async () => {
  const terminal = createTerminal(40, 12);
  const events: string[] = [];
  const app = mount(
    terminal,
    <Box
      width={20}
      height={10}
      onDragStart={(event) => events.push(`start:${event.col},${event.row}`)}
      onDragMove={(event) =>
        events.push(`move:${event.col},${event.row}:${event.startCol},${event.startRow}`)
      }
      onDragEnd={(event) => events.push(`end:${event.col},${event.row}`)}
    >
      <Text>drag</Text>
    </Box>,
  );
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "drag");
    terminal.stdin.write("\x1b[<0;3;3M\x1b[<32;7;9M\x1b[<0;7;9m");
    await terminal.waitFor(() => events.length === 3);
    expect(events).toEqual(["start:6,8", "move:6,8:2,2", "end:6,8"]);
  } finally {
    await dispose(app, terminal);
  }
});

test("source pixels follow scroll clipping, dormant placement release and resize repaint", async () => {
  const terminal = createTerminal(40, 12);
  const scroll: { current: ScrollBoxHandle | null } = { current: null };
  const app = mount(
    terminal,
    <Box height={6} flexShrink={0} flexDirection="column">
      <Text>header</Text>
      <ScrollBox ref={scroll} height={4} flexShrink={0} stickyScroll={false}>
        <Image
          source={source(100, 80)}
          presentation="transcript"
          alt="image"
          width={10}
          height={8}
        />
        <Box height={4} flexShrink={0}>
          <Text>{"tail\ntail\ntail\ntail"}</Text>
        </Box>
      </ScrollBox>
      <Text>dock</Text>
    </Box>,
  );
  try {
    await negotiate(terminal);
    await terminal.waitFor(() => placements(terminal).length > 0);
    const first = lastPlacement(terminal);
    expect([first.x, first.y, first.w, first.h, first.c, first.r]).toEqual([
      "0",
      "0",
      "100",
      "80",
      "10",
      "4",
    ]);
    const beforeMove = placements(terminal).length;
    scroll.current!.scrollTo(2);
    await terminal.waitFor(() => placements(terminal).length > beforeMove);
    expect(lastPlacement(terminal).y).toBe("40");
    expect(lastPlacement(terminal).h).toBe("80");
    expect(uploads(terminal.output())).toHaveLength(1);
    scroll.current!.scrollToBottom();
    await terminal.waitFor(() =>
      packets(terminal.output()).some(
        ({ fields }) => fields.a === "d" && fields.d === "i" && fields.i === first.i,
      ),
    );
    scroll.current!.scrollTo(0);
    const count = placements(terminal).length;
    await terminal.waitFor(() => placements(terminal).length > count);
    expect(lastPlacement(terminal).i).toBe(first.i);
    expect(uploads(terminal.output())).toHaveLength(1);
    terminal.resize(44, 12);
    await terminal.waitFor(() => uploads(terminal.output()).length > 1);
    expect(terminal.screen()[5]).toBe("dock");
    expect(scroll.current!.getViewportHeight()).toBe(4);
  } finally {
    await dispose(app, terminal);
  }
});

test("Kitty support is independent of metrics; inline and multiplexers preserve fallback geometry", async () => {
  for (const mode of [
    "inline",
    "TMUX",
    "STY",
    "DSH_TUI_ACCESSIBILITY",
    "DSH_TUI_DISABLE_TERMINAL_IMAGES",
    "DSH_TUI_IMAGE_PROTOCOL",
  ] as const) {
    const previous = process.env[mode];
    if (mode !== "inline") process.env[mode] = mode === "DSH_TUI_IMAGE_PROTOCOL" ? "none" : "1";
    const terminal = createTerminal(40, 12);
    const child = (
      <Box flexDirection="column">
        <Image source={source()} alt="fallback" width={10} height={2} />
        <Text>dock</Text>
      </Box>
    );
    const app =
      mode === "inline"
        ? renderSync(<Demand>{child}</Demand>, { ...terminal, terminalImages: true })
        : mount(terminal, child);
    try {
      await terminal.waitFor(() => terminal.screen()[2] === "dock");
      expect(terminal.screen()[0]).toBe("fallback");
      expect(terminal.output()).not.toContain("a=q");
    } finally {
      await dispose(app, terminal);
      if (mode !== "inline") {
        if (previous === undefined) delete process.env[mode];
        else process.env[mode] = previous;
      }
    }
  }
  const terminal = createTerminal(40, 12);
  function View() {
    const supported = useTerminalImages();
    const metrics = useTerminalImageCellSize();
    return <Text>{`${supported}:${metrics === undefined ? "unknown" : "measured"}`}</Text>;
  }
  const app = mount(terminal, <View />);
  try {
    await negotiate(terminal, "kitty", false);
    await terminal.waitFor(() => terminal.screen()[0] === "true:unknown");
    expect(terminal.screen()[0]).toBe("true:unknown");
  } finally {
    await dispose(app, terminal);
  }
});

test("RGBA transfers use bounded chunks and invalid snapshots or control alternatives stay fallback", async () => {
  const terminal = createTerminal(80, 24);
  const rgba = source(128, 128);
  let random = 123456;
  for (let i = 0; i < rgba.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      rgba.data[i + channel] = random & 255;
    }
  }
  const app = mount(
    terminal,
    <Box flexDirection="column">
      <Image source={rgba} alt="valid" width={16} height={8} />
      <Image
        source={{ data: new Uint8Array(1), width: 8, height: 8 }}
        alt={"bad\x1b[31m"}
        width={10}
        height={1}
      />
      <Image source={source(1025, 1)} alt="oversized" width={10} height={1} />
    </Box>,
  );
  try {
    await negotiate(terminal);
    await terminal.waitFor(() => placements(terminal).length > 0);
    const sent = uploads(terminal.output());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chunks.length).toBeGreaterThan(1);
    expect(sent[0]!.chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(sent[0]!.pixels).toEqual(rgba.data);
    expect(terminal.screen()[8]).toBe("bad [31m");
    expect(terminal.screen()[9]).toBe("oversized");
    expect(terminal.output()).not.toContain("\x1b[31m");
  } finally {
    await dispose(app, terminal);
  }
});

test("visible decoded sources obey the 16MiB frame and 64 placement budgets", async () => {
  const terminal = createTerminal(80, 24);
  const sources = Array.from({ length: 5 }, (_, i) => source(1024, 1024, i + 1));
  const app = mount(
    terminal,
    <Box>
      {sources.map((rgba, index) => (
        <Image key={index} source={rgba} alt={`over-${index}`} width={8} height={4} />
      ))}
    </Box>,
  );
  try {
    await negotiate(terminal);
    await terminal.waitFor(
      () => placements(terminal).length === 4 && terminal.screen()[0]!.includes("over-4"),
    );
    expect(placements(terminal)).toHaveLength(4);
    expect(terminal.screen()[0]).toContain("over-4");
    app.rerender(
      tree(
        <Box>
          {Array.from({ length: 5 }, (_, index) => (
            <Image key={index} source={sources[0]} alt={`shared-${index}`} width={8} height={4} />
          ))}
        </Box>,
      ),
    );
    await terminal.waitFor(() => terminal.screen()[0]!.includes("shared-4"));
    expect(terminal.screen()[0]).toContain("shared-4");
    const count = placements(terminal).length;
    app.rerender(
      tree(
        <Box>
          {Array.from({ length: 65 }, (_, index) => (
            <Image key={index} source={source(1, 1)} alt="X" width={1} height={1} />
          ))}
        </Box>,
      ),
    );
    // Graphics reports can arrive before xterm consumes the fallback text.
    await terminal.waitFor(
      () => placements(terminal).length >= count + 64 && terminal.screen()[0]?.[64] === "X",
    );
    expect(placements(terminal).slice(count)).toHaveLength(64);
    expect(terminal.screen()[0]![64]).toBe("X");
  } finally {
    await dispose(app, terminal);
  }
});

test("late reports stay out of input and an active graphics paint failure releases before exit", async () => {
  const terminal = createTerminal(40, 12);
  const failure = new Error("graphics paint failed");
  let fail = false;
  const write = terminal.stdout.write.bind(terminal.stdout);
  terminal.stdout.write = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void,
  ) => {
    if (fail) {
      fail = false;
      throw failure;
    }
    return typeof encoding === "string" ? write(chunk, encoding, callback) : write(chunk, encoding);
  };
  function View({ broken = false }: { broken?: boolean }) {
    const [input, setInput] = useState("");
    useInput((input) => setInput((value) => value + input));
    return (
      <Box flexDirection="column">
        <Image source={rgba} alt="image" width={4} height={2} />
        <Text>{broken ? "broken" : input}</Text>
      </Box>
    );
  }
  const rgba = source(40, 40);
  const app = mount(terminal, <View />);
  try {
    await negotiate(terminal);
    await terminal.waitFor(() => placements(terminal).length > 0);
    terminal.stdin.write("a\x1b_Gi=31;OK\x1b\\\x1b[?1;2c\x1b[6;20;10tb");
    await terminal.waitFor(() => terminal.screen()[2] === "ab");
    const exit = app.waitUntilExit();
    fail = true;
    app.rerender(tree(<View broken />));
    await expect(exit).rejects.toBe(failure);
    await expect(app.waitUntilExit()).rejects.toBe(failure);
    await terminal.flush();
    expect(terminal.stdin.isRaw).toBe(false);
    expect(terminal.terminal.buffer.active.type).toBe("normal");
    expect(terminal.output().lastIndexOf("a=d,d=I")).toBeLessThan(
      terminal.output().lastIndexOf("?1049l"),
    );
    const output = terminal.output();
    terminal.stdin.write("late");
    await terminal.flush();
    expect(terminal.output()).toBe(output);
  } finally {
    await dispose(app, terminal, failure);
  }
});

test("scroll clipping removes fitted padding before source pixels", async () => {
  const terminal = createTerminal(40, 12);
  const scroll: { current: ScrollBoxHandle | null } = { current: null };
  const app = mount(
    terminal,
    <ScrollBox ref={scroll} height={3} flexGrow={0} flexShrink={0} stickyScroll={false}>
      <Image source={source(80, 80)} presentation="transcript" alt="square" width={4} height={4} />
      <Box height={2} flexShrink={0}>
        <Text>{"tail\ntail"}</Text>
      </Box>
    </ScrollBox>,
  );
  try {
    await negotiate(terminal);
    await terminal.waitFor(() => placements(terminal).length > 0);
    const sent = uploads(terminal.output())[0]!;
    expect([sent.fields.s, sent.fields.v]).toEqual(["40", "80"]);
    expect([lastPlacement(terminal).y, lastPlacement(terminal).h]).toEqual(["0", "60"]);
    expect(sent.pixels.slice(0, 40 * 20 * 4).every((byte) => byte === 0)).toBe(true);
    scroll.current!.scrollTo(1);
    await terminal.waitFor(() => lastPlacement(terminal).y === "20");
    expect(lastPlacement(terminal).h).toBe("60");
    scroll.current!.scrollTo(2);
    await terminal.waitFor(() => lastPlacement(terminal).y === "40");
    expect(lastPlacement(terminal).h).toBe("40");
    expect(uploads(terminal.output())).toHaveLength(1);
  } finally {
    await dispose(app, terminal);
  }
});

for (const protocol of ["kitty", "sixel"] as const) {
  test(`${protocol} transparent raster yields to an opaque overlay and returns after release`, async () => {
    const terminal = createTerminal(40, 12);
    const rgba = source(40, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 8; x++) rgba.data[(y * 40 + x) * 4 + 3] = 0;
    const content = (overlay?: "transparent" | "partial" | "opaque") => (
      <Box height={4} flexShrink={0}>
        <Image
          source={rgba}
          transparent
          presentation="transcript"
          alt="image"
          width={4}
          height={2}
        />
        {overlay && (
          <Box
            position="absolute"
            left={0}
            top={0}
            width={overlay === "partial" ? 2 : 4}
            height={2}
            opaque={overlay !== "transparent"}
            backgroundColor={overlay !== "transparent" ? "#0000ff" : undefined}
          />
        )}
      </Box>
    );
    let frames = 0;
    const app = mount(terminal, content(), () => frames++);
    try {
      await negotiate(terminal, protocol);
      await terminal.waitFor(() =>
        protocol === "kitty" ? placements(terminal).length > 0 : rasterCount(terminal) > 0,
      );
      if (protocol === "kitty") expect(uploads(terminal.output())[0]!.pixels).toEqual(rgba.data);
      const beforeTransparent = frames;
      app.rerender(tree(content("transparent")));
      await terminal.waitFor(() => frames > beforeTransparent);
      expect(terminal.screen()[0]).not.toContain("image");
      app.rerender(tree(content("partial")));
      await terminal.waitFor(
        () => terminal.terminal.buffer.active.getLine(0)!.getCell(0)!.getBgColor() === 255,
      );
      expect(terminal.terminal.buffer.active.getLine(0)!.getCell(3)!.isBgDefault()).toBe(true);
      app.rerender(tree(content("opaque")));
      await terminal.waitFor(
        () => terminal.terminal.buffer.active.getLine(0)!.getCell(3)!.getBgColor() === 255,
      );
      const coveredRasters = rasterCount(terminal);
      app.rerender(tree(content()));
      await terminal.waitFor(() =>
        terminal.terminal.buffer.active.getLine(0)!.getCell(0)!.isBgDefault(),
      );
      if (protocol === "sixel")
        await terminal.waitFor(() => rasterCount(terminal) > coveredRasters);
      expect(terminal.screen()[0]).not.toContain("image");
    } finally {
      await dispose(app, terminal);
    }
  });
}

test("two graphics roots keep protocol, metrics and resource release independent", async () => {
  const a = createTerminal(40, 12);
  const b = createTerminal(40, 12);
  function Facts({ name }: { name: string }) {
    const protocol = useTerminalImageProtocol();
    const metrics = useTerminalImageCellSize();
    const [input, setInput] = useState("");
    useInput((text) => setInput((value) => value + text));
    return <Text>{`${name}:${protocol}:${metrics?.width}x${metrics?.height}:${input}`}</Text>;
  }
  const content = (name: string) => (
    <Box flexDirection="column">
      <Image source={source(40, 40)} presentation="transcript" alt={name} width={4} height={2} />
      <Facts name={name} />
    </Box>
  );
  const first = mount(a, content("alpha"));
  const second = mount(b, content("beta"));
  try {
    await negotiate(a, "kitty");
    await negotiate(b, "sixel", true, { width: 8, height: 16 });
    await a.waitFor(() => placements(a).length > 0);
    await b.waitFor(() => rasterCount(b) > 0);
    a.stdin.write("a");
    b.stdin.write("b");
    await a.waitFor(() => a.screen()[2] === "alpha:kitty:10x20:a");
    await b.waitFor(() => b.screen()[2] === "beta:sixel:8x16:b");
    expect(b.output()).not.toContain("a=p");
    expect(a.output()).not.toContain("80$p");
    first.unmount();
    await first.waitUntilExit();
    await a.flush();
    expect(a.stdin.isRaw).toBe(false);
    expect(b.stdin.isRaw).toBe(true);
    expect(b.output()).not.toContain("?1049l");
    const output = a.output();
    second.rerender(tree(content("healthy")));
    await b.waitFor(() => b.screen()[2] === "healthy:sixel:8x16:b");
    expect(a.output()).toBe(output);
  } finally {
    await dispose(first, a);
    await dispose(second, b);
  }
});

// Real worker IO is the public codec boundary; parent clocks cannot manufacture its replies.
test("the real sixel worker reports a failed crop and encodes the next valid request", async () => {
  const { Worker } = await import("node:worker_threads");
  const worker = new Worker(new URL("../../../src/ink/sixel-worker.js", import.meta.url), {
    stdout: true,
    stderr: true,
  });
  worker.stdout?.resume();
  worker.stderr?.resume();
  const response = () =>
    new Promise<unknown>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
  try {
    const failed = response();
    worker.postMessage({
      assetKey: "invalid-crop",
      request: {
        source: source(8, 8),
        width: 8,
        height: 8,
        background: "#000000",
        crop: { left: -1, top: 0, width: 8, height: 8 },
      },
    });
    expect(await failed).toEqual({ error: true });
    const complete = response();
    worker.postMessage({
      assetKey: "recovered",
      request: { source: source(8, 8), width: 8, height: 8, background: "#000000" },
    });
    const result = await complete;
    if (
      typeof result !== "object" ||
      result === null ||
      !("raster" in result) ||
      typeof result.raster !== "object" ||
      result.raster === null ||
      !("data" in result.raster) ||
      typeof result.raster.data !== "string"
    )
      throw new Error("worker did not recover with a real raster");
    expect(result.raster.data).toContain('"1;1;8;8');
  } finally {
    await worker.terminate();
  }
}, 3000);

// Observe genuine worker transport without replacing the encoder or its results.
test.each(["hide", "unmount"] as const)(
  "a sixel worker completing after %s cannot repaint the removed source",
  async (release) => {
    const { Worker } = await import("node:worker_threads");
    const started = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const exited = Promise.withResolvers<void>();
    const post = Worker.prototype.postMessage;
    let observed = false;
    const transport = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
      this: InstanceType<typeof Worker>,
      ...args: Parameters<typeof post>
    ) {
      if (!observed) {
        observed = true;
        this.once("message", () => completed.resolve());
        this.once("error", (error) => completed.reject(error));
        this.once("exit", () => exited.resolve());
        started.resolve();
      }
      return post.apply(this, args);
    });
    const terminal = createTerminal(40, 12);
    const app = mount(
      terminal,
      <Image
        source={source(64, 64)}
        presentation="transcript"
        transparent
        alt="pending"
        width={8}
        height={4}
      />,
    );
    try {
      await negotiate(terminal, "sixel");
      await started.promise;
      if (release === "hide") {
        app.rerender(tree(<Text>released</Text>));
        await terminal.waitFor(() => terminal.screen()[0] === "released");
        await completed.promise;
        await terminal.flush();
        expect(rasterCount(terminal)).toBe(0);
        expect(terminal.screen()[0]).toBe("released");
      }
      app.unmount();
      await app.waitUntilExit();
      await exited.promise;
      await terminal.flush();
      expect(rasterCount(terminal)).toBe(0);
      expect(terminal.stdin.isRaw).toBe(false);
      const output = terminal.output();
      await terminal.flush();
      expect(terminal.output()).toBe(output);
    } finally {
      await dispose(app, terminal);
      transport.mockRestore();
    }
  },
  3000,
);

// Terminate an actual worker process at its IO boundary, without substituting its encoder.
test("unexpected sixel worker exit retains fallback and a changed source recreates the worker", async () => {
  const { Worker } = await import("node:worker_threads");
  const started = Promise.withResolvers<InstanceType<typeof Worker>>();
  const post = Worker.prototype.postMessage;
  let observed = false;
  const transport = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: InstanceType<typeof Worker>,
    ...args: Parameters<typeof post>
  ) {
    if (!observed) {
      observed = true;
      started.resolve(this);
    }
    return post.apply(this, args);
  });
  const terminal = createTerminal(40, 12);
  let frames = 0;
  const app = mount(
    terminal,
    <Image source={source(64, 64)} presentation="transcript" alt="failed" width={8} height={4} />,
    () => frames++,
  );
  try {
    await negotiate(terminal, "sixel");
    const worker = await started.promise;
    const beforeExit = frames;
    await worker.terminate();
    await terminal.waitFor(() => frames > beforeExit && terminal.screen()[0] === "failed");
    expect(rasterCount(terminal)).toBe(0);
    expect(terminal.stdin.isRaw).toBe(true);
    app.rerender(
      tree(
        <Image
          source={source(64, 64, 2)}
          presentation="transcript"
          alt="recovered"
          width={8}
          height={4}
        />,
      ),
    );
    await terminal.waitFor(() => rasterCount(terminal) > 0);
    expect(terminal.screen()[0]).not.toContain("recovered");
  } finally {
    await dispose(app, terminal);
    transport.mockRestore();
  }
}, 3000);

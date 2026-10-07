import { expect, test } from "bun:test";
import { useRef } from "react";
import { readFile } from "node:fs/promises";
import {
  AlternateScreen,
  Box,
  Text,
  renderSync,
  useInput,
  ScrollBox,
  type ScrollBoxHandle,
  usePaintedViewport,
} from "../../../src/ink";
import { useImageSource } from "../../../src/tui/components/image-source";
import { ImageGallery } from "../../../src/tui/components/image-gallery";
import { ImagePreview } from "../../../src/tui/components/image-preview";
import { createTerminal } from "../../ink/helpers/terminal";

const png = await readFile(new URL("../fixtures/1000x800.png", import.meta.url));
const image = {
  data: png.toString("base64"),
  mimeType: "image/png",
  name: "scene",
  metadata: { width: 1000, height: 800, bytes: png.length },
};

// Public app components are rendered through the native root and real capability IO.
for (const protocol of ["kitty", "sixel"] as const) {
  test(`${protocol} demand decodes gallery pixels and releases placement on close`, async () => {
    const terminal = createTerminal(80, 24);
    let opened = -1;
    function View() {
      useInput(() => {});
      return <ImageGallery images={[image]} onOpen={(index) => (opened = index)} />;
    }
    const app = renderSync(
      <AlternateScreen>
        <View />
      </AlternateScreen>,
      { ...terminal, patchConsole: false, exitOnCtrlC: false, terminalImages: true },
    );
    try {
      await terminal.waitFor(() => terminal.output().includes("a=q"));
      terminal.stdin.write(
        `\x1b_Gi=31;${protocol === "kitty" ? "OK" : "ENOTSUP"}\x1b\\\x1b[6;20;10t\x1b[4;480;800t\x1b[?1;${protocol === "sixel" ? "4" : "2"}c`,
      );
      if (protocol === "sixel") {
        await terminal.waitFor(() => terminal.output().includes("80$p"));
        terminal.stdin.write("\x1b[?80;2$y\x1b[?1;4c\x1b[?1;4c");
      }
      await terminal.waitFor(() =>
        protocol === "kitty"
          ? terminal.output().includes("a=p")
          : // oxlint-disable-next-line no-control-regex -- Observe actual sixel DCS at terminal IO.
            /\x1bP[^\x1b]*q/.test(terminal.output()),
      );
      terminal.stdin.write("\x1b[<0;4;2M\x1b[<0;4;2m");
      await terminal.waitFor(() => opened === 0);
      app.rerender(
        <AlternateScreen>
          <Text>closed</Text>
        </AlternateScreen>,
      );
      await terminal.waitFor(() => terminal.screen().join("\n").includes("closed"));
      if (protocol === "kitty") expect(terminal.output()).toContain("a=d");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      await terminal.flush();
      terminal.dispose();
    }
  }, 5000);
}

test("preview fallback has modal click ownership and restores original metadata", async () => {
  const terminal = createTerminal(80, 24);
  let closed = 0;
  function View() {
    useInput(() => {});
    return (
      <Box width={80} height={24}>
        <ImagePreview
          image={image}
          index={0}
          total={1}
          width={80}
          height={24}
          locale="en"
          onClose={() => closed++}
        />
      </Box>
    );
  }
  const app = renderSync(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    { ...terminal, patchConsole: false, exitOnCtrlC: false, terminalImages: false },
  );
  try {
    await terminal.flush();
    expect(terminal.screen().join("\n")).toContain("1000×800");
    terminal.stdin.write("\x1b[<0;40;12M\x1b[<0;40;12m");
    await terminal.flush();
    expect(closed).toBe(0);
    terminal.stdin.write("\x1b[<0;1;1M\x1b[<0;1;1m");
    await terminal.waitFor(() => closed === 1);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("painted visibility follows native scroll clips and resize before image demand", async () => {
  const terminal = createTerminal(40, 12);
  const scroll: { current: ScrollBoxHandle | null } = { current: null };
  const seen = new Map<string, boolean>();
  function Row({ name }: { name: string }) {
    const [ref, visible] = usePaintedViewport();
    seen.set(name, visible);
    return (
      <Box ref={ref} height={10} flexShrink={0}>
        <Text>{name}</Text>
      </Box>
    );
  }
  function View() {
    useInput(() => {});
    const handle = useRef<ScrollBoxHandle>(null);
    return (
      <ScrollBox
        ref={(next) => {
          handle.current = next;
          scroll.current = next;
        }}
        height={10}
      >
        <Row name="first" />
        <Row name="second" />
      </ScrollBox>
    );
  }
  const app = renderSync(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.waitFor(() => seen.get("first") === true && seen.get("second") === false);
    scroll.current?.scrollTo(10);
    await terminal.waitFor(() => seen.get("first") === false && seen.get("second") === true);
    terminal.resize(40, 6);
    await terminal.waitFor(() => seen.get("second") === true);
    expect(seen.get("first")).toBe(false);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("released image demand discards late decodes and reopens with a fresh snapshot", async () => {
  const terminal = createTerminal(40, 12);
  let snapshot: unknown;
  function View({ enabled }: { enabled: boolean }) {
    snapshot = useImageSource(image.data, enabled, "transcript");
    return <Text>{snapshot ? "ready" : "pending"}</Text>;
  }
  const app = renderSync(<View enabled />, terminal);
  try {
    app.rerender(<View enabled={false} />);
    await terminal.flush();
    expect(snapshot).toBeUndefined();
    app.rerender(<View enabled />);
    await terminal.waitFor(() => snapshot !== undefined);
    const first = snapshot;
    app.rerender(<View enabled={false} />);
    await terminal.flush();
    expect(snapshot).toBeUndefined();
    app.rerender(<View enabled />);
    // Disabled demand dropped ownership rather than keeping a hidden cache.
    expect(snapshot).toBeUndefined();
    await terminal.waitFor(() => snapshot !== undefined);
    expect(snapshot).not.toBe(first);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("preview uses measured 100% crop and native wheel/drag without closing the card", async () => {
  const sharp = (await import("sharp")).default;
  const pixels = new Uint8Array(1000 * 800 * 4);
  for (let y = 0; y < 800; y++)
    for (let x = 0; x < 1000; x++) {
      const offset = (y * 1000 + x) * 4;
      pixels.set([x % 255, y % 255, 100, 255], offset);
    }
  const bytes = await sharp(pixels, { raw: { width: 1000, height: 800, channels: 4 } })
    .png()
    .toBuffer();
  const patterned = { ...image, data: bytes.toString("base64") };
  const terminal = createTerminal(80, 24);
  let closed = 0;
  function View() {
    useInput(() => {});
    return (
      <Box width={80} height={24}>
        <ImagePreview
          image={patterned}
          index={0}
          total={1}
          width={80}
          height={24}
          locale="en"
          onClose={() => closed++}
        />
      </Box>
    );
  }
  const app = renderSync(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    { ...terminal, terminalImages: true },
  );
  const uploads = () => terminal.output().match(/a=t,/g)?.length ?? 0;
  const click = (x: number, y: number) =>
    terminal.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
  try {
    await terminal.waitFor(() => terminal.output().includes("a=q"));
    terminal.stdin.write("\x1b_Gi=31;OK\x1b\\\x1b[6;20;10t\x1b[4;480;800t\x1b[?1;2c");
    await terminal.waitFor(() => uploads() > 0);
    const controls = terminal.screen().findIndex((row) => row.includes("100%"));
    click(terminal.screen()[controls]!.indexOf("100%"), controls);
    await terminal.waitFor(() => terminal.screen().some((row) => row.includes("· 100%")));
    const title = terminal.screen().findIndex((row) => row.includes("Image #1"));
    const left = terminal.screen()[title]!.indexOf("Image #1");
    await terminal.waitFor(() => uploads() > 1);
    expect(terminal.output().match(/s=(\d+),v=(\d+)/g)).toContain("s=700,v=300");
    let count = uploads();
    terminal.stdin.write(`\x1b[<65;${left + 2};${title + 3}M`);
    await terminal.waitFor(() => uploads() > count);
    count = uploads();
    terminal.stdin.write(
      `\x1b[<0;${left + 8};${title + 3}M\x1b[<32;${left + 5};${title + 4}M\x1b[<0;${left + 5};${title + 4}m`,
    );
    await terminal.waitFor(() => uploads() > count);
    expect(closed).toBe(0);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

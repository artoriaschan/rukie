import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";
import sharp from "sharp";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2UAAAAASUVORK5CYII=";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
const click = (app: Awaited<ReturnType<typeof start>>, label: string) => {
  const row = app.screen().findIndex((line) => line.includes(label));
  expect(row).toBeGreaterThanOrEqual(0);
  const col = app.screen()[row]!.indexOf(label) + 1;
  app.stdin.write(`\x1b[<0;${col};${row + 1}M\x1b[<0;${col};${row + 1}m`);
};

test("message thumbnail opens metadata in the message viewport and closing Enter preserves the draft and Run", async () => {
  const opened: string[] = [];
  const app = await start([], {
    rows: 32,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
    host: {
      readClipboard: async () => ({ empty: true }),
      openExternal: async (path) => {
        opened.push(path);
      },
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(
      () =>
        app.calls.length === 1 && app.screen().some((line) => line.includes("[Image · shot.png]")),
    );
    app.stdin.write("keep draft");
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ keep draft")));
    click(app, "[Image · shot.png]");
    await app.waitFor(() => app.screen().some((line) => line.includes("Open original")));
    expect(app.screen().join("\n")).toContain("PNG · 1×1 · 68 B");
    expect(app.screen().join("\n")).toContain("❯ keep draft");
    expect(opened).toEqual([]);
    app.stdin.write("ignored\r");
    await app.waitFor(() => !app.screen().some((line) => line.includes("Open original")));
    expect(app.screen().join("\n")).toContain("❯ keep draft");
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("preview snapshots repeated user and read occurrences and clamps navigation while a Run adds images", async () => {
  const app = await start([], {
    rows: 48,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/same.png`, Buffer.from(png, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/same.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "same.png" });
    await app.waitFor(
      () =>
        app.calls.length === 2 &&
        app.screen().filter((line) => line.includes("[Image · same.png]")).length === 2,
    );
    const matching = app
      .screen()
      .flatMap((line, row) => (line.includes("[Image · same.png]") ? [row] : []));
    const row = matching[1]!;
    app.stdin.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m`);
    await app.waitFor(() => app.screen().join("\n").includes("2/2"));
    expect(app.screen().join("\n")).toContain("Image #2");
    app.stdin.write("\x1b[C");
    await app.flush();
    expect(app.screen().join("\n")).toContain("2/2");
    app.calls[1]!.tool("read", { path: "same.png" });
    await app.waitFor(() => app.calls.length === 3);
    expect(app.screen().join("\n")).toContain("2/2");
    app.stdin.write("\x1b[D\x1b[D");
    await app.waitFor(() => app.screen().join("\n").includes("1/2"));
    app.stdin.write("\x03");
    await app.waitFor(() => !app.screen().join("\n").includes("Open original"));
    expect(app.calls[2]!.signal!.aborted).toBe(false);
    app.calls[2]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("preview closes for approval and the approval owns Enter", async () => {
  const app = await start([], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(
      () =>
        app.calls.length === 1 && app.screen().some((line) => line.includes("[Image · shot.png]")),
    );
    click(app, "[Image · shot.png]");
    await app.waitFor(() => app.screen().join("\n").includes("Open original"));
    app.calls[0]!.tool("bash", {
      command: "printf preview-approval",
      description: "Run test command",
    });
    await app.waitFor(() => app.screen().join("\n").includes("Waiting for approval"));
    expect(app.screen().join("\n")).not.toContain("Open original");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: false });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

const placements = (output: string) =>
  // oxlint-disable-next-line no-control-regex -- Observe protocol bytes at the terminal IO seam.
  [...output.matchAll(/\x1b_Ga=p,([^;]+);/g)].map((match) =>
    Object.fromEntries(
      match[1]!.split(",").map((field) => {
        const [key, value] = field.split("=");
        return [key!, Number(value)];
      }),
    ),
  );

type KittyPacket = { fields: Record<string, string>; payload: string };
type KittyUpload = {
  width: number;
  height: number;
  pixels: Buffer;
  chunks: number;
  maxChunk: number;
};

/** Parse complete native APC packets and assemble one real RGBA upload across its chunks. */
function kittyReader(output: () => string) {
  let offset = 0;
  let pending: { fields: Record<string, string>; chunks: string[] } | undefined;
  const packets: KittyPacket[] = [];
  const images = new Map<string, KittyUpload>();
  return () => {
    const bytes = output();
    // oxlint-disable-next-line no-control-regex -- Read the real terminal protocol boundary.
    const pattern = /\x1b_G([^;]*);([^\x1b]*)\x1b\\/g;
    pattern.lastIndex = offset;
    for (let match = pattern.exec(bytes); match; match = pattern.exec(bytes)) {
      offset = pattern.lastIndex;
      const fields = Object.fromEntries(match[1]!.split(",").map((field) => field.split("=")));
      const payload = match[2]!;
      packets.push({ fields, payload });
      if (fields.a === "t") pending = { fields, chunks: [] };
      if (pending && fields.m !== undefined) {
        pending.chunks.push(payload);
        if (fields.m === "0") {
          expect(pending.fields).toMatchObject({ f: "32", t: "d" });
          expect(pending.fields.o).toBeUndefined();
          const width = Number(pending.fields.s);
          const height = Number(pending.fields.v);
          const pixels = Buffer.from(pending.chunks.join(""), "base64");
          const maxChunk = Math.max(...pending.chunks.map((chunk) => chunk.length));
          expect(maxChunk).toBeLessThanOrEqual(4096);
          expect(pixels.length).toBe(width * height * 4);
          images.set(pending.fields.i!, {
            width,
            height,
            pixels,
            chunks: pending.chunks.length,
            maxChunk,
          });
          pending = undefined;
        }
      }
    }
    return { packets, images };
  };
}

test("PNG thumbnails yield graphics to source-pixel zoom, button/wheel/drag pan and Fit without moving the transcript", async () => {
  // Coordinates are encoded in opaque pixels so the real decoded crops prove pan direction.
  const pixels = Buffer.alloc(1000 * 800 * 4);
  for (let y = 0; y < 800; y++)
    for (let x = 0; x < 1000; x++)
      pixels.set(
        [x % 251, y % 251, Math.floor(x / 251) + Math.floor(y / 251) * 4, 255],
        (y * 1000 + x) * 4,
      );
  const pngBytes = await sharp(pixels, { raw: { width: 1000, height: 800, channels: 4 } })
    .png()
    .toBuffer();
  const app = await startWithClock([], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/large.png`, pngBytes);
    },
  });
  const read = kittyReader(app.output);
  let answeredSentinels = 0;
  const answerSentinels = () => {
    // Each emitted DA1 query owns one reply, including concurrent startup batches.
    // oxlint-disable-next-line no-control-regex -- Terminal query acknowledgement.
    const sent = app.output().match(/\x1b\[c/g)?.length ?? 0;
    app.stdin.write("\x1b[?1;2c".repeat(sent - answeredSentinels));
    answeredSentinels = sent;
  };
  const latestPlacement = () =>
    read()
      .packets.filter((packet) => packet.fields.a === "p")
      .at(-1)?.fields;
  const placedImage = () => {
    const placement = latestPlacement()!;
    return { placement, image: read().images.get(placement.i!)! };
  };
  const crop = (image: KittyUpload) => {
    const x = image.pixels[0]! + (image.pixels[2]! % 4) * 251;
    const y = image.pixels[1]! + Math.floor(image.pixels[2]! / 4) * 251;
    expect(x + image.width).toBeLessThanOrEqual(1000);
    expect(y + image.height).toBeLessThanOrEqual(800);
    const expected = Buffer.alloc(image.pixels.length);
    for (let row = 0; row < image.height; row++)
      pixels.copy(
        expected,
        row * image.width * 4,
        ((y + row) * 1000 + x) * 4,
        ((y + row) * 1000 + x + image.width) * 4,
      );
    expect(image.pixels.equals(expected)).toBe(true);
    return { x, y };
  };
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/large.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(
      () =>
        app.calls.length === 1 && app.screen().some((line) => line.includes("[Image · large.png]")),
    );
    app.stdin.write("keep draft");
    await app.waitFor(() => app.screen().includes("❯ keep draft"));
    await app.waitFor(() => read().packets.some((packet) => packet.fields.a === "q"));
    expect(read().packets.find((packet) => packet.fields.a === "q")!.fields.i).toBe("31");
    app.stdin.write("\x1b_Gi=31;OK\x1b\\");
    answerSentinels();
    await app.waitFor(() =>
      read().packets.some(
        (packet) => packet.fields.a === "p" && packet.fields.c === "24" && packet.fields.r === "10",
      ),
    );
    await app.waitFor(() => read().packets.filter((packet) => packet.fields.a === "p").length >= 2);
    const visible = read()
      .packets.filter((packet) => packet.fields.a === "p")
      .map((packet) => packet.fields);
    const thumb = visible.find((item) => item.c === "24" && item.r === "10")!;
    const portrait = visible.find((item) => item.i !== thumb.i)!;
    expect(portrait).toBeDefined();
    expect(read().images.get(thumb.i!)!.pixels.length).toBeLessThanOrEqual(4 * 1024 * 1024);
    const before = app.screen().slice(0, 5);
    const openedAt = read().packets.length;
    click(app, "large.png");
    await app.waitFor(() => app.screen().join("\n").includes("Open original"));
    await app.waitFor(() =>
      read()
        .packets.slice(openedAt)
        .some(
          (packet) =>
            packet.fields.a === "d" && packet.fields.d === "i" && packet.fields.i === portrait.i,
        ),
    );
    expect(app.screen().find((line) => line.includes("Image #1"))).toContain("PNG · 1000×800");
    const disabled = () => {
      const row = app.screen().findIndex((line) => line.includes("100%"));
      return app.terminal.buffer.active
        .getLine(row)!
        .getCell(app.screen()[row]!.indexOf("100%"))!
        .isDim();
    };
    expect(disabled()).toBeTruthy();
    // Protocol support can precede metrics; a public resize requests a fresh geometry batch.
    const metricsAt = app.output().length;
    const metricsPacketsAt = read().packets.length;
    app.resize(80, 41);
    await app.waitFor(() => app.output().slice(metricsAt).includes("\x1b[16t"));
    app.stdin.write("\x1b[6;20;10t\x1b[4;820;800t");
    answerSentinels();
    await app.waitFor(() => {
      const current = read();
      const p = current.packets
        .slice(metricsPacketsAt)
        .filter((packet) => packet.fields.a === "p")
        .at(-1)?.fields;
      const image = p && current.images.get(p.i!);
      // Metrics enable the control before asynchronous RGBA decode has necessarily committed.
      return (
        !disabled() &&
        !!image &&
        image.width === Number(p.c) * 10 &&
        image.height === Number(p.r) * 20
      );
    });
    expect(app.screen().join("\n")).not.toContain("Image preview unavailable in this terminal");
    const fit = placedImage();
    click(app, "100%");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("· 100%")) &&
        latestPlacement()?.i !== fit.placement.i,
    );
    const at100 = placedImage();
    expect(at100.image.width).toBe(Number(at100.placement.c) * 10);
    expect(at100.image.height).toBe(Number(at100.placement.r) * 20);
    const first = crop(at100.image);
    expect(first.x).toBeGreaterThan(0);
    click(app, "→");
    await app.waitFor(() => latestPlacement()?.i !== at100.placement.i);
    const afterButton = placedImage();
    const buttonCrop = crop(afterButton.image);
    expect(buttonCrop.x).toBeGreaterThan(first.x);
    expect(buttonCrop.y).toBe(first.y);
    const cardRow = app.screen().findIndex((line) => line.includes("Image #1"));
    const imageY = cardRow + 2;
    app.stdin.write(`\x1b[<65;40;${imageY}M`);
    await app.waitFor(() => latestPlacement()?.i !== afterButton.placement.i);
    const afterWheel = placedImage();
    const wheelCrop = crop(afterWheel.image);
    expect(wheelCrop.y).toBeGreaterThan(buttonCrop.y);
    expect(wheelCrop.x).toBe(buttonCrop.x);
    app.stdin.write(`\x1b[<0;40;${imageY}M\x1b[<32;42;${imageY}M\x1b[<0;42;${imageY}m`);
    await app.waitFor(() => latestPlacement()?.i !== afterWheel.placement.i);
    const afterDrag = placedImage();
    expect(crop(afterDrag.image).x).toBeLessThan(wheelCrop.x);
    expect(app.screen().join("\n")).toContain("Open original");
    click(app, "+");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("· 200%")) &&
        latestPlacement()?.i !== afterDrag.placement.i,
    );
    const at200 = placedImage();
    expect(at200.image.width).toBe(Number(at200.placement.c) * 5);
    expect(at200.image.height).toBe(Number(at200.placement.r) * 10);
    crop(at200.image);
    const uploads = read().images.size;
    click(app, "Fit");
    await app.waitFor(
      () =>
        !app.screen().some((line) => line.includes("· 200%")) &&
        latestPlacement()?.i === fit.placement.i,
    );
    expect(placedImage().image.pixels.equals(fit.image.pixels)).toBe(true);
    expect(read().images.size).toBe(uploads);
    const closedAt = read().packets.length;
    app.stdin.write("\r");
    await app.waitFor(() => !app.screen().join("\n").includes("Open original"));
    await app.waitFor(() =>
      read()
        .packets.slice(closedAt)
        .some(
          (packet) =>
            packet.fields.a === "p" &&
            packet.fields.c === portrait.c &&
            packet.fields.r === portrait.r,
        ),
    );
    await app.waitFor(() =>
      read()
        .packets.slice(closedAt)
        .some(
          (packet) =>
            packet.fields.a === "p" && packet.fields.c === thumb.c && packet.fields.r === thumb.r,
        ),
    );
    expect(app.screen().slice(0, 5)).toEqual(before);
    expect(app.screen()).toContain("❯ keep draft");
    expect(app.calls).toHaveLength(1);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test.each(["\x1b", "\x03", "\r", "outside"])(
  "closing a preview with %j preserves draft, reading position and a live Run",
  async (key) => {
    const app = await start([], {
      rows: 40,
      env: { LANG: "en_US.UTF-8" },
      prepare: async (root) => {
        await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write(paste(`${app.root}/shot.png`));
      await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
      app.stdin.write("\r");
      await app.waitFor(
        () =>
          app.calls.length === 1 &&
          app.screen().some((line) => line.includes("[Image · shot.png]")),
      );
      app.stdin.write("keep me");
      await app.waitFor(() => app.screen().some((line) => line.includes("❯ keep me")));
      const before = app.screen().slice(0, 5);
      click(app, "[Image · shot.png]");
      await app.waitFor(() => app.screen().join("\n").includes("Open original"));
      app.stdin.write(paste("blocked paste") + "\x1b[<65;1;1M");
      if (key === "outside") app.stdin.write("\x1b[<0;1;1M\x1b[<0;1;1m");
      else app.stdin.write(key);
      await app.waitFor(() => !app.screen().join("\n").includes("Open original"));
      expect(app.screen().join("\n")).toContain("❯ keep me");
      expect(app.screen().slice(0, 5)).toEqual(before);
      expect(app.calls[0]!.signal!.aborted).toBe(false);
      app.calls[0]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test.each(["zh_CN.UTF-8", "en_US.UTF-8"])(
  "a %s non-PNG preview survives small resize without graphics and opens only the explicit original",
  async (language) => {
    const opened: string[] = [];
    const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const app = await start([], {
      rows: 40,
      env: { LANG: language, TMUX: "isolated-test" },
      prepare: async (root) => {
        await Bun.write(`${root}/shot.gif`, Buffer.from(gif, "base64"));
      },
      host: {
        readClipboard: async () => ({ empty: true }),
        openExternal: async (path) => {
          opened.push(path);
        },
      },
    });
    const original = language.startsWith("zh") ? "打开原图" : "Open original";
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write(paste(`${app.root}/shot.gif`));
      await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
      app.stdin.write("\r");
      await app.waitFor(
        () =>
          app.calls.length === 1 &&
          app.screen().some((line) => line.includes("[Image · shot.gif]")),
      );
      click(app, "[Image · shot.gif]");
      await app.waitFor(() => app.screen().join("\n").includes(original));
      expect(app.screen().join("\n")).toContain("GIF · 1×1 · 42 B");
      expect(opened).toEqual([]);
      expect(placements(app.output())).toEqual([]);
      app.resize(30, 10);
      await app.waitFor(() => app.screen().join("\n").includes(original));
      expect(app.screen().every((line) => Bun.stringWidth(line) <= 30)).toBe(true);
      expect(placements(app.output())).toEqual([]);
      app.resize(80, 40);
      // The restored large preview must commit its lower controls before clicking.
      await app.waitFor(
        () =>
          app.screen().join("\n").includes("GIF · 1×1 · 42 B") &&
          app.screen().findIndex((line) => line.includes(original)) >=
            Math.floor(app.terminal.rows / 2),
      );
      click(app, original);
      await app.waitFor(() => opened.length === 1);
      expect(await Bun.file(opened[0]!).bytes()).toEqual(Buffer.from(gif, "base64"));
      app.stdin.write("\r");
      await app.waitFor(() => !app.screen().join("\n").includes(original));
      app.calls[0]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test("a reading preview preserves its transcript anchor while the background Run streams and consumes return-to-bottom clicks", async () => {
  const app = await startWithClock([], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      Array.from({ length: 50 }, (_, index) => `anchor-line-${index}`).join("\n"),
    );
    await app.waitFor(() => app.screen().join("\n").includes("anchor-line-49"));
    app.stdin.write("\x1b[5~\x1b[5~\x1b[<65;4;5M");
    await app.waitFor(
      () =>
        app.screen().join("\n").includes("[Image · shot.png]") &&
        app.screen().join("\n").includes("Back to bottom"),
    );
    const before = app.screen().slice(0, 5);
    click(app, "[Image · shot.png]");
    await app.waitFor(() => app.screen().join("\n").includes("Open original"));
    click(app, "Back to bottom");
    app.calls[0]!.delta("\nnew output sentinel");
    await app.waitFor(() => app.screen().join("\n").includes("New output"));
    app.stdin.write("\r");
    await app.waitFor(() => !app.screen().join("\n").includes("Open original"));
    expect(app.screen().slice(0, 5)).toEqual(before);
    expect(app.screen().join("\n")).toContain("New output");
    expect(app.screen().join("\n")).not.toContain("new output sentinel");
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("each multi-image thumbnail locates its occurrence in the gallery", async () => {
  const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const app = await start([], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/one.png`, Buffer.from(png, "base64"));
      await Bun.write(`${root}/two.gif`, Buffer.from(gif, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/one.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write(paste(`${app.root}/two.gif`));
    await app.waitFor(() => app.screen().some((line) => line.includes("[Image #2]")));
    app.stdin.write("\r");
    await app.waitFor(
      () =>
        app.calls.length === 1 &&
        app.screen().some((line) => line.includes("one.png") && line.includes("two.gif")),
    );
    click(app, "two.gif");
    await app.waitFor(() => app.screen().join("\n").includes("Image #2 · GIF"));
    expect(app.screen().join("\n")).toContain("2/2");
    app.stdin.write("\x1b[D");
    await app.waitFor(() => app.screen().join("\n").includes("Image #1 · PNG"));
    app.stdin.write("\r");
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("a pending question takes focus from preview and receives its answer without changing the composer", async () => {
  const app = await start([], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(
      () =>
        app.calls.length === 1 && app.screen().some((line) => line.includes("[Image · shot.png]")),
    );
    app.stdin.write("kept draft");
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ kept draft")));
    click(app, "[Image · shot.png]");
    await app.waitFor(() => app.screen().join("\n").includes("Open original"));
    app.calls[0]!.tool("ask_user_question", {
      questions: [
        {
          question: "Choose from preview",
          header: "Choice",
          multiSelect: false,
          options: [
            { label: "One", description: "First" },
            { label: "Two", description: "Second" },
          ],
        },
      ],
    });
    await app.waitFor(() => app.screen().join("\n").includes("Choose from preview"));
    expect(app.screen().join("\n")).not.toContain("Open original");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: '"Choose from preview" → One' }],
    });
    await app.waitFor(() => app.screen().join("\n").includes("❯ kept draft"));
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("preview owns mouse input while live SubagentPanel fold and child-detail controls remain visible", async () => {
  const app = await start([], {
    rows: 48,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", { description: "Review child", prompt: "child review" });
    await app.waitFor(
      () => app.calls.length === 3 && app.screen().join("\n").includes("▾ Subagents"),
    );
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("child review"),
      ),
    )!;
    const parent = app.calls.find((call, index) => index > 0 && call !== child)!;
    app.stdin.write("preserved draft");
    await app.waitFor(() => app.screen().join("\n").includes("❯ preserved draft"));
    click(app, "[Image · shot.png]");
    await app.waitFor(() => app.screen().join("\n").includes("Open original"));
    click(app, "▾ Subagents");
    app.resize(app.terminal.cols + 1, 48);
    await app.waitFor(() =>
      app
        .screen()
        .some((line) => line.startsWith("╭") && Bun.stringWidth(line) === app.terminal.cols),
    );
    expect(app.screen().join("\n")).toContain("▾ Subagents");
    expect(app.screen().join("\n")).not.toContain("▸ Subagents");
    click(app, "[general-purpose] Review child");
    app.resize(app.terminal.cols + 1, 48);
    await app.waitFor(() =>
      app
        .screen()
        .some((line) => line.startsWith("╭") && Bun.stringWidth(line) === app.terminal.cols),
    );
    expect(app.screen().join("\n")).toContain("Open original");
    expect(app.screen().join("\n")).not.toContain("id ");
    expect(parent.signal!.aborted).toBe(false);
    expect(child.signal!.aborted).toBe(false);
    app.stdin.write("\r");
    await app.waitFor(() => !app.screen().join("\n").includes("Open original"));
    expect(app.screen().join("\n")).toContain("❯ preserved draft");
    click(app, "▾ Subagents");
    await app.waitFor(() => app.screen().join("\n").includes("▸ Subagents"));
    click(app, "[general-purpose] Review child");
    await app.waitFor(() => app.screen().join("\n").includes("id "));
    app.stdin.write("\x1b");
  } finally {
    await app.cleanup();
  }
});

test("an active model picker retains mouse ownership when a transcript image is clicked", async () => {
  const app = await start([], {
    rows: 48,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/model\r");
    await app.waitFor(
      () =>
        app.screen().join("\n").includes("Select model") &&
        app.screen().join("\n").includes("[Image · shot.png]"),
    );
    click(app, "[Image · shot.png]");
    app.resize(81, 48);
    await app.waitFor(() =>
      app.screen().some((line) => line.startsWith("╭") && Bun.stringWidth(line) === 81),
    );
    expect(app.screen().join("\n")).toContain("Select model");
    expect(app.screen().join("\n")).not.toContain("Open original");
    app.stdin.write("\x1b");
    await app.waitFor(() => !app.screen().join("\n").includes("Select model"));
    click(app, "[Image · shot.png]");
    await app.waitFor(() => app.screen().join("\n").includes("Open original"));
    app.stdin.write("\r");
  } finally {
    await app.cleanup();
  }
});

test("preview suspends the command menu and restores its slash draft after closing", async () => {
  const app = await start([], {
    rows: 48,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/");
    await app.waitFor(() => app.screen().join("\n").includes("commands ·"));
    click(app, "[Image · shot.png]");
    await app.waitFor(() => app.screen().join("\n").includes("Open original"));
    expect(app.screen().join("\n")).not.toContain("commands ·");
    expect(app.screen().join("\n")).toContain("❯ /");
    app.stdin.write("\r");
    await app.waitFor(() => !app.screen().join("\n").includes("Open original"));
    await app.waitFor(() => app.screen().join("\n").includes("commands ·"));
    expect(app.screen().join("\n")).toContain("❯ /");
    expect(app.calls).toHaveLength(1);
  } finally {
    await app.cleanup();
  }
});

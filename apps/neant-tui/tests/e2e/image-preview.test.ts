import { expect, test } from "bun:test";
import { start } from "../helpers/app";

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
    app.calls[0]!.tool("bash", { command: "printf preview-approval" });
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

test("PNG thumbnails yield graphics to source-pixel zoom, button/wheel/drag pan and Fit without moving the transcript", async () => {
  const app = await start([], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(
        `${root}/large.png`,
        Bun.file(new URL("../fixtures/1000x800.png", import.meta.url)),
      );
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/large.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\r");
    await app.waitFor(
      () =>
        app.calls.length === 1 && app.screen().some((line) => line.includes("[Image · large.png]")),
    );
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    const before = app.screen().slice(0, 5);
    app.stdin.write("\x1b_Gi=2147483647;OK\x1b\\");
    await app.waitFor(() => placements(app.output()).length > 0);
    const thumb = placements(app.output()).at(-1)!;
    expect(thumb.c).toBe(24);
    expect(thumb.r).toBe(9);
    click(app, "large.png");
    await app.waitFor(() => app.screen().join("\n").includes("Open original"));
    const title = app.screen().find((line) => line.includes("Image #1"))!;
    expect(title).toContain("PNG · 1000×800");
    const disabledRow = app.screen().findIndex((line) => line.includes("100%"));
    expect(
      app.terminal.buffer.active
        .getLine(disabledRow)!
        .getCell(app.screen()[disabledRow]!.indexOf("100%"))!
        .isDim(),
    ).toBeTruthy();
    app.stdin.write("\x1b[6;20;10t");
    await app.waitFor(
      () =>
        !app.terminal.buffer.active
          .getLine(disabledRow)!
          .getCell(app.screen()[disabledRow]!.indexOf("100%"))!
          .isDim(),
    );
    const uploads = app.output().match(/a=t,/g)!.length;
    click(app, "100%");
    await app.waitFor(() => app.screen().some((line) => line.includes("· 100%")));
    const at100 = placements(app.output()).at(-1)!;
    expect(at100.w).toBe(at100.c! * 10);
    expect(at100.h).toBe(at100.r! * 20);
    expect(at100.x).toBeGreaterThan(0);
    click(app, "→");
    await app.waitFor(() => placements(app.output()).at(-1)!.x! > at100.x!);
    const afterButton = placements(app.output()).at(-1)!;
    const cardRow = app.screen().findIndex((line) => line.includes("Image #1"));
    const imageY = cardRow + 2;
    app.stdin.write(`\x1b[<65;40;${imageY}M`);
    await app.waitFor(() => placements(app.output()).at(-1)!.y! > afterButton.y!);
    const afterWheel = placements(app.output()).at(-1)!;
    app.stdin.write(`\x1b[<0;40;${imageY}M\x1b[<32;42;${imageY}M\x1b[<0;42;${imageY}m`);
    await app.waitFor(() => placements(app.output()).at(-1)!.x! < afterWheel.x!);
    click(app, "+");
    await app.waitFor(() => app.screen().some((line) => line.includes("· 200%")));
    const at200 = placements(app.output()).at(-1)!;
    expect(at200.w).toBe(at200.c! * 5);
    click(app, "Fit");
    await app.waitFor(() => !app.screen().some((line) => line.includes("· 200%")));
    expect(placements(app.output()).at(-1)).toMatchObject({ x: 0, y: 0, w: 1000, h: 800 });
    expect(app.output().match(/a=t,/g)!.length).toBe(uploads);
    app.stdin.write("\r");
    await app.waitFor(() => !app.screen().join("\n").includes("Open original"));
    expect(app.screen().slice(0, 5)).toEqual(before);
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
      await app.waitFor(() => app.screen().join("\n").includes("GIF · 1×1 · 42 B"));
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

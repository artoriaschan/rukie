import { expect, spyOn, test } from "bun:test";
import { stat, readFile, access, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "@rukie/agent";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model";
import { dark } from "../../../src/ink/index.ts";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";
import { testClock } from "../helpers/test-clock";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2UAAAAASUVORK5CYII=";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

// Observe the frontend's admitted timeout; image I/O and completed terminal paints stay public signals.
function observeImageNoticeDeadline() {
  let expiresAt = 0;
  let expired = false;
  const nativeTimeout = globalThis.setTimeout;
  const trackedTimeout = Object.assign((...parameters: Parameters<typeof setTimeout>) => {
    const [handler, delay, ...args] = parameters;
    if (delay !== 2500) return nativeTimeout(handler, delay, ...args);
    expiresAt = Date.now() + delay;
    return nativeTimeout(() => {
      expired = true;
      handler(...args);
    }, delay);
  }, nativeTimeout);
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(trackedTimeout);
  return {
    beforeExpiry() {
      testClock.advanceTimersByTime(expiresAt - Date.now() - 1);
      expect(expired).toBe(false);
    },
    expire() {
      testClock.advanceTimersByTime(1);
      expect(expired).toBe(true);
    },
    restore: () => timer.mockRestore(),
  };
}

async function openOriginal(app: Awaited<ReturnType<typeof start>>) {
  await app.waitFor(() =>
    app.screen().some((line) => line.includes("打开原图") || line.includes("Open original")),
  );
  const row = app
    .screen()
    .findIndex((line) => line.includes("打开原图") || line.includes("Open original"));
  const line = app.screen()[row]!;
  const column = Math.max(line.indexOf("打开原图"), line.indexOf("Open original")) + 1;
  app.stdin.write(`\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`);
  app.stdin.write("\r");
}

test("a pasted image path becomes a colored token and reaches the model with its prompt", async () => {
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("compare end\x1b[H" + paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1] compare end")));
    const row = app.screen().findIndex((line) => line.includes("❯ [Image #1] compare end"));
    expect(app.terminal.buffer.active.getLine(row)!.getCell(2)!.getFgColor()).toBe(
      parseInt(dark.suggestion.slice(1), 16),
    );
    expect(app.screen().join("\n")).toContain("Pasted image [Image #1]");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    const user = app.calls[0]!.context.messages.findLast((message) => message.role === "user");
    expect(user).toMatchObject({
      content: [
        { type: "text", text: "[Image #1] compare end" },
        { type: "image", data: png, mimeType: "image/png" },
      ],
    });
    await app.waitFor(() => app.screen().some((line) => line.includes("[Image · shot.png]")));
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("explicitly opening a user image original creates a private export and exit removes it", async () => {
  let opened = "";
  const app = await start([], {
    rows: 32,
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
    host: {
      readClipboard: async () => ({ empty: true }),
      openExternal: async (path) => {
        opened = path;
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
    const row = app.screen().findIndex((line) => line.includes("[Image · shot.png]"));
    app.stdin.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m`);
    await openOriginal(app);
    await app.waitFor(() => !!opened);
    expect(await readFile(opened)).toEqual(Buffer.from(png, "base64"));
    expect((await stat(opened)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(opened))).mode & 0o777).toBe(0o700);
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
  expect(opened).not.toBe("");
  expect(
    await access(dirname(opened)).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
});

test("exit keeps a private export until its pending external open completes", async () => {
  let opened = "";
  let openedBytes: Buffer | undefined;
  const release = Promise.withResolvers<void>();
  const app = await start([], {
    rows: 32,
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
    host: {
      readClipboard: async () => ({ empty: true }),
      openExternal: async (path) => {
        opened = path;
        await release.promise;
        openedBytes = await readFile(path);
      },
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
    const row = app.screen().findIndex((line) => line.includes("[Image · shot.png]"));
    app.stdin.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m`);
    await openOriginal(app);
    await app.waitFor(() => !!opened);
    let exited = false;
    void app.exit.then(() => {
      exited = true;
    });
    app.stdin.write("\x04");
    await app.waitFor(() => !app.terminal.modes.bracketedPasteMode);
    expect(exited).toBe(false);
    expect((await stat(opened)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(opened))).mode & 0o777).toBe(0o700);
    release.resolve();
    expect(await app.exit).toBe(0);
    expect(openedBytes).toEqual(Buffer.from(png, "base64"));
    expect(
      await access(dirname(opened)).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  } finally {
    release.resolve();
    await app.cleanup();
  }
});

test("read images open a preview then explicit original live and after resume", async () => {
  let opened = "";
  const host = {
    readClipboard: async () => ({ empty: true as const }),
    openExternal: async (path: string) => {
      opened = path;
    },
  };
  const app = await start(["inspect screenshot"], {
    rows: 32,
    prepare: async (root) => {
      await Bun.write(`${root}/read-shot.png`, Buffer.from(png, "base64"));
    },
    host,
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "read-shot.png" });
    await app.waitFor(
      () =>
        app.calls.length === 2 &&
        app.screen().some((line) => line.includes("[Image · read-shot.png]")),
    );
    const row = app.screen().findIndex((line) => line.includes("[Image · read-shot.png]"));
    app.stdin.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m`);
    await openOriginal(app);
    await app.waitFor(() => !!opened);
    expect(await readFile(opened)).toEqual(Buffer.from(png, "base64"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const { listSessions } = await import("@rukie/agent");
    const sessions = await listSessions({ cwd: app.root, homeDir: app.root });
    const resumed = await start(["--resume", sessions[0]!.id], {
      rows: 32,
      host,
      session: { cwd: app.root, homeDir: app.root },
    });
    try {
      await resumed.waitFor(() =>
        resumed.screen().some((line) => line.includes("[Image · read-shot.png]")),
      );
      opened = "";
      const replayRow = resumed
        .screen()
        .findIndex((line) => line.includes("[Image · read-shot.png]"));
      resumed.stdin.write(`\x1b[<0;4;${replayRow + 1}M\x1b[<0;4;${replayRow + 1}m`);
      await openOriginal(resumed);
      await resumed.waitFor(() => !!opened);
      expect(await readFile(opened)).toEqual(Buffer.from(png, "base64"));
    } finally {
      await resumed.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});

test.each(["absolute", "single-quote", "double-quote", "escaped", "home", "file-url"])(
  "a whole %s image path stages a token",
  async (form) => {
    const app = await start([], {
      prepare: async (root) => {
        await Bun.write(`${root}/shot space.png`, Buffer.from(png, "base64"));
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      const path = `${app.root}/shot space.png`;
      const payload =
        form === "absolute"
          ? `${app.root}/one.png`
          : form === "single-quote"
            ? `'${path}'`
            : form === "double-quote"
              ? `"${path}"`
              : form === "escaped"
                ? path.replaceAll(" ", "\\ ")
                : form === "home"
                  ? "'~/shot space.png'"
                  : new URL(`file://${path}`).href;
      if (form === "absolute") await Bun.write(payload, Buffer.from(png, "base64"));
      app.stdin.write(paste(payload));
      await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 1);
      expect(
        app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
      ).toMatchObject({
        content: [
          { type: "text", text: "[Image #1] " },
          { type: "image", data: png },
        ],
      });
      app.calls[0]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test.each(["missing", "multiline", "multiple", "invalid", "too-long"])(
  "%s path-like paste stays ordinary text",
  async (kind) => {
    const app = await start([], {
      prepare: async (root) => {
        await Bun.write(`${root}/one.png`, Buffer.from(png, "base64"));
        await Bun.write(`${root}/invalid.png`, "ordinary text");
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      const path = `${app.root}/one.png`;
      const payload =
        kind === "missing"
          ? `${app.root}/missing.png`
          : kind === "multiline"
            ? `look at\n${path}`
            : kind === "multiple"
              ? `${path} ${path}`
              : kind === "invalid"
                ? `${app.root}/invalid.png`
                : "/" + "a".repeat(4096) + ".png";
      app.stdin.write(paste(payload));
      await app.waitFor(() =>
        app
          .screen()
          .some((line) =>
            kind === "too-long"
              ? line.trimEnd().endsWith(".png")
              : line.startsWith("❯ " + (kind === "multiline" ? "look at" : payload.slice(0, 20))),
          ),
      );
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 1);
      expect(
        app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
      ).toMatchObject({ content: [{ type: "text", text: payload }] });
      expect(app.screen().join("\n")).not.toContain("[Image #1]");
      app.calls[0]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test.each(["bytes", "dimensions"])(
  "an image over the %s limit is refused with a localized warning",
  async (limit) => {
    const app = await start([], {
      env: { LANG: "en_US.UTF-8" },
      prepare: async (root) => {
        const bytes =
          limit === "bytes" ? Buffer.alloc(5 * 1024 * 1024 + 1) : Buffer.from(png, "base64");
        if (limit === "dimensions") bytes.writeUInt32BE(8001, 16);
        await Bun.write(`${root}/large.png`, bytes);
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write(paste(`${app.root}/large.png`));
      await app.waitFor(() => app.screen().some((line) => line.includes("Could not paste image:")));
      expect(app.screen().join("\n")).toContain(limit === "bytes" ? "5 MB" : "8001×1");
      expect(app.screen().join("\n")).not.toContain("[Image #1]");
      const row = app.screen().findIndex((line) => line.includes("Could not paste image:"));
      expect(
        app.terminal.buffer.active
          .getLine(row)!
          .getCell(app.screen()[row]!.indexOf("Could not paste image:"))!
          .getFgColor(),
      ).toBe(parseInt(dark.warning.slice(1), 16));
      app.stdin.write("\r");
      await app.flush();
      expect(app.calls).toHaveLength(0);
    } finally {
      await app.cleanup();
    }
  },
);

test("image order follows token positions rather than paste order", async () => {
  const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const app = await start([], {
    prepare: async (root) => {
      await Bun.write(`${root}/first.png`, Buffer.from(png, "base64"));
      await Bun.write(`${root}/second.gif`, Buffer.from(gif, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("compare " + paste(`${app.root}/first.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ compare [Image #1]")));
    app.stdin.write("\x1b[H" + paste(`${app.root}/second.gif`));
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("❯ [Image #2] compare [Image #1]")),
    );
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [
        { type: "text", text: "[Image #2] compare [Image #1] " },
        { type: "image", data: gif, mimeType: "image/gif" },
        { type: "image", data: png, mimeType: "image/png" },
      ],
    });
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("an image can steer a running Run without enabling ordinary prompt submission", async () => {
  const app = await start(["working"], {
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("look\r");
    await app.waitFor(() => app.screen().includes("❯"));
    app.calls[0]!.finish();
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [
        { type: "text", text: "[Image #1] look" },
        { type: "image", data: png, mimeType: "image/png" },
      ],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("a user image placeholder remains visible and clickable after resume", async () => {
  const app = await start([], {
    rows: 32,
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
    const { listSessions } = await import("@rukie/agent");
    const sessions = await listSessions({ cwd: app.root, homeDir: app.root });
    let opened = "";
    const resumed = await start(["--resume", sessions[0]!.id], {
      rows: 32,
      session: { cwd: app.root, homeDir: app.root },
      host: {
        readClipboard: async () => ({ empty: true }),
        openExternal: async (path) => {
          opened = path;
        },
      },
    });
    try {
      await resumed.waitFor(() =>
        resumed.screen().some((line) => line.includes("[Image · shot.png]")),
      );
      const row = resumed.screen().findIndex((line) => line.includes("[Image · shot.png]"));
      resumed.stdin.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m`);
      await openOriginal(resumed);
      await resumed.waitFor(() => !!opened);
      expect(await readFile(opened)).toEqual(Buffer.from(png, "base64"));
    } finally {
      await resumed.cleanup();
    }
    expect(
      await access(dirname(opened)).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  } finally {
    await app.cleanup();
  }
});

test("an external viewer failure shows a warning and leaves the composer usable", async () => {
  const app = await start([], {
    rows: 32,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
    host: {
      readClipboard: async () => ({ empty: true }),
      openExternal: async () => {
        throw new Error("viewer failed");
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
    const row = app.screen().findIndex((line) => line.includes("[Image · shot.png]"));
    app.stdin.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m`);
    await openOriginal(app);
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("Could not open image: viewer failed")),
    );
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("continue\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({ content: [{ type: "text", text: "continue" }] });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.skipIf(process.platform === "win32").each(["session", "exit"])(
  "a pending image path read cannot paste into a different %s owner",
  async (transition) => {
    const app = await start(["old owner"], {
      prepare: async (root) => {
        const child = Bun.spawn(["mkfifo", `${root}/pending.png`], {
          stdout: "ignore",
          stderr: "ignore",
        });
        if ((await child.exited) !== 0) throw new Error("Could not create image pipe");
      },
    });
    let released = false;
    const release = async () => {
      if (!released) {
        released = true;
        await writeFile(`${app.root}/pending.png`, Buffer.from(png, "base64"));
      }
    };
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.delta("old owner sentinel");
      app.calls[0]!.finish();
      await app.waitFor(
        () => !app.isWorking() && app.screen().join("\n").includes("old owner sentinel"),
      );
      app.stdin.write(paste(`${app.root}/pending.png`));
      if (transition === "session") {
        app.stdin.write("/clear\r");
        await app.waitFor(() => !app.screen().join("\n").includes("old owner sentinel"));
        await release();
        app.stdin.write("new owner\r");
        await app.waitFor(() => app.calls.length === 2);
        expect(
          app.calls[1]!.context.messages.findLast((message) => message.role === "user"),
        ).toMatchObject({ content: [{ type: "text", text: "new owner" }] });
        expect(app.screen().join("\n")).not.toContain("[Image #1]");
        app.calls[1]!.finish();
      } else {
        app.stdin.write("\x04");
        expect(await app.exit).toBe(0);
        await release();
        expect(app.calls).toHaveLength(1);
      }
    } finally {
      await release();
      await app.cleanup();
    }
  },
);

test.each(["zh_CN.UTF-8", "en_US.UTF-8"])(
  "%s image success notice expires while keeping the draft",
  async (lang) => {
    let advance = true;
    const app = await startWithClock([], {
      env: { LANG: lang },
      advanceTimers: (ms) => {
        if (advance) testClock.advanceTimersByTime(ms);
      },
      prepare: async (root) => {
        await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
      },
    });
    const deadline = observeImageNoticeDeadline();
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write(paste(`${app.root}/shot.png`));
      const copy = lang.startsWith("zh") ? "已粘贴图片 [Image #1]" : "Pasted image [Image #1]";
      await app.waitFor(() => app.screen().join("\n").includes(copy));
      const row = app.screen().findIndex((line) => line.includes(copy));
      expect(
        app.terminal.buffer.active
          .getLine(row)!
          .getCell(app.screen()[row]!.indexOf(copy))!
          .getFgColor(),
      ).toBe(parseInt(dark.text.slice(1), 16));
      advance = false;
      deadline.beforeExpiry();
      expect(app.screen().join("\n")).toContain(copy);
      deadline.expire();
      // Commit the expiry paint after asserting the exact business deadline.
      advance = true;
      await app.waitFor(() => !app.screen().join("\n").includes(copy));
      expect(app.screen().join("\n")).toContain("❯ [Image #1]");
    } finally {
      deadline.restore();
      await app.cleanup();
    }
  },
);

test("an image notice remains visible while reading history without moving the reading position", async () => {
  let advance = true;
  const app = await startWithClock(["long output"], {
    env: { LANG: "en_US.UTF-8" },
    advanceTimers: (ms) => {
      if (advance) testClock.advanceTimersByTime(ms);
    },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  const deadline = observeImageNoticeDeadline();
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      Array.from({ length: 80 }, (_, index) => `line ${index.toString().padStart(3, "0")}`).join(
        "\n",
      ),
    );
    app.calls[0]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().some((line) => line.includes("line 079")),
    );
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => !app.screen().some((line) => line.includes("line 079")));
    const before = app.screen().slice(0, 5);
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("Pasted image [Image #1]")));
    expect(app.screen().slice(0, 5)).toEqual(before);
    expect(app.screen().join("\n")).toContain("❯ [Image #1]");
    advance = false;
    deadline.beforeExpiry();
    expect(app.screen().join("\n")).toContain("Pasted image [Image #1]");
    deadline.expire();
    // Timer expiry is exact; completing the resulting terminal paint advances renderer frames.
    advance = true;
    await app.waitFor(() => !app.screen().some((line) => line.includes("Pasted image [Image #1]")));
    expect(app.screen().slice(0, 5)).toEqual(before);
  } finally {
    deadline.restore();
    await app.cleanup();
  }
});

test("restored image galleries use localized dim labels within their thumbnail slots", async () => {
  const argv: string[] = [];
  const app = await start(argv, {
    columns: 120,
    rows: 32,
    prepare: async (root) => {
      const fake = createFauxCore({ api: "faux", provider: "faux" });
      fake.setResponses([fauxAssistantMessage("done")]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: fake.getModel(),
        streamFn: withAuxiliaryRequests(fake.streamSimple),
      });
      await session.run("stored images", {
        images: [
          { data: png, mimeType: "image/png" },
          { data: png, mimeType: "image/png", name: "中".repeat(50) },
        ],
      });
      argv.push("--resume", session.id);
      await session.dispose();
    },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.includes("[Image ·")));
    expect(app.screen().join("\n")).toContain("图片");
    expect(app.screen().join("\n")).toContain("中".repeat(5));
    expect(app.screen().join("\n")).not.toContain("中".repeat(6));
    const row = app.screen().findIndex((line) => line.includes("[Image ·"));
    expect(app.terminal.buffer.active.getLine(row)!.getCell(2)!.isDim()).toBeTruthy();
  } finally {
    await app.cleanup();
  }
});

test.skipIf(process.platform === "win32")(
  "a pending image read is discarded when a question takes composer focus",
  async () => {
    const app = await start(["working"], {
      prepare: async (root) => {
        const child = Bun.spawn(["mkfifo", `${root}/pending.png`], {
          stdout: "ignore",
          stderr: "ignore",
        });
        if ((await child.exited) !== 0) throw new Error("Could not create image pipe");
      },
    });
    let released = false;
    const release = async () => {
      if (!released) {
        released = true;
        await writeFile(`${app.root}/pending.png`, Buffer.from("invalid image"));
      }
    };
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.stdin.write(paste(`${app.root}/pending.png`));
      app.calls[0]!.tool("ask_user_question", {
        questions: [
          {
            question: "Pick one?",
            header: "Choice",
            multiSelect: false,
            options: [
              { label: "Yes", description: "Continue" },
              { label: "No", description: "Stop" },
            ],
          },
        ],
      });
      await app.waitFor(() => app.screen().some((line) => line.trim() === "Pick one?"));
      await release();
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(app.screen().join("\n")).not.toContain("pending.png");
      expect(app.screen().join("\n")).not.toContain("[Image #1]");
      expect(
        app.calls[1]!.context.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ content: [{ type: "text", text: '"Pick one?" → Yes' }] });
      app.calls[1]!.finish();
    } finally {
      await release();
      await app.cleanup();
    }
  },
);

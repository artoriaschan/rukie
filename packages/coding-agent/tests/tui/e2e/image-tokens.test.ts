import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import { createSession } from "@rukie/agent";
import { fauxProvider } from "@earendil-works/pi-ai";
import { writeFile } from "node:fs/promises";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2UAAAAASUVORK5CYII=";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
function draft(app: Awaited<ReturnType<typeof start>>) {
  const lines = app.screen();
  const top = lines.findLastIndex((line) => line.startsWith("╭"));
  const bottom = lines.findIndex((line, index) => index > top && line.startsWith("╰"));
  return lines.slice(top + 1, bottom).join("\n");
}
async function imageApp(columns = 80, rows = 24) {
  const app = await start([], {
    columns,
    rows,
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  await app.waitFor(() => app.screen().includes("❯"));
  return app;
}

test("bound image tokens are crossed by one arrow and removed by one delete", async () => {
  const app = await imageApp();
  try {
    app.stdin.write("before " + paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ before [Image #1]")));
    app.stdin.write("\x1b[D");
    await app.waitFor(() => app.terminal.buffer.active.cursorX !== 20);
    expect(app.terminal.buffer.active.cursorX).toBe(19);
    app.stdin.write("\x1b[D");
    await app.waitFor(() => app.terminal.buffer.active.cursorX !== 19);
    expect(app.terminal.buffer.active.cursorX).toBe(9);
    app.stdin.write("\x1b[C");
    await app.waitFor(() => app.terminal.buffer.active.cursorX !== 9);
    expect(app.terminal.buffer.active.cursorX).toBe(19);
    app.stdin.write("\x7fafter\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [{ type: "text", text: "before after " }],
    });
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.skipIf(process.platform === "win32")(
  "a delayed image read is canceled by rewind and cannot consume its reset number",
  async () => {
    const app = await start([], {
      env: { LANG: "en_US.UTF-8" },
      prepare: async (root) => {
        await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
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
      await app.waitFor(() => draft(app) === "❯");
      app.stdin.write("remembered\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.delta("previous answer");
      app.calls[0]!.finish();
      await app.waitFor(
        () => !app.isWorking() && app.screen().join("\n").includes("previous answer"),
      );
      app.stdin.write(paste(`${app.root}/pending.png`) + "/rewind\r");
      await app.waitFor(() => app.screen().join("\n").includes("Pick a message to rewind to"));
      app.stdin.write("\r");
      await app.waitFor(() => app.screen().join("\n").includes("Rewind to this message?"));
      app.stdin.write("\r");
      await app.waitFor(() => draft(app) === "❯ remembered");
      await release();
      app.stdin.write("\x03" + paste(`${app.root}/shot.png`));
      await app.waitFor(() => draft(app) === "❯ [Image #1]");
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(
        app.calls[1]!.context.messages.findLast((message) => message.role === "user"),
      ).toMatchObject({
        content: [
          { type: "text", text: "[Image #1] " },
          { type: "image", data: png },
        ],
      });
      app.calls[1]!.finish();
    } finally {
      await release();
      await app.cleanup();
    }
  },
);

test("history recall and returning to its draft restore image labels as text only", async () => {
  const app = await imageApp();
  try {
    app.stdin.write("[Image #1]\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("literal finished");
    app.calls[0]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().join("\n").includes("literal finished"),
    );
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => draft(app) === "❯ [Image #1]");
    app.stdin.write("\x1b[A");
    await app.waitFor(
      () => draft(app) === "❯ [Image #1]" && app.terminal.buffer.active.cursorX === 12,
    );
    app.stdin.write("\x1b[B\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [{ type: "text", text: "[Image #1] " }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("a code-only rewind resets image bindings and numbers while retaining the conversation", async () => {
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    session: { permissionMode: "full-access" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
      await Bun.write(`${root}/work.txt`, "original");
    },
  });
  try {
    await app.waitFor(() => draft(app) === "❯");
    app.stdin.write("change file\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", { path: "work.txt", content: "changed" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("retained answer");
    app.calls[1]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().join("\n").includes("retained answer"),
    );
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => draft(app) === "❯ [Image #1]");
    app.stdin.write("\x03/rewind\r");
    await app.waitFor(() => app.screen().join("\n").includes("Pick a message to rewind to"));
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().join("\n").includes("Rewind to this message?"));
    app.stdin.write("\x1b[B\x1b[B");
    await app.waitFor(() => app.screen().join("\n").includes("❯ Restore code"));
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().join("\n").includes("Restored 1 files"));
    expect(app.screen().join("\n")).toContain("retained answer");
    expect(await Bun.file(`${app.root}/work.txt`).text()).toBe("original");
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => draft(app) === "❯ [Image #1]");
  } finally {
    await app.cleanup();
  }
});

test("deleting a typed duplicate before the original leaves the original image attached", async () => {
  const app = await imageApp();
  try {
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => draft(app) === "❯ [Image #1]");
    app.stdin.write("\x1b[H[Image #1] ");
    await app.waitFor(() => draft(app) === "❯ [Image #1] [Image #1]");
    app.stdin.write("\x1b[H" + "\x1b[1;2C".repeat(11) + "\x7f\r");
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
});

test("typing another copy of a bound label does not create another attachment token", async () => {
  const app = await imageApp();
  try {
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => draft(app) === "❯ [Image #1]");
    app.stdin.write("[Image #1]");
    await app.waitFor(() => draft(app) === "❯ [Image #1] [Image #1]");
    app.stdin.write("\x1b[D");
    await app.waitFor(() => app.terminal.buffer.active.cursorX !== 23);
    expect(app.terminal.buffer.active.cursorX).toBe(22);
    app.stdin.write("\x1b[H\x1b[3~\x1b[F\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [{ type: "text", text: " [Image #1]" }],
    });
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.each(["new", "resume", "rewind"])(
  "/%s starts image numbering again with no old bindings",
  async (context) => {
    const app = await start([], {
      env: { LANG: "en_US.UTF-8" },
      prepare: async (root) => {
        await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
        const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
        const previous = await createSession({
          cwd: root,
          homeDir: root,
          model: faux.getModel(),
          streamFn: faux.provider.streamSimple,
        });
        await previous.rename("Previous context");
        await previous.dispose();
      },
    });
    try {
      await app.waitFor(() => draft(app) === "❯");
      app.stdin.write("remembered\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.delta("old context answer");
      app.calls[0]!.finish();
      await app.waitFor(
        () => !app.isWorking() && app.screen().join("\n").includes("old context answer"),
      );
      app.stdin.write(paste(`${app.root}/shot.png`));
      await app.waitFor(() => draft(app) === "❯ [Image #1]");
      app.stdin.write(`\x03/${context}\r`);
      if (context === "resume") {
        await app.waitFor(() => app.screen().join("\n").includes("Previous context"));
        app.stdin.write("\r");
        await app.waitFor(
          () => !app.screen().join("\n").includes("old context answer") && draft(app) === "❯",
        );
      } else if (context === "rewind") {
        await app.waitFor(() => app.screen().join("\n").includes("Pick a message to rewind to"));
        app.stdin.write("\r");
        await app.waitFor(() => app.screen().join("\n").includes("Rewind to"));
        app.stdin.write("\r");
        await app.waitFor(() => draft(app) === "❯ remembered");
        app.stdin.write("\x03");
        await app.waitFor(() => draft(app) === "❯");
      } else
        await app.waitFor(
          () => !app.screen().join("\n").includes("old context answer") && draft(app) === "❯",
        );
      app.stdin.write(paste(`${app.root}/shot.png`));
      await app.waitFor(() => draft(app) === "❯ [Image #1]");
      expect(app.calls).toHaveLength(1);
    } finally {
      await app.cleanup();
    }
  },
);

test("deleting an image detaches it permanently while numbers keep increasing and skip literals", async () => {
  const app = await imageApp();
  try {
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1] [Image #2]")));
    app.stdin.write("\x1b[H\x1b[3~[Image #1]\x1b[F" + paste(`${app.root}/shot.png`));
    await app.waitFor(() => draft(app) === "❯ [Image #1] [Image #2] [Image #3]");
    app.stdin.write("[Image #4] " + paste(`${app.root}/shot.png`));
    await app.waitFor(
      () => draft(app) === "❯ [Image #1] [Image #2] [Image #3] [Image #4] [Image #5]",
    );
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [
        { type: "text", text: "[Image #1] [Image #2] [Image #3] [Image #4] [Image #5] " },
        { type: "image", data: png },
        { type: "image", data: png },
        { type: "image", data: png },
      ],
    });
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("switching a model clears staged images and resets numbering", async () => {
  const oldKey = process.env.RUKIE_TOKEN_MODEL_KEY;
  process.env.RUKIE_TOKEN_MODEL_KEY = "test-key";
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    session: { model: undefined },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
      await Bun.write(
        `${root}/.rukie/settings.json`,
        JSON.stringify({
          model: "token-model/first",
          providers: [
            {
              id: "token-model",
              api: "openai-completions",
              baseUrl: "http://localhost:1/v1",
              apiKeyEnv: "RUKIE_TOKEN_MODEL_KEY",
              models: [
                { id: "first", input: ["text", "image"] },
                { id: "second", input: ["text", "image"] },
              ],
            },
          ],
        }),
      );
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\x03/model token-model/second\r");
    await app.waitFor(() =>
      app.screen().join("\n").includes("Model changed to token-model/second"),
    );
    app.stdin.write("[Image #1]\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [{ type: "text", text: "[Image #1]" }],
    });
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && draft(app) === "❯");
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => draft(app) === "❯ [Image #1]");
  } finally {
    await app.cleanup();
    if (oldKey === undefined) delete process.env.RUKIE_TOKEN_MODEL_KEY;
    else process.env.RUKIE_TOKEN_MODEL_KEY = oldKey;
  }
});

test("bound image tokens stay on one line in a small terminal and after resize", async () => {
  const app = await imageApp(40, 12);
  try {
    app.stdin.write("x".repeat(32) + paste(`${app.root}/shot.png`));
    const wholeToken = (line: string) => /^(?:❯ | {2})\[Image #1\]/.test(line);
    await app.waitFor(() => app.screen().some(wholeToken));
    expect(app.screen().find(wholeToken)).toContain("[Image #1]");
    app.resize(44, 12);
    await app.waitFor(() => app.screen().some(wholeToken));
    const tokenRow = app.screen().findIndex(wholeToken);
    expect(app.screen()[tokenRow]).toContain("[Image #1]");
    app.stdin.write("\x1b[D\x1b[D");
    await app.waitFor(() => app.terminal.buffer.active.cursorX === 2);
    app.stdin.write("\x1b[3~look\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [{ type: "text", text: "x".repeat(32) + "look " }],
    });
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("a shifted selection across an image replaces the whole token", async () => {
  const app = await imageApp();
  try {
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ [Image #1]")));
    app.stdin.write("\x1b[H\x1b[1;2C");
    await app.waitFor(() => app.terminal.buffer.active.cursorX === 12);
    app.stdin.write("replacement\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [{ type: "text", text: "replacement " }],
    });
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

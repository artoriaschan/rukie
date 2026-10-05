import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import type { ClipboardContent } from "../../src/host";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";

test("Ctrl+V inserts a clipboard image at the caret and sends it with a success notice", async () => {
  let path = "";
  const app = await start([], {
    columns: 100,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      path = `${root}/clipboard.png`;
      await Bun.write(path, Buffer.from(png, "base64"));
    },
    host: { readClipboard: async () => ({ image: { path } }), openExternal: async () => {} },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("beforeafter" + "\x1b[D".repeat(5) + "\x16");
    await app.waitFor(() => app.screen().join("\n").includes("Pasted image [Image #1]"));
    expect(app.screen().join("\n")).toContain("❯ before[Image #1] after");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [
        { type: "text", text: "before[Image #1] after" },
        { type: "image", data: png, mimeType: "image/png" },
      ],
    });
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("Ctrl+V file copies attach images and insert other file paths in clipboard order", async () => {
  let files: string[] = [];
  const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const app = await start([], {
    columns: 160,
    prepare: async (root) => {
      files = [`${root}/one.png`, `${root}/notes.txt`, `${root}/two.gif`];
      await Bun.write(files[0]!, Buffer.from(png, "base64"));
      await Bun.write(files[1]!, "notes");
      await Bun.write(files[2]!, Buffer.from(gif, "base64"));
    },
    host: { readClipboard: async () => ({ files }), openExternal: async () => {} },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("\x16");
    await app.waitFor(() => app.screen().join("\n").includes("[Image #2]"));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [
        { type: "text", text: `[Image #1] ${files[1]} [Image #2] ` },
        { type: "image", data: png, mimeType: "image/png" },
        { type: "image", data: gif, mimeType: "image/gif" },
      ],
    });
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("Ctrl+V clipboard text preserves whitespace and newlines at the caret", async () => {
  const app = await start([], {
    host: { readClipboard: async () => ({ text: "  text\n next " }), openExternal: async () => {} },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("ab\x1b[D\x16");
    await app.waitFor(() => app.screen().join("\n").includes("text"));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({ content: [{ type: "text", text: "a  text\n next b" }] });
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["empty", "Clipboard is empty", "剪贴板为空"],
  ["unavailable", "Clipboard is unavailable", "剪贴板不可用"],
  ["throw", "Failed to read the clipboard", "读取剪贴板失败"],
  ["unsupported", "Clipboard image format is unsupported", "剪贴板图片格式不支持"],
  ["large", "Image exceeds the 5 MB limit", "图片超过 5 MB 限制"],
  ["unreadable", "Could not paste image:", "无法粘贴图片："],
] as const)(
  "%s clipboard keeps the draft and shows localized warnings",
  async (kind, english, chinese) => {
    for (const lang of ["en_US.UTF-8", "zh_CN.UTF-8"]) {
      let path = "";
      const app = await start([], {
        columns: 120,
        env: { LANG: lang },
        prepare: async (root) => {
          path = `${root}/clipboard.${kind === "unsupported" ? "tiff" : "png"}`;
          if (kind === "large") await Bun.write(path, Buffer.alloc(5 * 1024 * 1024 + 1));
        },
        host: {
          readClipboard: async (): Promise<ClipboardContent> => {
            if (kind === "empty") return { empty: true };
            if (kind === "unavailable") return { unavailable: true };
            if (kind === "throw") throw new Error("host failure");
            return { image: { path } };
          },
          openExternal: async () => {},
        },
      });
      try {
        await app.waitFor(() => app.screen().includes("❯"));
        app.stdin.write("kept\x16");
        await app.waitFor(() =>
          app
            .screen()
            .join("\n")
            .includes(lang.startsWith("zh") ? chinese : english),
        );
        expect(app.screen().join("\n")).toContain("❯ kept");
        expect(app.screen().join("\n")).not.toContain("[Image #1]");
        app.stdin.write("\r");
        await app.waitFor(() => app.calls.length === 1);
        expect(
          app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
        ).toMatchObject({ content: [{ type: "text", text: "kept" }] });
        app.calls[0]!.finish();
      } finally {
        await app.cleanup();
      }
    }
  },
);

test("a pending Ctrl+V read is discarded when its composer Session is replaced", async () => {
  const pending = Promise.withResolvers<ClipboardContent>();
  const read = Promise.withResolvers<void>();
  const app = await start(["old owner"], {
    host: {
      readClipboard: () => {
        read.resolve();
        return pending.promise;
      },
      openExternal: async () => {},
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("old owner sentinel");
    app.calls[0]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().join("\n").includes("old owner sentinel"),
    );
    app.stdin.write("\x16");
    await read.promise;
    app.stdin.write("/clear\r");
    await app.waitFor(() => !app.screen().join("\n").includes("old owner sentinel"));
    pending.resolve({ text: "stale paste" });
    app.stdin.write("new owner\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({ content: [{ type: "text", text: "new owner" }] });
    app.calls[1]!.finish();
  } finally {
    pending.resolve({ empty: true });
    await app.cleanup();
  }
});

test("a pending Ctrl+V image cannot take focus from an active question", async () => {
  const pending = Promise.withResolvers<ClipboardContent>();
  const read = Promise.withResolvers<void>();
  let path = "";
  const app = await start(["working"], {
    prepare: async (root) => {
      path = `${root}/clipboard.png`;
      await Bun.write(path, Buffer.from(png, "base64"));
    },
    host: {
      readClipboard: () => {
        read.resolve();
        return pending.promise;
      },
      openExternal: async () => {},
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("\x16");
    await read.promise;
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
    pending.resolve({ image: { path } });
    await pending.promise;
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.screen().join("\n")).not.toContain("[Image #1]");
    expect(
      app.calls[1]!.context.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({ content: [{ type: "text", text: '"Pick one?" → Yes' }] });
    app.calls[1]!.finish();
  } finally {
    pending.resolve({ empty: true });
    await app.cleanup();
  }
});

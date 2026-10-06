import { expect, test } from "bun:test";
import { start } from "../helpers/app";

const english = "Image in clipboard · ctrl+v to paste";

test("clipboard tip expires after ten seconds despite polling and editing, and a new image availability rearms it", async () => {
  let image = true;
  let probes = 0;
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    host: {
      hasClipboardImage: async () => {
        probes++;
        return image;
      },
    },
  });
  try {
    await app.waitFor(() => app.screen().join("\n").includes(english));
    const shownAt = performance.now();
    await app.waitFor(() => performance.now() - shownAt >= 9000, 9500);
    expect(app.screen().join("\n")).toContain(english);
    expect(probes).toBeGreaterThanOrEqual(9);
    app.stdin.write("preserved draft");
    await app.waitFor(() => app.screen().includes("❯ preserved draft"));
    const inputRow = app.screen().indexOf("❯ preserved draft");
    await app.waitFor(() => !app.screen().join("\n").includes(english), 2500);
    expect(performance.now() - shownAt).toBeGreaterThanOrEqual(9500);
    expect(app.screen().indexOf("❯ preserved draft")).toBe(inputRow);
    const afterExpiry = probes;
    await app.waitFor(() => probes > afterExpiry);
    expect(app.screen().join("\n")).not.toContain(english);
    image = false;
    const beforeClear = probes;
    await app.waitFor(() => probes > beforeClear);
    image = true;
    await app.waitFor(() => app.screen().join("\n").includes(english));
    expect(app.screen()).toContain("❯ preserved draft");
    expect(app.calls).toHaveLength(0);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
}, 20000);

test.each([
  ["en_US.UTF-8", "Image in clipboard · ctrl+v to paste"],
  ["zh_CN.UTF-8", "剪贴板中有图片 · ctrl+v 粘贴"],
])(
  "%s clipboard image tip follows clipboard changes without reading image bytes or editing the draft",
  async (lang, hint) => {
    let image = false;
    let reads = 0;
    const app = await start([], {
      columns: 100,
      env: { LANG: lang },
      host: {
        hasClipboardImage: async () => image,
        readClipboard: async () => {
          reads++;
          return { text: "clipboard text" };
        },
        openExternal: async () => {},
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("preserved draft");
      await app.waitFor(() => app.screen().includes("❯ preserved draft"));
      expect(app.screen().join("\n")).not.toContain(hint);
      image = true;
      await app.waitFor(() => app.screen().join("\n").includes(hint));
      const row = app.screen().findIndex((line) => line.includes(hint));
      const line = app.screen()[row]!;
      expect(Bun.stringWidth(line.slice(0, line.indexOf(hint)))).toBe(99 - Bun.stringWidth(hint));
      expect(row).toBe(app.screen().indexOf("❯ preserved draft") - 2);
      expect(reads).toBe(0);
      expect(app.calls).toHaveLength(0);
      image = false;
      await app.waitFor(() => !app.screen().join("\n").includes(hint));
      expect(app.screen()).toContain("❯ preserved draft");
    } finally {
      await app.cleanup();
    }
  },
);

test("clipboard tip yields to paste and rewind notices and remains stable through small resizes", async () => {
  let path = "";
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      path = `${root}/clipboard.png`;
      await Bun.write(path, Bun.file(new URL("../fixtures/1000x800.png", import.meta.url)));
    },
    host: {
      hasClipboardImage: async () => true,
      readClipboard: async () => ({ image: { path } }),
    },
  });
  try {
    await app.waitFor(() => app.screen().join("\n").includes(english));
    app.stdin.write("\x16");
    await app.waitFor(() => app.screen().join("\n").includes("Pasted image [Image #1]"));
    expect(app.screen().join("\n")).not.toContain(english);
    await app.waitFor(() => app.screen().join("\n").includes(english), 4000);
    app.resize(40, 12);
    await app.waitFor(() => app.screen().join("\n").includes(english));
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    expect(app.screen().join("\n")).toContain("❯ [Image #1]");
    app.resize(30, 10);
    await app.waitFor(() => app.screen().join("\n").includes("Resize to at least 40 columns"));
    expect(app.screen().join("\n")).not.toContain(english);
    app.resize(80, 24);
    await app.waitFor(() => app.screen().join("\n").includes(english));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x1b");
    await app.waitFor(() => app.screen().join("\n").includes("Press Esc again to rewind"));
    expect(app.screen().join("\n")).not.toContain(english);
    app.stdin.write("draft");
    await app.waitFor(() => app.screen().join("\n").includes(english));
    expect(app.screen()).toContain("❯ draft");
  } finally {
    await app.cleanup();
  }
});

test("failed clipboard probes clear the passive hint and later probes recover without notices", async () => {
  let failed = false;
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    host: {
      hasClipboardImage: async () => {
        if (failed) throw new Error("clipboard unavailable");
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.screen().join("\n").includes(english));
    failed = true;
    await app.waitFor(() => !app.screen().join("\n").includes(english));
    expect(app.screen().join("\n")).not.toContain("clipboard unavailable");
    failed = false;
    await app.waitFor(() => app.screen().join("\n").includes(english));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("a pending clipboard probe does not block editing or exit and its late result cannot repaint", async () => {
  const pending = Promise.withResolvers<boolean>();
  let probes = 0;
  const app = await start([], {
    host: {
      hasClipboardImage: () => {
        probes++;
        return pending.promise;
      },
    },
  });
  try {
    await app.waitFor(() => probes === 1 && app.screen().includes("❯"));
    app.stdin.write("draft while probing");
    await app.waitFor(() => app.screen().includes("❯ draft while probing"));
  } finally {
    await app.cleanup();
  }
  const output = app.output();
  pending.resolve(true);
  await pending.promise;
  await Promise.resolve();
  expect(probes).toBe(1);
  expect(app.output()).toBe(output);
  expect(app.stderr()).toBe("");
  expect(await app.exit).toBe(0);
});

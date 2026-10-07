import { expect, jest, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

function gesture(
  app: Awaited<ReturnType<typeof startWithClock>>,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  app.stdin.write(`\x1b[<0;${start.x + 1};${start.y + 1}M\x1b[<32;${end.x + 1};${end.y + 1}M`);
}
function release(app: Awaited<ReturnType<typeof startWithClock>>, at: { x: number; y: number }) {
  app.stdin.write(`\x1b[<0;${at.x + 1};${at.y + 1}m`);
}

test("drag copies painted multiline Unicode Markdown without assistant decorations and clears highlight", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    columns: 80,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("**Alpha** 中文🐋\nsecond `value`");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().includes("  second value"));
    const y = app.screen().findIndex((line) => line.includes("Alpha 中文🐋"));
    const start = { x: 0, y },
      end = { x: 13, y: y + 1 };
    gesture(app, start, end);
    await app.waitFor(() => !app.terminal.buffer.active.getLine(y)!.getCell(2)!.isBgDefault());
    expect(copied).toEqual([]);
    release(app, end);
    await app.waitFor(() => copied.length === 1 && app.screen().join("\n").includes("Copied"));
    expect(copied).toEqual(["Alpha 中文🐋\nsecond value"]);
    gesture(app, end, start);
    release(app, start);
    await app.waitFor(() => copied.length === 2);
    expect(copied[1]).toBe("Alpha 中文🐋\nsecond value");
    gesture(app, { x: 50, y }, { x: 60, y });
    release(app, { x: 60, y });
    jest.advanceTimersByTime(20);
    expect(copied.length).toBe(2);
    expect(app.terminal.buffer.active.getLine(y)!.getCell(2)!.isBgDefault()).toBe(true);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["en_US.UTF-8", "clipboard is unavailable"],
  ["zh_CN.UTF-8", "剪贴板不可用"],
])("%s reports clipboard failure without claiming success", async (lang, message) => {
  const app = await startWithClock(["explain"], {
    columns: 80,
    rows: 40,
    env: { LANG: lang },
    host: {
      writeClipboard: async () => {
        if (lang === "zh_CN.UTF-8") throw new Error("No helper");
        return false;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("selected text");
    app.calls[0]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes("selected text")));
    const y = app.screen().findIndex((line) => line.includes("selected text"));
    gesture(app, { x: 2, y }, { x: 9, y });
    release(app, { x: 9, y });
    await app.waitFor(() => app.screen().join("\n").includes(message!));
    expect(app.terminal.buffer.active.getLine(y)!.getCell(2)!.isBgDefault()).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test("replacement of selected streaming text refuses copy while updates outside it stay safe", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    columns: 80,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("selected text");
    await app.waitFor(() => app.screen().includes("⏺ selected text"));
    const y = app.screen().findIndex((line) => line.includes("selected text"));
    gesture(app, { x: 2, y }, { x: 9, y });
    await app.waitFor(() => !app.terminal.buffer.active.getLine(y)!.getCell(2)!.isBgDefault());
    app.calls[0]!.delta("\nupdates outside selection");
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("updates outside selection")),
    );
    release(app, { x: 9, y });
    await app.waitFor(() => copied.length === 1);
    expect(copied).toEqual(["selected"]);
    gesture(app, { x: 2, y }, { x: 9, y });
    await app.waitFor(() => !app.terminal.buffer.active.getLine(y)!.getCell(2)!.isBgDefault());
    app.calls[0]!.reply("replaced output");
    await app.waitFor(() => app.screen().some((line) => line.includes("replaced output")));
    release(app, { x: 9, y });
    await app.waitFor(() => app.screen().join("\n").includes("Selected content changed"));
    expect(copied).toEqual(["selected"]);
  } finally {
    await app.cleanup();
  }
});

test("resize, wheel and Escape discard gestures without copying or interrupting the Run", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    columns: 80,
    rows: 40,
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("selected text");
    await app.waitFor(() => app.screen().includes("⏺ selected text"));
    const position = () => ({
      x: 2,
      y: app.screen().findIndex((line) => line.includes("selected text")),
    });
    let at = position();
    gesture(app, at, { ...at, x: 9 });
    await app.waitFor(() => !app.terminal.buffer.active.getLine(at.y)!.getCell(2)!.isBgDefault());
    app.resize(81, 40);
    await app.waitFor(() => app.screen().some((line) => line.includes("selected text")));
    release(app, { ...at, x: 9 });
    at = position();
    gesture(app, at, { ...at, x: 9 });
    await app.waitFor(() => !app.terminal.buffer.active.getLine(at.y)!.getCell(2)!.isBgDefault());
    app.stdin.write(`\x1b[<64;5;${at.y + 1}M`);
    release(app, { ...at, x: 9 });
    at = position();
    gesture(app, at, { ...at, x: 9 });
    await app.waitFor(() => !app.terminal.buffer.active.getLine(at.y)!.getCell(2)!.isBgDefault());
    app.stdin.write("\x1b");
    jest.advanceTimersByTime(31);
    await app.flush();
    await app.waitFor(() => app.terminal.buffer.active.getLine(at.y)!.getCell(2)!.isBgDefault());
    release(app, { ...at, x: 9 });
    expect(copied).toEqual([]);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("dragging on a tool path suppresses its file action while a normal click still opens it", async () => {
  const { join } = await import("node:path");
  const copied: string[] = [];
  const app = await startWithClock(["--yolo", "read"], {
    columns: 80,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "file.txt"), "body");
    },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "file.txt" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().some((line) => line.includes("Read file.txt")),
    );
    const y = app.screen().findIndex((line) => line.includes("Read file.txt"));
    const x = Bun.stringWidth(app.screen()[y]!.slice(0, app.screen()[y]!.indexOf("file.txt")));
    const end = { x: x + 4, y };
    gesture(app, { x, y }, end);
    await app.waitFor(() => !app.terminal.buffer.active.getLine(y)!.getCell(x)!.isBgDefault());
    release(app, end);
    await app.waitFor(() => copied.length === 1);
    expect(copied).toEqual(["file."]);
    expect(app.screen().join("\n")).not.toContain("Copy path");
    jest.advanceTimersByTime(500);
    app.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
    await app.waitFor(() => app.screen().join("\n").includes("Copy path"));
    expect(copied).toHaveLength(1);
  } finally {
    await app.cleanup();
  }
});

test("wide continuation cells copy complete graphemes and wrapped code excludes frame decorations", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    columns: 40,
    rows: 40,
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("A中文🐋B");
    await app.waitFor(() => app.screen().includes("⏺ A中文🐋B"));
    const y = app.screen().findIndex((line) => line.includes("A中文🐋B"));
    gesture(app, { x: 4, y }, { x: 8, y });
    await app.waitFor(() => !app.terminal.buffer.active.getLine(y)!.getCell(3)!.isBgDefault());
    release(app, { x: 8, y });
    await app.waitFor(() => copied.length === 1);
    expect(copied).toEqual(["中文🐋"]);
    const code = 'const answer = "中文🐋"; ' + "alpha ".repeat(12) + "tail";
    app.calls[0]!.delta("\n\n```ts\n" + code + "\n```");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().some((line) => line.includes("tail")));
    const header = app.screen().findIndex((line) => line.includes("┌─ ts"));
    const end = app.screen().findIndex((line) => line.includes("tail"));
    gesture(app, { x: 0, y: header }, { x: 39, y: end });
    release(app, { x: 39, y: end });
    await app.waitFor(() => copied.length === 2);
    expect(copied[1]).toBe(code);
  } finally {
    await app.cleanup();
  }
});

test("a late clipboard result belongs to its original Session and does not notify a new Session", async () => {
  const pending = Promise.withResolvers<boolean>();
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    columns: 80,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return pending.promise;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("selected text");
    app.calls[0]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().some((line) => line.includes("selected text")),
    );
    const y = app.screen().findIndex((line) => line.includes("selected text"));
    gesture(app, { x: 2, y }, { x: 9, y });
    release(app, { x: 9, y });
    await app.waitFor(() => copied.length === 1);
    app.stdin.write("/clear\r");
    await app.waitFor(() => !app.screen().some((line) => line.includes("selected text")));
    pending.resolve(true);
    await app.flush();
    jest.advanceTimersByTime(32);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("Copied");
    expect(copied).toEqual(["selected"]);
    expect(app.stderr()).toBe("");
  } finally {
    pending.resolve(false);
    await app.cleanup();
  }
});

test("thinking header and preview drags exclude spinner and rails without toggling the body", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    columns: 80,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("first secret\nsecond\nthird");
    await app.waitFor(() => app.screen().some((line) => line.includes("│ first secret")));
    const y = app.screen().findIndex((line) => line.includes("│ first secret"));
    gesture(app, { x: 2, y }, { x: 15, y });
    release(app, { x: 15, y });
    await app.waitFor(() => copied.length === 1);
    expect(copied).toEqual(["first secret"]);
    const heading = app.screen().findIndex((line) => line.includes("Thinking"));
    gesture(app, { x: 0, y: heading }, { x: 9, y: heading });
    release(app, { x: 9, y: heading });
    await app.waitFor(() => copied.length === 2);
    expect(copied[1]).toBe("Thinking");
    expect(app.screen().some((line) => line.includes("│ first secret"))).toBe(true);
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

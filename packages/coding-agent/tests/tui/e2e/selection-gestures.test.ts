import { testClock } from "../helpers/test-clock";
import { expect, jest, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

function press(app: Awaited<ReturnType<typeof startWithClock>>, x: number, y: number, flags = 0) {
  app.stdin.write(`\x1b[<${flags};${x + 1};${y + 1}M`);
}
function release(app: Awaited<ReturnType<typeof startWithClock>>, x: number, y: number) {
  app.stdin.write(`\x1b[<0;${x + 1};${y + 1}m`);
}

test("double press highlights a Unicode path immediately, release copies; triple press selects a line", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    rows: 40,
    env: { LANG: "en" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("Read **/tmp/中文-file.ts** please\nsecond words");
    app.calls[0]!.finish();
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("Read /tmp/中文-file.ts please")),
    );
    const y = app.screen().findIndex((line) => line.includes("Read /tmp/中文-file.ts please"));
    press(app, 8, y);
    release(app, 8, y);
    testClock.advanceTimersByTime(499);
    press(app, 8, y);
    await app.waitFor(() => !app.terminal.buffer.active.getLine(y)!.getCell(7)!.isBgDefault());
    expect(copied).toEqual([]);
    release(app, 8, y);
    await app.waitFor(() => copied.length === 1);
    expect(copied[0]).toBe("/tmp/中文-file.ts");
    press(app, 8, y);
    release(app, 8, y);
    await app.waitFor(() => copied.length === 2);
    expect(copied[1]).toBe("Read /tmp/中文-file.ts please");
  } finally {
    await app.cleanup();
  }
});

test("active gesture Shift arrows extend text before release without changing the prompt", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    rows: 40,
    env: { LANG: "en" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("Alpha beta\nsecond");
    app.calls[0]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes("Alpha beta")));
    const y = app.screen().findIndex((line) => line.includes("Alpha beta"));
    press(app, 2, y);
    app.stdin.write("\x1b[1;2C\x1b[1;2C");
    release(app, 4, y);
    await app.waitFor(() => copied.length === 1);
    expect(copied[0]).toBe("Alp");
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test.each([
  [499, 0, 0, true],
  [500, 0, 0, false],
  [499, 1, 1, true],
  [499, 2, 0, false],
  [499, 0, 2, false],
])(
  "click chain delay %ims distance %i,%i obeys strict boundary",
  async (delay, dx, dy, selected) => {
    const copied: string[] = [];
    const app = await startWithClock(["explain"], {
      rows: 40,
      env: { LANG: "en" },
      host: {
        writeClipboard: async (text) => {
          copied.push(text);
          return true;
        },
      },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.delta("alpha beta\nalpha beta\nalpha beta");
      app.calls[0]!.finish();
      await app.waitFor(
        () => app.screen().filter((line) => line.includes("alpha beta")).length === 3,
      );
      const y = app.screen().findIndex((line) => line.includes("alpha beta"));
      expect(app.screen()[y + 1]).toContain("alpha beta");
      press(app, 3, y);
      release(app, 3, y);
      jest.setSystemTime(new Date(Date.now() + Number(delay)));
      press(app, 3 + Number(dx), y + Number(dy));
      release(app, 3 + Number(dx), y + Number(dy));
      await app.flush();
      expect(copied).toEqual(selected ? ["alpha"] : []);
    } finally {
      await app.cleanup();
    }
  },
);

test("word and line drags extend complete units; modified press resets click chain", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    rows: 40,
    env: { LANG: "en" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("alpha beta\nsecond words");
    app.calls[0]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes("second words")));
    const y = app.screen().findIndex((line) => line.includes("alpha beta"));
    press(app, 3, y);
    release(app, 3, y);
    press(app, 3, y);
    app.stdin.write(`\x1b[<32;11;${y + 1}M`);
    release(app, 10, y);
    await app.waitFor(() => copied.length === 1);
    expect(copied[0]).toBe("alpha beta");
    jest.setSystemTime(new Date(Date.now() + 501));
    press(app, 3, y);
    release(app, 3, y);
    press(app, 3, y);
    release(app, 3, y);
    press(app, 3, y);
    app.stdin.write(`\x1b[<32;5;${y + 2}M`);
    release(app, 4, y + 1);
    await app.waitFor(() => copied.length === 3);
    expect(copied[2]).toBe("alpha beta\nsecond words");
    press(app, 3, y, 4);
    release(app, 3, y);
    await app.flush();
    expect(copied.length).toBe(3);
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["en", "Clipboard request sent to terminal"],
  ["zh", "已向终端发送剪贴板请求"],
])("%s reports OSC submission without claiming clipboard confirmation", async (lang, message) => {
  const app = await startWithClock(["explain"], {
    rows: 40,
    env: { LANG: lang },
    host: { writeClipboard: async () => "sent" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("alpha");
    app.calls[0]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes("alpha")));
    const y = app.screen().findIndex((line) => line.includes("alpha"));
    press(app, 2, y);
    app.stdin.write(`\x1b[<32;6;${y + 1}M`);
    release(app, 5, y);
    await app.waitFor(() => app.screen().join("\n").includes(message!));
    expect(app.screen().join("\n")).not.toContain("Copied");
  } finally {
    await app.cleanup();
  }
});

test("Shift line navigation shares stale validation and leaves normal prompt editing available", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    rows: 40,
    env: { LANG: "en" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("first line\nsecond line");
    await app.waitFor(() => app.screen().some((line) => line.includes("second line")));
    const y = app.screen().findIndex((line) => line.includes("first line"));
    press(app, 2, y);
    app.stdin.write("\x1b[1;2F\x1b[1;2B\x1b[1;2H\x1b[1;2F");
    release(app, 79, y + 1);
    await app.waitFor(() => copied.length === 1);
    expect(copied[0]).toBe("first line\nsecond line");
    press(app, 2, y, 4);
    app.stdin.write("\x1b[1;2F");
    await app.waitFor(() => !app.terminal.buffer.active.getLine(y)!.getCell(2)!.isBgDefault());
    app.calls[0]!.reply("replacement");
    await app.waitFor(() => app.screen().some((line) => line.includes("replacement")));
    release(app, 79, y);
    await app.waitFor(() => app.screen().join("\n").includes("Selected content changed"));
    expect(copied.length).toBe(1);
    app.stdin.write("draft");
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ draft")));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("an Interaction takes keyboard ownership from an in-progress text gesture", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["explain"], {
    rows: 40,
    env: { LANG: "en" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("select this");
    await app.waitFor(() => app.screen().some((line) => line.includes("select this")));
    const y = app.screen().findIndex((line) => line.includes("select this"));
    press(app, 2, y);
    app.stdin.write(`\x1b[<32;7;${y + 1}M`);
    await app.waitFor(() => !app.terminal.buffer.active.getLine(y)!.getCell(2)!.isBgDefault());
    app.calls[0]!.tool("ask_user_question", {
      questions: [
        {
          question: "Which storage?",
          header: "Storage",
          multiSelect: false,
          options: [
            { label: "SQLite", description: "Local" },
            { label: "Postgres", description: "Remote" },
          ],
        },
      ],
    });
    await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
    release(app, 6, y);
    app.stdin.write("\x1b[B\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(JSON.stringify(app.calls[1]!.context.messages.at(-1))).toContain("Postgres");
    expect(copied).toEqual([]);
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

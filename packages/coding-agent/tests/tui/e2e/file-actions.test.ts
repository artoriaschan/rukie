import { expect, test } from "bun:test";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SessionOptions } from "@rukie/agent";
import { start } from "../helpers/app";

function clickText(app: Awaited<ReturnType<typeof start>>, label: string, occurrence = 0) {
  const matching = app
    .screen()
    .flatMap((line, row) => (line.includes(label) ? [{ line, row }] : []));
  const hit = matching[occurrence]!;
  if (!hit) throw new Error(`Missing ${label}: ${app.screen().join("\n")}`);
  const column = Bun.stringWidth(hit.line.slice(0, hit.line.indexOf(label))) + 1;
  app.stdin.write(`\x1b[<0;${column};${hit.row + 1}M\x1b[<0;${column};${hit.row + 1}m`);
}

test("clicking a card path opens the file menu without expanding its body", async () => {
  const opened: string[] = [];
  const path = "review file.txt";
  const app = await start(["inspect"], {
    columns: 100,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: (root) => writeFile(join(root, path), "one\ntwo\nthree\nfour\nfive\n"),
    host: {
      openExternal: async (target) => {
        opened.push(target);
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    clickText(app, path);
    await app.waitFor(() => app.screen().join("\n").includes("File actions"));
    app.stdin.write("\r");
    await app.waitFor(() => opened.length === 1);
    expect(opened).toEqual([join(app.root, path)]);
    await app.waitFor(() => !app.screen().join("\n").includes("File actions"));
    expect(app.screen().join("\n")).not.toContain("five");
  } finally {
    await app.cleanup();
  }
});

test.each(["en", "zh"] as const)(
  "%s file menu supports keyboard, mouse, Escape and Session cwd",
  async (locale) => {
    const actions: [string, string][] = [];
    const session: Partial<SessionOptions> = {};
    const path = "记录 file.txt";
    const labels =
      locale === "zh"
        ? ["文件操作", "打开文件", "在文件管理器中显示", "复制路径"]
        : ["File actions", "Open file", "Reveal in file manager", "Copy path"];
    const app = await start(["inspect"], {
      columns: 100,
      rows: 40,
      session,
      env: { LANG: locale === "zh" ? "zh_CN.UTF-8" : "en_US.UTF-8" },
      async prepare(root) {
        session.cwd = join(root, "workspace");
        await mkdir(session.cwd);
        await writeFile(join(session.cwd, path), "one\ntwo\nthree\nfour\nfive\n");
      },
      host: {
        openExternal: async (target) => {
          actions.push(["open", target]);
        },
        reveal: async (target) => {
          actions.push(["reveal", target]);
        },
        writeClipboard: async (target) => {
          actions.push(["copy", target]);
          return true;
        },
      },
    });
    const screen = () => app.screen().join("\n");
    const openMenu = async () => {
      clickText(app, path);
      await app.waitFor(() => screen().includes(labels[0]!));
    };
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("read", { path });
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      const row = app.screen().findIndex((line) => line.includes(path));
      const column = Bun.stringWidth(app.screen()[row]!.split(path)[0]!);
      expect(app.terminal.buffer.active.getLine(row)!.getCell(column)!.isUnderline()).toBeTruthy();
      await openMenu();
      app.stdin.write("/should not become a draft\x0f\x1b");
      await app.waitFor(() => !screen().includes(labels[0]!));
      expect(screen()).not.toContain("should not become");
      expect(screen()).not.toContain("five");
      await openMenu();
      app.stdin.write("\r");
      await app.waitFor(() => actions.length === 1 && !screen().includes(labels[0]!));
      await openMenu();
      app.stdin.write("\x1b[B\r");
      await app.waitFor(() => actions.length === 2 && !screen().includes(labels[0]!));
      await openMenu();
      clickText(app, labels[3]!);
      await app.waitFor(() => actions.length === 3 && !screen().includes(labels[0]!));
      expect(actions).toEqual([
        ["open", join(session.cwd!, path)],
        ["reveal", join(session.cwd!, path)],
        ["copy", join(session.cwd!, path)],
      ]);
    } finally {
      await app.cleanup();
    }
  },
);

test.each([80, 120])(
  "diff paths at %i columns open actions without toggling the card and the menu fits after shrinking",
  async (columns) => {
    const copied: string[] = [];
    const path = "new.txt";
    const app = await start(["--permission-mode", "full-access", "write"], {
      columns,
      rows: 40,
      env: { LANG: "en_US.UTF-8" },
      host: {
        writeClipboard: async (target) => {
          copied.push(target);
          return true;
        },
      },
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("write", {
        path,
        content: Array.from({ length: 15 }, (_, i) => `line ${i}`).join("\n"),
      });
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      const before = screen();
      expect(before).not.toContain("line 14");
      const pathRow = app
        .screen()
        .findIndex((line) => line.includes(path) && !line.includes("Write "));
      const pathColumn = Bun.stringWidth(app.screen()[pathRow]!.split(path)[0]!);
      expect(
        app.terminal.buffer.active.getLine(pathRow)!.getCell(pathColumn)!.isUnderline(),
      ).toBeTruthy();
      clickText(app, path, 1);
      await app.waitFor(() => screen().includes("File actions"));
      app.resize(28, 6);
      await app.waitFor(
        () =>
          screen().includes("Open file") &&
          screen().includes("Reveal in file manag") &&
          screen().includes("Copy path"),
      );
      app.stdin.write("\x1b[B\x1b[B\r");
      await app.waitFor(() => copied.length === 1);
      expect(copied).toEqual([join(app.root, path)]);
      app.resize(columns, 40);
      await app.waitFor(() => screen().includes("line 0"));
      expect(screen()).not.toContain("line 14");
    } finally {
      await app.cleanup();
    }
  },
);

test("edit headers expose their path as an underlined action segment", async () => {
  const opened: string[] = [];
  const path = "edit.txt";
  const app = await start(["--permission-mode", "full-access", "edit"], {
    columns: 100,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: (root) => writeFile(join(root, path), "original\n"),
    host: {
      openExternal: async (target) => {
        opened.push(target);
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("edit", { path, edits: [{ oldText: "original", newText: "updated" }] });
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    const row = app.screen().findIndex((line) => line.includes("Edit "));
    expect(app.screen()[row]).toContain("Edit edit.txt");
    const column = Bun.stringWidth(app.screen()[row]!.split(path)[0]!);
    expect(app.terminal.buffer.active.getLine(row)!.getCell(column)!.isUnderline()).toBeTruthy();
    app.stdin.write(`\x1b[<0;${column + 1};${row + 1}M\x1b[<0;${column + 1};${row + 1}m`);
    await app.waitFor(() => app.screen().join("\n").includes("File actions"));
    app.stdin.write("\r");
    await app.waitFor(() => opened.length === 1);
    expect(opened).toEqual([join(app.root, path)]);
  } finally {
    await app.cleanup();
  }
});

test("resumed card paths retain actions and report unavailable clipboard", async () => {
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const { createSession } = await import("@rukie/agent");
  const { auxiliaryModels } = await import("../helpers/auxiliary-model");
  const argv: string[] = [];
  const path = "stored.txt";
  const app = await start(argv, {
    columns: 100,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    async prepare(root) {
      await writeFile(join(root, path), "one\ntwo\nthree\nfour\nfive\n");
      const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("read", { path }), { stopReason: "toolUse" }),
        fauxAssistantMessage("stored conclusion"),
      ]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        models: auxiliaryModels(faux.provider.streamSimple),
      });
      await session.run("inspect stored file");
      argv.push("--resume", session.id);
      await session.close();
    },
    host: { writeClipboard: async () => false },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    clickText(app, path);
    await app.waitFor(() => app.screen().join("\n").includes("File actions"));
    app.stdin.write("3");
    await app.waitFor(() => app.screen().join("\n").includes("Clipboard is unavailable"));
    expect(app.screen().join("\n")).not.toContain("File actions");
    expect(app.screen().join("\n")).not.toContain("five");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("directory paths keep their own actions on failed reads without changing the verdict", async () => {
  const opened: string[] = [];
  const app = await start(["--yolo", "inspect directory"], {
    rows: 40,
    env: { LANG: "en" },
    prepare: (root) => mkdir(join(root, "folder")),
    host: {
      openExternal: async (path) => {
        opened.push(path);
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "folder" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().some((line) => line.startsWith("✗ Read folder"))).toBe(true);
    clickText(app, "folder", 1);
    await app.waitFor(() => app.screen().join("\n").includes("Open folder"));
    app.stdin.write("\r");
    await app.waitFor(
      () => opened.length === 1 && app.screen().some((line) => line.startsWith("✗ Read folder")),
    );
    expect(opened).toEqual([join(app.root, "folder")]);
    expect(app.screen().some((line) => line.startsWith("✗ Read folder"))).toBe(true);
  } finally {
    await app.cleanup();
  }
});

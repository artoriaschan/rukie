import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";
import { isolateProxyEnvironment } from "../helpers/proxy-env.ts";
isolateProxyEnvironment();

function click(app: Awaited<ReturnType<typeof startWithClock>>, label: string) {
  const row = app.screen().findIndex((line) => line.includes(label));
  expect(row).toBeGreaterThanOrEqual(0);
  const x = Bun.stringWidth(app.screen()[row]!.split(label)[0]!);
  app.stdin.write(`\x1b[<0;${x + 1};${row + 1}M\x1b[<0;${x + 1};${row + 1}m`);
}

test("long terminal output pages through retained source and keyboard belongs to its focused window", async () => {
  const app = await startWithClock(["--yolo", "inspect"], { rows: 450, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "seq 1 805", description: "Large result" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400 of 805"));
    expect(app.screen()).toContain("   400");
    click(app, "Next 400");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 401–800 of 805"));
    expect(app.screen()).toContain(" ⎿ 401");
    expect(app.screen()).toContain("   800");
    expect(app.screen()).not.toContain("   400");
    app.stdin.write("\x1b[6~");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 801–805 of 805"));
    expect(app.screen()).toContain("   805");
    app.stdin.write("\x1b[H");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400 of 805"));
    app.stdin.write("\x1b[F");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 801–805 of 805"));
    click(app, "Previous 400");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 401–800 of 805"));
    const resultRow = app.screen().findIndex((line) => line === " ⎿ 401");
    app.stdin.write(
      `\x1b[<0;4;${resultRow + 1}M\x1b[<32;6;${resultRow + 2}M\x1b[<0;6;${resultRow + 2}m`,
    );
    await app.waitFor(() => !app.screen().join("\n").includes("Window focused"));
    expect(app.screen().join("\n")).toContain("Showing lines 401–800 of 805");
    click(app, "Next 400");
    await app.waitFor(() => app.screen().join("\n").includes("Window focused"));
    click(app, "Previous 400");
    app.stdin.write("\x1b");
    await app.waitFor(() => !app.screen().join("\n").includes("Window focused"));
    expect(app.screen().join("\n")).toContain("Showing lines 401–800 of 805");
    app.stdin.write("\x1b");
    await app.waitFor(() => app.screen().join("\n").includes("+802 lines"));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("folded read clips each logical line honestly without splitting Unicode and expansion reveals its retained tail", async () => {
  const { join } = await import("node:path");
  const app = await startWithClock(["--yolo", "inspect"], {
    columns: 80,
    rows: 60,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(join(root, "long.txt"), "x".repeat(999) + "😀TAIL\nsecond\nthird\nfourth\n").then(
        () => {},
      ),
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "long.txt" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const screen = () => app.screen().join("\n");
    expect(screen()).toContain("+6 characters");
    expect(screen()).not.toContain("TAIL");
    expect(screen()).not.toContain("�");
    expect(screen()).toContain("fourth");
    expect(screen()).not.toContain("+1 lines");
    app.stdin.write("\x0f");
    await app.waitFor(() => screen().includes("TAIL") && screen().includes("😀"));
    expect(screen()).not.toContain("+6 characters");
  } finally {
    await app.cleanup();
  }
});

test("dragging a result copies only its source and never expands the folded card", async () => {
  const { join } = await import("node:path");
  const copied: string[] = [];
  const app = await startWithClock(["--yolo", "inspect"], {
    rows: 40,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(join(root, "result.txt"), "one\ntwo\nthree\nfour\nfive").then(() => {}),
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "result.txt" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const y = app.screen().findIndex((line) => line === " ⎿ one");
    expect(y).toBeGreaterThanOrEqual(0);
    app.stdin.write(`\x1b[<0;1;${y + 1}M\x1b[<32;6;${y + 2}M\x1b[<0;6;${y + 2}m`);
    await app.waitFor(() => copied.length === 1);
    expect(copied).toEqual(["one\ntwo"]);
    const header = app.screen().findIndex((line) => line.includes("Read result.txt"));
    app.stdin.write(`\x1b[<35;6;${header + 1}M`);
    await app.waitFor(() => app.screen()[header]?.includes("▾") ?? false);
    app.stdin.write(`\x1b[<0;1;${header + 1}M\x1b[<32;6;${y + 2}M\x1b[<0;6;${y + 2}m`);
    await app.waitFor(() => copied.length === 2);
    expect(copied[1]).toContain("Read result.txt");
    expect(copied[1]).not.toMatch(/[•⎿▾▴]/u);
    expect(app.screen().join("\n")).toContain("+2 lines");
    expect(app.screen()).not.toContain("   five");
  } finally {
    await app.cleanup();
  }
});

test("resumed truncated reads disclose retained bounds at the last window without replaying the tool", async () => {
  const { createSession } = await import("@rukie/agent");
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const { auxiliaryModels } = await import("../helpers/auxiliary-model");
  const { join } = await import("node:path");
  const argv: string[] = [];
  const app = await startWithClock(argv, {
    rows: 450,
    env: { LANG: "en" },
    prepare: async (root) => {
      await Bun.write(
        join(root, "large.txt"),
        Array.from({ length: 2200 }, (_, i) => `source-${i + 1}`).join("\n"),
      );
      const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("read", { path: "large.txt" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        models: auxiliaryModels(faux.provider.streamSimple),
      });
      await session.run("inspect");
      argv.push("--resume", session.id);
      await session.close();
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.calls).toHaveLength(0);
    expect(app.screen().join("\n")).toContain("Full output unavailable");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400"));
    click(app, "Next 400");
    await app.waitFor(() => app.screen().join("\n").includes("Window focused"));
    app.stdin.write("\x1b[F");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 2001"));
    click(app, "Previous 400");
    await app.waitFor(() => app.screen().join("\n").includes("source-2000"));
    const screen = app.screen().join("\n");
    expect(screen).toContain("Full output unavailable");
    expect(screen).toContain("Use offset=2001 to continue");
    expect(screen).not.toContain("source-2200");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("diff windows retain their source position across the 109/110 layout boundary", async () => {
  const { join } = await import("node:path");
  const copied: string[] = [];
  const content = Array.from({ length: 410 }, (_, i) => `BEFORE-${i}`).join("\n");
  const app = await startWithClock(["--yolo", "change"], {
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
    columns: 109,
    rows: 450,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(
        join(root, "large.txt"),
        Array.from({ length: 405 }, (_, i) => `before-${i}`).join("\n"),
      ).then(() => {}),
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", { path: "large.txt", content });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400 of 816"));
    click(app, "Next 400");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 401–800 of 816"));
    app.stdin.write("\x1b[F");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 801–816 of 816"));
    expect(app.screen().join("\n")).toContain("+BEFORE-394");
    app.resize(110, 450);
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("-before-394") && line.includes("+BEFORE-394")),
    );
    expect(app.screen().join("\n")).toContain(
      "Showing aligned rows 396–411 of 411 · Retained diff source: 816 lines",
    );
    const pairedRow = app
      .screen()
      .findIndex((line) => line.includes("-before-394") && line.includes("+BEFORE-394"));
    const pairedLine = app.screen()[pairedRow]!;
    app.stdin.write(
      `\x1b[<0;1;${pairedRow + 1}M\x1b[<32;${Bun.stringWidth(pairedLine)};${pairedRow + 1}M\x1b[<0;${Bun.stringWidth(pairedLine)};${pairedRow + 1}m`,
    );
    await app.waitFor(() => copied.length === 1);
    expect(copied[0]).toContain("before-394");
    expect(copied[0]).toContain("BEFORE-394");
    expect(copied[0]).not.toMatch(/[│⎿]/u);
    expect(app.screen().join("\n")).toContain("Showing aligned rows 396–411");
    app.resize(109, 450);
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 801–816 of 816"));
    expect(app.screen().join("\n")).toContain("+BEFORE-409");
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("truncated search retains its total and unavailable-source disclosure outside every window", async () => {
  const { join } = await import("node:path");
  const app = await startWithClock(["--yolo", "find"], {
    rows: 450,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(
        join(root, "matches.txt"),
        Array.from({ length: 2500 }, (_, i) => `needle-${i + 1}`).join("\n"),
      ).then(() => {}),
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("grep", { pattern: "needle", path: "matches.txt" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("Full output unavailable");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400"));
    click(app, "Next 400");
    await app.waitFor(() => app.screen().join("\n").includes("Window focused"));
    app.stdin.write("\x1b[F");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1601"));
    const screen = app.screen().join("\n");
    expect(screen).toContain("Full output unavailable");
    expect(screen).toContain("2500");
    expect(screen).not.toContain("needle-2500");
  } finally {
    await app.cleanup();
  }
});

test("resumed web windows preserve retained source and disclose upstream truncation outside the fold", async () => {
  const source = Array.from({ length: 900 }, (_, i) => `page-${i + 1} ${"x".repeat(60)}`).join(
    "\n",
  );
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(source) });
  const { createSession } = await import("@rukie/agent");
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const { auxiliaryModels } = await import("../helpers/auxiliary-model");
  const webFetch = {
    resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    allowAddresses: ["127.0.0.1"],
  };
  const argv: string[] = [];
  const app = await startWithClock(argv, {
    rows: 450,
    env: { LANG: "en" },
    prepare: async (root) => {
      const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("web_fetch", { url: `http://site.test:${server.port}/docs` }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done"),
      ]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        models: auxiliaryModels(faux.provider.streamSimple),
        webFetch,
        permissionMode: "full-access",
      });
      try {
        await session.run("fetch");
        argv.push("--resume", session.id);
      } finally {
        await session.close();
      }
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.calls).toHaveLength(0);
    expect(app.screen().join("\n")).toContain("Full output unavailable");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400"));
    click(app, "Next 400");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 401"));
    const screen = app.screen().join("\n");
    expect(screen).toContain("page-500");
    expect(screen).not.toContain("page-900");
    expect(screen).toContain("Full output unavailable");
  } finally {
    await app.cleanup();
    await server.stop(true);
  }
});

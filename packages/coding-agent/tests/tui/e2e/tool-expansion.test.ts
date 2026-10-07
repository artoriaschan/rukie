import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "@rukie/agent";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model";
import { expect, test, jest } from "bun:test";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";

async function outputCard(app: Awaited<ReturnType<typeof start>>, text: string) {
  await app.waitFor(() => app.calls.length === 1);
  app.calls[0]!.tool("bash", { command: `printf '${text}'`, description: "Expansion fixture" });
  await app.waitFor(() => app.calls.length === 2);
  app.calls[1]!.finish();
  await app.waitFor(() => !app.isWorking());
}

function click(app: Awaited<ReturnType<typeof start>>, x: number, y: number) {
  app.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
}

test("cards toggle from header and body whitespace and union with transcript expansion", async () => {
  const app = await startWithClock(["--yolo", "expand"], { rows: 40, env: { LANG: "en" } });
  try {
    await outputCard(app, "first\\n\\nthird\\nfourth\\nfifth");
    await app.waitFor(() => app.screen().join("\n").includes("+2 lines"));
    const header = () => app.screen().findIndex((line) => /^[•▾▴] Bash\(/.test(line));
    click(app, 79, header());
    await app.waitFor(() => app.screen().includes("   fifth"));
    expect(app.screen()).toContain("   fifth");
    jest.advanceTimersByTime(500);
    const body = header() + 2;
    expect(app.screen()[body]!.trim()).toBe("");
    click(app, 79, body);
    await app.waitFor(() => app.screen().join("\n").includes("+2 lines"));
    app.stdin.write(`\x1b[<35;4;${header() + 1}M`);
    await app.waitFor(() =>
      app.screen().some((line) => line.startsWith("• Bash(") && line.endsWith("▾")),
    );
    const cell = app.terminal.buffer.active.getLine(header())!.getCell(79)!;
    expect(cell.getBgColor()).toBe(0x2e3440);
    click(app, 3, header());
    await app.waitFor(() => app.screen().includes("   fifth"));
    expect(app.screen().some((line) => line.startsWith("• Bash(") && line.endsWith("▴"))).toBe(
      true,
    );
    app.stdin.write("\x0f");
    await app.flush();
    jest.advanceTimersByTime(500);
    click(app, 3, header());
    await app.flush();
    expect(app.screen()).toContain("   fifth");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("+2 lines"));
    app.resize(40, 40);
    await app.waitFor(() => app.screen().every((line) => Bun.stringWidth(line) <= 40));
    jest.advanceTimersByTime(500);
    click(app, 39, header() + 2);
    await app.waitFor(() => app.screen().includes("   fifth"));
    jest.advanceTimersByTime(500);
    click(app, 39, header() - 1);
    await app.flush();
    expect(app.screen()).toContain("   fifth");
  } finally {
    await app.cleanup();
  }
});

test("transcript expansion reveals streamed and completed thinking", async () => {
  const app = await start(["inspect reasoning"], { rows: 40, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("private reasoning first\nprivate reasoning second");
    await app.waitFor(() => app.screen().join("\n").includes("Thinking"));
    expect(app.screen().join("\n")).toContain("private reasoning first");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("private reasoning second"));
    app.calls[0]!.delta("answer");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    await app.waitFor(() => app.screen().join("\n").includes("private reasoning first"));
    app.stdin.write("\x0f");
    await app.waitFor(() => !app.screen().join("\n").includes("private reasoning first"));
  } finally {
    await app.cleanup();
  }
});

test("expanded output shows a bounded 400-line window and fits after small-terminal resize", async () => {
  const app = await start(["--yolo", "large output"], { rows: 450, env: { LANG: "en" } });
  try {
    await outputCard(app, Array.from({ length: 405 }, (_, index) => String(index + 1)).join("\\n"));
    await app.waitFor(() => app.screen().join("\n").includes("+402 lines"));
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400 of 405"));
    expect(app.screen()).toContain("   400");
    expect(app.screen()).not.toContain("   401");
    app.resize(35, 10);
    await app.waitFor(() => app.screen().join("\n").includes("Resize to at least"));
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 35)).toBe(true);
    app.resize(80, 450);
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400 of 405"));
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("+402 lines"));
    expect(app.terminal.buffer.active.baseY).toBe(0);
  } finally {
    await app.cleanup();
  }
});

test("expansion preserves an earlier reading position and bottom following", async () => {
  const app = await startWithClock(["--yolo", "reading anchor"], { rows: 40, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "printf 'first\\nsecond\\nthird\\nfourth\\nfifth'",
      description: "Anchor fixture",
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta(Array.from({ length: 40 }, (_, index) => `response-${index}`).join("\n"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes("response-39"));
    app.stdin.write("\x1b[5~");
    await app.waitFor(
      () =>
        app.screen()[0]?.trim() === "" && app.screen().some((line) => line.startsWith("• Bash(")),
    );
    const earlier = app.screen().slice(1, 6);
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().includes("   fifth"));
    expect(app.screen().slice(1, 6)).toEqual(earlier);
    expect(app.screen().join("\n")).not.toContain("response-39");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("+2 lines"));
    expect(app.screen().slice(1, 6)).toEqual(earlier);
    app.stdin.write("\x1b[6~\x1b[6~");
    await app.waitFor(() => app.screen().join("\n").includes("response-39"));
    app.stdin.write("\x0f");
    await app.flush();
    expect(app.screen().join("\n")).toContain("response-39");
  } finally {
    await app.cleanup();
  }
});

test("resumed thinking uses the same transcript expansion", async () => {
  const argv: string[] = [];
  const original = createFauxCore({ api: "faux", provider: "faux" });
  original.setResponses([
    fauxAssistantMessage([
      { type: "thinking", thinking: "saved reasoning" },
      { type: "text", text: "saved answer" },
    ]),
  ]);
  const app = await start(argv, {
    rows: 40,
    env: { LANG: "en" },
    prepare: async (root) => {
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        streamFn: withAuxiliaryRequests((model, context, options) =>
          original.streamSimple(model, context, options),
        ),
      });
      await session.run("saved prompt");
      argv.push("--resume", session.id);
      await session.dispose();
    },
  });
  try {
    await app.waitFor(() => app.screen().join("\n").includes("saved answer"));
    expect(app.screen().join("\n")).not.toContain("saved reasoning");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("saved reasoning"));
    expect(app.screen().join("\n")).toContain("saved answer");
  } finally {
    await app.cleanup();
  }
});

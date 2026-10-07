import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";
import { isolateProxyEnvironment } from "../helpers/proxy-env";
isolateProxyEnvironment();

test("transcript search jumps distinct matches beyond the 400-line tool window", async () => {
  const app = await start(["--yolo", "inspect"], {
    rows: 24,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(
        join(root, "corpus.txt"),
        Array.from({ length: 520 }, (_, index) =>
          index === 5
            ? "needle first"
            : index === 450
              ? "needle second"
              : index === 495
                ? "needle third"
                : `filler-${index}`,
        ).join("\n"),
      );
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "corpus.txt" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x0f/needle\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("1/3")));
    expect(app.screen().join("\n")).toContain("needle first");
    const row = app.screen().findIndex((line) => line.includes("needle first"));
    const line = app.terminal.buffer.active.getLine(row)!;
    expect(line.getCell(line.translateToString().indexOf("needle"))!.getBgColor()).not.toBe(0);
    app.stdin.write("n");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("2/3")) &&
        app.screen().some((line) => line.includes("needle second")),
    );
    app.stdin.write("n");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("3/3")) &&
        app.screen().some((line) => line.includes("needle third")),
    );
    app.stdin.write("N");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("2/3")) &&
        app.screen().some((line) => line.includes("needle second")),
    );
    app.stdin.write("\x1b");
    await app.waitFor(() => !app.screen().some((line) => line.includes("Search transcript")));
    app.stdin.write("/context");
    await app.waitFor(() => app.screen().some((line) => line.includes("/context")));
    expect(app.screen().join("\n")).not.toContain("2/3");
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["en_US.UTF-8", "No matches:"],
  ["zh_CN.UTF-8", "无匹配："],
])("%s search works during a Run and restores the input draft", async (lang, none) => {
  const app = await start(["inspect live"], { rows: 40, env: { LANG: lang } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("private-live-needle");
    app.calls[0]!.delta("live visible needle");
    await app.waitFor(() => app.screen().some((line) => line.includes("visible needle")));
    app.stdin.write("saved draft");
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ saved draft")));
    app.stdin.write("\x0f/absent-value\r");
    await app.waitFor(() => app.screen().some((line) => line.includes(none)));
    app.stdin.write("nN");
    await app.flush();
    expect(app.calls.length).toBe(1);
    app.stdin.write("/private-live-needle\r");
    await app.waitFor(() => app.screen().some((line) => / · 1\/1 · /.test(line)));
    expect(app.screen().join("\n")).toContain("private-live-needle");
    app.stdin.write("\x0f");
    await app.waitFor(() => !app.screen().some((line) => / · 1\/1 · /.test(line)));
    expect(app.screen().join("\n")).toContain("❯ saved draft");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.calls.length).toBe(1);
  } finally {
    await app.cleanup();
  }
});

test("search keeps earlier messages in view while a running response grows", async () => {
  const app = await startWithClock(["original needle"], { rows: 24, env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 50 }, (_, index) => `stream-${index}`).join("\n"));
    await app.waitFor(() => app.screen().some((line) => line.includes("stream-49")));
    app.stdin.write("\x0f/needle\r");
    await app.waitFor(
      () =>
        app.screen().some((line) => / · 1\/1 · /.test(line)) &&
        app.screen().some((line) => line.includes("original needle")),
    );
    const earlier = app.screen().slice(0, 4);
    app.calls[0]!.delta("\nstream-50\nstream-51");
    await app.waitFor(() => app.screen().some((line) => / · 1\/1 · /.test(line)));
    expect(app.screen().slice(0, 4)).toEqual(earlier);
    expect(app.screen().join("\n")).not.toContain("stream-51");
    app.stdin.write("\x1b");
    await app.waitFor(() => !app.screen().some((line) => line.includes("Search transcript")));
    expect(app.screen().join("\n")).toContain("original needle");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x1b[1;5F");
    await app.waitFor(() => app.screen().some((line) => line.includes("stream-51")));
  } finally {
    await app.cleanup();
  }
});

test("clipped generic title matches can be revealed without searching result metadata", async () => {
  const app = await start(["--yolo", "inspect"], { rows: 40, env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("unknown_tool", { title: "x".repeat(500) + "TITLE_NEEDLE" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).not.toContain("TITLE_NEEDLE");
    app.stdin.write("\x0f/TITLE_NEEDLE\r");
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("Unknown_tool(") && line.includes("TITLE_NEEDLE")),
    );
    expect(
      app.screen().some((line) => line.includes("Unknown_tool(") && line.includes("TITLE_NEEDLE")),
    ).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test("split diff search navigates old and new occurrences in the same aligned row", async () => {
  const app = await start(["--yolo", "change"], {
    columns: 120,
    rows: 24,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "code.ts"), 'const value = "needle old";\n');
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", { path: "code.ts", content: 'const value = "needle new";\n' });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x0f/needle\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("1/2")));
    expect(
      app.screen().some((line) => line.includes("needle old") && line.includes("needle new")),
    ).toBe(true);
    app.stdin.write("n");
    await app.waitFor(() => app.screen().some((line) => line.includes("2/2")));
    app.stdin.write("N");
    await app.waitFor(() => app.screen().some((line) => line.includes("1/2")));
  } finally {
    await app.cleanup();
  }
});

test("Markdown search maps repeated visible text back to source rows beyond its window", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        Array.from({ length: 260 }, (_, index) =>
          index === 3
            ? "**MARK_NEEDLE** first\n"
            : index === 230
              ? "**MARK_NEEDLE** second\n"
              : `paragraph-${index}\n`,
        ).join("\n"),
        { headers: { "content-type": "text/markdown" } },
      ),
  });
  const app = await start(["--yolo", "inspect"], {
    rows: 24,
    env: { LANG: "en_US.UTF-8" },
    session: {
      webFetch: {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        allowAddresses: ["127.0.0.1"],
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("web_fetch", { url: `http://site.test:${server.port}/docs` });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x0f/MARK_NEEDLE\r");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("1/2")) &&
        app.screen().some((line) => line.includes("MARK_NEEDLE first")),
    );
    app.stdin.write("n");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("2/2")) &&
        app.screen().some((line) => line.includes("MARK_NEEDLE second")),
    );
    expect(app.screen().join("\n")).not.toContain("**MARK_NEEDLE**");
  } finally {
    await app.cleanup();
    server.stop(true);
  }
});

test("search includes the displayed context snapshot without scanning hidden metadata", async () => {
  const app = await start([], { env: { LANG: "en_US.UTF-8" } });
  try {
    app.stdin.write("/context\r");
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("Estimated usage by category")),
    );
    app.stdin.write("\x0f/Estimated usage by category\r");
    await app.waitFor(() => app.screen().some((line) => / · 1\/1 · /.test(line)));
    expect(app.screen().join("\n")).toContain("Estimated usage by category");
  } finally {
    await app.cleanup();
  }
});

test("search indexes the displayed background job tail", async () => {
  const app = await start(["--yolo", "inspect"], { rows: 24, env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    // Real child output exercises the retained background-job delivery contract.
    app.calls[0]!.tool("bash", {
      command:
        "printf '\\112\\117\\102\\137\\116\\105\\105\\104\\114\\105\\n'; while [ ! -e go ]; do sleep 0.01; done",
      description: "start worker",
      timeout: 10,
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().some((line) => line.includes("JOB_NEEDLE")),
    );
    app.stdin.write("\x0f/● job: bash-1 bash\r");
    await app.waitFor(() => app.screen().some((line) => / · 1\/1 · /.test(line)));
    expect(app.screen().join("\n")).toContain("JOB_NEEDLE");
  } finally {
    await Bun.write(join(app.root, "go"), "");
    await app.cleanup();
  }
});

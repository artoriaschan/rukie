import { expect, test } from "bun:test";
import { watch } from "node:fs";
import { join } from "node:path";
import { createSession, listSessions } from "@rukie/agent";
import { startWithClock } from "./helpers/clock-app";
import { start } from "./helpers/app";
import { testClock } from "./helpers/test-clock";

test.each(["zh", "en"] as const)(
  "exit prints a resumable command on the restored terminal in %s",
  async (locale) => {
    const app = await startWithClock([], { env: { LANG: locale } });
    try {
      await app.waitFor(() => app.stdin.isRaw);
      const [session] = await listSessions({ cwd: app.root, homeDir: app.root });
      expect(session).toBeDefined();
      app.stdin.write("\x04");
      await app.waitFor(() => !app.stdin.isRaw);
      expect(await app.exit).toBe(0);
      await app.flush();
      const command = `rukie --resume ${session!.id}`;
      expect(app.screen().join("\n")).toContain(command);
      expect(app.output().slice(app.output().lastIndexOf("\x1b[?1049l"))).toContain(
        `${locale === "zh" ? "继续此会话：" : "Resume this session:"}\r\n  ${command}\r\n`,
      );
      const resumed = await createSession({
        cwd: app.root,
        homeDir: app.root,
        model: app.model,
        models: app.models,
        resumeId: session!.id,
      });
      try {
        expect(resumed.id).toBe(session!.id);
      } finally {
        await resumed.close();
      }
    } finally {
      await app.cleanup();
    }
  },
);

test("signal exit preserves pending work and Resume continues it before a new prompt", async () => {
  const controller = new AbortController();
  const app = await startWithClock(["interrupted prompt"], { signal: controller.signal });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("partial reply");
    await app.waitFor(() => app.screen().join("\n").includes("partial reply"));
    const [session] = await listSessions({ cwd: app.root, homeDir: app.root });
    controller.abort();
    await app.waitFor(() => !app.stdin.isRaw);
    expect(await app.exit).toBe(0);
    await app.flush();
    expect(app.screen().join("\n")).toContain(`rukie --resume ${session!.id}`);
    const resumed = await createSession({
      cwd: app.root,
      homeDir: app.root,
      model: app.model,
      models: app.models,
      resumeId: session!.id,
    });
    try {
      await app.waitFor(() => app.calls.length === 2);
      expect(resumed.currentRequestId).toBeDefined();
      expect(JSON.stringify(app.calls[1]!.context.messages)).toContain("interrupted prompt");
      // Native resume archives the prior partial attempt before retrying the same submission.
      expect(
        resumed.messages.filter(
          (message) => message.role === "assistant" && message.stopReason === "aborted",
        ),
      ).toHaveLength(1);
      const requestId = resumed.currentRequestId!;
      const settled: string[] = [];
      const unsubscribe = resumed.subscribe((event) => {
        if (event.type === "request_settled") settled.push(event.requestId);
      });
      app.calls[1]!.reply("resumed pending answer");
      const resumedResult = await resumed.waitForRequest(requestId);
      expect(resumedResult.requestId).toBe(requestId);
      expect(settled).toEqual([requestId]);
      unsubscribe();
      const result = resumed.run("continue");
      await app.waitFor(() => app.calls.length === 3);
      expect(JSON.stringify(app.calls[2]!.context.messages)).toContain("resumed pending answer");
      app.calls[2]!.reply("continued");
      await result;
    } finally {
      await resumed.close();
    }
  } finally {
    await app.cleanup();
  }
});

test("signal exit prints the current Session after switching with /new", async () => {
  const controller = new AbortController();
  const app = await startWithClock(["original prompt"], { signal: controller.signal });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.reply("original reply");
    await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes("original reply"));
    const options = { cwd: app.root, homeDir: app.root };
    const [original] = await listSessions(options);
    app.stdin.write("/new\r");
    await app.waitFor(() => !app.screen().join("\n").includes("original prompt"));
    const sessions = await listSessions(options);
    const currentId = sessions.find((session) => session.id !== original!.id)?.id;
    expect(currentId).toBeDefined();
    controller.abort();
    await app.waitFor(() => !app.stdin.isRaw);
    expect(await app.exit).toBe(0);
    await app.flush();
    expect(app.screen().join("\n")).toContain(`rukie --resume ${currentId}`);
    expect(app.screen().join("\n")).not.toContain(`rukie --resume ${original!.id}`);
  } finally {
    await app.cleanup();
  }
});

test("normal TUI exit preserves a background child and reopening renders its snapshot before continued output", async () => {
  const app = await startWithClock(["--permission-mode", "full-access", "durable child parent"], {
    rows: 24,
    env: { LANG: "en" },
  });
  let replay: Awaited<ReturnType<typeof start>> | undefined;
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", {
      description: "Durable reader",
      prompt: "durable child pending",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 3);
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("durable child pending"),
      ),
    )!;
    const parent = app.calls.find((call, index) => index > 0 && call !== child)!;
    parent.reply("parent idle while reader works");
    await app.waitFor(
      () =>
        app.screen().join("\n").includes("parent idle while reader works") &&
        app.screen().join("\n").includes("background tasks: 1 subagents"),
    );
    child.delta("committed reader partial");
    const [saved] = await listSessions({ cwd: app.root, homeDir: app.root });
    if (!saved) throw new Error("Missing actual Session identity");
    app.stdin.write("\x04");
    await app.waitFor(() => !app.stdin.isRaw);
    expect(await app.exit).toBe(0);
    await app.flush();
    expect(app.stdin.isRaw).toBe(false);
    expect(app.output().slice(app.output().lastIndexOf("\x1b[?1049l"))).toContain(
      `rukie --resume ${saved.id}`,
    );
    replay = await start(["--resume", saved.id, "--permission-mode", "full-access"], {
      advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
      session: { cwd: app.root, homeDir: app.root },
      rows: 24,
      env: { LANG: "en" },
    });
    await replay.waitFor(
      () => replay!.calls.length === 1 && replay!.screen().join("\n").includes("Durable reader"),
    );
    expect(replay.allLines().join("\n")).toContain("parent idle while reader works");
    expect(
      replay.calls[0]!.context.messages.some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("durable child pending"),
      ),
    ).toBe(true);
    replay.stdin.write("\x01\r\x1b[C");
    await replay.waitFor(() => replay!.screen().join("\n").includes("committed reader partial"));
    replay.calls[0]!.delta("fresh resumed reader output");
    await replay.waitFor(() => replay!.screen().join("\n").includes("fresh resumed reader output"));
    expect(replay.screen()).toHaveLength(24);
    replay.resize(40, 12);
    await replay.waitFor(() => replay!.screen().length === 12);
    expect(replay.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    replay.calls[0]!.reply("final resumed reader");
    await replay.waitFor(() => replay!.calls.length === 2);
    replay.calls[1]!.reply("parent accepted resumed reader");
    await replay.waitFor(() => !replay!.isWorking());
  } finally {
    await replay?.cleanup();
    await app.cleanup();
  }
});

test("TUI close reissues a pending Question on Resume with fresh FIFO input ownership", async () => {
  const app = await startWithClock(["pending frontend question"], {
    columns: 40,
    rows: 12,
    env: { LANG: "en" },
  });
  let replay: Awaited<ReturnType<typeof start>> | undefined;
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", {
      questions: [
        {
          header: "Storage",
          question: "Which durable storage?",
          options: [
            { label: "SQLite", description: "Embedded" },
            { label: "Postgres", description: "Server" },
          ],
          multiSelect: false,
        },
      ],
    });
    await app.waitFor(() => app.screen().join("\n").includes("Which durable storage?"));
    const [saved] = await listSessions({ cwd: app.root, homeDir: app.root });
    if (!saved) throw new Error("Missing pending Question Session");
    await app.shutdown();
    expect(app.stdin.isRaw).toBe(false);
    app.stdin.write("\r");
    replay = await start(["--resume", saved.id], {
      advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
      session: { cwd: app.root, homeDir: app.root },
      columns: 40,
      rows: 12,
      env: { LANG: "en" },
    });
    await replay.waitFor(() => replay!.screen().join("\n").includes("Which durable storage?"));
    expect(replay.calls).toHaveLength(0);
    expect(replay.screen()).toHaveLength(12);
    expect(replay.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    replay.stdin.write("\x1b[B\r");
    await replay.waitFor(() => replay!.calls.length === 1);
    expect(
      replay.calls[0]!.context.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
      toolName: "ask_user_question",
      isError: false,
      content: [{ type: "text", text: '"Which durable storage?" → Postgres' }],
    });
    replay.calls[0]!.reply("fresh frontend reply accepted");
    await replay.waitFor(() =>
      replay!.allLines().join("\n").includes("fresh frontend reply accepted"),
    );
  } finally {
    await replay?.cleanup();
    await app.cleanup();
  }
});

test("host close during TUI SessionStart releases the actual Hook group before initialization returns", async () => {
  const controller = new AbortController();
  let watcher: ReturnType<typeof watch> | undefined;
  let pids: number[] = [];
  const app = await startWithClock([], {
    signal: controller.signal,
    session: {
      settings: {
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: "sh pending-start.sh" }] }] },
      },
    },
    prepare: async (root) => {
      await Bun.write(
        join(root, "pending-start.sh"),
        "sleep 30 &\nchild=$!\nprintf '%s %s\\n' $$ $child > startup.pid.tmp\nmv startup.pid.tmp startup.pid\nwait $child\n",
      );
      watcher = watch(root, (_event, filename) => {
        if (filename !== "startup.pid") return;
        void Bun.file(join(root, "startup.pid"))
          .text()
          .then((text) => {
            const value = text.trim().split(/\s+/u).map(Number);
            if (value.length === 2 && value.every((pid) => Number.isSafeInteger(pid) && pid > 0))
              pids = value;
          });
      });
    },
  });
  try {
    // Real filesystem completion publishes both live processes; frontend timer ticks do not start them.
    await app.waitFor(() => pids.length === 2);
    expect(app.calls).toHaveLength(0);
    controller.abort();
    await app.waitFor(() => !app.stdin.isRaw);
    expect(await app.exit).toBe(0);
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    const [saved] = await listSessions({ cwd: app.root, homeDir: app.root });
    if (!saved) throw new Error("Missing initialized Session metadata");
    const reopened = await createSession({
      cwd: app.root,
      homeDir: app.root,
      model: app.model,
      models: app.models,
      resumeId: saved.id,
    });
    try {
      expect(reopened.currentRequestId).toBeUndefined();
    } finally {
      await reopened.close();
    }
  } finally {
    watcher?.close();
    for (const pid of pids.toReversed()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Owned fixture already exited. */
      }
    }
    await app.cleanup();
  }
});

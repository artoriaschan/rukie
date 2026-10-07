import { expect, test } from "bun:test";
import { createSession, listSessions } from "@rukie/agent";
import { startWithClock } from "./helpers/clock-app";

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

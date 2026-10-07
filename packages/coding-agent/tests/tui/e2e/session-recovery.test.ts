import { expect, test } from "bun:test";
import { createSession, listSessions } from "@rukie/agent";
import {
  getCurrentSystemMessage,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
} from "@earendil-works/pi-ai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../helpers/app";
import { crashUnsafeEffect } from "../helpers/native-recovery";
import { crashedSubagents } from "../helpers/agent-fixtures";
import { fakeModel } from "../helpers/agent-fixtures";
import { controlledModel } from "../helpers/model";

for (const [lang, unknown] of [
  ["zh_CN.UTF-8", "结果未知"],
  ["en_US.UTF-8", "Outcome unknown"],
] as const)
  for (const [columns, rows] of [
    [40, 12],
    [80, 24],
  ] as const)
    test(`${lang} native child resume keeps uncertainty accessible at ${columns}×${rows} and accepts fresh input`, async () => {
      const argv: string[] = [];
      const fake = controlledModel();
      const original = fake.models.getProvider("faux")!;
      fake.models.setProvider({
        ...original,
        streamSimple(model, context, options) {
          const manual = context.messages.some(
            (message) =>
              message.role === "user" &&
              /verify first|"next"/.test(JSON.stringify(message.content)),
          );
          if (!manual) {
            const stream = createAssistantMessageEventStream();
            const message = fauxAssistantMessage("restored history reviewed");
            stream.push({ type: "done", reason: "stop", message });
            stream.end(message);
            return stream;
          }
          return original.streamSimple(model, context, options);
        },
      });
      const app = await start(argv, {
        columns,
        rows,
        env: { LANG: lang },
        session: { model: fake.model, models: fake.models },
        async prepare(root) {
          const crashed = await crashUnsafeEffect(root, true);
          argv.push("--resume", crashed.sessionId);
        },
      });
      try {
        await app.waitFor(() => app.screen().includes("❯") && !app.isWorking());
        expect(fake.calls).toHaveLength(0);
        app.resize(80, 24);
        app.stdin.write("\x01\r");
        await app.waitFor(() => app.screen().join("\n").includes("id "));
        app.stdin.write("\x1b[C\x1b[C");
        await app.waitFor(() => app.screen().join("\n").includes("uncertain-effect.txt"));
        const history = app.screen().join("\n");
        expect(history).toContain(unknown);
        expect(history).toMatch(/\? (?:Write|write|写入)/);
        expect(await Bun.file(join(app.root, "uncertain-effect.txt")).text()).toBe("saved effect");
        app.stdin.write("\x1b\x1b");
        await app.waitFor(() => app.screen().includes("❯"));
        app.resize(columns, rows);
        app.stdin.write("verify first\r");
        await app.waitFor(() => fake.calls.length === 1);
        fake.calls[0]!.reply("checked");
        await app.waitFor(() => !app.isWorking() && app.allLines().join("\n").includes("checked"));
        expect(app.screen()).toContain("❯");
        app.stdin.write("next\r");
        await app.waitFor(() => fake.calls.length === 2);
        fake.calls[1]!.finish();
        await app.waitFor(() => !app.isWorking());
        expect(app.stderr()).toBe("");
      } finally {
        await app.cleanup();
      }
    });

test("SIGTERM lets the actual TUI process suspend an active native child before reporting exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-close-"));
  const script = `
    import { main } from ${JSON.stringify(join(import.meta.dir, "../../../src/index.ts"))};
    import { controlledModel } from ${JSON.stringify(join(import.meta.dir, "../helpers/model.ts"))};
    import { createTerminal } from ${JSON.stringify(join(import.meta.dir, "../helpers/terminal.ts"))};
    import { getCurrentSystemMessage, createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
    import { createJsonlStore } from "@rukie/agent";
    const store = createJsonlStore({cwd:${JSON.stringify(root)},homeDir:${JSON.stringify(root)}});
    const saved = {...store,async open(...args) {const lease = await store.open(...args);process.stdout.write("SESSION " + lease.id + "\\n"); return lease;}};
    const terminal = createTerminal();
    const fake = controlledModel();
    const exit = main(["delegate"], { ...terminal, env: { LANG: "en" }, stderr: (text) => process.stderr.write(text), session: { cwd: ${JSON.stringify(root)}, homeDir: ${JSON.stringify(root)}, ...fake, store:saved } });
    await terminal.waitFor(() => fake.calls.length === 1);
    fake.calls[0].tool("subagent", { description: "Active child", prompt: "work" });
    await terminal.waitFor(() => fake.calls.length === 3);
    const parent = fake.calls.slice(1).find((call) => getCurrentSystemMessage(call.context.messages)?.toolsAdded?.some((tool) => tool.name === "subagent"));
    parent.finish();
    await terminal.waitFor(() => terminal.screen().join("\\n").includes("Active child"));
    process.stdout.write("READY\\n");
    const code = await exit;
    process.stdout.write("CLOSED\\n");
    terminal.dispose();
    process.exitCode = code;
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: join(import.meta.dir, "../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const errors = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  let output = "";
  try {
    while (!output.includes("READY\n")) {
      const part = await reader.read();
      if (part.done) throw new Error(`TUI did not start: ${await errors}`);
      output += new TextDecoder().decode(part.value);
    }
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      output += new TextDecoder().decode(part.value);
    }
    expect(output).toContain("CLOSED\n");
    const sessionId = output
      .split("\n")
      .find((line) => line.startsWith("SESSION "))
      ?.slice(8);
    if (!sessionId) throw new Error("Native TUI Session identity missing");
    const sessions = await listSessions({ cwd: root, homeDir: root });
    expect(sessions.map((session) => session.id)).toContain(sessionId);
    const restored = await createSession({
      cwd: root,
      homeDir: root,
      ...(await fakeModel([])),
      resumeId: sessionId,
    });
    expect(restored.toolState("subagents")).toMatchObject([
      { description: "Active child", active: true },
    ]);
    const saved = restored.toolState("subagents");
    if (!Array.isArray(saved)) throw new Error("Native child directory missing");
    expect(saved[0]?.latestRun?.outcome).toBeUndefined();
    expect(restored.checkpoints()).toHaveLength(1);
    await restored.close();
    expect(await errors).toBe("");
  } finally {
    child.kill();
    await child.exited;
    await rm(root, { recursive: true, force: true });
  }
});

for (const [lang, interrupted, completed] of [
  ["en_US.UTF-8", "Run aborted", "Run ended normally"],
  ["zh_CN.UTF-8", "Run 已中止", "Run 正常结束"],
])
  test(`${lang} native resume at 40×12 preserves aborted, failed and completed child facts, with accurate manual history`, async () => {
    const argv: string[] = [];
    let childId = "",
      completedId = "";
    const app = await start(argv, {
      columns: 40,
      rows: 12,
      env: { LANG: lang },
      async prepare(root) {
        const fixture = await crashedSubagents({ cwd: root, homeDir: root });
        const pending = await fixture.child("Pending", "aborted");
        childId = pending.metadata.id;
        const finished = await fixture.child("Finished", "completed");
        completedId = finished.metadata.id;
        await fixture.child("Failed", "error");
        await fixture.save();
        argv.push("--resume", fixture.parentId);
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      const output = app.allLines().join("\n");
      expect(output).toContain("durable failure");
      expect(output).not.toContain(`${completed}: Finished`);
      expect(app.calls).toHaveLength(0);
      expect(app.screen().join("\n")).not.toContain(
        lang!.startsWith("zh") ? "▾ 子代理" : "▾ Subagents",
      );
      app.stdin.write("\x01\r");
      await app.waitFor(() =>
        app
          .screen()
          .join("\n")
          .includes(`id ${childId.slice(0, 8)}`),
      );
      expect(app.screen().join("\n")).toContain(interrupted!);
      app.stdin.write("\x1b");
      app.resize(80, 24);
      await app.waitFor(() => app.screen().join("\n").includes("Finished"));
      app.stdin.write("\x1b[B\r");
      await app.waitFor(
        () =>
          app.screen().join("\n").includes("Finished") &&
          app
            .screen()
            .join("\n")
            .includes(`id ${completedId.slice(0, 8)}`),
      );
      expect(app.screen().join("\n")).toContain(completed!);
      expect(app.calls).toHaveLength(0);
      app.stdin.write("\x1b");
      await app.waitFor(
        () =>
          app.screen().join("\n").includes("Finished") && !app.screen().join("\n").includes("id "),
      );
      app.stdin.write("\x1b");
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("continue after review\r");
      await app.waitFor(() => app.calls.length === 1);
      expect(JSON.stringify(app.calls[0]!.context.messages)).toContain("Pending");
      app.calls[0]!.tool("send_message", { agent_id: childId, message: "TUI child continuation" });
      await app.waitFor(() => app.calls.length === 3);
      const childCall = app.calls
        .slice(1)
        .find(
          (call) =>
            !getCurrentSystemMessage(call.context.messages)?.toolsAdded?.some(
              (tool) => tool.name === "subagent",
            ),
        )!;
      expect(JSON.stringify(childCall.context.messages)).toContain("TUI child continuation");
      childCall.delta("continued existing child");
      childCall.finish();
      app.calls
        .slice(1)
        .find((call) => call !== childCall)!
        .finish();
      let answered = 3;
      for (;;) {
        await app.waitFor(() => app.calls.length > answered || !app.isWorking());
        if (app.calls.length <= answered) break;
        app.calls[answered++]!.finish();
      }
      app.stdin.write("\x01\r");
      await app.waitFor(() =>
        app
          .screen()
          .join("\n")
          .includes(`id ${childId.slice(0, 8)}`),
      );
      app.stdin.write("\x1b[C");
      await app.waitFor(() => app.screen().join("\n").includes("continued existing child"));
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  });

import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createJsonlStore, createSession } from "@rukie/agent";
import { createFauxCore, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../helpers/app";

for (const [lang, notice, unknown, guide] of [
  ["zh_CN.UTF-8", "恢复提示：1 个子 Run 需核对", "Run 结束原因未知", "用现有输入决定如何继续。"],
  [
    "en_US.UTF-8",
    "Resume: 1 child Runs need review",
    "Run outcome unknown",
    "Use your prompt to decide next steps.",
  ],
])
  for (const [columns, rows] of [
    [40, 12],
    [80, 24],
  ]) {
    test(`${lang} resume shows one child recovery notice at ${columns}×${rows} while preserving input and history access`, async () => {
      const argv: string[] = [];
      const app = await start(argv, {
        columns,
        rows,
        env: { LANG: lang },
        async prepare(root) {
          const store = createJsonlStore({ cwd: root, homeDir: root });
          const stored = await store.create({ cwd: root }, BACKGROUND_CONTEXT);
          const branch = await stored.createBranch("main", null, BACKGROUND_CONTEXT);
          await branch.appendCustomEntry(
            "tool-state/subagents",
            {
              version: 1,
              value: [{ id: "old-child", description: "Old reader", type: "general-purpose" }],
            },
            BACKGROUND_CONTEXT,
          );
          await stored.close(BACKGROUND_CONTEXT);
          argv.push("--resume", stored.metadata.id);
        },
      });
      try {
        await app.waitFor(() => app.screen().includes("❯"));
        expect(app.calls).toHaveLength(0);
        expect(app.allLines().filter((line) => line.includes(notice!))).toHaveLength(1);
        expect(app.allLines().join("\n")).toContain(unknown!);
        expect(app.allLines().join("\n")).toContain(guide!);
        expect(app.screen().join("\n")).not.toContain(
          lang === "zh_CN.UTF-8" ? "▾ 子代理" : "▾ Subagents",
        );
        app.stdin.write("verify first\r");
        await app.waitFor(() => app.calls.length === 1);
        expect(JSON.stringify(app.calls[0]!.context.messages)).toContain(
          "old-child (Old reader): unknown",
        );
        app.calls[0]!.delta("checked");
        app.calls[0]!.finish();
        await app.waitFor(() => app.allLines().join("\n").includes("checked") && !app.isWorking());
        expect(app.screen()).toContain("❯");
        app.resize(80, 24);
        await app.waitFor(() => app.allLines().some((line) => line.includes(notice!)));
        expect(app.allLines().filter((line) => line.includes(notice!))).toHaveLength(1);
        app.stdin.write("next\r");
        await app.waitFor(() => app.calls.length === 2);
        app.calls[1]!.finish();
        await app.waitFor(() => !app.isWorking());
        expect(app.screen()).toContain("❯");
        expect(app.stderr()).toBe("");
      } finally {
        await app.cleanup();
      }
    });
  }

test("SIGTERM lets the actual TUI process save an active child Run before reporting exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-close-"));
  const script = `
    import { main } from ${JSON.stringify(join(import.meta.dir, "../../../src/index.ts"))};
    import { controlledModel } from ${JSON.stringify(join(import.meta.dir, "../helpers/model.ts"))};
    import { createTerminal } from ${JSON.stringify(join(import.meta.dir, "../helpers/terminal.ts"))};
    import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
    const terminal = createTerminal();
    const fake = controlledModel();
    const exit = main(["delegate"], { ...terminal, env: { LANG: "en" }, stderr: (text) => process.stderr.write(text), session: { cwd: ${JSON.stringify(root)}, homeDir: ${JSON.stringify(root)}, ...fake } });
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
    const store = createJsonlStore({ cwd: root, homeDir: root });
    const parent = (await store.list({ cwd: root }, BACKGROUND_CONTEXT)).find(
      (item) => !item.parentSessionId,
    )!;
    const faux = createFauxCore({ api: "faux", provider: "faux" });
    const restored = await createSession({
      cwd: root,
      homeDir: root,
      model: faux.getModel(),
      streamFn: faux.streamSimple,
      resumeId: parent.id,
    });
    expect(restored.recovery.subagents).toMatchObject([
      { description: "Active child", outcome: "aborted" },
    ]);
    expect(restored.checkpoints()).toHaveLength(1);
    await restored.dispose();
    expect(await errors).toBe("");
  } finally {
    child.kill();
    await child.exited;
    await rm(root, { recursive: true, force: true });
  }
});

for (const [lang, interrupted, unconfirmed, completed] of [
  [
    "en_US.UTF-8",
    "Run interrupted",
    "Saved child Run could not be confirmed",
    "Run ended normally",
  ],
  ["zh_CN.UTF-8", "Run 已中断", "无法确认已保存的子 Run", "Run 正常结束"],
])
  test(`${lang} crash resume at 40×12 shows interruption and uncertainty without activity, with accurate manual history`, async () => {
    const argv: string[] = [];
    let childId = "",
      completedId = "";
    const app = await start(argv, {
      columns: 40,
      rows: 12,
      env: { LANG: lang },
      async prepare(root) {
        const store = createJsonlStore({ cwd: root, homeDir: root });
        const parent = await store.create({ cwd: root }, BACKGROUND_CONTEXT);
        const branch = await parent.createBranch("main", null, BACKGROUND_CONTEXT);
        const identities = [];
        for (const description of ["Pending", "Finished", "Torn"]) {
          const child = await store.create(
            { cwd: root, parentSessionId: parent.metadata.id },
            BACKGROUND_CONTEXT,
          );
          const childBranch = await child.createBranch("main", null, BACKGROUND_CONTEXT);
          const run = {
            id: `run-${description}`,
            sessionId: child.metadata.id,
            parentSessionId: parent.metadata.id,
            startedAt: 10,
          };
          await childBranch.appendCustomEntry(
            "tool-state/subagent-run",
            { version: 1, value: run },
            BACKGROUND_CONTEXT,
          );
          if (description === "Finished") {
            completedId = child.metadata.id;
            await childBranch.appendCustomEntry(
              "tool-state/subagent-run",
              { version: 1, value: { ...run, endedAt: 20, outcome: "completed" } },
              BACKGROUND_CONTEXT,
            );
          }
          if (description === "Pending") childId = child.metadata.id;
          identities.push({
            id: child.metadata.id,
            description,
            type: "general-purpose",
            latestRun: run,
          });
          await child.close(BACKGROUND_CONTEXT);
          if (description === "Torn") {
            const path = Reflect.get(child.metadata, "path");
            if (typeof path !== "string") throw new Error("Missing native path");
            const { appendFile } = await import("node:fs/promises");
            await appendFile(path, '{"torn":');
          }
        }
        await branch.appendCustomEntry(
          "tool-state/subagents",
          { version: 2, value: identities },
          BACKGROUND_CONTEXT,
        );
        await parent.close(BACKGROUND_CONTEXT);
        argv.push("--resume", parent.metadata.id);
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      const output = app.allLines().join("\n");
      expect(output).toContain(interrupted!);
      expect(output).toContain(unconfirmed!);
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
      expect(JSON.stringify(app.calls[0]!.context.messages)).toContain("Pending): interrupted");
      expect(JSON.stringify(app.calls[0]!.context.messages)).toContain("unable to confirm");
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
      expect(app.allLines().join("\n")).toContain("continued existing child");
      expect(
        app
          .allLines()
          .filter((line) =>
            line.includes(lang!.startsWith("zh") ? "恢复提示：2 个子 Run" : "Resume: 2 child Runs"),
          ),
      ).toHaveLength(1);
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  });

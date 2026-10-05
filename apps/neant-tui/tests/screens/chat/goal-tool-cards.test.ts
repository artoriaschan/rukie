import { afterEach, expect, test } from "bun:test";
import { createSession } from "@neant/agent";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { withAuxiliaryRequests } from "../../helpers/auxiliary-model";
import { start } from "../../helpers/app";

let app: Awaited<ReturnType<typeof start>>;
afterEach(async () => {
  if (app) await app.cleanup();
});

test("Goal tools show objective, phase, rounds and activation instead of JSON", async () => {
  app = await start([], { columns: 120, rows: 35, env: { LANG: "en_US.UTF-8" } });
  await app.waitFor(() => app.screen().includes("❯"));
  app.stdin.write("Work until release is verified\r");
  await app.waitFor(() => app.calls.length === 1);
  app.calls[0]!.tool("create_goal", { objective: "Release verification", max_goal_rounds: 2 });
  await app.waitFor(
    () => app.calls.length === 2 && app.screen().join("\n").includes("● active · 0/2 · armed"),
  );
  expect(app.screen().join("\n")).toContain("🎯 Release verification");
  expect(app.screen().join("\n")).toContain("● active · 0/2 · armed");
  expect(app.screen().join("\n")).not.toContain('"roundsStarted"');
  app.calls[1]!.tool("update_goal", { action: "blocked", blocked_reason: "Missing credential" });
  await app.waitFor(
    () => app.calls.length === 3 && app.screen().join("\n").includes("⛔ Missing credential"),
  );
  expect(app.screen().join("\n")).toContain("⛔ blocked · 0/2 · disarmed");
  expect(app.screen().join("\n")).toContain("⛔ Missing credential");
  expect(app.screen().join("\n")).not.toContain('"blockedReason"');
  app.calls[2]!.delta("Need the credential to continue");
  app.calls[2]!.finish();
  await app.waitFor(() => !app.isWorking());
});

test.each([
  ["en_US.UTF-8", "blocked_reason is required with action blocked."],
  ["zh_CN.UTF-8", "blocked 操作必须提供非空 blocked_reason。"],
])("Goal tool errors preserve the existing localized error card in %s", async (lang, message) => {
  app = await start([], { columns: 120, rows: 30, env: { LANG: lang } });
  await app.waitFor(() => app.screen().includes("❯"));
  app.stdin.write("Update goal\r");
  await app.waitFor(() => app.calls.length === 1);
  app.calls[0]!.tool("update_goal", { action: "blocked" });
  await app.waitFor(() => app.calls.length === 2 && app.screen().join("\n").includes(message));
  expect(app.screen().join("\n")).toContain(message);
  expect(app.screen().join("\n")).not.toContain("🎯");
  app.calls[1]!.finish();
  await app.waitFor(() => !app.isWorking());
});

test("resume replays Goal summaries and coded errors in the frontend locale", async () => {
  const argv: string[] = [];
  app = await start(argv, {
    columns: 120,
    rows: 35,
    env: { LANG: "zh_CN.UTF-8" },
    async prepare(root) {
      const faux = createFauxCore({ api: "faux", provider: "faux" });
      const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
        fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
      faux.setResponses([
        tool("create_goal", { objective: "Replay result", max_goal_rounds: 2 }),
        tool("update_goal", { action: "blocked" }),
        tool("update_goal", { action: "blocked", blocked_reason: "Credential unavailable" }),
        fauxAssistantMessage("Need credential"),
      ]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        permissionMode: "full-access",
        model: faux.getModel(),
        streamFn: withAuxiliaryRequests((model, context, options) =>
          faux.streamSimple(model, context, options),
        ),
      });
      await session.run("Work through release");
      await session.waitForIdle();
      argv.push("--resume", session.id);
      await session.dispose();
    },
  });
  await app.waitFor(() => app.screen().join("\n").includes("Credential unavailable"));
  const screen = app.screen().join("\n");
  expect(screen).toContain("🎯 Replay result");
  expect(screen).toContain("⛔ blocked · 0/2 · 已停用");
  expect(screen).toContain("blocked 操作必须提供非空 blocked_reason。");
  expect(screen).not.toContain('"roundsStarted"');
  expect(app.calls).toHaveLength(0);
});

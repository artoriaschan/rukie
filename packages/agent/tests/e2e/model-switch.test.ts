import { envApiKeyAuth } from "@earendil-works/pi-ai";
import {
  withAuxiliaryRequests,
  withModelAlias,
  withModelStream,
} from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, listModels, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const originalKey = process.env.RUKIE_SWITCH_TEST_KEY;
const sessions: Awaited<ReturnType<typeof createSession>>[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  if (originalKey === undefined) delete process.env.RUKIE_SWITCH_TEST_KEY;
  else process.env.RUKIE_SWITCH_TEST_KEY = originalKey;
  await dirs?.cleanup();
});
const settings = {
  model: "switch/first",
  providers: [
    {
      id: "switch",
      api: "openai-completions" as const,
      baseUrl: "http://localhost:1/v1",
      apiKeyEnv: "RUKIE_SWITCH_TEST_KEY",
      models: [{ id: "first" }, { id: "second", contextWindow: 128000 }],
    },
  ],
};

function switchModels(fake: ReturnType<typeof fakeModel>) {
  const models = withModelAlias(fake.models, "switch", ["first", "second"], {
    contextWindow: 128000,
  });
  const provider = models.getProviders().find((provider) => provider.id === "switch");
  if (!provider) throw new Error("Missing fixture switch provider");
  models.setProvider({
    ...provider,
    auth: { apiKey: envApiKeyAuth("switch API key", ["RUKIE_SWITCH_TEST_KEY"]) },
  });
  const model = models.getModel("switch", "first");
  if (!model) throw new Error("Missing fixture switch model");
  return { models, model };
}

test("changing a Session model affects the next request and survives resume without valid settings.model", async () => {
  dirs = await tempDirs();
  process.env.RUKIE_SWITCH_TEST_KEY = "test-key";
  const fake = fakeModel([
    fauxAssistantMessage("first reply"),
    fauxAssistantMessage("second reply"),
    fauxAssistantMessage("resumed reply"),
  ]);
  const requested: string[] = [];
  const stream = fake.models.getProviders()[0]!.streamSimple;
  fake.models = withModelStream(
    fake.models,
    withAuxiliaryRequests((model, context, options) => {
      requested.push(`${model.provider}/${model.id}`);
      return stream(model, context, options);
    }),
  );
  const session = await createSession({
    ...dirs,
    settings,
    ...switchModels(fake),
  });
  sessions.push(session);
  await session.run("first question");
  await session.setModel("switch/second");
  expect(session.model).toBe("switch/second");
  expect(session.toolState("model")).toBe("switch/second");
  await session.run("second question");
  await session.close();
  const resumed = await createSession({
    ...dirs,
    settings: { ...settings, model: "missing/model" },
    ...switchModels(fake),
    resumeId: session.id,
  });
  sessions.push(resumed);
  expect(resumed.model).toBe("switch/second");
  expect((await resumed.run("third question")).text).toBe("resumed reply");
  expect(requested).toEqual(["switch/first", "switch/second", "switch/second"]);
  await resumed.close();
});

test("available models include custom and built-in provider entries without requiring credentials", () => {
  delete process.env.RUKIE_SWITCH_TEST_KEY;
  const choices = listModels(settings);
  expect(choices).toContainEqual({ spec: "switch/first", name: "first", input: ["text"] });
  expect(choices).toContainEqual({ spec: "switch/second", name: "second", input: ["text"] });
  expect(choices.some((choice) => choice.spec.startsWith("anthropic/"))).toBe(true);
});

test("invalid and busy model changes preserve the current model and settings files", async () => {
  dirs = await tempDirs();
  process.env.RUKIE_SWITCH_TEST_KEY = "test-key";
  const settingsPath = `${dirs.homeDir}/.rukie/settings.json`;
  const original = JSON.stringify(settings);
  await Bun.write(settingsPath, original);
  const fake = fakeModel([fauxAssistantMessage("answer")]);
  const session = await createSession({
    ...dirs,
    settings,
    ...switchModels(fake),
  });
  sessions.push(session);
  await expect(session.setModel("switch/no-such-model")).rejects.toThrow("Unknown model");
  expect(session.model).toBe("switch/first");
  expect(session.toolState("model")).toBeUndefined();
  delete process.env.RUKIE_SWITCH_TEST_KEY;
  await expect(session.setModel("switch/second")).rejects.toThrow("No API key");
  process.env.RUKIE_SWITCH_TEST_KEY = "test-key";
  const run = session.run("question");
  await expect(session.setModel("switch/second")).rejects.toThrow("idle");
  await run;
  await session.setModel("switch/second");
  expect(await Bun.file(settingsPath).text()).toBe(original);
  await session.close();
  await expect(session.setModel("switch/first")).rejects.toThrow("closed");
});

test("new inherited children use the switched model while retained children keep their original model", async () => {
  dirs = await tempDirs();
  process.env.RUKIE_SWITCH_TEST_KEY = "test-key";
  const childModels: string[] = [];
  let childId = "";
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "old child",
        prompt: "inspect",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("old child reply"),
    fauxAssistantMessage("first finished"),
    async () =>
      fauxAssistantMessage(
        [
          fauxToolCall("send_message", { agent_id: childId, message: "continue old child" }),
          fauxToolCall("subagent", {
            description: "new child",
            prompt: "inspect",
            run_in_background: false,
          }),
        ],
        { stopReason: "toolUse" },
      ),
    fauxAssistantMessage("child reply"),
    fauxAssistantMessage("child reply"),
    fauxAssistantMessage("second finished"),
    fauxAssistantMessage("notification finished"),
  ]);
  const session = await createSession({
    ...dirs,
    settings,
    ...switchModels(fake),
  });
  sessions.push(session);
  const observe = (event: SessionEvent) => {
    if (event.type === "subagent_event" && event.event.type === "snapshot") {
      childId ||= event.agentId;
      childModels.push(event.event.model);
    }
  };
  await session.run("delegate old", { onEvent: observe });
  await session.setModel("switch/second");
  await session.run("delegate and continue", { onEvent: observe });
  expect(childModels).toEqual(["switch/first", "switch/first", "switch/second"]);
  await session.close();
});

test("manual compaction waits for model selection and summarizes through the selected model", async () => {
  dirs = await tempDirs();
  process.env.RUKIE_SWITCH_TEST_KEY = "test-key";
  await Bun.write(`${dirs.cwd}/context.txt`, "retained fact ".repeat(6000));
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("read", { path: "context.txt" }),
        fauxToolCall("read", { path: "context.txt" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("first reply"),
    fauxAssistantMessage("recent retained reply"),
    fauxAssistantMessage("Selected model summary."),
  ]);
  const requested: string[] = [];
  const primary = fake.models.getProviders()[0]!.streamSimple;
  fake.models = withModelStream(
    fake.models,
    withAuxiliaryRequests((model, context, options) => {
      requested.push(`${model.provider}/${model.id}`);
      return primary(model, context, options);
    }),
  );
  const session = await createSession({
    ...dirs,
    settings,
    ...switchModels(fake),
  });
  sessions.push(session);
  await session.run("first question");
  await session.run("recent retained task");
  const switching = session.setModel("switch/second");
  await expect(session.compact()).rejects.toThrow("switching models");
  await switching;
  await session.compact();
  expect(requested).toEqual(["switch/first", "switch/first", "switch/first", "switch/second"]);
  expect(
    session.messages.some(
      (message) => message.role === "session-notice" && message.notice.kind === "compaction",
    ),
  ).toBe(true);
  await session.close();
});

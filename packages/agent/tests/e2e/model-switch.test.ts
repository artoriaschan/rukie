import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, listModels, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const originalKey = process.env.NEANT_SWITCH_TEST_KEY;
afterEach(async () => {
  if (originalKey === undefined) delete process.env.NEANT_SWITCH_TEST_KEY;
  else process.env.NEANT_SWITCH_TEST_KEY = originalKey;
  await dirs?.cleanup();
});
const settings = {
  model: "switch/first",
  providers: [
    {
      id: "switch",
      api: "openai-completions" as const,
      baseUrl: "http://localhost:1/v1",
      apiKeyEnv: "NEANT_SWITCH_TEST_KEY",
      models: [{ id: "first" }, { id: "second", contextWindow: 32000 }],
    },
  ],
};

test("changing a Session model affects the next request and survives resume without valid settings.model", async () => {
  dirs = await tempDirs();
  process.env.NEANT_SWITCH_TEST_KEY = "test-key";
  const fake = fakeModel([
    fauxAssistantMessage("first reply"),
    fauxAssistantMessage("second reply"),
    fauxAssistantMessage("resumed reply"),
  ]);
  const requested: string[] = [];
  const stream = fake.streamFn;
  fake.streamFn = (model, context, options) => {
    requested.push(`${model.provider}/${model.id}`);
    return stream(model, context, options);
  };
  const session = await createSession({ ...dirs, settings, streamFn: fake.streamFn });
  await session.run("first question");
  await session.setModel("switch/second");
  expect(session.model).toBe("switch/second");
  expect(session.toolState("model")).toBe("switch/second");
  await session.run("second question");
  await session.dispose();
  const resumed = await createSession({
    ...dirs,
    settings: { ...settings, model: "missing/model" },
    streamFn: fake.streamFn,
    resumeId: session.id,
  });
  expect(resumed.model).toBe("switch/second");
  expect((await resumed.run("third question")).text).toBe("resumed reply");
  expect(requested).toEqual(["switch/first", "switch/second", "switch/second"]);
  await resumed.dispose();
});

test("available models include custom and built-in provider entries without requiring credentials", () => {
  delete process.env.NEANT_SWITCH_TEST_KEY;
  const choices = listModels(settings);
  expect(choices).toContainEqual({ spec: "switch/first", name: "first" });
  expect(choices).toContainEqual({ spec: "switch/second", name: "second" });
  expect(choices.some((choice) => choice.spec.startsWith("anthropic/"))).toBe(true);
});

test("invalid and busy model changes preserve the current model and settings files", async () => {
  dirs = await tempDirs();
  process.env.NEANT_SWITCH_TEST_KEY = "test-key";
  const settingsPath = `${dirs.homeDir}/.neant/settings.json`;
  const original = JSON.stringify(settings);
  await Bun.write(settingsPath, original);
  const fake = fakeModel([fauxAssistantMessage("answer")]);
  const session = await createSession({ ...dirs, settings, streamFn: fake.streamFn });
  await expect(session.setModel("switch/no-such-model")).rejects.toThrow("Unknown model");
  expect(session.model).toBe("switch/first");
  expect(session.toolState("model")).toBeUndefined();
  delete process.env.NEANT_SWITCH_TEST_KEY;
  await expect(session.setModel("switch/second")).rejects.toThrow("No API key");
  process.env.NEANT_SWITCH_TEST_KEY = "test-key";
  const run = session.run("question");
  await expect(session.setModel("switch/second")).rejects.toThrow("idle");
  await run;
  await session.setModel("switch/second");
  expect(await Bun.file(settingsPath).text()).toBe(original);
  await session.dispose();
  await expect(session.setModel("switch/first")).rejects.toThrow("disposed");
});

test("new inherited children use the switched model while retained children keep their original model", async () => {
  dirs = await tempDirs();
  process.env.NEANT_SWITCH_TEST_KEY = "test-key";
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
  const session = await createSession({ ...dirs, settings, streamFn: fake.streamFn });
  const observe = (event: SessionEvent) => {
    if (event.type === "subagent_event" && event.event.type === "session_start") {
      childId ||= event.agentId;
      childModels.push(event.event.model);
    }
  };
  await session.run("delegate old", { onEvent: observe });
  await session.setModel("switch/second");
  await session.run("delegate and continue", { onEvent: observe });
  expect(childModels).toEqual(["switch/first", "switch/first", "switch/second"]);
  await session.dispose();
});

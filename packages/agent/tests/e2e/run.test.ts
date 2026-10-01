import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("a run sends the prompt to the model and returns the final assistant text", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("hello back")]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });

  const result = await session.run("hello");

  expect(result.text).toBe("hello back");
  expect(fake.contexts).toHaveLength(1);
  expect(fake.contexts[0]!.messages.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "hello" }],
  });
});

test("a model error fails the run", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("", { stopReason: "error", errorMessage: "boom" })]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });

  await expect(session.run("hello")).rejects.toThrow("boom");
});

test("an already-aborted signal stops the run before the model is called", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("unused")]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });

  await expect(session.run("hello", { signal: AbortSignal.abort() })).rejects.toThrow();
  expect(fake.contexts).toHaveLength(0);
});

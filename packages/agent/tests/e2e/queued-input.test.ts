import { crashQueuedInputs } from "../helpers/native-recovery.ts";
import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { fakeModel } from "../helpers/fake-model.ts";
import { createSession } from "../../src/index.ts";
import { recordedNativeModel } from "../helpers/recorded-native-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("queued inputs keep their identity and each enters a separate user message in order", async () => {
  const dirs = await tempDirs();
  const fake = recordedNativeModel();
  const ctx = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  const session = await createSession({ ...dirs, ...fake });
  session.subscribe(() => fake.notify());
  try {
    const run = session.run("first");
    await fake.until(() => fake.calls.length === 1, ctx);
    const updates: string[][] = [];
    const stopUpdates = session.subscribe((event) => {
      if (event.type === "queued_inputs_update")
        updates.push(event.items.map((input) => input.prompt));
    });
    const [second, third] = await Promise.all([
      session.followUp("second"),
      session.followUp("third"),
    ]);
    expect(second).not.toBe(third);
    expect(updates.at(-1)).toEqual(["second", "third"]);
    stopUpdates();
    const visible: string[] = [];
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "snapshot")
        visible.push(...event.queuedInputs.map((input) => input.prompt));
    });
    unsubscribe();
    expect(visible).toEqual(["second", "third"]);
    expect(session.queuedInputs.map((input) => input.prompt)).toEqual(["second", "third"]);
    fake.calls[0]!.finish(fauxAssistantMessage("first reply"));
    await fake.until(() => fake.calls.length === 2, ctx);
    expect(
      fake.calls[1]!.context.messages.filter(
        (m) =>
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((p) => p.type === "text" && ["first", "second", "third"].includes(p.text)),
      ).map((m) => m.content),
    ).toEqual([[{ type: "text", text: "first" }], [{ type: "text", text: "second" }]]);
    fake.calls[1]!.finish(fauxAssistantMessage("second reply"));
    await fake.until(() => fake.calls.length === 3, ctx);
    fake.calls[2]!.finish(fauxAssistantMessage("third reply"));
    await run;
    await session.waitForRequest(third);
    expect(session.runSummaries()).toHaveLength(3);
    expect(session.runSummaries().map((summary) => summary.afterMessage)).toEqual(
      [...session.runSummaries()].map((summary) => summary.afterMessage).toSorted((a, b) => a - b),
    );
    expect(new Set(session.runSummaries().map((summary) => summary.afterMessage)).size).toBe(3);
    expect(session.queuedInputs).toEqual([]);
    expect(await session.withdraw(second)).toEqual({ status: "not_queued" });
  } finally {
    await session.abort();
    await session.close();
    await dirs.cleanup();
  }
});

const image = {
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=",
  mimeType: "image/png",
  name: "draft.png",
};

test("withdraw and abort return original queued text and attachments in admission order", async () => {
  const dirs = await tempDirs();
  const fake = recordedNativeModel();
  const ctx = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  const session = await createSession({ ...dirs, ...fake });
  session.subscribe(() => fake.notify());
  try {
    const run = session.run("first");
    await fake.until(() => fake.calls.length === 1, ctx);
    const withdrawn = await session.followUp("recover me", { images: [image] });
    expect(await session.withdraw(withdrawn)).toEqual({
      status: "withdrawn",
      input: { requestId: withdrawn, prompt: "recover me", images: [image] },
    });
    expect(await session.withdraw(withdrawn)).toEqual({ status: "not_queued" });
    const second = await session.followUp("second", { images: [image] });
    const third = await session.followUp("third");
    expect(await session.abort()).toEqual([
      { requestId: second, prompt: "second", images: [image] },
      { requestId: third, prompt: "third", images: [] },
    ]);
    await expect(run).rejects.toThrow("aborted");
    expect(session.queuedInputs).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  } finally {
    await session.abort();
    await session.close();
    await dirs.cleanup();
  }
});

test("a selected queued input can steer at the next tool boundary", async () => {
  const dirs = await tempDirs();
  const fake = recordedNativeModel();
  const ctx = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  const session = await createSession({ ...dirs, ...fake });
  session.subscribe(() => fake.notify());
  try {
    const run = session.run("first");
    await fake.until(() => fake.calls.length === 1, ctx);
    const selected = await session.followUp("steer now", { images: [image] });
    expect(await session.steerNow(selected)).toEqual({ status: "steered" });
    fake.calls[0]!.finish(
      fauxAssistantMessage(fauxToolCall("read", { path: "missing.txt" }), {
        stopReason: "toolUse",
      }),
    );
    await fake.until(() => fake.calls.length === 2, ctx);
    expect(JSON.stringify(fake.calls[1]!.context.messages)).toContain("steer now");
    expect(await session.steerNow(selected)).toEqual({ status: "not_queued" });
    fake.calls[1]!.finish(fauxAssistantMessage("steered"));
    await run;
    await session.waitForRequest(selected);
    expect(session.runSummaries()).toHaveLength(1);
  } finally {
    await session.abort();
    await session.close();
    await dirs.cleanup();
  }
});

test("crash recovery exposes acknowledged queued inputs and admits them in order", async () => {
  const dirs = await tempDirs();
  const accepted = await crashQueuedInputs(dirs.cwd, dirs.homeDir);
  const fake = recordedNativeModel();
  const ctx = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  const session = await createSession({ ...dirs, ...fake, resumeId: accepted.sessionId });
  session.subscribe(() => fake.notify());
  try {
    const snapshots: string[] = [];
    session.subscribe((event) => {
      if (event.type === "snapshot")
        snapshots.push(...event.queuedInputs.map((input) => input.prompt));
    });
    expect(snapshots).toEqual(["after crash one", "after crash two"]);
    expect(session.queuedInputs[0]?.images).toEqual([
      {
        data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        mimeType: "image/gif",
        name: "recovered.gif",
      },
    ]);
    await fake.until(() => fake.calls.length === 1, ctx);
    fake.calls[0]!.finish(fauxAssistantMessage("recovered current run"));
    await fake.until(() => fake.calls.length === 2, ctx);
    expect(JSON.stringify(fake.calls[1]!.context.messages)).toContain("after crash one");
    expect(JSON.stringify(fake.calls[1]!.context.messages)).not.toContain("after crash two");
    fake.calls[1]!.finish(fauxAssistantMessage("recovered first input"));
    await fake.until(() => fake.calls.length === 3, ctx);
    fake.calls[2]!.finish(fauxAssistantMessage("recovered second input"));
    await session.waitForRequest(accepted.requestId);
    await session.waitForIdle();
    expect(session.runSummaries()).toHaveLength(3);
    expect(session.queuedInputs).toEqual([]);
  } finally {
    await session.abort();
    await session.close();
    await dirs.cleanup();
  }
});

test("idle followUp publishes one result and persisted summary just like run", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("first reply"),
    fauxAssistantMessage("second reply"),
  ]);
  let session = await createSession({ ...dirs, ...fake });
  const results: string[] = [];
  session.subscribe((event) => {
    if (event.type === "result") results.push(event.text);
  });
  try {
    const first = await session.followUp("first");
    await session.waitForIdle();
    expect((await session.waitForRequest(first)).text).toBe("first reply");
    expect(results).toEqual(["first reply"]);
    expect(session.runSummaries()).toHaveLength(1);
    await session.run("second");
    expect(results).toHaveLength(2);
    expect(session.runSummaries()).toHaveLength(2);
    await session.close();
    session = await createSession({ ...dirs, ...fake, resumeId: session.id });
    expect(session.runSummaries()).toHaveLength(2);
    const snapshots: string[] = [];
    session.subscribe((event) => {
      if (event.type === "snapshot")
        snapshots.push(...event.messages.map((m) => JSON.stringify(m)));
    });
    expect(snapshots.join(" ")).toContain("first reply");
    expect(snapshots.join(" ")).toContain("second reply");
  } finally {
    await session.abort();
    await session.close();
    await dirs.cleanup();
  }
});

test("abort then close preserves a followUp terminal summary", async () => {
  const dirs = await tempDirs();
  const fake = recordedNativeModel();
  const ctx = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  let session = await createSession({ ...dirs, ...fake });
  session.subscribe(() => fake.notify());
  try {
    await session.followUp("abort this");
    await fake.until(() => fake.calls.length === 1, ctx);
    await session.abort();
    expect(session.runSummaries()).toHaveLength(1);
    await session.close();
    session = await createSession({ ...dirs, ...fake, resumeId: session.id });
    expect(session.runSummaries()).toHaveLength(1);
    expect(session.runSummaries()[0]?.success).toBe(false);
  } finally {
    await session.abort();
    await session.close();
    await dirs.cleanup();
  }
});

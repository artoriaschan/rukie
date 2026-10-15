import { expect, test, onTestFinished } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { fakeModel } from "../helpers/fake-model.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";
const image = { data: png, mimeType: "image/png", name: "original.png" };

async function fixture(
  replies: Parameters<typeof fakeModel>[0] = [fauxAssistantMessage("inspected")],
) {
  const dirs = await tempDirs();
  const sessions: Awaited<ReturnType<typeof createSession>>[] = [];
  let calls = 0;
  let respond = async () => Response.json({ decision: "block", reason: "review required" });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      calls += 1;
      return respond();
    },
  });
  const settings = {
    hooks: { UserPromptSubmit: [{ hooks: [{ type: "http" as const, url: server.url.href }] }] },
  };
  const fake = fakeModel(replies);
  async function open(resumeId?: string) {
    const session = await createSession({
      ...dirs,
      ...fake,
      settings,
      permissionMode: "full-access",
      ...(resumeId ? { resumeId } : {}),
    });
    sessions.push(session);
    return session;
  }
  onTestFinished(async () => {
    try {
      for (const session of sessions) await session.close();
    } finally {
      await server.stop(true);
      await dirs.cleanup();
    }
  });
  return {
    open,
    fake,
    calls: () => calls,
    respond: (handler: typeof respond) => {
      respond = handler;
    },
  };
}

test("resuming an unplaced image Goal repeats the human hook until it allows the original message", async () => {
  const f = await fixture();
  const session = await f.open();
  const created = await session.createGoal("", { images: [image], maxRounds: 1 });
  await session.waitForRequest(created.requestId);
  expect(session.goal).toMatchObject({ roundsStarted: 0, armed: false });
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(0);
  const blocked = await session.resumeGoal();
  await session.waitForRequest(blocked.requestId!);
  expect(f.calls()).toBe(2);
  expect(f.fake.contexts).toHaveLength(0);
  expect(session.goal).toMatchObject({ roundsStarted: 0, armed: false });
  f.respond(async () => Response.json({}));
  const allowed = await session.resumeGoal();
  await session.waitForRequest(allowed.requestId!);
  expect(f.calls()).toBe(3);
  const users = session.messages.filter((message) => message.role === "user");
  expect(users).toHaveLength(1);
  expect(users[0]).not.toHaveProperty("source");
  expect(JSON.stringify(users[0])).toContain(png);
  expect(JSON.stringify(users[0])).toContain("original.png");
  expect(JSON.stringify(f.fake.contexts[0])).toContain(png);
  expect(session.goal).toMatchObject({ roundsStarted: 1, armed: false });
  expect(session.checkpoints()).toHaveLength(1);
  expect(JSON.stringify(session.toolState("goal"))).not.toContain(png);
});

test.each(["pause", "abort"] as const)(
  "%s before first Goal placement preserves its human input across explicit resume",
  async (action) => {
    const replacing = action === "pause";
    const f = await fixture([
      ...(replacing
        ? [
            fauxAssistantMessage(fauxToolCall("update_goal", { action: "complete" }), {
              stopReason: "toolUse",
            }),
            fauxAssistantMessage("prior completed"),
          ]
        : []),
      fauxAssistantMessage("image inspected"),
    ]);
    let session = await f.open();
    f.respond(async () => Response.json({}));
    if (replacing) {
      const prior = await session.createGoal("prior complete Goal");
      await session.waitForRequest(prior.requestId);
    }
    const previousGoal = structuredClone(session.goal);
    const received = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    onTestFinished(() => release.resolve(Response.json({})));
    f.respond(async () => {
      received.resolve();
      return release.promise;
    });
    const accepted = await session.createGoal("", { images: [image], maxRounds: 1 });
    await received.promise;
    expect(session.goal).toMatchObject({ roundsStarted: 0 });
    if (action === "pause") await session.pauseGoal();
    else await session.abort();
    release.resolve(Response.json({}));
    await session.waitForRequest(accepted.requestId);
    expect(session.goal).toMatchObject({ roundsStarted: 0, armed: false });
    expect(f.fake.contexts).toHaveLength(replacing ? 2 : 0);
    if (action === "abort") {
      const id = session.id;
      await session.close();
      session = await f.open(id);
      await session.waitForIdle();
      expect(session.goal).toMatchObject({ roundsStarted: 0, armed: false });
    }
    f.respond(async () => Response.json({}));
    const resumed = await session.resumeGoal();
    await session.waitForRequest(resumed.requestId!);
    expect(f.calls()).toBe(replacing ? 3 : 2);
    const targets = session.messages.filter(
      (message) =>
        message.role === "user" &&
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image"),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toHaveProperty("source");
    expect(JSON.stringify(targets[0])).toContain(png);
    expect(JSON.stringify(targets[0])).toContain("original.png");
    expect(JSON.stringify(f.fake.contexts.at(-1))).toContain(png);
    expect(session.goal).toMatchObject({ roundsStarted: 1, armed: false });
    const checkpoint = session.checkpoints().at(-1)!;
    expect(checkpoint).toBeDefined();
    await session.rewind(checkpoint.promptEntryId, { conversation: true, code: false });
    expect(session.goal).toEqual(previousGoal);
  },
);

test("a rewound root Conversation resumes its inherited unplaced human Goal", async () => {
  const f = await fixture([
    fauxAssistantMessage("supplement answered"),
    fauxAssistantMessage("parent image inspected"),
    fauxAssistantMessage("rewound image inspected"),
  ]);
  const session = await f.open();
  const blocked = await session.createGoal("", { images: [image], maxRounds: 1 });
  await session.waitForRequest(blocked.requestId);
  f.respond(async () => Response.json({}));
  await session.run("supplement before accepting target");
  const checkpoint = session.checkpoints().at(-1)!;
  const placedLater = await session.resumeGoal();
  await session.waitForRequest(placedLater.requestId!);
  expect(session.goal).toMatchObject({ roundsStarted: 1, armed: false });
  await session.rewind(checkpoint.promptEntryId, { conversation: true, code: false });
  expect(session.goal).toMatchObject({ roundsStarted: 0, armed: false });
  const resumed = await session.resumeGoal();
  await session.waitForRequest(resumed.requestId!);
  await session.waitForIdle();
  expect(f.calls()).toBe(4);
  const users = session.messages.filter((message) => message.role === "user");
  expect(users).toHaveLength(1);
  expect(users[0]).not.toHaveProperty("source");
  expect(JSON.stringify(users[0])).toContain(png);
  expect(JSON.stringify(f.fake.contexts.at(-1))).toContain(png);
  expect(session.goal).toMatchObject({ roundsStarted: 1, armed: false });
  await session.rewind(session.checkpoints().at(-1)!.promptEntryId, {
    conversation: true,
    code: false,
  });
  expect(session.goal).toBeUndefined();
});

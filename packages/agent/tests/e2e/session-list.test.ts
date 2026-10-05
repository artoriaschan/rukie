import { expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { createJsonlStore, createSession, listSessions } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("lists the current project's named sessions by native modification time", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("First answer"),
    fauxAssistantMessage("Second answer"),
  ]);
  const first = await createSession({ ...dirs, ...fake });
  const second = await createSession({ ...dirs, ...fake });
  try {
    await first.rename("Older session");
    await first.run("First prompt");
    await second.rename("Latest session");
    await second.run("Second prompt");
    await first.dispose();
    await second.dispose();
    const sessions = await listSessions(dirs);
    expect(sessions.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(sessions[0]).toMatchObject({
      id: second.id,
      title: "Latest session",
      titleSource: "user",
      model: "faux/faux-1",
    });
    expect(Object.keys(sessions[0]!).sort()).toEqual([
      "id",
      "messageCount",
      "model",
      "title",
      "titleSource",
      "updatedAt",
    ]);
    expect(sessions[0]!.messageCount).toBe(6);
    expect(sessions[0]!.updatedAt).toBeGreaterThanOrEqual(sessions[1]!.updatedAt);
    expect(await listSessions({ ...dirs, cwd: dirs.homeDir })).toEqual([]);
  } finally {
    await first.dispose();
    await second.dispose();
    await dirs.cleanup();
  }
});

test("stored model selection wins over the last answer and delegated children are excluded", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Child",
        prompt: "inspect",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Child answer"),
    fauxAssistantMessage("Parent answer"),
  ]);
  const previous = process.env.NEANT_LIST_KEY;
  process.env.NEANT_LIST_KEY = "test-key";
  const settings = {
    providers: [
      {
        id: "list-test",
        api: "openai-completions" as const,
        baseUrl: "http://localhost:1",
        apiKeyEnv: "NEANT_LIST_KEY",
        models: [{ id: "selected" }],
      },
    ],
  };
  const session = await createSession({ ...dirs, ...fake, settings });
  try {
    await session.rename("Parent");
    await session.run("Delegate inspection");
    await session.setModel("list-test/selected");
    await session.dispose();
    expect(await listSessions(dirs)).toEqual([
      expect.objectContaining({
        id: session.id,
        title: "Parent",
        titleSource: "user",
        model: "list-test/selected",
      }),
    ]);
  } finally {
    await session.dispose();
    await dirs.cleanup();
    if (previous === undefined) delete process.env.NEANT_LIST_KEY;
    else process.env.NEANT_LIST_KEY = previous;
  }
});

test("a generic store uses entry timestamps without JSONL-only metadata", async () => {
  const dirs = await tempDirs();
  let now = 1000;
  const store = new MemorySessionRepo({ now: () => now });
  const fake = fakeModel([fauxAssistantMessage("Done")]);
  const first = await createSession({ ...dirs, ...fake, store });
  try {
    await first.rename("First");
    now = 2000;
    const latest = await createSession({ ...dirs, ...fake, store });
    await latest.run("Recent work");
    await latest.rename("Latest");
    await latest.dispose();
    const sessions = await listSessions({
      ...dirs,
      store,
      settings: { model: "configured/default" },
    });
    expect(sessions.map(({ id }) => id)).toEqual([latest.id, first.id]);
    expect(sessions[0]).toMatchObject({
      title: "Latest",
      updatedAt: 2000,
      messageCount: 6,
      model: "faux/faux-1",
    });
    expect(sessions[1]).toMatchObject({
      title: "First",
      updatedAt: 1000,
      messageCount: 0,
      model: "configured/default",
    });
  } finally {
    await first.dispose();
    await dirs.cleanup();
  }
});

test("session creation and listing use the same resolved spelling of a symlink cwd", async () => {
  const dirs = await tempDirs();
  const alias = join(dirs.homeDir, "linked-project");
  await symlink(dirs.cwd, alias);
  const session = await createSession({ ...dirs, cwd: alias, ...fakeModel([]) });
  try {
    await session.rename("Linked project");
    await session.dispose();
    expect((await listSessions({ ...dirs, cwd: join(alias, ".") })).map(({ id }) => id)).toEqual([
      session.id,
    ]);
    expect(await listSessions(dirs)).toEqual([]);
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test("legacy child metadata is omitted even when it has no parent session id", async () => {
  const dirs = await tempDirs();
  const session = await createSession({ ...dirs, ...fakeModel([]) });
  try {
    await session.rename("Legacy child");
    await session.dispose();
    const metadata = (await createJsonlStore(dirs).list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT))[0]!;
    if (!("path" in metadata) || typeof metadata.path !== "string")
      throw new Error("Expected native JSONL path");
    const lines = (await Bun.file(metadata.path).text()).split("\n");
    const header: Record<string, unknown> = JSON.parse(lines[0]!);
    lines[0] = JSON.stringify({ ...header, legacyParentSessionPath: "/old/parent.jsonl" });
    await Bun.write(metadata.path, lines.join("\n"));
    expect(await listSessions(dirs)).toEqual([]);
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test("listing borrows the live Session's native store while its Run and title generation are pending", async () => {
  const dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const primary = createAssistantMessageEventStream();
  const title = createAssistantMessageEventStream();
  const started = Promise.withResolvers<void>();
  const session = await createSession({
    ...dirs,
    store,
    model: fakeModel([]).model,
    streamFn: withAuxiliaryRequests(
      () => {
        started.resolve();
        return primary;
      },
      { titles: () => title },
    ),
  });
  let run: Promise<unknown> | undefined;
  try {
    run = session.run("Pending work");
    await started.promise;
    expect(await listSessions({ ...dirs, store })).toEqual([
      expect.objectContaining({
        id: session.id,
        title: "Pending work",
        titleSource: "prompt",
        model: "",
      }),
    ]);
    await session.rename("A fixed title");
    expect((await listSessions({ ...dirs, store }))[0]?.title).toBe("A fixed title");
  } finally {
    const response = fauxAssistantMessage("Done");
    primary.push({ type: "done", reason: "stop", message: response });
    primary.end(response);
    await run;
    await session.dispose();
    await dirs.cleanup();
  }
});

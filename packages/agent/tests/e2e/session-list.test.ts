import { expect, test, setSystemTime } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemoryStorage, createSession as createNativeSession } from "@earendil-works/pi-durable";
import { SessionMetadataDoc } from "../../src/store/index.ts";
import type { Session, SessionStore, SessionSummary } from "../../src/index.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { appendFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createJsonlStore, createSession, listSessions } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import {
  withAuxiliaryRequests,
  withModelStream,
  withModelAlias,
} from "../helpers/auxiliary-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

function memoryStore(): SessionStore & { close(): Promise<void> } {
  const storages = new Map<string, MemoryStorage>();
  const created = new Map<string, number>();
  const root = crypto.randomUUID();
  const retained = (storage: MemoryStorage) =>
    new Proxy(storage, {
      get(target, key) {
        if (key === "close") return async () => {};
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return {
    async close() {
      await Promise.all([...storages.values()].map((storage) => storage.close(BACKGROUND_CONTEXT)));
    },
    key: (id) => `${root}:${id}`,
    async open({ id = crypto.randomUUID() }) {
      const storage = storages.get(id) ?? new MemoryStorage();
      storages.set(id, storage);
      if (!created.has(id)) created.set(id, Date.now());
      // The test backend owns the retained in-memory store across host leases.
      return {
        id,
        storage: retained(storage),
        release: async () => {},
      };
    },
    async list(context) {
      const results: SessionSummary[] = [];
      for (const storage of storages.values()) {
        const native = createNativeSession(retained(storage));
        try {
          const metadata = await native.snapshot(SessionMetadataDoc, context);
          if (metadata) {
            const { id, title, titleSource, model, updatedAt, messageCount } = metadata;
            results.push({
              id,
              title,
              titleSource,
              model,
              createdAt: created.get(id)!,
              updatedAt,
              messageCount,
            });
          }
        } finally {
          await native.close(BACKGROUND_CONTEXT);
        }
      }
      return results.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    },
  };
}

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
    await first.close();
    await second.close();
    const sessions = await listSessions(dirs);
    expect(sessions.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(sessions[0]).toMatchObject({
      id: second.id,
      title: "Latest session",
      titleSource: "user",
      model: "faux/faux-1",
    });
    expect(Object.keys(sessions[0]!).sort()).toEqual([
      "createdAt",
      "id",
      "messageCount",
      "model",
      "title",
      "titleSource",
      "updatedAt",
    ]);
    expect(sessions[0]!.messageCount).toBe(5);
    expect(sessions[0]!.updatedAt).toBeGreaterThanOrEqual(sessions[1]!.updatedAt);
    expect(await listSessions({ ...dirs, cwd: dirs.homeDir })).toEqual([]);
  } finally {
    await first.close();
    await second.close();
    await dirs.cleanup();
  }
});

test("listing skips unreadable Session indexes, warns and keeps torn transcript bytes unchanged", async () => {
  const dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const session = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("Done")]),
    store,
  });
  const healthy = await createSession({ ...dirs, ...fakeModel([]), store });
  try {
    await healthy.rename("Healthy history");
    await healthy.close();
    await session.rename("Read-only history");
    await session.run("Keep this history");
    await session.close();
    const path = join(store.key(session.id), "main.jsonl");
    await appendFile(path, '{"torn":');
    const before = await Bun.file(path).bytes();
    const warnings: string[] = [];
    expect(
      await listSessions({ ...dirs, store, onWarning: (warning) => warnings.push(warning) }),
    ).toMatchObject([{ id: healthy.id, title: "Healthy history" }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(session.id);
    expect(warnings[0]).toContain("Session history requires repair");
    expect(await Bun.file(path).bytes()).toEqual(before);
  } finally {
    await session.close();
    await healthy.close();
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
  const previous = process.env.RUKIE_LIST_KEY;
  process.env.RUKIE_LIST_KEY = "test-key";
  const settings = {
    providers: [
      {
        id: "list-test",
        api: "openai-completions" as const,
        baseUrl: "http://localhost:1",
        apiKeyEnv: "RUKIE_LIST_KEY",
        models: [{ id: "selected" }],
      },
    ],
  };
  const session = await createSession({
    ...dirs,
    ...fake,
    settings,
    models: withModelAlias(fake.models, "list-test", ["selected"]),
  });
  try {
    await session.rename("Parent");
    await session.run("Delegate inspection");
    await session.setModelSelection({ model: "list-test/selected" });
    await session.close();
    expect(await listSessions(dirs)).toEqual([
      expect.objectContaining({
        id: session.id,
        title: "Parent",
        titleSource: "user",
        model: "list-test/selected",
      }),
    ]);
  } finally {
    await session.close();
    await dirs.cleanup();
    if (previous === undefined) delete process.env.RUKIE_LIST_KEY;
    else process.env.RUKIE_LIST_KEY = previous;
  }
});

test("a MemoryStorage backend lists committed Session metadata without JSONL paths", async () => {
  const dirs = await tempDirs();
  const before = Date.now();
  const store = memoryStore();
  const fake = fakeModel([fauxAssistantMessage("Done")]);
  const first = await createSession({ ...dirs, ...fake, store });
  let latest: Session | undefined;
  try {
    await first.rename("First");
    latest = await createSession({ ...dirs, ...fake, store });
    await latest.run("Recent work");
    await latest.rename("Latest");
    await latest.close();
    await first.close();
    const sessions = await listSessions({ ...dirs, store });
    expect(sessions.map(({ id }) => id)).toEqual([latest.id, first.id]);
    expect(sessions[0]).toMatchObject({
      title: "Latest",
      messageCount: 5,
      model: "faux/faux-1",
    });
    expect(sessions[0]!.updatedAt).toBeGreaterThanOrEqual(sessions[1]!.updatedAt);
    expect(sessions[1]!.updatedAt).toBeGreaterThanOrEqual(before);
    expect(sessions[0]!.updatedAt).toBeLessThanOrEqual(Date.now());
    expect(sessions[1]).toMatchObject({
      title: "First",
      messageCount: 0,
      model: "faux/faux-1",
    });
  } finally {
    await latest?.close();
    await first.close();
    await store.close();
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
    await session.close();
    expect((await listSessions({ ...dirs, cwd: join(alias, ".") })).map(({ id }) => id)).toEqual([
      session.id,
    ]);
    expect(await listSessions(dirs)).toEqual([]);
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("listing excludes the old session directory and rejects old ids without changing its bytes", async () => {
  const dirs = await tempDirs();
  const path = join(dirs.homeDir, ".rukie", "sessions", "old-id.jsonl");
  const legacy = '{"type":"session","id":"old-id","cwd":"old"}\n';
  try {
    await Bun.write(path, legacy);
    expect(await listSessions(dirs)).toEqual([]);
    await expect(
      createSession({ ...dirs, ...fakeModel([]), resumeId: "old-id" }),
    ).rejects.toMatchObject({ code: "session-not-found", params: { id: "old-id" } });
    expect(await Bun.file(path).text()).toBe(legacy);
  } finally {
    await dirs.cleanup();
  }
});

test("listing borrows the live Session's native store while its Run and title generation are pending", async () => {
  const dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const primary = createAssistantMessageEventStream();
  const title = createAssistantMessageEventStream();
  const started = Promise.withResolvers<void>();
  const fake = fakeModel([]);
  const session = await createSession({
    ...dirs,
    store,
    model: fake.model,
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(
        () => {
          started.resolve();
          return primary;
        },
        { titles: () => title },
      ),
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
        model: `${fake.model.provider}/${fake.model.id}`,
      }),
    ]);
    await session.rename("A fixed title");
    expect((await listSessions({ ...dirs, store }))[0]?.title).toBe("A fixed title");
  } finally {
    const response = fauxAssistantMessage("Done");
    primary.push({ type: "done", reason: "stop", message: response });
    primary.end(response);
    await run;
    const generatedTitle = fauxAssistantMessage("Generated title");
    title.push({ type: "done", reason: "stop", message: generatedTitle });
    title.end(generatedTitle);
    await session.close();
    await dirs.cleanup();
  }
});

test("creation time is the store directory birth time and remains distinct from updates", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([]);
  const first = await createSession({ ...dirs, ...fake });
  const second = await createSession({ ...dirs, ...fake });
  try {
    const initial = await listSessions(dirs);
    const older = initial.find((summary) => summary.id === first.id)!;
    const newer = initial.find((summary) => summary.id === second.id)!;
    expect(older.createdAt).toBeLessThan(newer.createdAt);
    setSystemTime(new Date(Math.max(older.updatedAt, newer.updatedAt) + 1000));
    await first.rename("updated oldest");
    const updated = await listSessions(dirs);
    expect(updated.map((summary) => summary.id)).toEqual([first.id, second.id]);
    expect(
      updated.toSorted((a, b) => b.createdAt - a.createdAt).map((summary) => summary.id),
    ).toEqual([second.id, first.id]);
    expect(updated.find((summary) => summary.id === first.id)?.createdAt).toBe(older.createdAt);
  } finally {
    setSystemTime();
    await first.close();
    await second.close();
    await dirs.cleanup();
  }
});

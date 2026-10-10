import { expect, test } from "bun:test";
import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import {
  BACKGROUND_CONTEXT,
  awaitWithContext,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { createJsonlStore, createSession, listSessions } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { crashUnsafeEffect } from "../helpers/native-recovery.ts";

// Independent processes hold kernel locks; this deadline bounds their actual transport and exit.
function bounded<T>(promise: Promise<T>) {
  return awaitWithContext(promise, withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT));
}

test("native JSONL rejects a live owner and crash contenders cannot replace the winning lease", async () => {
  const dirs = await tempDirs();
  const workers: ReturnType<typeof spawnWorker>[] = [];
  function spawnWorker(mode: string, id?: string) {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../helpers/session-store-worker.ts"),
        mode,
        dirs.cwd,
        dirs.homeDir,
        ...(id ? [id] : []),
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    const stderr = new Response(child.stderr).text();
    const reader = child.stdout.getReader();
    let buffer = "";
    const context = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
    const instance = {
      child,
      stderr,
      async line() {
        while (!buffer.includes("\n")) {
          const next = await awaitWithContext(reader.read(), context);
          if (next.done) throw new Error(`Worker exited before readiness: ${await stderr}`);
          buffer += new TextDecoder().decode(next.value);
        }
        const end = buffer.indexOf("\n");
        const value = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        return value;
      },
      async close() {
        child.stdin.write("CLOSE\n");
        await child.stdin.flush();
        child.stdin.end();
        expect(await bounded(child.exited)).toBe(0);
        expect(await stderr).toBe("");
      },
    };
    return instance;
  }
  function worker(mode: string, id?: string) {
    const instance = spawnWorker(mode, id);
    workers.push(instance);
    return instance;
  }
  try {
    const owner = worker("seed");
    const ready = await owner.line();
    expect(ready).toStartWith("READY ");
    const summary: unknown = JSON.parse(ready.slice(6));
    if (
      !summary ||
      typeof summary !== "object" ||
      !("id" in summary) ||
      typeof summary.id !== "string"
    )
      throw new Error("Invalid readiness identity");
    const id = summary.id;
    const store = createJsonlStore(dirs);
    const leaseFile = join(store.key(id), "host-lease.sqlite");
    const inode = (await stat(leaseFile)).ino;
    const fake = fakeModel([]);
    await expect(createSession({ ...dirs, ...fake, resumeId: id })).rejects.toMatchObject({
      code: "session-busy",
      params: { id },
      message: `Session already open: ${id}`,
    });
    expect(fake.contexts).toEqual([]);
    expect(await listSessions(dirs)).toMatchObject([
      { id, title: expect.any(String), model: "faux/faux-1" },
    ]);
    const main = await Bun.file(join(store.key(id), "main.jsonl")).text();
    const listing = worker("list");
    expect(JSON.parse(await listing.line())).toMatchObject([{ id }]);
    expect(await bounded(listing.child.exited)).toBe(0);
    expect(await listing.stderr).toBe("");
    expect(await Bun.file(join(store.key(id), "main.jsonl")).text()).toBe(main);

    owner.child.kill("SIGKILL");
    await bounded(owner.child.exited);
    const contenders = [worker("contend", id), worker("contend", id)];
    expect(await Promise.all(contenders.map((item) => item.line()))).toEqual(["WAIT", "WAIT"]);
    for (const item of contenders) item.child.stdin.write("GO\n");
    await Promise.all(contenders.map((item) => item.child.stdin.flush()));
    const replies = await Promise.all(contenders.map((item) => item.line()));
    expect(replies.filter((reply) => reply.startsWith("READY "))).toHaveLength(1);
    expect(
      replies.filter((reply) => reply.startsWith("REJECT Session already open:")),
    ).toHaveLength(1);
    const winnerIndex = replies.findIndex((reply) => reply.startsWith("READY "));
    const winner = contenders[winnerIndex]!;
    expect(JSON.parse(replies[winnerIndex]!.slice(6))).toMatchObject({
      id,
      modelCalls: 0,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", content: [{ type: "text", text: "lease-seed" }] }),
      ]),
    });
    expect((await stat(leaseFile)).ino).toBe(inode);
    const third = worker("open", id);
    expect(await third.line()).toStartWith("REJECT Session already open:");
    expect(await bounded(third.child.exited)).toBe(0);
    await winner.close();
    const final = worker("open", id);
    expect(await final.line()).toStartWith("READY ");
    expect((await stat(leaseFile)).ino).toBe(inode);
    await final.close();
  } finally {
    for (const item of workers) {
      item.child.kill();
      await bounded(item.child.exited);
    }
    await dirs.cleanup();
  }
}, 10000);

test("cold listing of unfinished native child work does not recover tasks or modify any storage file", async () => {
  const dirs = await tempDirs();
  try {
    const { sessionId, childId } = await crashUnsafeEffect(dirs.cwd, true);
    expect(childId).toBeString();
    const options = { cwd: dirs.cwd, homeDir: dirs.cwd };
    const directory = createJsonlStore(options).key(sessionId);
    async function bytes() {
      const paths = (await readdir(directory, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .sort();
      return Promise.all(
        paths.map(async (path) => ({ path, bytes: await Bun.file(path).bytes() })),
      );
    }
    const before = await bytes();
    expect(before.some(({ path }) => path.endsWith("main.jsonl"))).toBe(true);
    expect(before.filter(({ path }) => path.endsWith(".jsonl")).length).toBeGreaterThan(1);
    const listing = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../helpers/session-store-worker.ts"),
        "list",
        options.cwd,
        options.homeDir,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const context = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
    try {
      const output = await awaitWithContext(new Response(listing.stdout).text(), context);
      expect(JSON.parse(output)).toMatchObject([{ id: sessionId, title: "Native crash fixture" }]);
      expect(await awaitWithContext(listing.exited, context)).toBe(0);
      expect(await new Response(listing.stderr).text()).toBe("");
    } finally {
      listing.kill();
      await awaitWithContext(listing.exited, context);
    }
    expect(await listSessions(options)).toMatchObject([{ id: sessionId }]);
    expect(await bytes()).toEqual(before);
    expect(await Bun.file(join(dirs.cwd, "uncertain-effect.txt")).text()).toBe("saved effect");
  } finally {
    await dirs.cleanup();
  }
}, 10000);

test("same-process duplicate Session open reports its busy identity and releases it on close", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([]);
  const owner = await createSession({ ...dirs, ...fake });
  try {
    await expect(createSession({ ...dirs, ...fake, resumeId: owner.id })).rejects.toMatchObject({
      code: "session-busy",
      params: { id: owner.id },
    });
    expect(fake.contexts).toEqual([]);
    await owner.close();
    const reopened = await createSession({ ...dirs, ...fake, resumeId: owner.id });
    await reopened.close();
  } finally {
    await owner.close();
    await dirs.cleanup();
  }
});

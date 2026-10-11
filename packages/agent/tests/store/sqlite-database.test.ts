import { expect, test } from "bun:test";
import type { SqliteExecutor } from "@earendil-works/pi-durable/storage/sqlite";
import { openBunSqliteDatabase } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { join } from "node:path";

test("Bun SQLite commits serialize unrelated reads and close, rolls back failures and expires transaction handles", async () => {
  const db = await openBunSqliteDatabase(":memory:");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let escaped: SqliteExecutor | undefined;
  try {
    await db.exec("CREATE TABLE facts (value TEXT NOT NULL)");
    const commit = db.transaction(async (tx) => {
      escaped = tx;
      await tx.run("INSERT INTO facts VALUES (?)", "committed");
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const read = db.all("SELECT value FROM facts");
    release.resolve();
    await commit;
    expect(await read).toEqual([{ value: "committed" }]);
    await expect(escaped!.all("SELECT value FROM facts")).rejects.toThrow("no longer active");
    const failure = new Error("caller failure");
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO facts VALUES (?)", "rolled back");
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await db.all("SELECT value FROM facts")).toEqual([{ value: "committed" }]);
    const pending = db.transaction(async (tx) => {
      await tx.run("INSERT INTO facts VALUES (?)", "before close");
    });
    const close = db.close();
    await pending;
    await close;
    await expect(db.all("SELECT value FROM facts")).rejects.toThrow("closed");
  } finally {
    release.resolve();
    await db.close();
  }
});

test("owned file databases use WAL and FULL and read-only connections cannot write or create files", async () => {
  const dirs = await tempDirs();
  const path = join(dirs.cwd, "database.sqlite");
  const db = await openBunSqliteDatabase(path);
  try {
    expect(await db.get("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
    expect(await db.get("PRAGMA synchronous")).toEqual({ synchronous: 2 });
    await db.exec("CREATE TABLE facts (value TEXT NOT NULL)");
    await db.run("INSERT INTO facts VALUES (?)", "committed");
    const reader = await openBunSqliteDatabase(path, { readonly: true });
    try {
      await db.run("INSERT INTO facts VALUES (?)", "later");
      expect(await reader.all("SELECT value FROM facts")).toEqual([{ value: "committed" }]);
      await expect(reader.run("INSERT INTO facts VALUES (?)", "forbidden")).rejects.toThrow();
    } finally {
      await reader.close();
    }
    await expect(
      openBunSqliteDatabase(join(dirs.cwd, "missing.sqlite"), { readonly: true }),
    ).rejects.toThrow();
    expect(await Bun.file(join(dirs.cwd, "missing.sqlite")).exists()).toBe(false);
  } finally {
    await db.close();
    await dirs.cleanup();
  }
});

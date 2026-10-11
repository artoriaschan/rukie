import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteValue,
} from "@earendil-works/pi-durable/storage/sqlite";

/** One owned Bun connection. Transactions retain the queue until commit/rollback; escaped handles expire. */
export async function openBunSqliteDatabase(
  path: string,
  options: { readonly?: boolean } = {},
): Promise<SqliteDatabase> {
  if (!options.readonly && path !== ":memory:") await mkdir(dirname(path), { recursive: true });
  const database = new Database(path, options.readonly ? { readonly: true } : { create: true });
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  const queue = <T>(operation: () => T | Promise<T>): Promise<T> => {
    const result = tail.then(() => {
      if (closed) throw new Error("SQLite database is closed");
      return operation();
    });
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const executor = (active: () => boolean): SqliteExecutor => {
    const run = async <T>(operation: () => T): Promise<T> => {
      if (!active()) throw new Error("SQLite transaction handle is no longer active");
      return operation();
    };
    return {
      exec: (sql) =>
        run(() => {
          database.exec(sql);
        }),
      run: (sql, ...params) =>
        run(() => {
          database.query(sql).run(...params);
        }),
      get: <T extends object>(sql: string, ...params: SqliteValue[]) =>
        run(() => database.query<T, SqliteValue[]>(sql).get(...params) ?? undefined),
      all: <T extends object>(sql: string, ...params: SqliteValue[]) =>
        run(() => database.query<T, SqliteValue[]>(sql).all(...params)),
    };
  };
  const direct = executor(() => !closed);
  const adapter: SqliteDatabase = {
    exec: (sql) => queue(() => direct.exec(sql)),
    run: (sql, ...params) => queue(() => direct.run(sql, ...params)),
    get: (sql, ...params) => queue(() => direct.get(sql, ...params)),
    all: (sql, ...params) => queue(() => direct.all(sql, ...params)),
    transaction: (callback) =>
      queue(async () => {
        // Read-only observers hold one outer read transaction for their entire lifetime.
        if (!options.readonly) database.exec("BEGIN IMMEDIATE");
        let active = true;
        try {
          const result = await callback(executor(() => active));
          active = false;
          if (!options.readonly) database.exec("COMMIT");
          return result;
        } catch (error) {
          active = false;
          if (!options.readonly) {
            try {
              database.exec("ROLLBACK");
            } catch (rollbackError) {
              throw new AggregateError(
                [error, rollbackError],
                "SQLite transaction failed and rollback failed",
              );
            }
          }
          throw error;
        }
      }),
    close() {
      const result = tail.then(() => {
        if (closed) return;
        closed = true;
        database.close();
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  try {
    if (options.readonly) {
      await adapter.exec("BEGIN");
      // Establish the WAL read frame now, before returning to a callback with asynchronous reads.
      await adapter.get("SELECT count(*) FROM sqlite_schema");
    } else {
      await adapter.exec(
        "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
      );
    }
    return adapter;
  } catch (error) {
    await adapter.close();
    throw error;
  }
}

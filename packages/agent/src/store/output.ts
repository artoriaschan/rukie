import type { SqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite";
import type { JobOutput, ToolOutputRef } from "@rukie/shared";

/** Output shares its root Harness connection and transaction queue. It never closes that connection. */
export async function createSqliteOutputs(db: SqliteDatabase) {
  await db.exec(`CREATE TABLE IF NOT EXISTS rukie_output_chunks (
    output_id TEXT NOT NULL, byte_offset INTEGER NOT NULL, stream TEXT NOT NULL,
    bytes BLOB NOT NULL, PRIMARY KEY(output_id, byte_offset)
  )`);
  return {
    writer(ref: ToolOutputRef) {
      let offset = 0;
      let failure: unknown;
      let tail = Promise.resolve();
      return {
        ref,
        append(stream: "stdout" | "stderr", value: string | Uint8Array) {
          const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
          if (!bytes.length) return;
          const from = offset;
          offset += bytes.length;
          tail = tail.then(async () => {
            if (failure) return;
            try {
              await db.transaction(async (tx) => {
                for (let start = 0; start < bytes.length; start += 65536)
                  await tx.run(
                    "INSERT INTO rukie_output_chunks VALUES (?, ?, ?, ?)",
                    ref.id,
                    from + start,
                    stream,
                    bytes.subarray(start, start + 65536),
                  );
              });
            } catch (error) {
              failure = error;
            }
          });
        },
        async flush() {
          await tail;
          if (failure) throw failure;
        },
      };
    },
    read: (ref: ToolOutputRef, from = 0, maxBytes = 256 * 1024) =>
      readSqliteOutput(db, ref, from, maxBytes),
  };
}
export type SqliteOutputs = Awaited<ReturnType<typeof createSqliteOutputs>>;

/** Absolute byte cursors cover stdout/stderr together. Only committed chunks are visible. */
export async function readSqliteOutput(
  db: SqliteDatabase,
  ref: ToolOutputRef,
  from: number,
  maxBytes: number,
): Promise<JobOutput> {
  if (
    !ref.id ||
    !Number.isSafeInteger(from) ||
    from < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 4 * 1024 * 1024
  )
    throw new Error("Invalid tool output cursor or limit");
  const rows = await db.all<{ byte_offset: number; stream: string; bytes: Uint8Array }>(
    "SELECT byte_offset, stream, bytes FROM rukie_output_chunks WHERE output_id = ? AND byte_offset + length(bytes) > ? AND byte_offset < ? ORDER BY byte_offset",
    ref.id,
    from,
    from + maxBytes + 4,
  );
  const joined = Buffer.concat(rows.map((row) => Buffer.from(row.bytes)));
  const base = rows[0]?.byte_offset ?? from;
  let boundary = Math.min(joined.length, from + maxBytes - base);
  while (boundary > from - base && boundary < joined.length && (joined[boundary]! & 0xc0) === 0x80)
    boundary--;
  // A page smaller than one character must still advance. Bound overshoot to one UTF-8 character.
  if (boundary <= from - base) {
    boundary = Math.min(joined.length, from + maxBytes - base);
    while (boundary < joined.length && (joined[boundary]! & 0xc0) === 0x80) boundary++;
  }
  const endOffset = base + boundary;
  const streams = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
  let nextOffset = from;
  for (const row of rows) {
    const bytes = Buffer.from(row.bytes);
    let start = Math.max(0, from - row.byte_offset);
    while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80 && row.byte_offset <= from)
      start++;
    const end = Math.min(bytes.length, endOffset - row.byte_offset);
    if (end <= start) continue;
    if (row.stream !== "stdout" && row.stream !== "stderr")
      throw new Error("Invalid output stream");
    streams[row.stream].push(bytes.subarray(start, end));
    nextOffset = row.byte_offset + end;
  }
  // Decode each stream after joining database chunks, preserving characters split by persistence blocks.
  return {
    stdout: Buffer.concat(streams.stdout).toString("utf8"),
    stderr: Buffer.concat(streams.stderr).toString("utf8"),
    nextOffset,
    dropped: false,
  };
}

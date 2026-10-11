import type { Storage } from "@earendil-works/pi-durable";
import type { SqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const prefix = "rukie-attachment:";

/** Resolve only application-relative references; symlinks cannot redirect bytes outside the root. */
async function externalFilePath(root: string, reference: string): Promise<string> {
  if (!/^(attachments|file-history)\/[A-Za-z0-9_-]+\/[a-f0-9]{64}$/.test(reference))
    throw new Error("Invalid application file reference");
  const path = resolve(root, reference);
  const canonicalRoot = await realpath(root);
  if (!(await realpath(dirname(path))).startsWith(canonicalRoot + "/"))
    throw new Error("Application file reference escapes its data root");
  return path;
}

/** Read a bounded application-owned file without following a substituted file symlink. */
export async function readExternalFile(root: string, reference: string) {
  const file = await open(
    await externalFilePath(root, reference),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    return await file.readFile();
  } finally {
    await file.close();
  }
}

/** Bytes precede the native commit; failed commits leave reclaimable orphan files. */
export async function writeExternalFile(root: string, reference: string, bytes: Uint8Array) {
  await mkdir(dirname(join(root, reference)), { recursive: true });
  const path = await externalFilePath(root, reference);
  const temporary = path + "." + crypto.randomUUID();
  try {
    const file = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function mapImages(
  value: unknown,
  root: string,
  id: string,
  writing: boolean,
): Promise<unknown> {
  if (Array.isArray(value))
    return Promise.all(value.map((item) => mapImages(item, root, id, writing)));
  if (value === null || typeof value !== "object") return value;
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (
    record.type === "image" &&
    typeof record.data === "string" &&
    typeof record.mimeType === "string"
  ) {
    if (writing) {
      const bytes = Buffer.from(record.data, "base64");
      const reference = `attachments/${id}/${createHash("sha256").update(bytes).digest("hex")}`;
      await writeExternalFile(root, reference, bytes);
      return { ...record, data: prefix + reference };
    }
    if (!record.data.startsWith(prefix))
      throw new Error("Invalid persisted desktop image reference");
    const reference = record.data.slice(prefix.length);
    const bytes = await readExternalFile(root, reference);
    if (!reference.endsWith(createHash("sha256").update(bytes).digest("hex")))
      throw new Error("Application attachment integrity failure");
    return { ...record, data: bytes.toString("base64") };
  }
  return Object.fromEntries(
    await Promise.all(
      Object.entries(record).map(async ([key, item]) => [
        key,
        await mapImages(item, root, id, writing),
      ]),
    ),
  );
}

/** Native types and message blocks remain unchanged at the Storage boundary. */
export function withExternalImages(storage: Storage, root: string, id: string): Storage {
  return new Proxy(storage, {
    get(target, key) {
      const member = Reflect.get(target, key);
      if (typeof member !== "function") return member;
      if (key === "commit")
        return async (...args: Parameters<Storage["commit"]>) => {
          // Mapping changes only image data strings; branded IDs and every native record field are preserved.
          const writes = (await mapImages(args[0], root, id, true)) as Parameters<
            Storage["commit"]
          >[0];
          return target.commit(writes, args[1]);
        };
      if (key === "close" || key === "mintId") return member.bind(target);
      return async (...args: unknown[]) =>
        mapImages(await member.apply(target, args), root, id, false);
    },
  });
}

/** Called only by the Session execution lease, with all native work drained. Keeps every historical branch/revision. */
export async function cleanupExternalFiles(database: SqliteDatabase, root: string, id: string) {
  const references = new Set<string>();
  const collect = (value: unknown) => {
    if (typeof value === "string")
      references.add(value.startsWith(prefix) ? value.slice(prefix.length) : value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
  };
  // All native record/revision tables, including inactive Conversations and retired documents.
  for (const table of [
    "conversations",
    "entries",
    "tasks",
    "submissions",
    "documents",
    "document_revisions",
  ]) {
    const column = table === "document_revisions" ? "content" : "record";
    for (const row of await database.all<{ value: string }>(
      `SELECT ${column} AS value FROM ${table}`,
    ))
      collect(JSON.parse(row.value));
  }
  for (const kind of ["attachments", "file-history"]) {
    const directory = join(root, kind, id);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const canonicalRoot = await realpath(root);
    if (!(await realpath(directory)).startsWith(canonicalRoot + "/"))
      throw new Error("Application cleanup escapes its data root");
    for (const entry of entries)
      if (entry.isFile() && !references.has(`${kind}/${id}/${entry.name}`))
        await rm(join(directory, entry.name), { force: true });
  }
}

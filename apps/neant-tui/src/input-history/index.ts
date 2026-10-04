import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const LIMIT = 200;

async function load(file: string): Promise<string[]> {
  try {
    const entries: string[] = [];
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      try {
        const text: unknown = JSON.parse(line);
        if (typeof text === "string" && text.trim()) entries.push(text);
      } catch {
        // A malformed line does not hide the remaining history.
      }
    }
    return entries.slice(-LIMIT);
  } catch {
    return [];
  }
}

function append(entries: string[], text: string) {
  if (entries.at(-1) === text) return;
  entries.push(text);
  if (entries.length > LIMIT) entries.shift();
}

/** Project-scoped TUI input memory, independent of model context and session replay. */
export async function createInputHistory(cwd: string, homeDir = homedir()) {
  const project = resolve(cwd);
  const key = createHash("sha256")
    .update(process.platform === "win32" ? project.toLowerCase() : project)
    .digest("hex");
  const directory = join(homeDir, ".neant/input-history");
  const file = join(directory, `${key}.jsonl`);
  const lock = `${file}.lock`;
  const entries = await load(file);
  let pending = Promise.resolve();

  async function persist(text: string) {
    // Atomic replacement under a project lock keeps simultaneous TUI writers from
    // losing each other's entries. Local writes also retain submission order.
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let acquired = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await mkdir(lock);
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          if (Date.now() - (await stat(lock)).mtimeMs > 30_000)
            await rm(lock, { recursive: true, force: true });
        } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure;
        }
        await Bun.sleep(5);
      }
    }
    if (!acquired) return;
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const stored = await load(file);
      append(stored, text);
      await writeFile(temporary, stored.map((entry) => JSON.stringify(entry)).join("\n") + "\n", {
        mode: 0o600,
      });
      await rename(temporary, file);
    } finally {
      try {
        await rm(temporary, { force: true });
      } finally {
        await rm(lock, { recursive: true, force: true });
      }
    }
  }

  return {
    entries,
    remember(input: string) {
      const text = input.trim();
      if (!text) return;
      append(entries, text);
      // Disk failures must never prevent input or leave an unhandled rejection.
      pending = pending.then(() => persist(text)).catch(() => {});
    },
    flush: () => pending,
  };
}

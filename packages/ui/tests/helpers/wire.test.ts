import { expect, onTestFinished, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { startWireFixture } from "./wire";

test("a rejected wire handshake waits for the spawned child to exit", async () => {
  const previousPath = process.env.PATH;
  let directory: string | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    })());
  onTestFinished(close);
  try {
    directory = await mkdtemp(join(tmpdir(), "rukie-wire-acquisition-"));
    const marker = join(directory, "exited");
    // Replace only the external executable boundary with a real process that rejects its handshake.
    await writeFile(
      join(directory, "bun"),
      `#!/usr/bin/env node
const fs = require("node:fs");
process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(marker)}, "closed"); process.exit(0); });
console.log(JSON.stringify({ invalid: true }));
setInterval(() => {}, 1000);
`,
      { mode: 0o755 },
    );
    process.env.PATH = directory + delimiter + (previousPath ?? "");
    await expect(startWireFixture()).rejects.toThrow("Invalid wire fixture handshake");
    expect(await readFile(marker, "utf8")).toBe("closed");
  } finally {
    await close();
  }
});

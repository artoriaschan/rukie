import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(process.platform !== "darwin")(
  "default macOS host detects offered images and Finder image files without exporting clipboard contents",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "neant-clipboard-probe-"));
    const payload = join(root, "metadata.json");
    const calls = join(root, "calls.jsonl");
    const command = join(root, "osascript");
    await Bun.write(
      command,
      `#!${process.execPath}
import { appendFile } from "node:fs/promises";
await appendFile(${JSON.stringify(calls)}, JSON.stringify(Bun.argv.slice(2)) + String.fromCharCode(10));
if (Bun.argv[2] !== "-l" || Bun.argv[3] !== "JavaScript") process.exit(1);
process.stdout.write(await Bun.file(${JSON.stringify(payload)}).text());
`,
    );
    await chmod(command, 0o700);
    const probe = async () => {
      const script = `import { createDefaultHost } from ${JSON.stringify(new URL("../../src/host/index.ts", import.meta.url).href)};
const instance = createDefaultHost();
let result;
try { result = {present: await instance.host.hasClipboardImage()}; }
catch (error) { result = {error: error.message}; }
finally { await instance.dispose(); }
console.log(JSON.stringify({...result, disposed: await instance.host.hasClipboardImage()}));`;
      const child = Bun.spawn([process.execPath, "-e", script], {
        env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ""}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(child.stdout).text();
      expect(await new Response(child.stderr).text()).toBe("");
      expect(await child.exited).toBe(0);
      const value: unknown = JSON.parse(output);
      return value;
    };
    try {
      for (const [metadata, expected] of [
        [{ files: [], types: ["public.png"] }, true],
        [{ files: [], types: ["public.tiff"] }, true],
        [{ files: ["/fixture/note.txt", "/fixture/SHOT.PNG"], types: [] }, true],
        [{ files: ["/fixture/note.txt"], types: ["public.png"] }, false],
        [{ files: [], types: ["public.utf8-plain-text"] }, false],
        [{ files: [], types: [] }, false],
      ] as const) {
        await Bun.write(payload, JSON.stringify(metadata));
        expect(await probe()).toEqual({ present: expected, disposed: false });
      }
      await Bun.write(payload, JSON.stringify({ files: [42], types: ["public.png"] }));
      expect(await probe()).toEqual({ error: "Invalid clipboard metadata", disposed: false });
      const invoked = (await Bun.file(calls).text()).trim().split("\n");
      expect(invoked).toHaveLength(7);
      expect(invoked.every((line) => line.startsWith('["-l","JavaScript","-e",'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

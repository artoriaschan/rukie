import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "@neant/agent";
import { main as entryMain, type PrintIo } from "../../src/index.ts";
function main(argv: string[], io: PrintIo) {
  return entryMain(
    argv.includes("--goal") || argv.includes("-p") || argv.includes("--print")
      ? argv
      : ["-p", ...argv],
    { env: { LANG: "en" }, ...io },
  );
}

import { echoModel } from "./helpers/echo-model.ts";

test("Headless titles its persisted session and keeps the auxiliary response out of stdout", async () => {
  const root = await mkdtemp(join(tmpdir(), "neant-title-cli-"));
  await mkdir(join(root, ".neant/file-history"), { recursive: true });
  const fake = echoModel();
  let stdout = "";
  try {
    const code = await main(["-p", "Repair authentication", "--output-format", "stream-json"], {
      readStdin: async () => "",
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {},
      session: { cwd: root, homeDir: root, ...fake },
    });
    expect(code).toBe(0);
    const result = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((event) => event.type === "result");
    const resumed = await createSession({
      cwd: root,
      homeDir: root,
      ...fake,
      resumeId: result.sessionId,
    });
    expect(resumed.title).toBe("Test session");
    expect(resumed.titleSource).toBe("model");
    expect(result.text).toContain("Repair authentication");
    expect(stdout).not.toContain('"text":"Test session"');
    await resumed.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/headless/main.ts";
import { echoModel } from "./helpers/echo-model.ts";

test.each(["ask", "auto-review", "full-access"])(
  "Headless stream-json omits enter_plan_mode in %s",
  async (permissionMode) => {
    const root = await mkdtemp(join(tmpdir(), "neant-cli-plan-"));
    await mkdir(join(root, ".neant", "file-history"), { recursive: true });
    let stdout = "";
    let stderr = "";
    try {
      expect(
        await main(
          [
            "-p",
            "list tools",
            "--output-format",
            "stream-json",
            "--permission-mode",
            permissionMode,
          ],
          {
            readStdin: async () => "",
            stdout: (value) => {
              stdout += value;
            },
            stderr: (value) => {
              stderr += value;
            },
            session: { cwd: root, homeDir: root, ...echoModel() },
          },
        ),
      ).toBe(0);
      expect(stderr).toBe("");
      const started = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .find((event) => event.type === "session_start");
      expect(started).toBeDefined();
      expect(started.tools).not.toContain("enter_plan_mode");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

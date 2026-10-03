import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main.ts";
import { echoModel } from "./helpers/echo-model.ts";

async function run(argv: string[], stdin = "") {
  const root = await mkdtemp(join(tmpdir(), "neant-main-"));
  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await main(argv, {
      readStdin: async () => stdin,
      stdout: (s) => (stdout += s),
      stderr: (s) => (stderr += s),
      session: { cwd: root, homeDir: root, ...echoModel() },
    });
    return { exitCode, stdout, stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("-p prints the final assistant text", async () => {
  const { exitCode, stdout } = await run(["-p", "hi"]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe('echo: [{"type":"text","text":"hi"}]\n');
});

test("reads the prompt from stdin when -p is absent", async () => {
  const { exitCode, stdout } = await run([], "from pipe\n");
  expect(exitCode).toBe(0);
  expect(stdout).toBe('echo: [{"type":"text","text":"from pipe"}]\n');
});

test("unknown arguments exit with 2", async () => {
  const { exitCode, stderr } = await run(["--nope"]);
  expect(exitCode).toBe(2);
  expect(stderr).not.toBe("");
});

for (const flags of [
  ["--permission-mode", "ask"],
  ["--permission-mode=auto-review"],
  ["--permission-mode", "full-access"],
  ["--yolo", "--permission-mode", "full-access"],
  ["--permission-mode", "full-access", "--yolo"],
]) {
  test(`valid permission flags ${flags.join(" ")} run successfully`, async () => {
    const { exitCode, stdout, stderr } = await run([...flags, "-p", "hi"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('echo: [{"type":"text","text":"hi"}]\n');
    expect(stderr).toBe("");
  });
}

test.each([
  [["--permission-mode"], "argument missing"],
  [["--permission-mode", "invalid"], "--permission-mode must be one of"],
  [["--permission-mode", ""], "--permission-mode must be one of"],
  [["--yolo", "--permission-mode", "ask"], "--yolo conflicts with --permission-mode"],
  [["--permission-mode", "auto-review", "--yolo"], "--yolo conflicts with --permission-mode"],
] as const)("invalid permission flags %j exit before reading stdin", async (flags, message) => {
  let read = false;
  let stderr = "";
  let stdout = "";
  const exitCode = await main([...flags], {
    readStdin: async () => {
      read = true;
      return "hi";
    },
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  expect(exitCode).toBe(2);
  expect(stderr).toContain(message);
  expect(stdout).toBe("");
  expect(read).toBe(false);
});

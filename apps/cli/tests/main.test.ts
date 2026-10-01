import { expect, test } from "bun:test";
import { main } from "../src/main.ts";
import { echoModel } from "./helpers/echo-model.ts";

function run(argv: string[], stdin = "") {
  let stdout = "";
  let stderr = "";
  const code = main(argv, {
    readStdin: async () => stdin,
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
    session: { cwd: process.cwd(), homeDir: process.cwd(), ...echoModel() },
  });
  return code.then((exitCode) => ({ exitCode, stdout, stderr }));
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

import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsSchema } from "@neant/shared";
import { Value } from "typebox/value";
import { fakeOpenAI } from "../helpers/fake-openai.ts";

const MAIN = join(import.meta.dir, "../../src/main.ts");
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((f) => f()));
});

/** Temp home whose user settings point a custom provider `fake` at a fake server. */
async function setup(settings: object = {}) {
  const server = fakeOpenAI("hello from fake");
  const root = await mkdtemp(join(tmpdir(), "neant-cli-"));
  cleanups.push(server.stop, () => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const cwd = join(root, "project");
  await Bun.write(join(cwd, ".keep"), "");
  await Bun.write(
    join(home, ".neant/settings.json"),
    JSON.stringify({
      model: "fake/m",
      providers: [
        {
          id: "fake",
          api: "openai-completions",
          baseUrl: server.baseUrl,
          apiKeyEnv: "FAKE_API_KEY",
          models: [{ id: "m", reasoning: true }],
        },
      ],
      ...settings,
    }),
  );
  return { server, home, cwd };
}

async function neant(args: string[], opts: { home: string; cwd: string; key?: string }) {
  const proc = Bun.spawn(["bun", MAIN, ...args], {
    cwd: opts.cwd,
    env: { PATH: process.env.PATH, HOME: opts.home, FAKE_API_KEY: opts.key },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("prints the model's reply using the configured custom provider", async () => {
  const { server, ...dirs } = await setup();

  const result = await neant(["-p", "hi"], { ...dirs, key: "sk-test" });

  expect(result).toMatchObject({ exitCode: 0, stdout: "hello from fake\n" });
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]!.authorization).toBe("Bearer sk-test");
  expect(server.requests[0]!.body.model).toBe("m");
  expect(JSON.stringify(server.requests[0]!.body.messages)).toContain("hi");
});

test("--model and --thinking override settings", async () => {
  const { server, ...dirs } = await setup({ model: "fake/missing" });

  const result = await neant(["-p", "hi", "--model", "fake/m", "--thinking", "high"], {
    ...dirs,
    key: "sk-test",
  });

  expect(result.exitCode).toBe(0);
  expect(server.requests[0]!.body.reasoning_effort).toBe("high");
});

test("no model configured exits 1 with a clear error", async () => {
  const { server, ...dirs } = await setup({ model: undefined });

  const result = await neant(["-p", "hi"], { ...dirs, key: "sk-test" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("No model configured");
  expect(result.stderr).toContain(join(dirs.home, ".neant/settings.json"));
  // The printed example is valid settings the user can paste as-is.
  const example = JSON.parse(
    result.stderr.slice(result.stderr.indexOf("{"), result.stderr.lastIndexOf("}") + 1),
  );
  expect(Value.Check(SettingsSchema, example)).toBe(true);
  expect(example.providers[0].apiKeyEnv).toBeString();
  expect(server.requests).toHaveLength(0);
});

test("apiKeyEnv never falls back to sending its value as a literal key", async () => {
  const dirs = await setup();
  const server = dirs.server;
  const settings = await Bun.file(join(dirs.home, ".neant/settings.json")).json();
  settings.providers[0].apiKeyEnv = "sk-literal-1";
  await Bun.write(join(dirs.home, ".neant/settings.json"), JSON.stringify(settings));

  const result = await neant(["-p", "hi"], dirs);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("No API key");
  expect(server.requests).toHaveLength(0);
});

test("missing API key exits 1 naming the env var", async () => {
  const { server, ...dirs } = await setup();

  const result = await neant(["-p", "hi"], dirs);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("FAKE_API_KEY");
  expect(server.requests).toHaveLength(0);
});

test("built-in providers resolve without settings and need their standard key", async () => {
  const dirs = await setup();

  const result = await neant(["-p", "hi", "--model", "openai/gpt-4.1"], dirs);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('No API key for provider "openai"');
});

test("invalid settings exit 1 naming the file and field", async () => {
  const dirs = await setup({ thinking: "extreme" });

  const result = await neant(["-p", "hi"], { ...dirs, key: "sk-test" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(join(dirs.home, ".neant/settings.json"));
  expect(result.stderr).toContain("/thinking");
});

test.each([[["--nope"]], [["-p", "hi", "--thinking", "extreme"]], [["-p", "hi", "--model", "m"]]])(
  "bad arguments %j exit 2",
  async (args) => {
    const { server, ...dirs } = await setup();

    const result = await neant(args, { ...dirs, key: "sk-test" });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toBe("");
    expect(server.requests).toHaveLength(0);
  },
);

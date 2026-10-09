import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildRelease } from "../build.ts";
import { configureProvider, installRelease } from "./installed-fixture.ts";
import { runPty } from "./pty.ts";
const {
  fakeOpenAI,
}: {
  fakeOpenAI: (reply: string) => { baseUrl: string; requests: { body: unknown }[]; stop(): void };
} = await import(
  new URL("../../../packages/coding-agent/tests/headless/helpers/fake-openai.ts", import.meta.url)
    .href
);
let fixture: Awaited<ReturnType<typeof installRelease>>;
let ownedArtifacts: string | undefined;
beforeAll(async () => {
  let artifacts = process.env.RUKIE_RELEASE_ARTIFACTS;
  if (!artifacts) {
    ownedArtifacts = await mkdtemp(join(tmpdir(), "rukie-tui-build-"));
    artifacts = ownedArtifacts;
    await buildRelease(artifacts);
  }
  fixture = await installRelease(resolve(artifacts));
}, 120_000);
afterAll(async () => {
  await fixture?.cleanup();
  if (ownedArtifacts) await rm(ownedArtifacts, { recursive: true, force: true });
});
const ready = /Ask[\s\S]*project with spaces/;
function restored(result: Awaited<ReturnType<typeof runPty>>) {
  expect(result.code).toBe(0);
  expect(result.restoredFullTermios).toBe(true);
  expect(result.canonical).toBe(true);
  expect(result.echo).toBe(true);
  expect(result.alternateEnter).toBe(true);
  expect(result.alternateExit).toBe(true);
  expect(result.cursorShow).toBe(true);
}
// The complete DCS payload verifies worker encoding, rather than merely successful capability negotiation.
test("installed TUI transmits its embedded avatar through the real Sixel worker", async () => {
  const server = fakeOpenAI("ZQX");
  try {
    await configureProvider(fixture.homeDir, server.baseUrl);
    const result = await runPty(fixture, {
      graphics: "sixel",
      // eslint-disable-next-line no-control-regex -- Match the actual terminal DCS protocol.
      actions: [{ when: /\x1bP[0-9;]*q[^\x1b]{20,}\x1b\\/, raw: true, send: "\x04" }],
    });
    expect(result.sixelUpload).toBe(true);
    restored(result);
  } finally {
    server.stop();
  }
}, 15_000);

test("installed TUI sends its embedded avatar through native sharp and Kitty graphics", async () => {
  const server = fakeOpenAI("ZQX");
  try {
    await configureProvider(fixture.homeDir, server.baseUrl);
    const result = await runPty(fixture, {
      graphics: "kitty",
      actions: [
        // eslint-disable-next-line no-control-regex -- Match the actual terminal APC protocol.
        { when: /\x1b_G[^;\x1b]*a=[tT][^;\x1b]*;[^\x1b]{20,}\x1b\\/, raw: true, send: "\x04" },
      ],
    });
    expect(result.kittyUpload).toBe(true);
    expect(result.transcript).toContain("a=t,t=d,f=32,s=320,v=224,");
    restored(result);
  } finally {
    server.stop();
  }
}, 15_000);

for (const signal of [undefined, "SIGINT", "SIGTERM"] as const) {
  test(`installed TUI accepts interactive input and restores its terminal after ${signal ?? "Ctrl-D"}`, async () => {
    const server = fakeOpenAI("ZQX");
    try {
      await configureProvider(fixture.homeDir, server.baseUrl);
      const result = await runPty(fixture, {
        actions: [
          { when: ready, send: `interactive ${signal ?? "normal"} question\r` },
          // Delta rendering may paint the reply before the completed Run summary.
          { when: /Baked[\s\S]*ZQX|ZQX[\s\S]*Baked/, ...(signal ? { signal } : { send: "\x04" }) },
        ],
      });
      restored(result);
      expect(JSON.stringify(server.requests[0]!.body)).toContain(
        `interactive ${signal ?? "normal"} question`,
      );
      const resume = /rukie --resume ([a-zA-Z0-9-]+)/.exec(result.transcript);
      expect(resume).not.toBeNull();
      if (!resume) throw new Error("Missing visible Session Resume command");
      if (!signal) {
        const resumed = await fixture.run(["-p", "--resume", resume[1]!, "resume installed TUI"]);
        expect(resumed.code).toBe(0);
        expect(resumed.stdout).toBe("ZQX\n");
        expect(JSON.stringify(server.requests.at(-1)!.body)).toContain(
          "interactive normal question",
        );
        expect(JSON.stringify(server.requests.at(-1)!.body)).toContain("resume installed TUI");
      }
    } finally {
      server.stop();
    }
  }, 15_000);
}

test("installed TUI responds to resize and restores a small terminal", async () => {
  const server = fakeOpenAI("ZQX");
  try {
    await configureProvider(fixture.homeDir, server.baseUrl);
    const result = await runPty(fixture, {
      actions: [
        { when: ready, resize: { columns: 30, rows: 8 } },
        { when: "40 columns", send: "\x04" },
      ],
    });
    expect(result.transcript).toContain("40 columns");
    restored(result);
  } finally {
    server.stop();
  }
}, 15_000);

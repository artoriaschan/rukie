import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSession as createSessionImpl,
  type Session,
  type SessionEvent,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { abortingModel } from "../helpers/aborting-model.ts";
import { waitForFile } from "../helpers/wait-for-file.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
async function createSession(options: Parameters<typeof createSessionImpl>[0]) {
  const session = await createSessionImpl(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});

test.each([undefined, "other"] as const)(
  "close matches reason %s and concurrent calls run SessionEnd once",
  async (reason) => {
    dirs = await tempDirs();
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          SessionEnd: [
            { matcher: reason ?? "exit", hooks: [{ type: "command", command: "cat >> input" }] },
            {
              matcher: reason === "other" ? "exit" : "other",
              hooks: [{ type: "command", command: "touch wrong" }],
            },
          ],
        },
      },
    });
    await session.run("hi");
    await Promise.all([session.close(reason), session.close("other")]);
    await session.close();
    const input = await Bun.file(join(dirs.cwd, "input")).json();
    expect(input).toMatchObject({
      session_id: session.id,
      cwd: dirs.cwd,
      permission_mode: "ask",
      hook_event_name: "SessionEnd",
      reason: reason ?? "exit",
    });
    expect(isAbsolute(input.transcript_path)).toBe(true);
    expect(await Bun.file(join(dirs.cwd, "wrong")).exists()).toBe(false);
  },
);

test("close interrupts an active Run and closes its MCP process", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.homeDir, "manifest.json"), JSON.stringify({ tools: ["echo"] }));
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({
      mcpServers: {
        local: {
          command: process.execPath,
          args: [fileURLToPath(new URL("../helpers/mcp-server.ts", import.meta.url))],
          env: {
            MCP_MANIFEST: join(dirs.homeDir, "manifest.json"),
            MCP_PIDS: join(dirs.homeDir, "pids"),
            MCP_CALLS: join(dirs.homeDir, "calls"),
          },
        },
      },
    }),
  );
  const fake = abortingModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        SessionEnd: [{ hooks: [{ type: "command", command: "echo ended >> count" }] }],
      },
    },
  });
  const run = session.run("wait").catch((error: unknown) => error);
  await fake.started;
  const pid = Number((await Bun.file(join(dirs.homeDir, "pids")).text()).trim());
  expect(() => process.kill(pid, 0)).not.toThrow();
  try {
    await session.close();
    expect(await run).toBeInstanceOf(Error);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await Bun.file(join(dirs.cwd, "count")).text()).toBe("ended\n");
    await expect(session.run("again")).rejects.toThrow("closed");
  } finally {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already closed. */
    }
  }
});

test("SessionEnd discards all output and retains the small handler timeout", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([]),
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: {
        SessionEnd: [
          {
            hooks: [
              { type: "command", command: "echo '{bad}'" },
              { type: "command", command: "sleep 10; touch late", timeout: 0.02 },
              {
                type: "command",
                command: 'echo \'{"continue":false,"systemMessage":"ignore","unknownField":true}\'',
              },
            ],
          },
        ],
      },
    },
  });
  const started = performance.now();
  await session.close();
  expect(performance.now() - started).toBeLessThan(1000);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("timed out after 0.02s");
  expect(await Bun.file(join(dirs.cwd, "late")).exists()).toBe(false);
});

test("close cancels a slow in-flight tool hook before running SessionEnd", async () => {
  dirs = await tempDirs();
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { description: "Run test command", command: "touch forbidden" }),
        {
          stopReason: "toolUse",
        },
      ),
    ]),
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: "touch hook-started; sleep 10; touch hook-late" }],
          },
        ],
        SessionEnd: [{ hooks: [{ type: "command", command: "touch ended" }] }],
      },
    },
  });
  const run = session.run("try").catch((error: unknown) => error);
  await waitForFile(join(dirs.cwd, "hook-started"));
  const started = performance.now();
  await session.close();
  expect(performance.now() - started).toBeLessThan(1000);
  expect(await run).toBeInstanceOf(Error);
  expect(await Bun.file(join(dirs.cwd, "hook-late")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "forbidden")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "ended")).exists()).toBe(true);
});

test("an event observer can await close without waiting on its own Run", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([]),
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: {
        SessionEnd: [{ hooks: [{ type: "command", command: "sleep 10", timeout: 0.02 }] }],
      },
    },
  });
  const closed = Promise.withResolvers<void>();
  let closeStarted = false;
  const started = performance.now();
  session.subscribe((event) => events.push(event));
  await expect(
    session.run("try", {
      onEvent: async () => {
        if (closeStarted) return;
        closeStarted = true;
        try {
          await session.close();
          closed.resolve();
        } catch (error) {
          closed.reject(error);
        }
      },
    }),
  ).rejects.toThrow();
  await closed.promise;
  expect(performance.now() - started).toBeLessThan(1000);
  expect(warnings).toHaveLength(1);
  expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
    { event: "SessionEnd", error: { code: "hook-timeout", params: { timeout: "0.02" } } },
  ]);
});

test("SessionEnd exit failures emit diagnostics after the Run while discarding output", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("done")]),
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: {
        SessionEnd: [
          { hooks: [{ type: "command", command: "echo '{bad}'; echo failed >&2; exit 3" }] },
        ],
      },
    },
  });
  session.subscribe((event) => events.push(event));
  await session.run("try");
  await session.close();
  expect(warnings).toHaveLength(1);
  // Native notice commits also publish structural entry events during shutdown.
  expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
    {
      type: "hook_warning",
      sessionId: session.id,
      event: "SessionEnd",
      error: { code: "hook-exit", params: { exitCode: "3", stderr: "failed" } },
    },
  ]);
});

// A real Hook process owns the 1.5s budget; a virtual parent clock cannot drive its shutdown.
test("SessionEnd handlers share a 1.5 second total shutdown budget", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("done")]),
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: {
        SessionEnd: [
          {
            hooks: [
              { type: "command", command: "cat > first; sleep 10; touch first-late" },
              {
                type: "command",
                command: "cat > second; sleep 10; touch second-late",
                timeout: 10,
              },
            ],
          },
        ],
      },
    },
  });
  session.subscribe((event) => events.push(event));
  await session.run("try");
  const started = performance.now();
  await session.close();
  expect(performance.now() - started).toBeLessThan(2500);
  expect(warnings).toHaveLength(2);
  expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
    { event: "SessionEnd", error: { code: "hook-timeout", params: { timeout: "1.5" } } },
    { event: "SessionEnd", error: { code: "hook-timeout", params: { timeout: "1.5" } } },
  ]);
  for (const name of ["first", "second"]) {
    expect((await Bun.file(join(dirs.cwd, name)).json()).hook_event_name).toBe("SessionEnd");
    expect(await Bun.file(join(dirs.cwd, `${name}-late`)).exists()).toBe(false);
  }
});

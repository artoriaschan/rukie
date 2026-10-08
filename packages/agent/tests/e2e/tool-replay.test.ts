import { expect, test } from "bun:test";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "../../src/index.ts";
import { crashUnsafeEffect } from "../helpers/native-recovery.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("a real bash effect with a lost receipt stays uncertain across repeated cold opens without relaunch", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const saved = await crashUnsafeEffect(dirs.cwd, false, {
      unsafeCall: {
        name: "bash",
        args: {
          command: "printf '%s' 'bash-effect' >> uncertain-effect.txt",
          description: "Write the isolated replay fixture",
        },
      },
    });
    const effect = join(dirs.cwd, "uncertain-effect.txt");
    const fake = fakeModel([
      fauxAssistantMessage("Inspect the effect before attempting a new command."),
    ]);
    session = await createSession({
      cwd: dirs.cwd,
      homeDir: dirs.cwd,
      ...fake,
      resumeId: saved.sessionId,
      permissionMode: "full-access",
    });
    expect(session.currentRequestId).toBeDefined();
    await session.waitForRequest(session.currentRequestId!);
    expect(session.messages.filter((message) => message.role === "toolResult")).toMatchObject([
      { toolName: "bash", isError: true, outcomeUnknown: true },
    ]);
    expect(await Bun.file(effect).text()).toBe("before effectbash-effect");
    expect((await stat(effect)).mtimeMs).toBe(saved.effectModifiedAt);
    const messages = structuredClone(session.messages);
    await session.close();
    const next = fakeModel([fauxAssistantMessage("No historical process is restarted.")]);
    session = await createSession({
      cwd: dirs.cwd,
      homeDir: dirs.cwd,
      ...next,
      resumeId: saved.sessionId,
      permissionMode: "full-access",
    });
    expect(session.messages).toEqual(messages);
    expect(next.contexts).toHaveLength(0);
    expect(await Bun.file(effect).text()).toBe("before effectbash-effect");
    expect((await stat(effect)).mtimeMs).toBe(saved.effectModifiedAt);
  } finally {
    await session?.close();
    await dirs.cleanup();
  }
});

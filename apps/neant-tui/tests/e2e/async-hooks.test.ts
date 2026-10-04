import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";

test("idle asyncRewake displays a running agent, supports Esc, and accepts another prompt after interruption", async () => {
  const app = await start(["first"], {
    prepare: async (root) => {
      await Bun.write(
        join(root, "rewake.sh"),
        `cat > hook-input
while [ ! -f release ]; do sleep 0.01; done
echo 'repair background check' >&2
exit 2
`,
      );
    },
    session: {
      settings: {
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "sh rewake.sh", asyncRewake: true }] },
          ],
        },
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    await Bun.write(join(app.root, "release"), "");
    await app.waitFor(() => app.calls.length === 2 && app.isWorking());
    expect(app.isWorking()).toBe(true);
    expect(JSON.stringify(app.calls[1]!.context.messages)).toContain("repair background check");
    app.stdin.write("blocked while busy\r");
    expect(app.calls).toHaveLength(2);
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls[1]!.signal!.aborted && !app.isWorking());
    app.stdin.write("\x15after interrupt\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(app.calls[2]!.signal!.aborted).toBe(false);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("a SessionStart asyncRewake before any submitted prompt is visible and cancellable", async () => {
  const app = await start([], {
    prepare: async (root) => {
      await Bun.write(
        join(root, "rewake.sh"),
        `cat > hook-input
echo '{"systemMessage":"startup check finished"}'
echo 'repair initial background check' >&2
exit 2
`,
      );
    },
    session: {
      settings: {
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "sh rewake.sh", asyncRewake: true }] },
          ],
        },
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1 && app.isWorking());
    expect(app.isWorking()).toBe(true);
    app.calls[0]!.delta("automatic startup reply");
    await app.waitFor(() => app.allLines().join("\n").includes("automatic startup reply"));
    expect(app.allLines().join("\n")).toContain("startup check finished");
    expect(
      app
        .allLines()
        .join("\n")
        .match(/repair initial background check/g),
    ).toHaveLength(1);
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls[0]!.signal!.aborted && !app.isWorking());
    app.stdin.write("next user prompt\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    app.calls[1]!.delta("manual reply");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(
      app
        .allLines()
        .join("\n")
        .match(/manual reply/g),
    ).toHaveLength(1);
  } finally {
    await app.cleanup();
  }
});

test("a startup autorun retains the initial argv prompt and submits it normally after completion", async () => {
  const app = await start(["actual human task"], {
    prepare: async (root) => {
      await Bun.write(
        join(root, "rewake.sh"),
        "cat >/dev/null\necho background-failure >&2\ntouch background-exit\nexit 2\n",
      );
    },
    session: {
      settings: {
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: "command", command: "sh rewake.sh", asyncRewake: true },
                { type: "command", command: "while [ ! -f background-exit ]; do sleep 0.01; done" },
              ],
            },
          ],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "cat >> human-prompts" }] }],
        },
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1 && app.isWorking());
    expect(JSON.stringify(app.calls[0]!.context.messages)).toContain("background-failure");
    expect(JSON.stringify(app.calls[0]!.context.messages)).not.toContain("actual human task");
    app.calls[0]!.finish();
    await app.waitFor(() => app.calls.length === 2 && app.isWorking());
    expect(JSON.stringify(app.calls[1]!.context.messages)).toContain("actual human task");
    expect(
      (await Bun.file(join(app.root, "human-prompts")).text()).match(/hook_event_name/g),
    ).toHaveLength(1);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(
      app
        .allLines()
        .join("\n")
        .match(/actual human task/g),
    ).toHaveLength(1);
  } finally {
    await app.cleanup();
  }
});

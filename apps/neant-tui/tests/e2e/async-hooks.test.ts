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
    await app.waitFor(() => app.calls.length === 2);
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

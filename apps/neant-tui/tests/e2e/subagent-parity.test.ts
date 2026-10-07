import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";
function click(app: Awaited<ReturnType<typeof startWithClock>>, x: number, y: number) {
  app.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
}

test("Subagent card omits unobserved usage, ignores blank cells and exposes an independent read-only Agent View", async () => {
  const app = await startWithClock(["--permission-mode", "full-access", "delegate"], {
    columns: 120,
    rows: 40,
    env: { LANG: "en" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", { description: "Reader", prompt: "child read" });
    await app.waitFor(
      () =>
        app.calls.length === 3 && app.screen().some((line) => line.includes("Subagent: Reader")),
    );
    const y = app.screen().findIndex((line) => line.includes("Subagent: Reader"));
    expect(app.screen()[y]).not.toContain("0 tok");
    click(app, 119, y + 3);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("id ");
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("child read"),
      ),
    )!;
    app.stdin.write("saved draft");
    child.delta("child output");
    await app.waitFor(() => app.screen().some((line) => line.includes("child output")));
    const row = app.screen().findIndex((line) => line.includes("Subagent: Reader"));
    const x = app.screen()[row]!.indexOf("⤢");
    expect(x).toBeGreaterThan(0);
    click(app, x, row);
    await app.waitFor(() => app.screen().join("\n").includes("Agent View"));
    expect(app.screen().join("\n")).toContain("Read-only");
    child.delta("\n" + Array.from({ length: 50 }, (_, index) => `child line ${index}`).join("\n"));
    await app.waitFor(() => app.screen().join("\n").includes("child line 49"));
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => !app.screen().join("\n").includes("child line 49"));
    const reading = app.screen().filter((line) => line.includes("child line"));
    child.delta("\nchild line 50");
    await app.flush();
    expect(app.screen().filter((line) => line.includes("child line"))).toEqual(reading);
    app.stdin.write("\x1b[F");
    await app.waitFor(() => app.screen().join("\n").includes("child line 50"));
    app.resize(40, 12);
    await app.waitFor(() => app.screen().join("\n").includes("Agent View"));
    app.resize(120, 40);
    await app.waitFor(() => app.screen().join("\n").includes("Read-only"));
    app.stdin.write("ignored\r\x1b[200~pasted\x1b[201~");
    await app.flush();
    expect(app.calls.length).toBe(3);
    expect(app.screen().join("\n")).not.toContain("ignored");
    app.stdin.write("\x1b");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("Subagent: Reader")) &&
        !app.screen().join("\n").includes("Agent View"),
    );
    expect(child.signal!.aborted).toBe(false);
    expect(app.screen().join("\n")).toContain("saved draft");
  } finally {
    await app.cleanup();
  }
});

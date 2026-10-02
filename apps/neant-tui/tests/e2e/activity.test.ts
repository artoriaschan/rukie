import { expect, test } from "bun:test";
import { start } from "../helpers/app";

test("a tool Run shows live tokens and approval, then hides activity until the next submit", async () => {
  const app = await start();
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => screen().includes("❯"));
    expect(screen()).not.toContain("Ready");
    expect(screen()).not.toContain("tokens");
    expect(screen()).not.toContain("git ");
    app.stdin.write("use bash\r");
    await app.waitFor(() => app.calls.length === 1 && screen().includes("esc 中断"));
    expect(screen()).toContain("↑ 0 · ↓ 0 tokens");
    await app.waitFor(() => screen().includes("总1s"));
    app.calls[0]!.delta("abcdefgh");
    await app.waitFor(() => screen().includes("↓ 2 tokens"));
    app.calls[0]!.delta("ijklmnop");
    await app.waitFor(() => screen().includes("↓ 4 tokens"));
    app.calls[0]!.tool("bash", { command: "printf activity-tool" });
    await app.waitFor(() => screen().includes("权限确认"));
    expect(screen()).toContain("↑ 11 · ↓ 5 tokens");
    const approval = /在等你点头|等你批准呢——看一眼？|模型在等你决定/;
    expect(screen()).toMatch(approval);
    app.stdin.write("1\r");
    await app.waitFor(() => app.calls.length === 2);
    await app.waitFor(() => !approval.test(screen()));
    app.calls[1]!.delta("abcdefgh");
    await app.waitFor(() => screen().includes("↑ 11 · ↓ 7 tokens"));
    app.calls[1]!.finish(21, 9);
    await app.waitFor(() => screen().includes("32→14"));
    expect(screen()).not.toContain("tokens");
    expect(screen()).not.toContain(" 工具 · 想");
    expect(screen()).not.toContain("esc 中断");
    expect(screen()).toContain("32→14");
    expect(screen()).not.toContain("Running");
    await Bun.sleep(120);
    await app.flush();
    expect(screen()).not.toContain("tokens");
    app.stdin.write("again\r");
    await app.waitFor(() => app.calls.length === 3 && screen().includes("esc 中断"));
    expect(screen()).toContain("↑ 0 · ↓ 0 tokens");
  } finally {
    await app.cleanup();
  }
});

test("thinking and text estimates are corrected downward to the final usage", async () => {
  const app = await start(["think"]);
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("abcdefgh");
    await app.waitFor(() => screen().includes("↓ 2 tokens"));
    expect(screen()).not.toContain("abcdefgh");
    app.calls[0]!.delta("ijklmnop");
    await app.waitFor(() => screen().includes("↓ 4 tokens"));
    app.calls[0]!.finish(8000, 1);
    await app.waitFor(() => screen().includes("8.0k→1"));
    expect(screen()).not.toContain("tokens");
    expect(screen()).not.toContain("esc 中断");
  } finally {
    await app.cleanup();
  }
});

test("git branch is captured once at startup and retained across Runs", async () => {
  let root = "";
  const app = await start([], {
    prepare: async (cwd) => {
      root = cwd;
      const git = Bun.spawn(["git", "init", "--initial-branch=activity-test"], {
        cwd,
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await git.exited).toBe(0);
    },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => screen().includes("❯"));
    const git = Bun.spawn(["git", "checkout", "-b", "changed-after-startup"], {
      cwd: root,
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await git.exited).toBe(0);
    app.stdin.write("first\r");
    await app.waitFor(() => app.calls.length === 1 && screen().includes("git activity-test"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(screen()).not.toContain("git activity-test");
    app.stdin.write("second\r");
    await app.waitFor(() => app.calls.length === 2 && screen().includes("esc 中断"));
    expect(screen()).toContain("git activity-test");
    expect(screen()).not.toContain("changed-after-startup");
  } finally {
    await app.cleanup();
  }
});

import { expect, test } from "bun:test";
import { start } from "../helpers/app";

test("REVIEW stays visible until all concurrent reviews finish, without counting their tokens", async () => {
  const app = await start(["--permission-mode", "auto-review", "review two writes"], {
    controlReviews: true,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      { name: "write", args: { path: "first.txt", content: "first" } },
      { name: "write", args: { path: "second.txt", content: "second" } },
    ]);
    await app.waitFor(() => app.reviews.length === 2 && screen().includes("REVIEW"));
    expect(screen()).toContain("REVIEW");
    expect(screen()).toContain("↑ 11 · ↓ 5 tokens");
    // Complete in reverse order: the earlier review must remain visible.
    app.reviews[1]!.delta('{"risk":"low","decision":"allow"}');
    app.reviews[1]!.finish(9000, 9000);
    await Bun.sleep(30);
    await app.flush();
    expect(screen()).toContain("REVIEW");
    expect(screen()).toContain("↑ 11 · ↓ 5 tokens");
    app.reviews[0]!.delta('{"risk":"low","decision":"allow"}');
    app.reviews[0]!.finish(9000, 9000);
    await app.waitFor(() => app.calls.length === 2 && !screen().includes("REVIEW"));
    expect(screen()).not.toContain("REVIEW");
    expect(
      app.calls[1]!.context.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([{ isError: false }, { isError: false }]);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(screen()).not.toContain("REVIEW");
  } finally {
    await app.cleanup();
  }
});

test.each(["deny", "failure"])(
  "review %s shows its reason in the panel and cancellation clears concurrent reviews",
  async (outcome) => {
    const app = await start(["--permission-mode", "auto-review", "review and ask"], {
      controlReviews: true,
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.stdin.write("next draft");
      await app.waitFor(() => screen().includes("❯ next draft"));
      app.calls[0]!.tools([
        { name: "bash", args: { command: "printf must-not-run" } },
        { name: "write", args: { path: "refused.txt", content: "refused" } },
      ]);
      await app.waitFor(() => app.reviews.length === 2 && screen().includes("REVIEW"));
      if (outcome === "deny") {
        app.reviews[0]!.delta('{"risk":"high","decision":"deny","reason":"需要你确认操作范围"}');
        app.reviews[0]!.finish();
      } else app.reviews[0]!.fail("review provider offline");
      await app.waitFor(() =>
        (outcome === "deny" ? /需要你确认操作范围/ : /Permission Review failed/).test(screen()),
      );
      expect(screen()).not.toContain("REVIEW");
      expect(screen()).not.toContain("一直允许");
      expect(screen()).toMatch(
        outcome === "deny" ? /需要你确认操作范围/ : /Permission Review failed/,
      );
      // An approval takes priority over the second review, which remains cancellable.
      app.stdin.write("\x03");
      await app.waitFor(() => !app.isWorking());
      expect(app.reviews.every((review) => review.signal!.aborted)).toBe(true);
      expect(screen()).not.toContain("REVIEW");
      expect(screen()).not.toContain("2. 拒绝");
      expect(screen()).toContain("❯ next draft");
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(screen()).not.toContain("REVIEW");
      app.calls[1]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test("Esc cancels in-flight review and the next Run starts without stale REVIEW activity", async () => {
  const app = await start(["--permission-mode", "auto-review", "cancel review"], {
    controlReviews: true,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "printf cancelled-review" });
    await app.waitFor(() => app.reviews.length === 1 && screen().includes("REVIEW"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !app.isWorking());
    expect(app.reviews[0]!.signal!.aborted).toBe(true);
    expect(screen()).not.toContain("REVIEW");
    app.stdin.write("again\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(screen()).not.toContain("REVIEW");
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

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
    await app.waitFor(() => screen().includes("等待审批"));
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

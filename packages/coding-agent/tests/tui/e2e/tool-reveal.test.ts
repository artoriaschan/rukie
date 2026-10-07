import { start } from "../helpers/app";
import { expect, jest, test } from "bun:test";
import { join } from "node:path";
import { startWithClock } from "../helpers/clock-app";

const oldText = "before-0\nbefore-1\nbefore-2\n";
const newText = "after-0\nafter-1\nafter-2\n";

test("pending edit call rows reveal in frames and completing the result snaps every visible row", async () => {
  const permission = Promise.withResolvers<"allow" | "deny">();
  const app = await startWithClock(["change"], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "code.txt"), oldText);
    },
    session: { onPermissionAsk: () => permission.promise },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("edit", { path: "code.txt", edits: [{ oldText, newText }] });
    await app.waitFor(() => app.screen().some((row) => row.includes("Edit ")));
    expect(app.screen().join("\n")).not.toContain("+after-2");
    jest.advanceTimersByTime(32);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("-before-0");
    jest.advanceTimersByTime(2);
    await app.flush();
    jest.advanceTimersByTime(16);
    await app.flush();
    expect(app.screen().filter((row) => /^ ⎿|^   [-+]/.test(row))).toHaveLength(3);
    expect(app.screen().join("\n")).toContain("before-1");
    expect(app.screen().join("\n")).not.toContain("+after-2");
    permission.resolve("allow");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes("+after-2"));
  } finally {
    permission.resolve("deny");
    await app.cleanup();
  }
});

test.each(["card", "transcript"] as const)(
  "%s expansion snaps a pending call and collapse never restarts its reveal",
  async (mode) => {
    const permission = Promise.withResolvers<"allow" | "deny">();
    const app = await startWithClock(["change"], {
      rows: 40,
      env: { LANG: "en_US.UTF-8" },
      prepare: async (root) => {
        await Bun.write(join(root, "code.txt"), oldText);
      },
      session: { onPermissionAsk: () => permission.promise },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("edit", { path: "code.txt", edits: [{ oldText, newText }] });
      await app.waitFor(() => app.screen().some((row) => row.includes("Edit ")));
      expect(app.screen().join("\n")).not.toContain("+after-2");
      const toggle = () => {
        if (mode === "transcript") app.stdin.write("\x0f");
        else {
          const row = app.screen().findIndex((row) => row.includes("Edit ")) + 1;
          app.stdin.write(`\x1b[<0;5;${row}M\x1b[<0;5;${row}m`);
        }
      };
      toggle();
      await app.waitFor(() => app.screen().join("\n").includes("+after-2"));
      toggle();
      // Let the renderer commit at its paint boundary, without advancing another reveal frame.
      jest.advanceTimersByTime(16);
      await app.flush();
      expect(app.screen().join("\n")).toContain("+after-2");
      permission.resolve("deny");
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.finish();
    } finally {
      permission.resolve("deny");
      await app.cleanup();
    }
  },
);

test("pending cards share a reveal phase across apps and a denied result appears immediately", async () => {
  const first = Promise.withResolvers<"allow" | "deny">(),
    second = Promise.withResolvers<"allow" | "deny">();
  const prepare = async (root: string) => {
    await Bun.write(join(root, "code.txt"), oldText);
  };
  const a = await startWithClock(["change"], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare,
    session: { onPermissionAsk: () => first.promise },
  });
  let b: Awaited<ReturnType<typeof start>> | undefined;
  try {
    b = await start(["change"], {
      rows: 40,
      env: { LANG: "en_US.UTF-8" },
      prepare,
      session: { onPermissionAsk: () => second.promise },
      advanceTimers: (ms) => jest.advanceTimersByTime(ms),
    });
    await a.waitFor(() => a.calls.length === 1);
    await b.waitFor(() => b!.calls.length === 1);
    a.calls[0]!.tool("edit", { path: "code.txt", edits: [{ oldText, newText }] });
    b.calls[0]!.tool("edit", { path: "code.txt", edits: [{ oldText, newText }] });
    await a.waitFor(() => a.screen().some((row) => row.includes("Edit ")));
    await b.waitFor(() => b!.screen().some((row) => row.includes("Edit ")));
    expect(a.screen().join("\n")).not.toContain("+after-2");
    expect(b.screen().join("\n")).not.toContain("+after-2");
    jest.advanceTimersByTime(34);
    await a.flush();
    await b.flush();
    jest.advanceTimersByTime(16);
    await a.flush();
    await b.flush();
    expect(a.screen().filter((row) => row.includes("-before-1"))).toHaveLength(1);
    expect(b.screen().filter((row) => row.includes("-before-1"))).toHaveLength(1);
    expect(a.screen().join("\n")).not.toContain("+after-2");
    expect(b.screen().join("\n")).not.toContain("+after-2");
    first.resolve("deny");
    await a.waitFor(
      () => a.calls.length === 2 && a.screen().some((row) => row.startsWith("✗ Edit(")),
    );
    expect(a.screen().join("\n")).toContain("Tool not authorized: edit");
    a.calls[1]!.finish();
    second.resolve("allow");
    await b.waitFor(() => b!.calls.length === 2);
    b.calls[1]!.finish();
    await b.waitFor(() => !b!.isWorking());
  } finally {
    first.resolve("deny");
    second.resolve("deny");
    await b?.cleanup();
    await a.cleanup();
  }
});

test("split pending rows reveal together and resize never restarts a caught-up card", async () => {
  const permission = Promise.withResolvers<"allow" | "deny">();
  const app = await startWithClock(["change"], {
    columns: 120,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "code.txt"), oldText);
    },
    session: { onPermissionAsk: () => permission.promise },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("edit", { path: "code.txt", edits: [{ oldText, newText }] });
    await app.waitFor(() => app.screen().some((row) => row.includes("Edit ")));
    expect(app.screen().join("\n")).not.toContain("+after-2");
    jest.advanceTimersByTime(34);
    await app.flush();
    jest.advanceTimersByTime(16);
    await app.flush();
    expect(app.screen().some((row) => row.includes("-before-1") && row.includes("+after-1"))).toBe(
      true,
    );
    expect(app.screen().join("\n")).not.toContain("+after-2");
    jest.advanceTimersByTime(34);
    await app.flush();
    jest.advanceTimersByTime(16);
    await app.flush();
    expect(app.screen().some((row) => row.includes("-before-2") && row.includes("+after-2"))).toBe(
      true,
    );
    app.resize(80, 40);
    await app.waitFor(() => app.screen().join("\n").includes("+after-2"));
    expect(app.screen().join("\n")).toContain("-before-0");
  } finally {
    permission.resolve("deny");
    await app.cleanup();
  }
});

test("resumed call and result views paint their complete visible rows immediately", async () => {
  const argv: string[] = [];
  const { createSession } = await import("@rukie/agent");
  const { createFauxCore, fauxAssistantMessage, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const { withAuxiliaryRequests } = await import("../helpers/auxiliary-model");
  const app = await startWithClock(argv, {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "code.txt"), oldText);
      const model = createFauxCore({ api: "faux", provider: "faux" });
      model.setResponses([
        fauxAssistantMessage(
          fauxToolCall("edit", { path: "code.txt", edits: [{ oldText, newText }] }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done"),
      ]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: model.getModel(),
        streamFn: withAuxiliaryRequests((m, c, o) => model.streamSimple(m, c, o)),
        permissionMode: "full-access",
      });
      try {
        await session.run("change");
        argv.push("--resume", session.id);
      } finally {
        await session.dispose();
      }
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.screen().join("\n")).toContain("-before-0");
    expect(app.screen().join("\n")).toContain("+after-2");
  } finally {
    await app.cleanup();
  }
});

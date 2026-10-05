import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession } from "../../src/index.ts";
import type { HookHandler, HooksSettings } from "@neant/shared";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

async function scriptedHook(output: unknown, name = "hook.sh") {
  await Bun.write(
    join(dirs.cwd, name),
    `cat > ${name}.input\nprintf '%s' '${JSON.stringify(output).replaceAll("'", "'\\''")}'\n`,
  );
  return { type: "command", command: `sh ${name}` } satisfies HookHandler;
}

function writeModel(
  args: Parameters<typeof fauxToolCall>[1] = { path: "allowed.txt", content: "original" },
) {
  return fakeModel([
    fauxAssistantMessage(fauxToolCall("write", args), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
}

function routePermissionReviews(
  fake: ReturnType<typeof fakeModel>,
  response: string,
  onReview: () => void,
) {
  const mainStream = fake.streamFn;
  fake.streamFn = (model, context, options) => {
    if (
      context.messages.some(
        (message) => message.role === "system" && JSON.stringify(message).includes("REVIEW_POLICY"),
      )
    ) {
      onReview();
      return fakeModel([fauxAssistantMessage(response)]).streamFn(model, context, options);
    }
    return mainStream(model, context, options);
  };
}

test("allowed tools wait for the read-only stage after frontend permission", async () => {
  dirs = await tempDirs();
  const order: string[] = [];
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "allowed.txt", content: "approved" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    async onPermissionAsk() {
      order.push("permission");
      return "allow";
    },
    async onToolCallAllowed({ toolName, args }) {
      expect(toolName).toBe("write");
      expect(args).toEqual({ path: join(dirs.cwd, "allowed.txt"), content: "approved" });
      expect(await Bun.file(join(dirs.cwd, "allowed.txt")).exists()).toBe(false);
      order.push("allowed");
      // Even an untyped callback cannot change the executed input.
      Object.assign(args, { content: "tampered" });
    },
  });
  await session.run("write", {
    onEvent(event) {
      if (event.type === "tool_execution_end") order.push("executed");
    },
  });
  expect(order).toEqual(["permission", "allowed", "executed"]);
  expect(await Bun.file(join(dirs.cwd, "allowed.txt")).text()).toBe("approved");
});

test("cancellation during PreToolUse skips the allowed stage and execution", async () => {
  dirs = await tempDirs();
  const handler = await scriptedHook({ systemMessage: "ready" });
  const controller = new AbortController();
  let called = false;
  const session = await createSession({
    ...dirs,
    ...writeModel(),
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ hooks: [handler] }] } },
    onToolCallAllowed() {
      called = true;
    },
  });
  await expect(
    session.run("write", {
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "hook_message" && event.event === "PreToolUse")
          controller.abort(new Error("cancel before allowed stage"));
      },
    }),
  ).rejects.toThrow("cancel before allowed stage");
  expect(called).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "allowed.txt")).exists()).toBe(false);
});

test.each(["PreToolUse", "PermissionRequest"] as const)(
  "the stage observes validated final input after %s rewrites",
  async (event) => {
    dirs = await tempDirs();
    const updatedInput = { path: "rewritten.txt", content: "changed" };
    const handler = await scriptedHook({
      hookSpecificOutput:
        event === "PreToolUse"
          ? { updatedInput, permissionDecision: "allow" }
          : { decision: { behavior: "allow", updatedInput } },
    });
    const seen: unknown[] = [];
    const session = await createSession({
      ...dirs,
      ...writeModel(),
      settings: { hooks: { [event]: [{ hooks: [handler] }] } },
      async onToolCallAllowed(call) {
        expect(await Bun.file(join(dirs.cwd, "hook.sh.input")).exists()).toBe(true);
        expect(await Bun.file(join(dirs.cwd, "rewritten.txt")).exists()).toBe(false);
        seen.push(call);
      },
    });
    await session.run("write");
    expect(seen).toEqual([
      { toolName: "write", args: { path: join(dirs.cwd, "rewritten.txt"), content: "changed" } },
    ]);
    expect(await Bun.file(join(dirs.cwd, "rewritten.txt")).text()).toBe("changed");
    expect(await Bun.file(join(dirs.cwd, "allowed.txt")).exists()).toBe(false);
  },
);

test("a failed allowed stage becomes a tool error without executing or denying permission", async () => {
  dirs = await tempDirs();
  const fake = writeModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    async onToolCallAllowed() {
      throw new Error("snapshot unavailable");
    },
  });
  let denied = false;
  expect(
    (
      await session.run("write", {
        onEvent(event) {
          if (event.type === "permission_denied") denied = true;
        },
      })
    ).text,
  ).toBe("done");
  expect(session.messages.findLast((message) => message.role === "toolResult")).toMatchObject({
    toolName: "write",
    isError: true,
    content: [{ type: "text", text: "snapshot unavailable" }],
  });
  expect(denied).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "allowed.txt")).exists()).toBe(false);
});

test.each([
  "rule",
  "user",
  "review",
  "PreToolUse deny",
  "PreToolUse stop",
  "PermissionRequest deny",
  "PermissionRequest stop",
  "invalid input",
  "invalid PreToolUse input",
  "invalid PermissionRequest input",
] as const)("%s never reaches the allowed stage", async (denial) => {
  dirs = await tempDirs();
  const fake = writeModel(denial === "invalid input" ? { path: "allowed.txt" } : undefined);
  let reviewed = 0;
  routePermissionReviews(fake, '{"risk":"high","decision":"deny"}', () => reviewed++);
  const hooks: HooksSettings = {};
  if (denial.includes("PreToolUse") || denial.includes("PermissionRequest")) {
    const event = denial.includes("PreToolUse") ? "PreToolUse" : "PermissionRequest";
    const output = denial.endsWith("stop")
      ? { continue: false, stopReason: "stopped" }
      : {
          hookSpecificOutput:
            event === "PreToolUse"
              ? denial.startsWith("invalid")
                ? { updatedInput: { path: "allowed.txt", content: 1 } }
                : { permissionDecision: "deny" }
              : {
                  decision: denial.startsWith("invalid")
                    ? { behavior: "allow", updatedInput: { path: "allowed.txt", content: 1 } }
                    : { behavior: "deny" },
                },
        };
    hooks[event] = [{ hooks: [await scriptedHook(output)] }];
  }
  let called = false;
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { hooks, ...(denial === "rule" && { permissions: { deny: ["write"] } }) },
    permissionMode: denial === "review" ? "auto-review" : "ask",
    onPermissionAsk: async () => "deny",
    onToolCallAllowed() {
      called = true;
    },
  });
  await session.run("write");
  expect(called).toBe(false);
  expect(reviewed).toBe(denial === "review" ? 1 : 0);
  expect(session.messages.findLast((message) => message.role === "toolResult")).toMatchObject({
    isError: true,
  });
  expect(await Bun.file(join(dirs.cwd, "allowed.txt")).exists()).toBe(false);
});

test.each(["rule", "full-access", "review"] as const)(
  "%s allow reaches the stage without frontend interaction",
  async (source) => {
    dirs = await tempDirs();
    const fake = writeModel();
    const order: string[] = [];
    routePermissionReviews(fake, '{"risk":"low","decision":"allow"}', () => order.push("review"));
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: source === "full-access" ? "full-access" : "auto-review",
      ...(source === "rule" && { allowRules: ["write"] }),
      onPermissionAsk: async () => {
        throw new Error("unexpected frontend interaction");
      },
      onToolCallAllowed() {
        order.push("allowed");
      },
    });
    await session.run("write");
    expect(order).toEqual(source === "review" ? ["review", "allowed"] : ["allowed"]);
    expect(await Bun.file(join(dirs.cwd, "allowed.txt")).text()).toBe("original");
  },
);

test.each(["subagent", "subagent_fork"])(
  "%s shares the parent allowed-stage configuration",
  async (toolName) => {
    dirs = await tempDirs();
    const calls: string[] = [];
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall(toolName, {
          description: "write a child file",
          prompt: "write",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("write", { path: "child.txt", content: "child" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("child done"),
      fauxAssistantMessage(fauxToolCall("write", { path: "parent.txt", content: "parent" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("parent done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onToolCallAllowed({ toolName, args }) {
        calls.push(toolName);
        if (toolName === "write") calls.push(String(args.content));
      },
    });
    await session.run("delegate");
    expect(calls).toEqual([toolName, "write", "child", "write", "parent"]);
    expect(await Bun.file(join(dirs.cwd, "child.txt")).text()).toBe("child");
    expect(await Bun.file(join(dirs.cwd, "parent.txt")).text()).toBe("parent");
  },
);

test("cancellation while the allowed stage waits prevents execution", async () => {
  dirs = await tempDirs();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const controller = new AbortController();
  const session = await createSession({
    ...dirs,
    ...writeModel(),
    permissionMode: "full-access",
    async onToolCallAllowed() {
      entered.resolve();
      await release.promise;
    },
  });
  const run = session.run("write", { signal: controller.signal });
  void run.catch(() => {});
  await entered.promise;
  controller.abort(new Error("cancel allowed stage"));
  release.resolve();
  await expect(run).rejects.toThrow("cancel allowed stage");
  expect(await Bun.file(join(dirs.cwd, "allowed.txt")).exists()).toBe(false);
});

import { modelStream, withAuxiliaryRequests, withModelStream } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { symlink } from "node:fs/promises";
import { createSession, type Session } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
  await dirs?.cleanup();
});

test("ask mode asks for an external read and freely writes inside cwd and additional directories", async () => {
  dirs = await tempDirs();
  const external = join(dirs.homeDir, "secret.txt");
  const additional = join(dirs.homeDir, "extra");
  await Bun.write(external, "private");
  await Bun.write(join(additional, ".keep"), "");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "local.txt", content: "local" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("write", { path: join(additional, "new.txt"), content: "extra" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("read", { path: external }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const asked: string[] = [];
  session = await createSession({
    ...dirs,
    ...fake,
    additionalDirectories: [additional],
    onPermissionAsk: async (request) => {
      asked.push(request.toolName);
      return "deny";
    },
  });
  await session.run("access files");
  expect(asked).toEqual(["read"]);
  expect(await Bun.file(join(dirs.cwd, "local.txt")).text()).toBe("local");
  expect(await Bun.file(join(additional, "new.txt")).text()).toBe("extra");
  expect(
    fake.contexts.at(-1)!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({ isError: true });
});

test.each(["ask", "auto-review", "full-access"] as const)(
  "%s applies scope to all file tools",
  async (permissionMode) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.cwd, "inside.txt"), "needle");
    await Bun.write(join(dirs.homeDir, "outside.txt"), "needle");
    const calls = ["read", "glob", "grep", "write", "edit"] as const;
    const fake = fakeModel([
      ...[dirs.cwd, dirs.homeDir].flatMap((root, index) =>
        calls.map((tool) =>
          fauxAssistantMessage(
            fauxToolCall(
              tool,
              tool === "write"
                ? { path: join(root, "new/deep/file.txt"), content: "new" }
                : tool === "edit"
                  ? {
                      path: join(root, index ? "outside.txt" : "inside.txt"),
                      edits: [{ oldText: "needle", newText: "edited" }],
                    }
                  : tool === "glob" || tool === "grep"
                    ? { path: root, pattern: tool === "glob" ? "*.txt" : "needle" }
                    : { path: join(root, index ? "outside.txt" : "inside.txt") },
              { id: `${index}-${tool}` },
            ),
            { stopReason: "toolUse" },
          ),
        ),
      ),
      fauxAssistantMessage("done"),
    ]);
    // Reviews are external model requests; deny them and observe the normal ask fallback.
    const main = modelStream(fake.models);
    const reviewer = fakeModel([fauxAssistantMessage('{"risk":"medium","decision":"deny"}')]);
    fake.models = withModelStream(
      fake.models,
      withAuxiliaryRequests((model, context, options) =>
        context.messages.some(
          (message) =>
            message.role === "system" && JSON.stringify(message).includes("REVIEW_POLICY"),
        )
          ? modelStream(reviewer.models)(model, context, options)
          : main(model, context, options),
      ),
    );
    const asked: string[] = [];
    const reviews: string[] = [];
    session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      onPermissionAsk: async (request) => {
        asked.push(request.toolCallId);
        return "deny";
      },
    });
    await session.run("files", {
      onEvent(event) {
        if (event.type === "permission_review" && event.phase === "start")
          reviews.push(event.toolCallId);
      },
    });
    expect(asked).toEqual(permissionMode === "full-access" ? [] : calls.map((tool) => `1-${tool}`));
    expect(reviews).toEqual(
      permissionMode === "auto-review" ? calls.map((tool) => `1-${tool}`) : [],
    );
    expect(await Bun.file(join(dirs.cwd, "new/deep/file.txt")).text()).toBe("new");
    expect(await Bun.file(join(dirs.cwd, "inside.txt")).text()).toBe("edited");
    expect(await Bun.file(join(dirs.homeDir, "outside.txt")).text()).toBe(
      permissionMode === "full-access" ? "edited" : "needle",
    );
    expect(await Bun.file(join(dirs.homeDir, "new/deep/file.txt")).exists()).toBe(
      permissionMode === "full-access",
    );
  },
);

test("discovered skill references are read only and cwd symlinks do not grant external access", async () => {
  dirs = await tempDirs();
  const skillRoot = join(dirs.homeDir, ".agents/skills/review");
  await Bun.write(
    join(skillRoot, "SKILL.md"),
    "---\nname: review\ndescription: Review changes\n---\nRead references.\n",
  );
  await Bun.write(join(skillRoot, "reference.txt"), "reference");
  await Bun.write(join(dirs.homeDir, "private.txt"), "private");
  await symlink(dirs.homeDir, join(dirs.cwd, "external"));
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("read", { path: join(skillRoot, "reference.txt") }, { id: "reference" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall(
        "write",
        { path: join(skillRoot, "new.txt"), content: "no" },
        { id: "skill-write" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("read", { path: "external/private.txt" }, { id: "link" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const asked: string[] = [];
  session = await createSession({
    ...dirs,
    ...fake,
    onPermissionAsk: async (request) => {
      asked.push(request.toolCallId);
      return "deny";
    },
  });
  await session.run("references");
  expect(asked).toEqual(["skill-write", "link"]);
  expect(
    fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({ isError: false, content: [{ type: "text", text: "reference" }] });
});

test("explicit deny and ask override scope grants and external directory approval covers descendants", async () => {
  dirs = await tempDirs();
  const outside = join(dirs.homeDir, "external");
  const fake = fakeModel([
    ...[
      [join(dirs.cwd, "denied.txt"), "denied"],
      [join(dirs.cwd, "ask.txt"), "ask"],
      [join(outside, "first.txt"), "first"],
      [join(outside, "nested/second.txt"), "second"],
    ].map(([path, id]) =>
      fauxAssistantMessage(
        fauxToolCall("write", { path: path!, content: "written" }, { id: id! }),
        { stopReason: "toolUse" },
      ),
    ),
    fauxAssistantMessage("done"),
  ]);
  const asks: string[] = [];
  session = await createSession({
    ...dirs,
    ...fake,
    settings: { permissions: { deny: ["write(./denied.txt)"], ask: ["write(./ask.txt)"] } },
    onPermissionAsk: async (request) => {
      asks.push(request.toolCallId);
      return request.toolCallId === "first" ? "allow-session" : "deny";
    },
  });
  await session.run("write");
  expect(asks).toEqual(["ask", "first"]);
  expect(await Bun.file(join(dirs.cwd, "denied.txt")).exists()).toBe(false);
  expect(await Bun.file(join(outside, "nested/second.txt")).text()).toBe("written");
});

test.each(["subagent", "subagent_fork"])(
  "%s inherits additional roots and directory approvals",
  async (tool) => {
    dirs = await tempDirs();
    const extra = join(dirs.homeDir, "extra");
    const outside = join(dirs.homeDir, "outside");
    await Bun.write(join(extra, ".keep"), "");
    const write = (path: string) =>
      fauxAssistantMessage(fauxToolCall("write", { path, content: "written" }), {
        stopReason: "toolUse",
      });
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall(tool, { description: "Files", prompt: "child", run_in_background: false }),
        { stopReason: "toolUse" },
      ),
      write(join(extra, "child.txt")),
      write(join(outside, "child.txt")),
      fauxAssistantMessage("child done"),
      write(join(outside, "nested/parent.txt")),
      fauxAssistantMessage("parent done"),
    ]);
    const origins: unknown[] = [];
    session = await createSession({
      ...dirs,
      ...fake,
      additionalDirectories: [extra],
      onPermissionAsk: async (request) => {
        origins.push(request.origin);
        return "allow-session";
      },
    });
    await session.run("delegate");
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({ description: "Files" });
    expect(await Bun.file(join(extra, "child.txt")).text()).toBe("written");
    expect(await Bun.file(join(outside, "nested/parent.txt")).text()).toBe("written");
  },
);

test("the Session Job output directory is readable and refuses writes without approval", async () => {
  dirs = await tempDirs();
  let outputPath = "";
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "printf job-output",
        description: "Output",
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    () => {
      outputPath = session!.jobs()[0]!.spillPath!;
      return fauxAssistantMessage(fauxToolCall("read", { path: outputPath }), {
        stopReason: "toolUse",
      });
    },
    () =>
      fauxAssistantMessage(fauxToolCall("write", { path: outputPath, content: "overwrite" }), {
        stopReason: "toolUse",
      }),
    fauxAssistantMessage("done"),
  ]);
  const asks: string[] = [];
  session = await createSession({
    ...dirs,
    ...fake,
    allowRules: ["bash"],
    onPermissionAsk: async (request) => {
      asks.push(request.toolName);
      return "deny";
    },
  });
  await session.run("output");
  expect(outputPath).toBeString();
  expect(asks).toEqual(["write"]);
  expect(
    fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({ isError: false });
});

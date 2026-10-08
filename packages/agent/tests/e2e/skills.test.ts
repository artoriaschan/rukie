import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createSession as createAgentSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions = new Set<Awaited<ReturnType<typeof createAgentSession>>>();
async function createSession(...args: Parameters<typeof createAgentSession>) {
  const session = await createAgentSession(...args);
  sessions.add(session);
  return session;
}
afterEach(async () => {
  await Promise.all([...sessions].map((session) => session.close()));
  sessions.clear();
  await dirs?.cleanup();
});
function reminders(session: Awaited<ReturnType<typeof createAgentSession>>, source: string) {
  return session.messages
    .filter((message) => message.role === "system-reminder")
    .filter((message) => message.source === source);
}

async function writeSkill(
  root: string,
  namespace: string,
  name: string,
  description: string,
  body: string,
) {
  const path = join(root, namespace, "skills", name, "SKILL.md");
  await Bun.write(path, `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
  return path;
}

test.each([
  ["homeDir", ".rukie"],
  ["homeDir", ".claude"],
  ["homeDir", ".agents"],
  ["cwd", ".rukie"],
  ["cwd", ".claude"],
  ["cwd", ".agents"],
] as const)(
  "discovers %s/%s skills and loads the body by name with default permissions",
  async (level, namespace) => {
    dirs = await tempDirs();
    const path = await writeSkill(
      dirs[level],
      namespace,
      "review",
      "Review a change",
      "Inspect the diff carefully.",
    );
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("skill", { name: "review" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({ ...dirs, ...fake });
    expect(
      (
        await session.run("review changes", {
          onEvent: (event) => {
            events.push(event);
          },
        })
      ).text,
    ).toBe("done");
    expect(getCurrentTools(fake.contexts[0]!.messages).map((tool) => tool.name)).toContain("skill");
    const catalog = reminders(session, "skills")[0];
    expect(catalog).toBeDefined();
    if (catalog?.role !== "system-reminder") throw new Error("Missing skills reminder");
    expect(catalog.content).toContain("Review a change");
    expect(catalog.content).not.toContain("Inspect the diff carefully.");
    expect(JSON.stringify(fake.contexts[0]!.messages)).not.toContain("Inspect the diff carefully.");
    const loaded = fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult")!;
    expect(JSON.stringify(loaded.content)).toContain("Inspect the diff carefully.");
    expect(JSON.stringify(loaded.content)).toContain(path);
    expect(loaded).toMatchObject({ role: "toolResult", toolName: "skill", isError: false });
    expect(events.filter((event) => event.type === "permission_denied")).toEqual([]);
  },
);

test.each([
  "/missing unchanged\n",
  "/不存在的名字 继续",
  "/review/file.ts",
  "/review.md",
  "/tmp/file",
  " /review",
  "explain /review",
  "/",
])("unknown names and paths remain ordinary prompts: %s", async (prompt) => {
  dirs = await tempDirs();
  await writeSkill(dirs.cwd, ".agents", "review", "Review changes", "Never inject this body.");
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const events: SessionEvent[] = [];
  const session = await createSession({ ...dirs, ...fake });
  await session.run(prompt, {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(
    fake.contexts[0]!.messages.findLast(
      (message) =>
        message.role === "user" &&
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "text" && part.text === prompt),
    ),
  ).toMatchObject({
    role: "user",
    content: [{ type: "text", text: prompt }],
  });
  expect(JSON.stringify(fake.contexts[0]!.messages)).not.toContain("Never inject this body.");
  expect(reminders(session, "skill-invocation")).toEqual([]);
});

test("resume preserves the model and Transcript prefix and appends only changed skill lists, including removal of the last skill", async () => {
  dirs = await tempDirs();
  const now = () => new Date("2026-10-01T12:00:00Z");
  await writeSkill(dirs.cwd, ".agents", "review", "Original description", "Original instructions.");
  const fake = fakeModel([fauxAssistantMessage("first reply")]);
  const session = await createSession({ ...dirs, ...fake, now });
  await session.run("/review original prompt");
  const before = structuredClone([...session.messages]);
  await session.close();
  const next = fakeModel([fauxAssistantMessage("continued")]);
  const resumed = await createSession({ ...dirs, ...next, now, resumeId: session.id });
  // Discovery at Run time also catches changes made after createSession.
  await writeSkill(dirs.cwd, ".agents", "review", "Changed description", "Changed instructions.");
  await writeSkill(dirs.homeDir, ".claude", "added", "New capability", "New instructions.");
  const events: SessionEvent[] = [];
  await resumed.run("continue", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(resumed.messages.slice(0, before.length)).toEqual(before);
  expect(resumed.model).toEqual(session.model);
  const updates = reminders(resumed, "skills").slice(reminders(session, "skills").length);
  expect(updates.map((event) => event.source)).toEqual(["skills"]);
  expect(updates[0]!.content).toContain("Changed description");
  expect(updates[0]!.content).toContain("New capability");
  expect(updates[0]!.content).not.toContain("Original description");

  await rm(join(dirs.homeDir, ".claude/skills"), { recursive: true });
  await rm(join(dirs.cwd, ".agents/skills"), { recursive: true });
  const final = fakeModel([fauxAssistantMessage("removed"), fauxAssistantMessage("unchanged")]);
  await resumed.close();
  const empty = await createSession({ ...dirs, ...final, now, resumeId: session.id });
  events.length = 0;
  await empty.run("no skills", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const emptyCatalog = reminders(empty, "skills");
  expect(emptyCatalog.at(-1)).toMatchObject({
    role: "system-reminder",
    source: "skills",
    content: expect.stringContaining("No skills are available through the skill tool."),
  });
  events.length = 0;
  await empty.run("still empty", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(reminders(empty, "skills")).toEqual(emptyCatalog);
});

test("an unchanged skill list is not reinjected and the tool loads the current body in a later Run", async () => {
  dirs = await tempDirs();
  await writeSkill(dirs.cwd, ".rukie", "review", "Stable description", "First instructions.");
  const fake = fakeModel([
    fauxAssistantMessage("first reply"),
    fauxAssistantMessage(fauxToolCall("skill", { name: "review" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("second reply"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("first");
  const catalog = reminders(session, "skills");
  await writeSkill(dirs.cwd, ".rukie", "review", "Stable description", "Updated instructions.");
  const events: SessionEvent[] = [];
  await session.run("load review", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(reminders(session, "skills")).toEqual(catalog);
  expect(
    JSON.stringify(
      fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult")!.content,
    ),
  ).toContain("Updated instructions.");
});

test("an unknown skill returns isError to the model without denying permission or ending the Run", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("skill", { name: "missing" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("recovered"),
  ]);
  const events: SessionEvent[] = [];
  const session = await createSession({ ...dirs, ...fake });
  expect(
    (
      await session.run("load skill", {
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).text,
  ).toBe("recovered");
  expect(
    fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({
    role: "toolResult",
    toolName: "skill",
    isError: true,
    content: [{ type: "text", text: expect.stringContaining("Skill not found: missing") }],
  });
  expect(events.filter((event) => event.type === "permission_denied")).toEqual([]);
});

test("Skill Invocation appends the body as a reminder and preserves the original prompt on every Run", async () => {
  dirs = await tempDirs();
  const path = await writeSkill(
    dirs.cwd,
    ".agents",
    "review",
    "Review changes",
    "Read references/checklist.md first.",
  );
  const fake = fakeModel([
    fauxAssistantMessage("first reply"),
    fauxAssistantMessage("second reply"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const prompt = "/review  Inspect this change\nKeep the original spacing.\n";
  for (let i = 0; i < 2; i++) {
    const events: SessionEvent[] = [];
    await session.run(prompt, {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const messages = fake.contexts[i]!.messages;
    expect(
      messages.findLast(
        (message) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === "text" && part.text === prompt),
      ),
    ).toMatchObject({
      role: "user",
      content: [{ type: "text", text: prompt }],
    });
    const reminder = messages.findLast(
      (message) =>
        message.role === "user" &&
        JSON.stringify(message.content).includes("Read references/checklist.md first."),
    )!;
    expect(reminder.role).toBe("user");
    const text = JSON.stringify(reminder.content);
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("Read references/checklist.md first.");
    expect(text).toContain(path);
    expect(reminders(session, "skill-invocation")).toHaveLength(i + 1);
  }
});

test("project skills take precedence over user skills across namespaces", async () => {
  dirs = await tempDirs();
  await writeSkill(dirs.homeDir, ".agents", "review", "User review", "User instructions");
  await writeSkill(dirs.cwd, ".rukie", "review", "Project review", "Project instructions");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("skill", { name: "review" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  await (await createSession({ ...dirs, ...fake })).run("review");
  const catalog = JSON.stringify(fake.contexts[0]!.messages);
  expect(catalog).toContain("Project review");
  expect(catalog).not.toContain("User review");
  const loaded = JSON.stringify(
    fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult")!.content,
  );
  expect(loaded).toContain("Project instructions");
  expect(loaded).not.toContain("User instructions");
});

test("invalid skills are skipped with warnings while valid skills and the Run remain usable", async () => {
  dirs = await tempDirs();
  await writeSkill(dirs.homeDir, ".agents", "review", "Valid fallback", "Valid instructions");
  const invalid = [
    ["review", "---\nname: review\ndescription: [broken\n---\nBad YAML"],
    ["missing-name", "---\ndescription: Missing the required name\n---\nBad name"],
    ["missing-description", "---\nname: missing-description\n---\nBad description"],
    ["mismatch", "---\nname: other\ndescription: Wrong directory\n---\nBad match"],
    ["Uppercase", "---\nname: Uppercase\ndescription: Invalid name\n---\nBad case"],
    ["too-long", `---\nname: too-long\ndescription: ${"x".repeat(1025)}\n---\nBad length`],
    ["no-frontmatter", "# No YAML frontmatter"],
  ];
  const paths: string[] = [];
  for (const [name, content] of invalid) {
    const path = join(dirs.cwd, ".rukie/skills", name!, "SKILL.md");
    paths.push(path);
    await Bun.write(path, content!);
  }
  const warnings: string[] = [];
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("skill", { name: "review" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("skill", { name: "missing-name" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });
  expect((await session.run("review")).text).toBe("recovered");
  for (const path of paths) expect(warnings.some((warning) => warning.includes(path))).toBe(true);
  const catalog = JSON.stringify(fake.contexts[0]!.messages);
  expect(catalog).toContain("Valid fallback");
  for (const name of [
    "missing-name",
    "missing-description",
    "other",
    "Uppercase",
    "too-long",
    "no-frontmatter",
  ])
    expect(catalog).not.toContain(`- ${name}:`);
  expect(
    JSON.stringify(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult")!.content,
    ),
  ).toContain("Valid instructions");
  expect(
    fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({
    role: "toolResult",
    toolName: "skill",
    isError: true,
  });
});

test("catalog descriptions collapse whitespace, fit 500 characters, and ignore unrendered changes", async () => {
  dirs = await tempDirs();
  const description = `  Review\n\t changes   ${"x".repeat(600)}`;
  const path = await writeSkill(
    dirs.cwd,
    ".agents",
    "review",
    JSON.stringify(description),
    "PRIVATE_BODY",
  );
  const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("first");
  const catalog = reminders(session, "skills")[0]!;
  const line = catalog.content.split("\n").find((line) => line.startsWith("- review:"))!;
  const rendered = line.slice("- review: ".length);
  expect(rendered).toHaveLength(500);
  expect(rendered).toStartWith("Review changes ");
  expect(rendered).toEndWith("...");
  expect(catalog.content).not.toContain(path);
  expect(catalog.content).not.toContain("PRIVATE_BODY");
  const normalized = `Review changes ${"x".repeat(600)}TAIL`;
  await writeSkill(
    dirs.cwd,
    ".agents",
    "review",
    JSON.stringify(normalized),
    "UPDATED_PRIVATE_BODY",
  );
  await session.run("second");
  expect(reminders(session, "skills")).toHaveLength(1);
});

test("user-only skills stay out of the model catalog and loader but slash invocation supplies instructions once", async () => {
  dirs = await tempDirs();
  const path = await writeSkill(dirs.cwd, ".agents", "manual", "Manual only", "MANUAL_BODY");
  await Bun.write(
    path,
    "---\nname: manual\ndescription: Manual only\ndisable-model-invocation: true\nwhenToUse: NEVER_CATALOG\n---\nMANUAL_BODY\n",
  );
  await writeSkill(dirs.cwd, ".agents", "review", "Review changes", "REVIEW_BODY");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("skill", { name: "manual" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("first"),
    fauxAssistantMessage("second"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("load manual");
  expect(reminders(session, "skills")[0]!.content).not.toContain("manual");
  expect(JSON.stringify(fake.contexts[0]!.messages)).not.toContain("MANUAL_BODY");
  expect(
    fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({ isError: true });
  await session.run("/manual requested by user");
  expect(JSON.stringify(fake.contexts[2]!.messages)).toContain("MANUAL_BODY");
  expect(reminders(session, "skill-invocation").at(-1)!.content).toContain(
    "do not call the skill tool again",
  );
  expect(reminders(session, "skills")).toHaveLength(1);
});

test("no callable skills means no initial directory", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("hello");
  expect(reminders(session, "skills")).toEqual([]);
});

test.each([true, false])(
  "child skill directory follows skill tool visibility=%s",
  async (visible) => {
    dirs = await tempDirs();
    await writeSkill(dirs.cwd, ".agents", "review", "UNIQUE_SKILL_CATALOG", "PRIVATE_BODY");
    await Bun.write(
      join(dirs.cwd, ".rukie/agents/limited.md"),
      `---\nname: limited\ndescription: Limited\ntools: [${visible ? "skill" : "read"}]\n---\nInspect only.\n`,
    );
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          subagent_type: "limited",
          description: "inspect",
          prompt: "inspect",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(getCurrentTools(context.messages).some((tool) => tool.name === "skill")).toBe(
          visible,
        );
        expect(JSON.stringify(context.messages).includes("UNIQUE_SKILL_CATALOG")).toBe(visible);
        return fauxAssistantMessage("child done");
      },
      fauxAssistantMessage("parent done"),
    ]);
    expect((await (await createSession({ ...dirs, ...fake })).run("delegate")).text).toBe(
      "parent done",
    );
  },
);

test("a compacted-away directory is republished once, then unchanged requests and resume reuse it", async () => {
  dirs = await tempDirs();
  await writeSkill(dirs.cwd, ".agents", "review", "POST_COMPACTION_SKILL", "PRIVATE_BODY");
  await Bun.write(join(dirs.cwd, "evidence.txt"), "OLD_EVIDENCE ".repeat(4500));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("old evidence"),
    fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("second old evidence"),
    fauxAssistantMessage("recent reply"),
    fauxAssistantMessage("Summary only."),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("again"),
  ]);
  let session = await createSession({ ...dirs, ...fake });
  await session.run("old task");
  await session.run("second old task");
  await session.run("recent task");
  await session.compact();
  await session.run("continue");
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain("Summary only.");
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain("POST_COMPACTION_SKILL");
  expect(reminders(session, "skills")).toHaveLength(2);
  await session.run("again");
  expect(reminders(session, "skills")).toHaveLength(2);
  const resumeId = session.id;
  await session.close();
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  session = await createSession({ ...dirs, ...next, resumeId });
  await session.run("resume");
  expect(reminders(session, "skills")).toHaveLength(2);
  expect(JSON.stringify(next.contexts[0]!.messages)).toContain("POST_COMPACTION_SKILL");
});

test("user-invocable false skills remain model-callable but do not expand slash prompts", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, ".agents/skills/model-only/SKILL.md"),
    "---\nname: model-only\ndescription: Model only\nuser-invocable: false\n---\nMODEL_ONLY_BODY\n",
  );
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("skill", { name: "model-only" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("/model-only ordinary text");
  expect(reminders(session, "skill-invocation")).toHaveLength(0);
  expect(reminders(session, "skills")[0]!.content).toContain("model-only");
  expect(JSON.stringify(fake.contexts[0]!.messages)).not.toContain("MODEL_ONLY_BODY");
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("MODEL_ONLY_BODY");
});

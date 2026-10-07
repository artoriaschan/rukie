import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { readdir, rm } from "node:fs/promises";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

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
    expect(events[0]).toMatchObject({
      type: "session_start",
      tools: expect.arrayContaining(["skill"]),
    });
    const catalog = events.find(
      (event) => event.type === "reminder_injected" && event.source === "skills",
    );
    expect(catalog).toBeDefined();
    if (catalog?.type !== "reminder_injected") throw new Error("Missing skills reminder");
    expect(catalog.content).toContain("Review a change");
    expect(catalog.content).not.toContain("Inspect the diff carefully.");
    expect(JSON.stringify(fake.contexts[0]!.messages)).not.toContain("Inspect the diff carefully.");
    const loaded = fake.contexts[1]!.messages.at(-1)!;
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
  await (
    await createSession({ ...dirs, ...fake })
  ).run(prompt, {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(fake.contexts[0]!.messages.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: prompt }],
  });
  expect(JSON.stringify(fake.contexts[0]!.messages)).not.toContain("Never inject this body.");
  expect(
    events.filter(
      (event) => event.type === "reminder_injected" && event.source === "skill-invocation",
    ),
  ).toEqual([]);
});

async function transcript() {
  const root = join(dirs.homeDir, ".rukie/sessions");
  const file = (await readdir(root, { recursive: true })).find((path) => path.endsWith(".jsonl"))!;
  return Bun.file(join(root, file)).text();
}

test("resume preserves the model and Transcript prefix and appends only changed skill lists, including removal of the last skill", async () => {
  dirs = await tempDirs();
  const now = () => new Date("2026-10-01T12:00:00Z");
  await writeSkill(dirs.cwd, ".agents", "review", "Original description", "Original instructions.");
  const fake = fakeModel([fauxAssistantMessage("first reply")]);
  const session = await createSession({ ...dirs, ...fake, now });
  await session.run("/review original prompt");
  const before = await transcript();
  const prefix = structuredClone(fake.contexts[0]!.messages);
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
  expect(next.contexts[0]!.messages.slice(0, prefix.length)).toEqual(prefix);
  expect(await transcript()).toStartWith(before);
  const updates = events.filter((event) => event.type === "reminder_injected");
  expect(updates.map((event) => event.source)).toEqual(["skills"]);
  expect(updates[0]!.content).toContain("Changed description");
  expect(updates[0]!.content).toContain("New capability");
  expect(updates[0]!.content).not.toContain("Original description");

  await rm(join(dirs.homeDir, ".claude/skills"), { recursive: true });
  await rm(join(dirs.cwd, ".agents/skills"), { recursive: true });
  const final = fakeModel([fauxAssistantMessage("removed"), fauxAssistantMessage("unchanged")]);
  const empty = await createSession({ ...dirs, ...final, now, resumeId: session.id });
  events.length = 0;
  await empty.run("no skills", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([
    {
      type: "reminder_injected",
      sessionId: session.id,
      source: "skills",
      content: "Available skills: none.",
    },
  ]);
  events.length = 0;
  await empty.run("still empty", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([]);
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
  await writeSkill(dirs.cwd, ".rukie", "review", "Stable description", "Updated instructions.");
  const events: SessionEvent[] = [];
  await session.run("load review", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([]);
  expect(JSON.stringify(fake.contexts[2]!.messages.at(-1)!.content)).toContain(
    "Updated instructions.",
  );
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
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    toolName: "skill",
    isError: true,
    content: [{ type: "text", text: "Skill not found: missing" }],
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
    expect(messages.at(-2)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: prompt }],
    });
    const reminder = messages.at(-1)!;
    expect(reminder.role).toBe("user");
    const text = JSON.stringify(reminder.content);
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("Read references/checklist.md first.");
    expect(text).toContain(path);
    expect(
      events.filter(
        (event) => event.type === "reminder_injected" && event.source === "skill-invocation",
      ),
    ).toHaveLength(1);
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
  const loaded = JSON.stringify(fake.contexts[1]!.messages.at(-1)!.content);
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
  expect(JSON.stringify(fake.contexts[1]!.messages.at(-1)!.content)).toContain(
    "Valid instructions",
  );
  expect(fake.contexts[2]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    toolName: "skill",
    isError: true,
  });
});

import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([0, 2])(
  "permission notification starts without delaying the interaction and only displays systemMessage (exit %s)",
  async (exitCode) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "notify.sh"),
      `cat > notification.json
while [ ! -f replied ]; do sleep 0.01; done
printf '%s' '{"continue":false,"stopReason":"must not stop","decision":"block","systemMessage":"approval notice","hookSpecificOutput":{"additionalContext":"must not reach model"}}'
exit ${exitCode}
`,
    );
    const notified = Promise.withResolvers<void>();
    const events: SessionEvent[] = [];
    let asks = 0;
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { description: "Run test command", command: "printf approved" }),
        {
          stopReason: "toolUse",
        },
      ),
      async () => {
        await waitForNotification(notified.promise);
        return fauxAssistantMessage("done");
      },
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "ask",
      settings: {
        hooks: {
          Notification: [
            { matcher: "permission_prompt", hooks: [{ type: "command", command: "sh notify.sh" }] },
            { matcher: "question", hooks: [{ type: "command", command: "touch wrong-matcher" }] },
          ],
        },
      },
      onWarning: () => {},
      onPermissionAsk: async () => {
        asks++;
        await Bun.write(join(dirs.cwd, "replied"), "yes");
        return "allow";
      },
    });
    try {
      const result = await session.run("try", {
        onEvent(event) {
          events.push(event);
          if (event.type === "hook_message") notified.resolve();
        },
      });
      expect(result.text).toBe("done");
      expect(result.stopReason).not.toBe("hook_stopped");
      expect(asks).toBe(1);
      expect(await Bun.file(join(dirs.cwd, "wrong-matcher")).exists()).toBe(false);
      const input = await Bun.file(join(dirs.cwd, "notification.json")).json();
      expect(input).toMatchObject({
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        session_id: session.id,
        permission_mode: "ask",
      });
      expect(input.message).toContain("bash");
      expect(input.title.length).toBeGreaterThan(0);
      expect(events.filter((event) => event.type === "hook_message")).toMatchObject([
        { event: "Notification", message: "approval notice" },
      ]);
      expect(JSON.stringify(fake.contexts)).not.toContain("must not reach model");
    } finally {
      await session.dispose();
    }
  },
);

test("question interaction emits one matching notification with its question text", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "notify.sh"),
    `cat > question.json
printf '%s' '{"systemMessage":"question notice"}'
`,
  );
  const notified = Promise.withResolvers<void>();
  const questions = [
    {
      header: "Choice",
      question: "Which color?",
      options: [
        { label: "Red", description: "Warm" },
        { label: "Blue", description: "Cool" },
      ],
    },
  ];
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("ask_user_question", { questions }), {
      stopReason: "toolUse",
    }),
    async () => {
      await waitForNotification(notified.promise);
      return fauxAssistantMessage("answered");
    },
  ]);
  let asks = 0;
  let notices = 0;
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        Notification: [
          { matcher: "question", hooks: [{ type: "command", command: "sh notify.sh" }] },
        ],
      },
    },
    onQuestion: async () => {
      asks++;
      return { answers: [{ selected: ["Blue"] }] };
    },
  });
  try {
    expect(
      (
        await session.run("ask", {
          onEvent(event) {
            if (event.type === "hook_message") {
              notices++;
              notified.resolve();
            }
          },
        })
      ).text,
    ).toBe("answered");
    expect(asks).toBe(1);
    expect(notices).toBe(1);
    expect(await Bun.file(join(dirs.cwd, "question.json")).json()).toMatchObject({
      notification_type: "question",
      message: "Which color?",
      title: expect.any(String),
    });
  } finally {
    await session.dispose();
  }
});

test("plan review notifies with the submitted plan", async () => {
  dirs = await tempDirs();
  const notified = Promise.withResolvers<void>();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("exit_plan_mode", { plan: "Implement the feature." }), {
      stopReason: "toolUse",
    }),
    async () => {
      await waitForNotification(notified.promise);
      return fauxAssistantMessage("approved");
    },
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        Notification: [
          {
            matcher: "plan_review",
            hooks: [
              {
                type: "command",
                command: `cat > plan.json; echo '{"systemMessage":"plan notice"}'`,
              },
            ],
          },
        ],
      },
    },
    onPlanReview: async () => ({ kind: "approve" }),
  });
  try {
    await session.setPlanMode(true);
    expect(
      (
        await session.run("plan", {
          onEvent(event) {
            if (event.type === "hook_message") notified.resolve();
          },
        })
      ).text,
    ).toBe("approved");
    expect(await Bun.file(join(dirs.cwd, "plan.json")).json()).toMatchObject({
      notification_type: "plan_review",
      message: "Implement the feature.",
    });
  } finally {
    await session.dispose();
  }
});

async function waitForNotification(notification: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      notification,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Notification missing")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 2000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Notification process did not reach expected state");
    await Bun.sleep(5);
  }
}

test("child permission notification includes child session identity", async () => {
  dirs = await tempDirs();
  const notified = Promise.withResolvers<void>();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "child",
        prompt: "inspect",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command: "printf child" }),
      {
        stopReason: "toolUse",
      },
    ),
    async () => {
      await waitForNotification(notified.promise);
      return fauxAssistantMessage("child done");
    },
    fauxAssistantMessage("parent done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "ask",
    settings: {
      permissions: { allow: ["subagent"] },
      hooks: {
        Notification: [
          {
            matcher: "permission_prompt",
            hooks: [
              {
                type: "command",
                command: `cat > child.json; echo '{"systemMessage":"child notice"}'`,
              },
            ],
          },
        ],
      },
    },
    onPermissionAsk: async () => "allow",
  });
  try {
    expect(
      (
        await session.run("delegate", {
          onEvent(event) {
            if (event.type === "subagent_event" && event.event.type === "hook_message")
              notified.resolve();
          },
        })
      ).text,
    ).toBe("parent done");
    const input = await Bun.file(join(dirs.cwd, "child.json")).json();
    expect(input.agent_id).toBe(input.session_id);
    expect(input.agent_id).not.toBe(session.id);
    expect(input.agent_type).toBe("general-purpose");
    expect(input.notification_type).toBe("permission_prompt");
  } finally {
    await session.dispose();
  }
});

test.each(["cancel", "dispose"])(
  "%s kills notification process while frontend awaits a reply",
  async (action) => {
    dirs = await tempDirs();
    const controller = new AbortController();
    const asked = Promise.withResolvers<void>();
    const session = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(
          fauxToolCall("bash", { description: "Run test command", command: "touch forbidden" }),
          {
            stopReason: "toolUse",
          },
        ),
      ]),
      permissionMode: "ask",
      settings: {
        hooks: {
          Notification: [
            {
              hooks: [
                { type: "command", command: "cat > input; echo $$ > pid; sleep 30; touch late" },
              ],
            },
          ],
        },
      },
      onPermissionAsk: async () => {
        asked.resolve();
        return new Promise(() => {});
      },
    });
    const run = session.run("try", { signal: controller.signal }).catch((error: unknown) => error);
    let pid: number | undefined;
    try {
      await asked.promise;
      await until(() => Bun.file(join(dirs.cwd, "pid")).exists());
      pid = Number(await Bun.file(join(dirs.cwd, "pid")).text());
      expect(() => process.kill(pid!, 0)).not.toThrow();
      if (action === "cancel") controller.abort();
      else await session.dispose();
      expect(await run).toBeInstanceOf(Error);
      await until(() => {
        try {
          process.kill(pid!, 0);
          return false;
        } catch {
          return true;
        }
      });
      expect(await Bun.file(join(dirs.cwd, "forbidden")).exists()).toBe(false);
      expect(await Bun.file(join(dirs.cwd, "late")).exists()).toBe(false);
    } finally {
      await session.dispose();
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* Closed. */
        }
      }
    }
  },
);

test.each([undefined, "async", "asyncRewake"] as const)(
  "late notification %s displays after the Run without waking or feeding the model",
  async (background) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "late-notify.sh"),
      `cat > late-input.json
while [ ! -f release-notice ]; do sleep 0.01; done
printf '%s' '{"continue":false,"stopReason":"notification cannot stop","decision":"block","systemMessage":"late user notice","hookSpecificOutput":{"additionalContext":"notification cannot feed model"}}'
echo 'notification cannot rewake' >&2
exit 2
`,
    );
    const noticed = Promise.withResolvers<void>();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { description: "Run test command", command: "printf approved" }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage("done"),
      fauxAssistantMessage("next prompt done"),
    ]);
    let notices = 0;
    const ignoredFields: string[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "ask",
      onWarning: () => {},
      settings: {
        hooks: {
          Notification: [
            {
              hooks: [
                {
                  type: "command",
                  command: "sh late-notify.sh",
                  ...(background ? { [background]: true } : {}),
                },
              ],
            },
          ],
        },
      },
      onPermissionAsk: async () => "allow",
    });
    try {
      expect(
        (
          await session.run("first", {
            onEvent(event) {
              if (event.type === "hook_warning" && event.error?.code === "hook-output-ignored")
                ignoredFields.push(event.error.params.field);
              if (event.type === "hook_message") {
                notices++;
                noticed.resolve();
              }
            },
          })
        ).text,
      ).toBe("done");
      expect(notices).toBe(0);
      await Bun.write(join(dirs.cwd, "release-notice"), "release");
      await waitForNotification(noticed.promise);
      expect(notices).toBe(1);
      expect(ignoredFields).toEqual([
        "continue",
        "stopReason",
        "decision",
        "hookSpecificOutput.additionalContext",
      ]);
      expect(session.running).toBe(false);
      expect(fake.contexts).toHaveLength(2);
      expect((await session.run("next")).text).toBe("next prompt done");
      const messages = JSON.stringify(fake.contexts.at(-1)!.messages);
      expect(messages).not.toContain("late user notice");
      expect(messages).not.toContain("notification cannot feed model");
      expect(messages).not.toContain("notification cannot rewake");
    } finally {
      await session.dispose();
    }
  },
);

test("parent disposal kills completed child async notification processes", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "child",
        prompt: "inspect",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command: "printf child" }),
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("parent done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "ask",
    settings: {
      permissions: { allow: ["subagent"] },
      hooks: {
        Notification: [
          {
            matcher: "permission_prompt",
            hooks: [
              {
                type: "command",
                command: "cat > child-input; echo $$ > child-pid; sleep 30; touch child-late",
                asyncRewake: true,
              },
            ],
          },
        ],
      },
    },
    onPermissionAsk: async () => "allow",
  });
  let pid: number | undefined;
  try {
    expect((await session.run("delegate")).text).toBe("parent done");
    await until(() => Bun.file(join(dirs.cwd, "child-pid")).exists());
    pid = Number(await Bun.file(join(dirs.cwd, "child-pid")).text());
    expect(() => process.kill(pid!, 0)).not.toThrow();
    await session.dispose();
    await until(() => {
      try {
        process.kill(pid!, 0);
        return false;
      } catch {
        return true;
      }
    });
    expect(await Bun.file(join(dirs.cwd, "child-late")).exists()).toBe(false);
  } finally {
    await session.dispose();
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Closed. */
      }
    }
  }
});

test("HTTP notification runs beside permission interaction and warns while discarding control output", async () => {
  dirs = await tempDirs();
  const answered = Promise.withResolvers<void>();
  const noticed = Promise.withResolvers<void>();
  const inputs: unknown[] = [];
  const events: SessionEvent[] = [];
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests++;
      inputs.push(await request.json());
      await answered.promise;
      return Response.json({
        continue: false,
        decision: "block",
        systemMessage: "HTTP approval notice",
        hookSpecificOutput: {
          hookEventName: "Notification",
          additionalContext: "HTTP forbidden context",
        },
      });
    },
  });
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command: "printf approved" }),
      {
        stopReason: "toolUse",
      },
    ),
    async () => {
      await waitForNotification(noticed.promise);
      return fauxAssistantMessage("HTTP done");
    },
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "ask",
    onWarning: () => {},
    settings: {
      hooks: {
        Notification: [
          { matcher: "permission_prompt", hooks: [{ type: "http", url: server.url.toString() }] },
          {
            matcher: "permission_prompt",
            hooks: [{ type: "http", url: new URL("filtered", server.url).toString(), if: "bash" }],
          },
        ],
      },
    },
    onPermissionAsk: async () => {
      answered.resolve();
      return "allow";
    },
  });
  try {
    expect(
      (
        await session.run("try", {
          onEvent(event) {
            events.push(event);
            if (event.type === "hook_message") noticed.resolve();
          },
        })
      ).text,
    ).toBe("HTTP done");
    expect(requests).toBe(1);
    expect(inputs).toMatchObject([
      {
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        session_id: session.id,
      },
    ]);
    expect(events.filter((event) => event.type === "hook_message")).toMatchObject([
      { message: "HTTP approval notice" },
    ]);
    expect(
      events.flatMap((event) =>
        event.type === "hook_warning" && event.error?.code === "hook-output-ignored"
          ? [event.error.params.field]
          : [],
      ),
    ).toEqual(["continue", "decision", "hookSpecificOutput.additionalContext"]);
    expect(JSON.stringify(fake.contexts)).not.toContain("HTTP forbidden context");
    expect(
      events.some(
        (event) => event.type === "hook_warning" && event.error?.code === "hook-if-nontool",
      ),
    ).toBe(true);
  } finally {
    await session.dispose();
    server.stop(true);
  }
});

test("a notification event observer can cancel a pending session permission interaction", async () => {
  dirs = await tempDirs();
  const controller = new AbortController();
  let asks = 0;
  let notices = 0;
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command: "touch forbidden" }),
      {
        stopReason: "toolUse",
      },
    ),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "ask",
    settings: {
      hooks: {
        Notification: [
          {
            hooks: [
              {
                type: "command",
                command: `cat >/dev/null; echo '{"systemMessage":"cancel this request"}'`,
              },
            ],
          },
        ],
      },
    },
    onPermissionAsk: async () => {
      asks++;
      return new Promise(() => {});
    },
  });
  try {
    await expect(
      session.run("try", {
        signal: controller.signal,
        onEvent(event) {
          if (event.type === "hook_message") {
            notices++;
            controller.abort();
          }
        },
      }),
    ).rejects.toThrow();
    expect(asks).toBe(1);
    expect(notices).toBe(1);
    expect(await Bun.file(join(dirs.cwd, "forbidden")).exists()).toBe(false);
  } finally {
    await session.dispose();
  }
});

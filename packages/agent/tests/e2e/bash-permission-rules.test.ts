import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PERMISSION_MODES } from "@neant/shared";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([...PERMISSION_MODES])(
  "compound bash deny blocks every segment in %s",
  async (permissionMode) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.cwd, "victim"), "keep");
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall(
          "bash",
          { command: "printf ran > marker && rm -rf victim" },
          { id: "compound" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      settings: { permissions: { allow: ["bash"], deny: ["bash(rm -rf *)"] } },
      onPermissionAsk: async () => {
        asks++;
        return "allow";
      },
    });
    await session.run("try compound", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(asks).toBe(0);
    expect(events.filter((event) => event.type === "permission_review")).toEqual([]);
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { toolCallId: "compound", by: "rule", rule: "bash(rm -rf *)" },
    ]);
    expect(
      fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      {
        isError: true,
        content: [{ type: "text", text: "Denied by permission rule: bash(rm -rf *)" }],
      },
    ]);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    expect(await Bun.file(join(dirs.cwd, "victim")).text()).toBe("keep");
  },
);

test.each([false, true])(
  "pipeline runs only when each segment has allow coverage: %s",
  async (covered) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", { command: "printf approved | cat > marker" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "ask",
      settings: {
        permissions: {
          allow: ["bash(printf approved*)", ...(covered ? ["bash(cat > marker)"] : [])],
        },
      },
      onPermissionAsk: async () => {
        asks++;
        return "deny";
      },
    });
    await session.run("pipeline");
    expect(asks).toBe(covered ? 0 : 1);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(covered);
    if (covered) expect(await Bun.file(join(dirs.cwd, "marker")).text()).toBe("approved");
  },
);

test.each(["ask", "full-access"] as const)(
  "complex syntax defers to %s even with bare allow",
  async (permissionMode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { command: "printf $(printf approved) > marker" }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage("done"),
    ]);
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      settings: { permissions: { allow: ["bash", "bash(*)"] } },
      onPermissionAsk: async () => {
        asks++;
        return "deny";
      },
    });
    await session.run("complex");
    expect(asks).toBe(permissionMode === "ask" ? 1 : 0);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(
      permissionMode === "full-access",
    );
  },
);

import { expect, test } from "bun:test";
import { crashedSubagents } from "../helpers/agent-fixtures";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { start } from "../helpers/app";

for (const outcome of ["completed", "interrupted"] as const)
  test(`unrelated subagent updates preserve the observed ${outcome} history, but a new Run of that child starts fresh`, async () => {
    const argv: string[] = [];
    let childId = "";
    const savedLabel = outcome === "completed" ? "Run ended normally" : "Run aborted";
    const app = await start(argv, {
      columns: 100,
      rows: 30,
      env: { LANG: "en_US.UTF-8" },
      async prepare(root) {
        const saved = await crashedSubagents({ cwd: root, homeDir: root });
        const child = await saved.child(
          "Confirmed old child",
          outcome === "completed" ? "completed" : "aborted",
        );
        childId = child.metadata.id;
        await saved.save();
        argv.push("--resume", saved.parentId);
      },
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      expect(app.calls).toHaveLength(0);
      app.stdin.write("\x01\r");
      await app.waitFor(() => screen().includes("id "));
      expect(screen()).toContain(savedLabel);
      app.stdin.write("\x1b");
      await app.waitFor(() => screen().includes("─ Subagents "));
      app.stdin.write("\x1b");
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("start unrelated work\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("subagent", {
        description: "Unrelated new child",
        prompt: "unrelated instruction",
      });
      await app.waitFor(() => app.calls.length === 3 && screen().includes("Unrelated new child"));
      const unrelatedCall = app.calls
        .slice(1)
        .find((call) =>
          call.context.messages.some(
            (message) =>
              message.role === "user" &&
              JSON.stringify(message.content).includes("unrelated instruction"),
          ),
        )!;
      unrelatedCall.delta("Unrelated live output");
      app.stdin.write("\x01\r");
      await app.waitFor(() => screen().includes("id ") && screen().includes("Confirmed old child"));
      expect(screen()).toContain(savedLabel);
      expect(screen()).not.toContain("Run outcome unknown");
      // Address the same child through the real parent model boundary: its new
      // Run must not borrow the observed ending of the previous Run.
      const parentCall = app.calls
        .slice(1)
        .find((call) =>
          getCurrentSystemMessage(call.context.messages)?.toolsAdded?.some(
            (tool) => tool.name === "subagent",
          ),
        )!;
      parentCall.tool("send_message", { agent_id: childId, message: "continue original" });
      await app.waitFor(() => app.calls.length === 5 && screen().includes("running"));
      expect(screen()).not.toContain(savedLabel);
      expect(
        app.calls.some((call) =>
          call.context.messages.some(
            (message) =>
              message.role === "user" &&
              JSON.stringify(message.content).includes("continue original"),
          ),
        ),
      ).toBe(true);
      app.stdin.write("\x1b");
      await app.waitFor(() => screen().includes("─ Subagents "));
      app.stdin.write("\x1b[B\r");
      await app.waitFor(() => screen().includes("id ") && screen().includes("Unrelated new child"));
      expect(screen()).toContain("running");
      expect(screen()).toContain("faux/faux-1");
      app.stdin.write("\x1b[C");
      await app.waitFor(() => screen().includes("Unrelated live output"));
      expect(unrelatedCall.signal!.aborted).toBe(false);
      const continuedCall = app.calls.find((call) =>
        call.context.messages.some(
          (message) =>
            message.role === "user" &&
            typeof message.content !== "string" &&
            message.content.some(
              (part) => part.type === "text" && part.text === "continue original",
            ),
        ),
      )!;
      continuedCall.fail("new Run failure");
      app.stdin.write("\x1b");
      await app.waitFor(() => screen().includes("─ Subagents "));
      app.stdin.write("\x1b[A\r");
      await app.waitFor(
        () =>
          screen().includes("id ") &&
          screen().includes("Confirmed old child") &&
          screen().includes("Run ended with error"),
      );
      expect(screen()).not.toContain(savedLabel);
      expect(screen()).toContain("new Run failure");
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  });

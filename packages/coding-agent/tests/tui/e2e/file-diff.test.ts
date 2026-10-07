import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";

test("write diffs show deletion/addition prefixes and an eight-line fold", async () => {
  const app = await start(["--yolo", "change file"], {
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "file.txt"), "before\n");
    },
    rows: 40,
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", {
      path: "file.txt",
      content: Array.from({ length: 12 }, (_, i) => `after-${i}`).join("\n") + "\n",
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const text = app.screen().join("\n");
    expect(text).toContain("file.txt");
    expect(text).toContain("-before");
    expect(text).toContain("+after-0");
    expect(text).toContain("ctrl+o to expand");
    expect(text).not.toContain("+after-11");
  } finally {
    await app.cleanup();
  }
});

test("resumed diffs retain file paths and separated hunks", async () => {
  const argv: string[] = [];
  const { createSession } = await import("@rukie/agent");
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const { auxiliaryModels } = await import("../helpers/auxiliary-model");
  const app = await start(argv, {
    rows: 48,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      const model = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
      await Bun.write(join(root, "first.txt"), `before\n${"context\n".repeat(12)}last\n`);
      model.setResponses([
        fauxAssistantMessage(
          fauxToolCall("edit", {
            path: "first.txt",
            edits: [
              { oldText: "before", newText: "after" },
              { oldText: "last", newText: "final" },
            ],
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(fauxToolCall("write", { path: "second.txt", content: "created\n" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: model.getModel(),
        models: auxiliaryModels((m, c, o) => model.provider.streamSimple(m, c, o)),
        permissionMode: "full-access",
      });
      await session.run("change two files");
      await session.close();
      argv.push("--resume", session.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    const text = app.screen().join("\n");
    expect(text).toContain("first.txt");
    expect(text).toContain("second.txt");
    expect(text).toContain("-before");
    expect(text).toContain("+after");
    expect(text).toContain("⋯");
    expect(text).toContain("+created");
  } finally {
    await app.cleanup();
  }
});

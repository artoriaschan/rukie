import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createJsonlStore, createSession } from "@rukie/agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { start } from "../helpers/app";

test.each([
  ["zh_CN.UTF-8", 40, 12, "结果未知", "可能已产生副作用。", "重试前先核对实际状态。"],
  [
    "en_US.UTF-8",
    40,
    12,
    "Outcome unknown",
    "Side effects may have occurred.",
    "Verify actual state before retrying.",
  ],
  ["zh_CN.UTF-8", 80, 24, "结果未知", "可能已产生副作用。", "重试前先核对实际状态。"],
  [
    "en_US.UTF-8",
    80,
    24,
    "Outcome unknown",
    "Side effects may have occurred.",
    "Verify actual state before retrying.",
  ],
] as const)(
  "resume shows honest unknown Tool history in %s at %s×%s and accepts the next input",
  async (lang, columns, rows, unknown, effects, retry) => {
    const argv: string[] = [];
    const app = await start(argv, {
      columns,
      rows,
      env: { LANG: lang },
      async prepare(root) {
        const store = createJsonlStore({ cwd: root, homeDir: root });
        const original = await createSession({ cwd: root, homeDir: root, ...storeModel(), store });
        const metadata = (await store.list({ cwd: root }, BACKGROUND_CONTEXT))[0]!;
        const stored = await store.open(metadata, BACKGROUND_CONTEXT);
        const branch = (await stored.branch("main", BACKGROUND_CONTEXT))!;
        await branch.appendMessage(
          fauxAssistantMessage(
            fauxToolCall("write", { path: "saved.txt", content: "payload" }, { id: "lost-write" }),
            { stopReason: "toolUse" },
          ),
          BACKGROUND_CONTEXT,
        );
        await stored.close(BACKGROUND_CONTEXT);
        await original.close();
        argv.push("--resume", original.id);
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      expect(app.calls).toHaveLength(0);
      if (rows === 12) {
        app.resize(columns, 24);
        await app.waitFor(() => app.screen().some((line) => line.includes("? write")));
      }
      const history = app.screen().join("\n");
      expect(history).toContain(`⎿ ${unknown}`);
      expect(history).toContain(effects);
      expect(history).toContain(retry);
      expect(history).toContain("? write");
      expect(history).not.toContain("✗ write");
      expect(history).not.toContain("• write");
      expect(await Bun.file(`${app.root}/saved.txt`).exists()).toBe(false);
      if (rows === 12) {
        app.resize(columns, rows);
        await app.waitFor(() => app.screen().at(-3)?.includes("/128k") === true);
      }
      app.stdin.write("verify\r");
      await app.waitFor(() => app.calls.length === 1);
      expect(JSON.stringify(app.calls[0]!.context.messages)).toContain("unknown-tool-outcome");
      app.calls[0]!.delta("ready to verify");
      app.calls[0]!.finish();
      await app.waitFor(
        () => app.allLines().join("\n").includes("ready to verify") && !app.isWorking(),
      );
      expect(app.screen()).toContain("❯");
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  },
);

function storeModel() {
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
  return {
    model: faux.getModel(),
    streamFn: () => {
      throw new Error("History preparation must not request the model");
    },
  };
}

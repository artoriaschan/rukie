import { auxiliaryModels } from "./helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as entryMain, type PrintIo } from "../../src/index.ts";
function main(argv: string[], io: PrintIo) {
  return entryMain(
    argv.includes("--goal") || argv.includes("-p") || argv.includes("--print")
      ? argv
      : ["-p", ...argv],
    { env: { LANG: "en" }, ...io },
  );
}

test.each(["text", "stream-json"])(
  "%s includes Stop continuation feedback and the final result",
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-cli-stop-"));
    const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
    faux.setResponses(
      Array.from({ length: 9 }, (_, index) => fauxAssistantMessage(`conclusion ${index}`)),
    );
    let stdout = "";
    let stderr = "";
    try {
      await Bun.write(
        join(root, "stop.sh"),
        `cat >/dev/null\necho '{"decision":"block","reason":"verify tests"}'\n`,
      );
      expect(
        await main(["-p", "finish", "--output-format", format], {
          readStdin: async () => "",
          stdout: (text) => {
            stdout += text;
          },
          stderr: (text) => {
            stderr += text;
          },
          session: {
            cwd: root,
            homeDir: root,
            model: faux.getModel(),
            models: auxiliaryModels(faux.provider.streamSimple),
            settings: {
              hooks: { Stop: [{ hooks: [{ type: "command", command: "sh stop.sh" }] }] },
            },
          },
        }),
      ).toBe(0);
      expect(stderr).toContain("Stop hook reached the 8 continuation limit");
      if (format === "text") expect(stdout).toBe("conclusion 8\n");
      else {
        const events = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(events.filter((event) => event.type === "hook_continued")).toHaveLength(8);
        expect(events.filter((event) => event.type === "hook_continued")).toContainEqual({
          type: "hook_continued",
          event: "Stop",
          reason: "verify tests",
          sessionId: expect.any(String),
        });
        expect(
          events.filter(
            (event) => event.type === "message_end" && event.message.source === "stop_hook",
          ),
        ).toHaveLength(8);
        expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
          { event: "Stop", error: { code: "hook-continuation-limit" } },
        ]);
        expect(events.at(-1)).toMatchObject({
          type: "result",
          text: "conclusion 8",
          success: true,
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { main } from "../../src/index.ts";
import { auxiliaryModels } from "./helpers/auxiliary-model.ts";

test("Headless waits past parent idle for the background request's committed closing answer", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-causal-headless-"));
  const childStarted = Promise.withResolvers<void>();
  const parentIdle = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
  const respond: Parameters<typeof faux.setResponses>[0][number] = async (context) => {
    const latest = context.messages.findLast((message) => message.role === "user");
    if (JSON.stringify(latest?.content).includes("controlled-child-prompt")) {
      childStarted.resolve();
      await release.promise;
      return fauxAssistantMessage("controlled-child-answer");
    }
    return fauxAssistantMessage(
      JSON.stringify(context.messages).includes("controlled-child-answer")
        ? "FINAL CAUSAL ANSWER"
        : "PARENT IDLE ANSWER",
    );
  };
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Controlled child",
        prompt: "controlled-child-prompt",
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    ...Array.from({ length: 8 }, () => respond),
  ]);
  const controller = new AbortController();
  const deadline = AbortSignal.timeout(3000);
  const expired = Promise.withResolvers<never>();
  const expire = () => {
    controller.abort(deadline.reason);
    expired.reject(deadline.reason);
  };
  deadline.addEventListener("abort", expire, { once: true });
  const events: { type: string; text?: string; requestId?: string }[] = [];
  let stderr = "";
  let settled = false;
  const running = main(
    [
      "-p",
      "delegate and finish",
      "--permission-mode",
      "full-access",
      "--output-format",
      "stream-json",
    ],
    {
      readStdin: async () => "",
      env: { LANG: "en" },
      signal: controller.signal,
      session: {
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        models: auxiliaryModels(faux.provider.streamSimple),
      },
      stdout: (line) => {
        const event = JSON.parse(line);
        events.push(event);
        if (event.type === "result" && event.text === "PARENT IDLE ANSWER") parentIdle.resolve();
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  ).then((code) => {
    settled = true;
    return code;
  });
  try {
    // These model and output completion signals cross native child task boundaries.
    await Promise.race([Promise.all([childStarted.promise, parentIdle.promise]), expired.promise]);
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "request_settled")).toBe(false);
    release.resolve();
    expect(await Promise.race([running, expired.promise])).toBe(0);
    const final = events.filter((event) => event.type === "request_settled");
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ text: "FINAL CAUSAL ANSWER", requestId: expect.any(String) });
    expect(stderr).toBe("");
  } finally {
    deadline.removeEventListener("abort", expire);
    release.resolve();
    controller.abort();
    await running;
    await rm(root, { recursive: true, force: true });
  }
});

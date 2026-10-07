import { afterEach } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type SessionOptions } from "../../src/index.ts";
import { fakeModel } from "./fake-model.ts";
import { tempDirs } from "./temp-dirs.ts";

/** Create isolated resources for public Session web_fetch scenarios in one test file. */
export function webFetchFixture() {
  const resources: (() => void | Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of resources.splice(0).reverse()) await cleanup();
  });

  function server(handler: (request: Request) => Response | Promise<Response>) {
    const instance = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
    resources.push(() => {
      instance.stop(true);
    });
    return `http://site.test:${instance.port}`;
  }

  async function fetchPage(url: string, options: Partial<SessionOptions> = {}) {
    const dirs = await tempDirs();
    resources.push(dirs.cleanup);
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("web_fetch", { url }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      webFetch: {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        allowAddresses: ["127.0.0.1"],
      },
      ...options,
    });
    resources.push(() => session.close());
    await session.run("fetch this page");
    const result = fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult")!;
    if (result.role !== "toolResult") throw new Error("Expected tool result");
    return result;
  }

  function text(result: Awaited<ReturnType<typeof fetchPage>>) {
    return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  }

  return { resources, server, fetchPage, text };
}

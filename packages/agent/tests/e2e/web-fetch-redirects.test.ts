import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type SessionOptions } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { isolateProxyEnvironment } from "../helpers/proxy-env.ts";

isolateProxyEnvironment();

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

async function fetchPages(urls: string[], options: Partial<SessionOptions> = {}) {
  const dirs = await tempDirs();
  resources.push(dirs.cleanup);
  const fake = fakeModel([
    ...urls.map((url) =>
      fauxAssistantMessage(fauxToolCall("web_fetch", { url }), { stopReason: "toolUse" }),
    ),
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
  resources.push(() => session.dispose());
  await session.run("fetch these pages");
  return fake.contexts.slice(1).map((context) => {
    const result = context.messages.at(-1)!;
    if (result.role !== "toolResult") throw new Error("Expected tool result");
    return result;
  });
}

function text(result: Awaited<ReturnType<typeof fetchPages>>[number]) {
  return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

test("same-origin relative redirects return the final URL and page", async () => {
  const paths: string[] = [];
  const base = server((request) => {
    const path = new URL(request.url).pathname;
    paths.push(path);
    return path === "/docs"
      ? new Response(null, { status: 302, headers: { Location: "./docs/" } })
      : new Response("Final documentation");
  });
  const [result] = await fetchPages([`${base}/docs`]);
  expect(result!.isError).toBe(false);
  expect(text(result!)).toStartWith(`Fetched ${base}/docs/ (HTTP 200)`);
  expect(text(result!)).toEndWith("Final documentation");
  expect(result!.details).toMatchObject({ url: `${base}/docs/`, status: 200 });
  expect(paths).toEqual(["/docs", "/docs/"]);
});

test.each([5, 6])(
  "a chain of %i same-origin redirects respects the five-hop limit",
  async (hops) => {
    const paths: string[] = [];
    const base = server((request) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      const hop = Number(path.slice(1));
      return hop < hops
        ? new Response(null, { status: 307, headers: { Location: `/${hop + 1}` } })
        : new Response("Destination reached");
    });
    const [result] = await fetchPages([`${base}/0`]);
    if (hops === 5) {
      expect(result!.isError).toBe(false);
      expect(text(result!)).toStartWith(`Fetched ${base}/5 (HTTP 200)`);
    } else {
      expect(result!.isError).toBe(true);
      expect(text(result!)).toStartWith("Too many redirects:");
    }
    expect(paths).toEqual(["/0", "/1", "/2", "/3", "/4", "/5"]);
  },
);

test.each(["host", "port", "scheme"])(
  "cross-origin %s redirects return a new URL without contacting it",
  async (part) => {
    const requests: string[] = [];
    const otherBase = server((request) => {
      requests.push(request.url);
      return new Response("must not be contacted");
    });
    let destination = "";
    const base = server((request) => {
      requests.push(request.url);
      return new Response(null, { status: 301, headers: { Location: destination } });
    });
    destination =
      part === "host"
        ? `${base.replace("site.test", "other.test")}/new`
        : part === "port"
          ? `${otherBase}/new`
          : `${base.replace("http:", "https:")}/new`;
    const [result] = await fetchPages([`${base}/old`]);
    expect(result!.isError).toBe(false);
    expect(text(result!)).toContain(
      `Redirected to ${destination}; call web_fetch again with it to continue.`,
    );
    expect(text(result!)).toContain("HTTP 301");
    expect(result!.details).toMatchObject({ url: `${base}/old`, status: 301 });
    expect(requests).toEqual([`${base}/old`]);
  },
);

test("a same-origin redirect rechecks DNS and rejects a newly private destination", async () => {
  const paths: string[] = [];
  const base = server((request) => {
    paths.push(new URL(request.url).pathname);
    return new Response(null, { status: 302, headers: { Location: "/private" } });
  });
  let resolutions = 0;
  const [result] = await fetchPages([`${base}/public`], {
    webFetch: {
      resolve: async () => [{ address: ++resolutions === 1 ? "127.0.0.1" : "10.0.0.1", family: 4 }],
      allowAddresses: ["127.0.0.1"],
    },
  });
  expect(result!.isError).toBe(true);
  expect(text(result!)).toContain(
    "SSRF rejected: site.test resolves to non-public address 10.0.0.1",
  );
  expect(paths).toEqual(["/public"]);
});

test("a model following a cross-origin redirect requests permission for the new URL", async () => {
  const received: string[] = [];
  let destination = "";
  const base = server((request) => {
    const path = new URL(request.url).pathname;
    received.push(request.url);
    return path === "/old"
      ? new Response(null, { status: 302, headers: { Location: destination } })
      : new Response("New site documentation");
  });
  destination = `${base.replace("site.test", "other.test")}/new`;
  const asked: unknown[] = [];
  const results = await fetchPages([`${base}/old`, destination], {
    permissionMode: "ask",
    onPermissionAsk: async (request) => {
      asked.push(request.args);
      return "allow";
    },
  });
  expect(results.map((result) => result.isError)).toEqual([false, false]);
  expect(text(results[0]!)).toContain(`Redirected to ${destination}`);
  expect(text(results[1]!)).toEndWith("New site documentation");
  expect(asked).toEqual([{ url: `${base}/old` }, { url: destination }]);
  expect(received).toEqual([`${base}/old`, destination]);
});

test("redirect responses are cancelled before the next hop even when their bodies never finish", async () => {
  const cancelled = Promise.withResolvers<void>();
  const base = server((request) =>
    new URL(request.url).pathname === "/old"
      ? new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("unfinished redirect body"));
            },
            cancel() {
              cancelled.resolve();
            },
          }),
          { status: 302, headers: { Location: "/new" } },
        )
      : new Response("Destination reached"),
  );
  const [result] = await fetchPages([`${base}/old`]);
  expect(result!.isError).toBe(false);
  expect(text(result!)).toStartWith(`Fetched ${base}/new (HTTP 200)`);
  await cancelled.promise;
});

test("the total timeout spans multiple redirect hops rather than restarting at each response", async () => {
  const received: string[] = [];
  const base = server(async (request) => {
    const path = new URL(request.url).pathname;
    received.push(path);
    // Each response is quicker than the deadline; their combined delay exceeds it.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return path === "/old"
      ? new Response(null, { status: 302, headers: { Location: "/new" } })
      : new Response("Too late");
  });
  const [result] = await fetchPages([`${base}/old`], {
    webFetch: {
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      allowAddresses: ["127.0.0.1"],
      timeoutMs: 200,
    },
  });
  expect(result!.isError).toBe(true);
  expect(text(result!)).toStartWith("Web fetch timeout:");
  expect(received).toEqual(["/old", "/new"]);
});

test.each([
  "http://[::",
  "http://user:password@site.test/private",
  "file:///etc/passwd",
  `http://site.test/${"x".repeat(2048)}`,
])("redirect destinations are subject to URL validation (%s)", async (destination) => {
  let requests = 0;
  const base = server(() => {
    requests++;
    return new Response(null, { status: 302, headers: { Location: destination } });
  });
  const [result] = await fetchPages([base]);
  expect(result!.isError).toBe(true);
  expect(text(result!)).toStartWith("Invalid URL:");
  expect(requests).toBe(1);
});

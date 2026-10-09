import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:http";
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

function proxy(
  handler: (request: Request) => Response = () => new Response("Proxied documentation"),
) {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(request.url);
      return handler(request);
    },
  });
  resources.push(() => {
    return server.stop(true);
  });
  return { url: `http://127.0.0.1:${server.port}`, requests };
}

async function fetchPage(
  url: string,
  webFetch: SessionOptions["webFetch"] = {
    resolve: async () => {
      throw new Error("Proxied hostname must not use local DNS");
    },
  },
) {
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
    webFetch,
  });
  resources.push(() => session.close());
  await session.run("read this public URL");
  const result = fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult")!;
  if (result.role !== "toolResult") throw new Error("Expected tool result");
  const text = result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  return { result, text };
}

test("HTTP_PROXY routes a public hostname through a local proxy without local DNS", async () => {
  const local = proxy();
  process.env.HTTP_PROXY = local.url;
  const { result, text } = await fetchPage("http://docs.example.com/page");
  expect(result.isError).toBe(false);
  expect(text).toEndWith("Proxied documentation");
  expect(local.requests).toEqual(["http://docs.example.com/page"]);
});

test("NO_PROXY sends a matching hostname through validated direct DNS instead of the proxy", async () => {
  const local = proxy();
  process.env.HTTP_PROXY = local.url;
  process.env.NO_PROXY = "docs.example.com";
  const { result, text } = await fetchPage("http://docs.example.com/page", {
    resolve: async () => [{ address: "10.0.0.1", family: 4 }],
  });
  expect(result.isError).toBe(true);
  expect(text).toContain("SSRF rejected:");
  expect(local.requests).toEqual([]);
});

test("a direct fake-IP DNS rejection identifies the host, address and proxy remedy", async () => {
  const { result, text } = await fetchPage("http://docs.example.com/page", {
    resolve: async () => [{ address: "198.18.0.17", family: 4 }],
  });
  expect(result.isError).toBe(true);
  expect(text).toContain(
    "SSRF rejected: docs.example.com resolves to non-public address 198.18.0.17",
  );
  expect(text).toContain("fake-IP / TUN");
  expect(text).toContain("HTTPS_PROXY / HTTP_PROXY");
});

test("setting a proxy lets the same fake-IP hostname succeed after direct rejection", async () => {
  const local = proxy();
  const url = "http://docs.example.com/page";
  const webFetch = { resolve: async () => [{ address: "198.18.0.17", family: 4 }] };
  const direct = await fetchPage(url, webFetch);
  expect(direct.result.isError).toBe(true);
  expect(direct.text).toContain("HTTPS_PROXY / HTTP_PROXY");
  process.env.HTTP_PROXY = local.url;
  const proxied = await fetchPage(url, webFetch);
  expect(proxied.result.isError).toBe(false);
  expect(proxied.text).toEndWith("Proxied documentation");
  expect(local.requests).toEqual([url]);
});

test("each redirect hop snapshots proxy routing and revalidates a newly direct hostname", async () => {
  const local = proxy(() => {
    process.env.NO_PROXY = "docs.example.com";
    return new Response(null, { status: 302, headers: { Location: "/next" } });
  });
  process.env.HTTP_PROXY = local.url;
  const { result, text } = await fetchPage("http://docs.example.com/page", {
    resolve: async () => [{ address: "198.18.0.17", family: 4 }],
  });
  expect(result.isError).toBe(true);
  expect(text).toContain("fake-IP / TUN");
  expect(local.requests).toEqual(["http://docs.example.com/page"]);
});

test.each([
  ["http://10.0.0.1/", false],
  ["http://198.18.0.17/", false],
  ["http://198.19.255.255/", false],
  ["http://[::ffff:198.18.0.17]/", false],
  ["http://docs.example.com/", true],
] as const)(
  "proxy configuration never permits a non-public IP literal (%s)",
  async (url, domain) => {
    const local = proxy();
    process.env.HTTP_PROXY = local.url;
    const { result, text } = await fetchPage(url, {
      resolve: async () => [{ address: "198.18.0.17", family: 4 }],
    });
    expect(result.isError).toBe(!domain);
    if (domain) {
      expect(text).toEndWith("Proxied documentation");
      expect(local.requests).toEqual([url]);
    } else {
      expect(text).toStartWith("SSRF rejected:");
      expect(text).not.toContain("fake-IP / TUN");
      expect(local.requests).toEqual([]);
    }
  },
);

test.each(["198.18.0.17", "198.19.255.255", "10.0.0.1"])(
  "fake-IP guidance is limited to hostname DNS answers in 198.18/15 (%s)",
  async (address) => {
    const { result, text } = await fetchPage("http://docs.example.com/page", {
      resolve: async () => [{ address, family: 4 }],
    });
    expect(result.isError).toBe(true);
    if (address.startsWith("198.18") || address.startsWith("198.19")) {
      expect(text).toContain("fake-IP / TUN");
      expect(text).toContain(address);
    } else expect(text).not.toContain("fake-IP / TUN");
  },
);

test.each([
  ["docs.example.com", "docs.example.com", true],
  ["DOCS.EXAMPLE.COM.", "docs.example.com.", true],
  ["example.com", "docs.example.com", true],
  [".example.com", "example.com", true],
  ["*.example.com", "docs.example.com", true],
  ["*.example.com", "example.com", false],
  ["example.com", "badexample.com", false],
  ["example.com:80", "example.com", true],
  ["example.com:443", "example.com", false],
  ["none.invalid, *", "docs.example.com", true],
  ["*:80", "docs.example.com", true],
  ["*:443", "docs.example.com", false],
  ["none.invalid example.com", "docs.example.com", true],
  ["198.18.0.0/15", "docs.example.com", false],
] as const)("NO_PROXY %s routes %s consistently with Undici", async (noProxy, host, bypass) => {
  const local = proxy();
  process.env.HTTP_PROXY = local.url;
  process.env.NO_PROXY = noProxy;
  let resolutions = 0;
  const url = `http://${host}/page`;
  const { result, text } = await fetchPage(url, {
    resolve: async () => {
      resolutions++;
      return [{ address: "10.0.0.1", family: 4 }];
    },
  });
  expect(result.isError).toBe(bypass);
  expect(resolutions).toBe(bypass ? 1 : 0);
  if (bypass) {
    expect(text).toStartWith("SSRF rejected:");
    expect(local.requests).toEqual([]);
  } else expect(local.requests).toEqual([url]);
});

test.each(["bare", "bracketed", "matching-port", "different-port"])(
  "NO_PROXY recognizes IPv6 literals and optional ports (%s)",
  async (mode) => {
    let directRequests = 0;
    const target = Bun.serve({
      hostname: "::1",
      port: 0,
      fetch() {
        directRequests++;
        return new Response("Direct IPv6 documentation");
      },
    });
    resources.push(() => {
      return target.stop(true);
    });
    const local = proxy();
    process.env.HTTP_PROXY = local.url;
    process.env.NO_PROXY =
      mode === "bare"
        ? "::1"
        : mode === "bracketed"
          ? "[::1]"
          : mode === "matching-port"
            ? `[::1]:${target.port}`
            : "[::1]:1";
    const url = `http://[::1]:${target.port}/page`;
    const { result } = await fetchPage(url, { allowAddresses: ["::1"] });
    expect(result.isError).toBe(false);
    expect(directRequests).toBe(mode === "different-port" ? 0 : 1);
    expect(local.requests).toEqual(mode === "different-port" ? [url] : []);
  },
);

test("NO_PROXY direct requests retain validated IP pinning", async () => {
  const local = proxy();
  const target = proxy();
  process.env.HTTP_PROXY = local.url;
  process.env.NO_PROXY = "docs.example.com";
  const url = `http://docs.example.com:${new URL(target.url).port}/page`;
  const { result } = await fetchPage(url, {
    resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    allowAddresses: ["127.0.0.1"],
  });
  expect(result.isError).toBe(false);
  expect(local.requests).toEqual([]);
  expect(target.requests).toEqual([url]);
});

test.each([false, true])(
  "lowercase http_proxy overrides uppercase, including a blank value (%s)",
  async (blank) => {
    const upper = proxy();
    const lower = proxy();
    process.env.HTTP_PROXY = upper.url;
    process.env.http_proxy = blank ? "" : lower.url;
    const { result, text } = await fetchPage("http://docs.example.com/page", {
      resolve: async () => [{ address: "10.0.0.1", family: 4 }],
    });
    expect(result.isError).toBe(blank);
    expect(upper.requests).toEqual([]);
    expect(lower.requests).toEqual(blank ? [] : ["http://docs.example.com/page"]);
    if (blank) expect(text).toStartWith("SSRF rejected:");
  },
);

test.each(["", "example.com"])(
  "lowercase no_proxy overrides uppercase, including a blank list (%s)",
  async (noProxy) => {
    const local = proxy();
    process.env.HTTP_PROXY = local.url;
    process.env.NO_PROXY = "*";
    process.env.no_proxy = noProxy;
    const { result } = await fetchPage("http://docs.example.com/page", {
      resolve: async () => [{ address: "10.0.0.1", family: 4 }],
    });
    expect(result.isError).toBe(Boolean(noProxy));
    expect(local.requests).toEqual(noProxy ? [] : ["http://docs.example.com/page"]);
  },
);

test("HTTPS_PROXY alone does not route HTTP requests through the proxy", async () => {
  const local = proxy();
  process.env.HTTPS_PROXY = local.url;
  const { result, text } = await fetchPage("http://docs.example.com/page", {
    resolve: async () => [{ address: "10.0.0.1", family: 4 }],
  });
  expect(result.isError).toBe(true);
  expect(text).toStartWith("SSRF rejected:");
  expect(local.requests).toEqual([]);
});

async function connectProxy() {
  const connections: string[] = [];
  const instance = createServer();
  instance.on("connect", (request, socket) => {
    connections.push(request.url!);
    // A rejected tunnel lets this test observe routing without introducing TLS trust fixtures.
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  resources.push(
    () =>
      new Promise<void>((resolve, reject) =>
        instance.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("Expected proxy TCP address");
  return { url: `http://127.0.0.1:${address.port}`, connections };
}

test.each([
  "http-fallback",
  "https-only",
  "https-precedence",
  "lowercase-https",
  "blank-https-fallback",
])("HTTPS uses the configured proxy without local hostname DNS (%s)", async (mode) => {
  const http = await connectProxy();
  const https = await connectProxy();
  if (mode !== "https-only") process.env.HTTP_PROXY = http.url;
  if (mode !== "http-fallback") process.env.HTTPS_PROXY = https.url;
  if (mode === "lowercase-https") process.env.https_proxy = http.url;
  if (mode === "blank-https-fallback") process.env.https_proxy = "";
  const { result, text } = await fetchPage("https://docs.example.com/page");
  expect(result.isError).toBe(true);
  expect(text).toStartWith("Web fetch network error:");
  const usesHttp = ["http-fallback", "lowercase-https", "blank-https-fallback"].includes(mode);
  expect(http.connections).toEqual(usesHttp ? ["docs.example.com:443"] : []);
  expect(https.connections).toEqual(usesHttp ? [] : ["docs.example.com:443"]);
});

test("HTTPS NO_PROXY uses the default 443 port and re-enters DNS validation", async () => {
  const local = await connectProxy();
  process.env.HTTPS_PROXY = local.url;
  process.env.NO_PROXY = "docs.example.com:443";
  const { result, text } = await fetchPage("https://docs.example.com/page", {
    resolve: async () => [{ address: "198.18.0.17", family: 4 }],
  });
  expect(result.isError).toBe(true);
  expect(text).toContain("fake-IP / TUN");
  expect(local.connections).toEqual([]);
});

test("a blank lowercase HTTPS proxy suppresses uppercase without an HTTP fallback", async () => {
  const local = await connectProxy();
  process.env.HTTPS_PROXY = local.url;
  process.env.https_proxy = "";
  const { result, text } = await fetchPage("https://docs.example.com/page", {
    resolve: async () => [{ address: "10.0.0.1", family: 4 }],
  });
  expect(result.isError).toBe(true);
  expect(text).toStartWith("SSRF rejected:");
  expect(local.connections).toEqual([]);
});

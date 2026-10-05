import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, loadSettings, type SessionOptions } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

const resources: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of resources.splice(0).reverse()) await cleanup();
});

const webFetch = {
  resolve: async () => [{ address: "127.0.0.1", family: 4 }],
  allowAddresses: ["127.0.0.1"],
};

function server(
  handler: (request: Request) => Response = () => new Response("Public documentation"),
) {
  const requests: string[] = [];
  const instance = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(request.url);
      return handler(request);
    },
  });
  resources.push(() => {
    instance.stop(true);
  });
  return {
    url: (host = "site.test", path = "/") => `http://${host}:${instance.port}${path}`,
    requests,
  };
}

async function fetchUrls(urls: string[], options: Partial<SessionOptions> = {}) {
  const dirs = await tempDirs();
  resources.push(dirs.cleanup);
  const fake = fakeModel([
    ...urls.map((url) =>
      fauxAssistantMessage(fauxToolCall("web_fetch", { url }), { stopReason: "toolUse" }),
    ),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, webFetch, ...options });
  resources.push(() => session.dispose());
  await session.run("read the pages");
  return fake.contexts.slice(1).map((context) => {
    const result = context.messages.at(-1)!;
    if (result.role !== "toolResult") throw new Error("Expected tool result");
    return result;
  });
}

test("session permission grants normalized host across paths, while another host still asks", async () => {
  const http = server();
  const asks: string[] = [];
  const results = await fetchUrls(
    [http.url("SITE.TEST.", "/one"), http.url("site.test", "/two"), http.url("other.test")],
    {
      onPermissionAsk: async (request) => {
        asks.push(request.sessionAllow.rule);
        expect(request.sessionAllow.kind).toBe("domain");
        expect(request.args).toEqual({
          url: asks.length === 1 ? http.url("SITE.TEST.", "/one") : http.url("other.test"),
        });
        return "allow-session";
      },
    },
  );
  expect(asks).toEqual(["web_fetch(domain:site.test)", "web_fetch(domain:other.test)"]);
  expect(results).toMatchObject([{ isError: false }, { isError: false }, { isError: false }]);
  expect(http.requests).toHaveLength(3);
});

test.each(["ask", "auto-review"] as const)(
  "domain allow rules skip interaction and review in %s",
  async (permissionMode) => {
    const http = server();
    const results = await fetchUrls([http.url("site.test"), http.url("docs.site.test")], {
      permissionMode,
      settings: {
        permissions: { allow: ["web_fetch(domain:site.test)", "web_fetch(domain:*.site.test)"] },
      },
      onPermissionAsk: async () => {
        throw new Error("Allowed domains should not ask");
      },
    });
    expect(results).toMatchObject([{ isError: false }, { isError: false }]);
    expect(http.requests).toHaveLength(2);
  },
);

test("a wildcard authorizes subdomains but asks for its apex", async () => {
  const http = server();
  const asks: unknown[] = [];
  const results = await fetchUrls([http.url("a.site.test"), http.url("site.test")], {
    allowRules: ["web_fetch(domain:*.site.test)"],
    onPermissionAsk: async (request) => {
      asks.push(request.args);
      return "deny";
    },
  });
  expect(asks).toEqual([{ url: http.url("site.test") }]);
  expect(results).toMatchObject([{ isError: false }, { isError: true }]);
  expect(http.requests).toEqual([http.url("a.site.test")]);
});

test("a cross-origin redirect requires permission when the model calls the new domain", async () => {
  const http = server((request) => {
    const destination = new URL(request.url);
    destination.hostname = "other.test";
    return new Response(null, { status: 302, headers: { location: destination.href } });
  });
  const asks: unknown[] = [];
  const results = await fetchUrls([http.url(), http.url("other.test")], {
    allowRules: ["web_fetch(domain:site.test)"],
    onPermissionAsk: async (request) => {
      asks.push(request.args);
      return "deny";
    },
  });
  expect(asks).toEqual([{ url: http.url("other.test") }]);
  expect(results).toMatchObject([
    {
      isError: false,
      content: [{ text: expect.stringContaining(`Redirected to ${http.url("other.test")}`) }],
    },
    { isError: true },
  ]);
  expect(http.requests).toEqual([http.url()]);
});

test.each(["ask", "deny"] as const)(
  "explicit domain %s overrides full-access and a bare allow",
  async (decision) => {
    const http = server();
    const asks: string[] = [];
    const rule = "web_fetch(domain:site.test)";
    const results = await fetchUrls([http.url()], {
      permissionMode: "full-access",
      settings: { permissions: { allow: ["web_fetch"], [decision]: [rule] } },
      onPermissionAsk: async (request) => {
        asks.push(request.reason!);
        return "deny";
      },
    });
    expect(asks).toEqual(decision === "ask" ? [`Permission rule: ${rule}`] : []);
    expect(results).toMatchObject([{ isError: true }]);
    expect(http.requests).toEqual([]);
  },
);

test.each([false, true])("project domain allow requires user trust: %s", async (trusted) => {
  const dirs = await tempDirs();
  resources.push(dirs.cleanup);
  const http = server();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({ trustedProjects: trusted ? [dirs.cwd] : [] }),
  );
  await Bun.write(
    join(dirs.cwd, ".neant/settings.json"),
    JSON.stringify({
      trustedProjects: [dirs.cwd],
      permissions: { allow: ["web_fetch(domain:site.test)"] },
    }),
  );
  const { settings } = await loadSettings(dirs);
  const results = await fetchUrls([http.url()], { ...dirs, settings });
  expect(results).toMatchObject([{ isError: !trusted }]);
  expect(http.requests).toHaveLength(trusted ? 1 : 0);
});

test.each(["PreToolUse", "PermissionRequest"] as const)(
  "%s rewritten URL is rechecked against the destination domain deny",
  async (event) => {
    const dirs = await tempDirs();
    resources.push(dirs.cleanup);
    const http = server();
    const rewritten = http.url("blocked.test");
    const output =
      event === "PreToolUse"
        ? { hookSpecificOutput: { hookEventName: event, updatedInput: { url: rewritten } } }
        : {
            hookSpecificOutput: {
              hookEventName: event,
              decision: { behavior: "allow", updatedInput: { url: rewritten } },
            },
          };
    await Bun.write(
      join(dirs.cwd, "rewrite.sh"),
      `cat >/dev/null\nprintf '%s' '${JSON.stringify(output)}'\n`,
    );
    const results = await fetchUrls([http.url()], {
      ...dirs,
      permissionMode: event === "PreToolUse" ? "full-access" : "ask",
      settings: {
        permissions: { deny: ["web_fetch(domain:blocked.test)"] },
        hooks: {
          [event]: [
            { matcher: "web_fetch", hooks: [{ type: "command", command: "sh rewrite.sh" }] },
          ],
        },
      },
      onPermissionAsk: async () => {
        throw new Error("The deny should stop interaction");
      },
    });
    expect(results).toMatchObject([
      {
        isError: true,
        content: [{ text: "Denied by permission rule: web_fetch(domain:blocked.test)" }],
      },
    ]);
    expect(http.requests).toEqual([]);
  },
);

test("a child shares domain rules and its top-level approval also covers the parent", async () => {
  const dirs = await tempDirs();
  resources.push(dirs.cleanup);
  const http = server();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Read docs",
        prompt: "read",
        subagent_type: "explore",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("web_fetch", { url: http.url() }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("web_fetch", { url: http.url("other.test", "/child") }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage(fauxToolCall("web_fetch", { url: http.url("OTHER.TEST.", "/parent") }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("parent done"),
  ]);
  const asks: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    webFetch,
    settings: { permissions: { allow: ["web_fetch(domain:site.test)"] } },
    onPermissionAsk: async (request) => {
      expect(request.origin).toMatchObject({ description: "Read docs" });
      asks.push(request.sessionAllow.rule);
      return "allow-session";
    },
  });
  resources.push(() => session.dispose());
  await session.run("delegate");
  expect(asks).toEqual(["web_fetch(domain:other.test)"]);
  expect(http.requests).toHaveLength(3);
  expect(fake.contexts[5]!.messages.at(-1)).toMatchObject({ isError: false });
});

test("approving a malformed URL for the session never grants all web access", async () => {
  const http = server();
  const asks: unknown[] = [];
  const results = await fetchUrls(["invalid URL", http.url()], {
    onPermissionAsk: async (request) => {
      asks.push(request.args);
      return "allow-session";
    },
  });
  expect(asks).toEqual([{ url: "invalid URL" }, { url: http.url() }]);
  expect(results).toMatchObject([{ isError: true }, { isError: false }]);
});

import { runPty } from "./pty.ts";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildRelease } from "../build.ts";
import { installRelease } from "./installed-fixture.ts";
import { providerProtocol } from "./provider-protocol.ts";
let fixture: Awaited<ReturnType<typeof installRelease>>;
let ownedArtifacts: string | undefined;
let artifactDirectory: string;
beforeAll(async () => {
  let artifacts = process.env.RUKIE_RELEASE_ARTIFACTS;
  if (!artifacts) {
    ownedArtifacts = await mkdtemp(join(tmpdir(), "rukie-providers-build-"));
    artifacts = ownedArtifacts;
    await buildRelease(artifacts);
  }
  artifactDirectory = resolve(artifacts);
  fixture = await installRelease(artifactDirectory);
}, 120_000);
afterAll(async () => {
  await fixture?.cleanup();
  if (ownedArtifacts) await rm(ownedArtifacts, { recursive: true, force: true });
});

async function configure(api: "openai-responses" | "anthropic-messages", baseUrl: string) {
  await Bun.write(
    join(fixture.homeDir, ".rukie/settings.json"),
    JSON.stringify({
      model: "local/m",
      providers: [
        {
          id: "local",
          api,
          baseUrl: baseUrl + (api === "anthropic-messages" ? "" : "/v1"),
          apiKeyEnv: "FAKE_API_KEY",
          models: [{ id: "m" }],
        },
      ],
    }),
  );
}

test.each(["openai-responses", "anthropic-messages", "azure"] as const)(
  "installed %s adapter produces a real Session reply without external Bun",
  async (api) => {
    const server = providerProtocol(api);
    try {
      if (api === "azure")
        await Bun.write(
          join(fixture.homeDir, ".rukie/settings.json"),
          JSON.stringify({ model: "azure/gpt-5" }),
        );
      else await configure(api, server.baseUrl);
      const result = await fixture.run(
        ["-p", "--output-format", "stream-json", "installed protocol prompt"],
        {
          env:
            api === "azure"
              ? {
                  AZURE_OPENAI_API_KEY: "fabricated-azure",
                  AZURE_OPENAI_BASE_URL: server.baseUrl + "/v1",
                }
              : undefined,
        },
      );
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      const events: unknown[] = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "result",
          success: true,
          text: "packaged protocol reply",
          usage: expect.objectContaining({ input: 10, output: 4 }),
        }),
      );
      const path = api === "anthropic-messages" ? "/v1/messages" : "/v1/responses";
      expect(server.requests.some((r) => r.path === path)).toBe(true);
      const request = server.requests.find((r) =>
        JSON.stringify(r.body).includes("installed protocol prompt"),
      );
      expect(request).toBeDefined();
      if (api === "openai-responses") expect(request!.authorization).toBe("Bearer packaged-key");
      else expect(request!.apiKey).toBe(api === "azure" ? "fabricated-azure" : "packaged-key");
    } finally {
      server.stop();
    }
  },
);

test("installed Anthropic adapter reports local protocol errors", async () => {
  const server = providerProtocol("anthropic-messages", { error: true });
  try {
    await configure("anthropic-messages", server.baseUrl);
    const result = await fixture.run(["-p", "rejected protocol prompt"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("local protocol rejection");
    expect(server.requests.length).toBeGreaterThan(0);
  } finally {
    server.stop();
  }
});

test("installed Responses cancellation closes the active stream and exits through launcher", async () => {
  const server = providerProtocol("openai-responses", { holdPrompt: "hold installed protocol" });
  let started: ReturnType<typeof fixture.start> | undefined;
  try {
    await configure("openai-responses", server.baseUrl);
    started = fixture.start(["-p", "hold installed protocol"]);
    // This is a real child/HTTP transport contract; synchronize on the actual request, not a timer.
    await Promise.race([
      server.received,
      started.result.then((r) => {
        throw new Error(`Child exited before request: ${r.code} ${r.stderr}`);
      }),
    ]);
    started.child.kill("SIGINT");
    const result = await started.result;
    expect(result.code).toBe(130);
    expect(result.stderr).not.toContain("Cannot find module");
  } finally {
    server.stop();
    if (started) {
      started.child.kill();
      await started.result;
    }
  }
});

test("installed Bedrock SDK signs a loopback request and preserves local validation failure", async () => {
  const server = providerProtocol("amazon-bedrock");
  try {
    await Bun.write(
      join(fixture.homeDir, ".rukie/settings.json"),
      JSON.stringify({ model: "amazon-bedrock/amazon.nova-2-lite-v1:0" }),
    );
    const result = await fixture.run(["-p", "installed AWS protocol"], {
      env: {
        AWS_ACCESS_KEY_ID: "fabricated-aws",
        AWS_SECRET_ACCESS_KEY: "fabricated-secret",
        AWS_REGION: "us-east-1",
        AWS_ENDPOINT_URL_BEDROCK_RUNTIME: server.baseUrl,
        AWS_EC2_METADATA_DISABLED: "true",
        AWS_BEDROCK_FORCE_HTTP1: "1",
      },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Validation error: local fabricated AWS adapter accepted");
    const request = server.requests.find((r) => r.path.endsWith("/converse-stream"));
    expect(request).toBeDefined();
    expect(request!.authorization).toStartWith("AWS4-HMAC-SHA256 ");
    expect(JSON.stringify(request!.body)).toContain("installed AWS protocol");
  } finally {
    server.stop();
  }
});

test("built-in missing credentials fail before any model stream or external request", async () => {
  await Bun.write(
    join(fixture.homeDir, ".rukie/settings.json"),
    JSON.stringify({ model: "google/gemini-2.5-flash" }),
  );
  const result = await fixture.run(["-p", "missing credentials"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('No API key for provider "google"');
});

// Build graph evidence for paths unreachable through present Rukie model login;
// successful protocol Runs above separately prove reachable adapters execute.
test("release build embeds every locked API family and all nine model OAuth flows", async () => {
  const graph: unknown = await Bun.file(join(artifactDirectory, "release-modules.json")).json();
  if (!Array.isArray(graph) || !graph.every((path: unknown) => typeof path === "string"))
    throw new Error("Invalid release module inventory");
  const paths: string[] = graph;
  for (const api of [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "azure-openai-responses",
    "bedrock-converse-stream",
    "google-generative-ai",
    "google-vertex",
    "mistral-conversations",
    "openai-codex-responses",
    "pi-messages",
  ]) {
    expect(
      paths.some((path) => path.endsWith(`/pi-ai/dist/api/${api}.js`)),
      `Missing compiled ${api} implementation`,
    ).toBe(true);
  }
  for (const flow of [
    "anthropic",
    "openai-codex",
    "openai-chatgpt",
    "github-copilot",
    "openrouter",
    "kimi-coding",
    "meta",
    "xai",
    "radius",
  ]) {
    expect(
      paths.some((path) => path.endsWith(`/pi-ai/dist/auth/oauth/${flow}.js`)),
      `Missing embedded ${flow} OAuth flow`,
    ).toBe(true);
  }
});

// Reuse Agent Core's real HTTP/OAuth fixture across project roots.
const {
  mcpOAuthServer,
}: {
  mcpOAuthServer: () => {
    url: string;
    requests: { path: string; authorization: string | null; body: unknown }[];
    stop(): Promise<void>;
  };
} = await import(
  new URL("../../../packages/agent/tests/helpers/mcp-oauth-server.ts", import.meta.url).href
);

test("installed TUI MCP login persists credentials, reconnects, logs out and cancels authorization", async () => {
  const model = providerProtocol("openai-responses");
  const oauth = mcpOAuthServer();
  const browser = join(fixture.env.PATH.split(":")[0]!, "open");
  const browserLog = join(fixture.root, "local-browser.json");
  try {
    await configure("openai-responses", model.baseUrl);
    await Bun.write(
      join(fixture.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: oauth.url } } }),
    );
    // Replace only the OS browser boundary. The installed product performs all OAuth itself.
    // Every initial URL and redirect is checked before issuing a request.
    await Bun.write(
      browser,
      `#!/usr/bin/env node
const {existsSync,writeFileSync}=require("node:fs");
(async()=>{const log=${JSON.stringify(browserLog)};if(existsSync(log))process.exit(1);const url=new URL(process.argv[2]);if(url.origin!==${JSON.stringify(new URL(oauth.url).origin)}||url.pathname!=="/authorize")throw Error("Nonlocal authorization URL");const auth=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(5000)});const callback=new URL(auth.headers.get("location"));if(!["localhost","127.0.0.1"].includes(callback.hostname)||callback.protocol!=="http:"||callback.pathname!=="/callback")throw Error("Nonlocal callback");writeFileSync(log,JSON.stringify({authorization:url.href,callback:callback.href}));const result=await fetch(callback,{signal:AbortSignal.timeout(5000)});if(!result.ok)throw Error("Callback failed");})().catch(()=>process.exitCode=1);
`,
    );
    await chmod(browser, 0o755);
    const first = await runPty(fixture, {
      actions: [
        { when: /Ask[\s\S]*project with spaces/, send: "/mcp login srv\r" },
        { when: "Signed in to MCP server srv", send: "\x04" },
      ],
    });
    expect(first.code).toBe(0);
    expect(first.restoredFullTermios).toBe(true);
    const browserResult: unknown = await Bun.file(browserLog).json();
    expect(browserResult).toEqual(
      expect.objectContaining({
        authorization: expect.stringContaining("code_challenge_method=S256"),
        callback: expect.stringContaining("/callback?state="),
      }),
    );
    expect(oauth.requests.some((r) => r.path === "/register")).toBe(true);
    const token = oauth.requests.find((r) => r.path === "/token");
    expect(token?.body).toEqual(
      expect.objectContaining({
        grant_type: "authorization_code",
        code_verifier: expect.any(String),
      }),
    );
    // A second process must use the persisted credentials, rather than in-memory state.
    const second = await runPty(fixture, {
      actions: [
        { when: /Ask[\s\S]*project with spaces/, send: "/mcp reconnect srv\r" },
        { when: "Reconnected the MCP server srv", send: "\x04" },
      ],
    });
    expect(second.code).toBe(0);
    expect(second.restoredFullTermios).toBe(true);
    const logout = await runPty(fixture, {
      actions: [
        { when: /Ask[\s\S]*project with spaces/, send: "/mcp logout srv\r" },
        { when: "Signed out of MCP server srv", send: "\x04" },
      ],
    });
    expect(logout.code).toBe(0);
    expect(logout.restoredFullTermios).toBe(true);
    const cancelled = await runPty(fixture, {
      actions: [
        { when: /Ask[\s\S]*project with spaces/, send: "/mcp login srv\r" },
        { when: "Copy authorization link", send: "\x1b" },
        { when: "MCP authorization cancelled", send: "\x04" },
      ],
    });
    expect(cancelled.code).toBe(0);
    expect(cancelled.restoredFullTermios).toBe(true);
    expect(
      oauth.requests.some(
        (r) => r.path === "/mcp" && r.authorization?.startsWith("Bearer access-"),
      ),
    ).toBe(true);
    expect(oauth.requests.filter((r) => r.path === "/token")).toHaveLength(1);
    expect(second.transcript).not.toContain("Cannot find module");
  } finally {
    await rm(browser, { force: true });
    await rm(join(fixture.homeDir, ".rukie/mcp.json"), { force: true });
    await Promise.all([oauth.stop(), Promise.resolve(model.stop())]);
  }
}, 40_000);

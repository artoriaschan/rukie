import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

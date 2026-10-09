import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { buildRelease } from "../build.ts";
import { releaseObject, publishRelease } from "../publication.ts";
import { requireUnpublished } from "../tag.ts";
import { registryFixture } from "./registry.ts";

let artifacts: string;
let owned: string | undefined;
let channel: "latest" | "next";
let uploadTag: "candidate" | "next";
beforeAll(async () => {
  artifacts =
    process.env.RUKIE_RELEASE_ARTIFACTS ??
    (owned = await mkdtemp(join(tmpdir(), "rukie publication artifacts ")));
  if (owned) await buildRelease(artifacts);
  const metadata = releaseObject(await Bun.file(join(artifacts, "release-build.json")).json());
  if (typeof metadata.version !== "string") throw new Error("Missing artifact fixture version");
  channel = metadata.version.includes("-beta.") ? "next" : "latest";
  uploadTag = channel === "next" ? "next" : "candidate";
}, 120_000);
afterAll(async () => {
  if (owned) await rm(owned, { recursive: true, force: true });
});

test("real npm publication installs the registry's exact dependencies and validates a Session before stable latest or validates beta next", async () => {
  const ctx = await registryFixture();
  try {
    const receipt = await publishRelease({
      artifactDirectory: artifacts,
      registry: ctx.registry.url,
      env: ctx.env,
    });
    expect(receipt.channel).toBe(channel);
    expect(ctx.registry.tags("@rukie/coding-agent")).toEqual(
      channel === "next"
        ? { next: receipt.version }
        : { candidate: receipt.version, latest: receipt.version },
    );
    expect(
      ctx.registry.version("@rukie/coding-agent", receipt.version)?.optionalDependencies,
    ).toEqual({ "@rukie/coding-agent-darwin-arm64": receipt.version });
    const metadata = await Bun.file(join(artifacts, "release-build.json")).json();
    for (const pkg of metadata.packages) {
      expect(
        createHash("sha256").update(ctx.registry.bytes(pkg.name, receipt.version)!).digest("hex"),
      ).toBe(pkg.sha256);
      expect(ctx.registry.bytes(pkg.name, receipt.version)).toEqual(
        new Uint8Array(await readFile(join(artifacts, pkg.tarball))),
      );
    }
  } finally {
    await ctx.cleanup();
  }
}, 120_000);

test("failed main upload leaves the platform and does not expose latest", async () => {
  const ctx = await registryFixture();
  ctx.registry.failUpload("@rukie/coding-agent");
  try {
    await expect(
      publishRelease({ artifactDirectory: artifacts, registry: ctx.registry.url, env: ctx.env }),
    ).rejects.toThrow();
    expect(ctx.registry.tags("@rukie/coding-agent-darwin-arm64")[uploadTag]).toBeDefined();
    expect(ctx.registry.tags("@rukie/coding-agent").latest).toBeUndefined();
    const metadata = await Bun.file(join(artifacts, "release-build.json")).json();
    await expect(requireUnpublished(metadata.version, ctx.registry.url)).rejects.toThrow(
      "refusing rebuild",
    );
  } finally {
    await ctx.cleanup();
  }
}, 120_000);

test("a real registry Session rejection leaves the uploaded package and latest unchanged", async () => {
  const ctx = await registryFixture();
  try {
    const { acceptRegistryRelease } = await import("../publication.ts");
    await expect(
      publishRelease({
        artifactDirectory: artifacts,
        registry: ctx.registry.url,
        env: ctx.env,
        accept: (options) => acceptRegistryRelease(options, true),
      }),
    ).rejects.toThrow("Session acceptance failed");
    expect(ctx.registry.tags("@rukie/coding-agent")[uploadTag]).toBeDefined();
    expect(ctx.registry.tags("@rukie/coding-agent").latest).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
}, 120_000);

test("fabricated inherited npm auth and registry configuration cannot override the loopback destination", async () => {
  const ctx = await registryFixture();
  try {
    const env = {
      ...ctx.env,
      npm_config_registry: "http://127.0.0.1:1/",
      npm_config__authToken: "fabricated-untrusted",
      npm_config_userconfig: "/nonexistent/fabricated-config",
    };
    const receipt = await publishRelease({
      artifactDirectory: artifacts,
      registry: ctx.registry.url,
      env,
    });
    expect(ctx.registry.tags("@rukie/coding-agent")[channel]).toBe(receipt.version);
  } finally {
    await ctx.cleanup();
  }
}, 120_000);

test("npm12.1 is rejected before any registry upload", async () => {
  const ctx = await registryFixture();
  const directory = await mkdtemp(join(tmpdir(), "rukie unsupported npm "));
  try {
    const npm = join(directory, "npm");
    await Bun.write(npm, "#!/bin/sh\nprintf '12.1.0\\n'\n");
    await import("node:fs/promises").then((module) => module.chmod(npm, 0o755));
    await expect(
      publishRelease({
        artifactDirectory: artifacts,
        registry: ctx.registry.url,
        env: ctx.env,
        npm,
      }),
    ).rejects.toThrow("OIDC dist-tag");
    expect(ctx.registry.tags("@rukie/coding-agent")).toEqual({});
    expect(ctx.registry.tags("@rukie/coding-agent-darwin-arm64")).toEqual({});
  } finally {
    await ctx.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

test("matching partial publication resumes only the missing main package", async () => {
  const ctx = await registryFixture();
  ctx.registry.failUpload("@rukie/coding-agent");
  try {
    await expect(
      publishRelease({
        artifactDirectory: artifacts,
        registry: ctx.registry.url,
        env: ctx.env,
        accept: async () => {},
      }),
    ).rejects.toThrow();
    const receipt = await publishRelease({
      artifactDirectory: artifacts,
      registry: ctx.registry.url,
      env: ctx.env,
    });
    expect(ctx.registry.tags("@rukie/coding-agent")[channel]).toBe(receipt.version);
    expect(ctx.registry.bytes("@rukie/coding-agent-darwin-arm64", receipt.version)).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
}, 120_000);

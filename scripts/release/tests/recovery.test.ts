import { beforeAll, afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inc, SemVer } from "semver";
import { buildRelease } from "../build.ts";
import { publishRelease, acceptRegistryRelease } from "../publication.ts";
import { verifyReleaseArtifacts } from "../verify.ts";
import { registryFixture } from "./registry.ts";
import { buildVersionFixture } from "./version-fixture.ts";

let artifacts: string;
let owned: string | undefined;
let version: string;
let channel: "latest" | "next";
let olderStable: { artifactDirectory: string; sourceRoot?: string };
let newerStable: Awaited<ReturnType<typeof buildVersionFixture>>;
let olderBeta: Awaited<ReturnType<typeof buildVersionFixture>>;
let newerBeta: Awaited<ReturnType<typeof buildVersionFixture>>;
const versions: Awaited<ReturnType<typeof buildVersionFixture>>[] = [];
const acceptState = async () => {};
beforeAll(async () => {
  artifacts =
    process.env.RUKIE_RELEASE_ARTIFACTS ??
    (owned = await mkdtemp(join(tmpdir(), "rukie recovery original ")));
  if (owned) await buildRelease(artifacts);
  const metadata = await verifyReleaseArtifacts(artifacts);
  version = metadata.version;
  channel = version.includes("-beta.") ? "next" : "latest";
  const parsed = new SemVer(version);
  const stable = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  olderStable =
    version === stable ? { artifactDirectory: artifacts } : await buildVersionFixture(stable);
  if ("cleanup" in olderStable)
    versions.push(olderStable as Awaited<ReturnType<typeof buildVersionFixture>>);
  for (const selected of [inc(stable, "patch")!, `${stable}-beta.1`, `${stable}-beta.2`])
    versions.push(await buildVersionFixture(selected));
  [newerStable, olderBeta, newerBeta] = versions.slice(-3) as [
    typeof newerStable,
    typeof olderBeta,
    typeof newerBeta,
  ];
}, 120_000);
afterAll(async () => {
  for (const fixture of versions) await fixture.cleanup();
  if (owned) await rm(owned, { recursive: true, force: true });
});
const main = "@rukie/coding-agent",
  platform = "@rukie/coding-agent-darwin-arm64";
async function publish(
  ctx: Awaited<ReturnType<typeof registryFixture>>,
  extra: Partial<Parameters<typeof publishRelease>[0]> = {},
) {
  return publishRelease({
    artifactDirectory: artifacts,
    registry: ctx.registry.url,
    env: ctx.env,
    accept: acceptState,
    ...extra,
  });
}

test("complete matching retry downloads original registry bytes with a fresh installed Session", async () => {
  const ctx = await registryFixture();
  try {
    await publish(ctx);
    const uploads = ctx.registry.uploads.length;
    const gets = ctx.registry.tarballGets;
    const receipt = await publish(ctx, { accept: acceptRegistryRelease });
    expect(ctx.registry.uploads.length).toBe(uploads);
    expect(ctx.registry.tarballGets - gets).toBe(4); // Reconcile both plus independent install cache fetches both.
    expect(ctx.registry.tags(main)[channel]).toBe(version);
    expect(receipt.superseded).toBe(false);
  } finally {
    await ctx.cleanup();
  }
}, 120_000);
for (const selected of [platform, main])
  test(`accepted ${selected} PUT with lost socket response reconciles actual bytes`, async () => {
    const ctx = await registryFixture();
    ctx.registry.unknownUpload(selected);
    try {
      const receipt = await publish(ctx);
      expect(receipt.version).toBe(version);
      expect(ctx.registry.uploads.filter((name) => name === selected)).toHaveLength(1);
      expect(ctx.registry.tags(main)[channel]).toBe(version);
    } finally {
      await ctx.cleanup();
    }
  }, 120_000);
for (const conflict of ["bytes", "repository", "dependencies", "platform"] as const)
  test(`same-version ${conflict} conflict stops without republish`, async () => {
    const ctx = await registryFixture();
    try {
      await publish(ctx);
      const before = ctx.registry.uploads.length;
      if (conflict === "bytes") ctx.registry.corruptBytes(platform, version);
      else if (conflict === "platform")
        ctx.registry.mutateVersion(platform, version, (value) => {
          value.cpu = ["x64"];
        });
      else
        ctx.registry.mutateVersion(main, version, (value) => {
          value[conflict === "dependencies" ? "optionalDependencies" : "repository"] =
            conflict === "dependencies"
              ? { [platform]: "9.9.9" }
              : { type: "git", url: "git+https://github.com/wrong/repo.git" };
        });
      await expect(publish(ctx)).rejects.toThrow("conflict");
      expect(ctx.registry.uploads.length).toBe(before);
      expect(ctx.registry.tags(main)[channel]).toBe(version);
    } finally {
      await ctx.cleanup();
    }
  }, 120_000);
for (const status of [401, 503])
  test(`registry lookup${status} is uncertainty, never absence`, async () => {
    const ctx = await registryFixture();
    ctx.registry.failLookup(status);
    try {
      await expect(publish(ctx)).rejects.toThrow("uncertain");
      expect(ctx.registry.uploads).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  }, 120_000);
test("real Session rejection is recovered from existing bytes without duplicate uploads", async () => {
  const ctx = await registryFixture();
  try {
    await expect(
      publish(ctx, { accept: (options) => acceptRegistryRelease(options, true) }),
    ).rejects.toThrow("Session acceptance failed");
    expect(ctx.registry.tags(main).latest).toBeUndefined();
    const before = ctx.registry.uploads.length;
    await publish(ctx, { accept: acceptRegistryRelease });
    expect(ctx.registry.uploads.length).toBe(before);
    expect(ctx.registry.tags(main)[channel]).toBe(version);
  } finally {
    await ctx.cleanup();
  }
}, 120_000);
test("tag failure preserves stable channel; rerun and unknown accepted tag outcome reconcile state", async () => {
  const ctx = await registryFixture();
  try {
    // Independent stable source remains valid even when the shared build is a beta.
    ctx.registry.failPromotion();
    await expect(publish(ctx, { ...olderStable })).rejects.toThrow("Channel update outcome");
    expect(ctx.registry.tags(main).latest).toBeUndefined();
    const before = ctx.registry.uploads.length;
    ctx.registry.unknownPromotion();
    const receipt = await publish(ctx, { ...olderStable });
    expect(ctx.registry.uploads.length).toBe(before);
    expect(ctx.registry.tags(main).latest).toBe(receipt.version);
  } finally {
    await ctx.cleanup();
  }
}, 120_000);
test("older stable recovery cannot lower latest, explicit rollback selects a complete accepted version", async () => {
  const ctx = await registryFixture();
  try {
    const old = await publish(ctx, { ...olderStable });
    const next = await publish(ctx, { ...newerStable });
    expect((await publish(ctx, { ...olderStable })).superseded).toBe(true);
    expect(ctx.registry.tags(main).latest).toBe(next.version);
    const uploads = ctx.registry.uploads.length;
    const rollback = await publish(ctx, {
      ...olderStable,
      operation: "rollback",
      accept: acceptRegistryRelease,
    });
    expect(rollback.operation).toBe("rollback");
    expect(rollback.previousVersion).toBe(next.version);
    expect(ctx.registry.tags(main).latest).toBe(old.version);
    expect(ctx.registry.tags(main).next).toBeUndefined();
    expect(ctx.registry.uploads.length).toBe(uploads);
  } finally {
    await ctx.cleanup();
  }
}, 120_000);
test("older missing beta is blocked before upload; complete old beta skips newer next and explicit rollback only moves next", async () => {
  const ctx = await registryFixture();
  try {
    const newer = await publish(ctx, { ...newerBeta });
    const initial = ctx.registry.uploads.length;
    await expect(publish(ctx, { ...olderBeta })).rejects.toThrow("superseded");
    expect(ctx.registry.uploads.length).toBe(initial);
    expect(ctx.registry.tags(main).next).toBe(newer.version);
  } finally {
    await ctx.cleanup();
  }
  const complete = await registryFixture();
  try {
    const older = await publish(complete, { ...olderBeta });
    const newer = await publish(complete, { ...newerBeta });
    const uploads = complete.registry.uploads.length;
    expect((await publish(complete, { ...olderBeta })).superseded).toBe(true);
    expect(complete.registry.tags(main).next).toBe(newer.version);
    await publish(complete, { ...olderBeta, operation: "rollback", accept: acceptRegistryRelease });
    expect(complete.registry.tags(main).next).toBe(older.version);
    expect(complete.registry.tags(main).latest).toBeUndefined();
    expect(complete.registry.uploads.length).toBe(uploads);
  } finally {
    await complete.cleanup();
  }
}, 120_000);
test("rollback refuses missing registry packages and performs no upload", async () => {
  const ctx = await registryFixture();
  try {
    await expect(publish(ctx, { operation: "rollback" })).rejects.toThrow("never uploads");
    expect(ctx.registry.uploads).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
}, 120_000);

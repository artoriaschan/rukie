import { beforeAll, afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRelease } from "../build.ts";
import {
  downloadOriginalAssets,
  preserveOriginalAssets,
  verifyAcceptanceWitness,
} from "../assets.ts";
import { releaseObject } from "../publication.ts";

let artifacts: string;
let owned: string | undefined;
beforeAll(async () => {
  artifacts =
    process.env.RUKIE_RELEASE_ARTIFACTS ??
    (owned = await mkdtemp(join(tmpdir(), "rukie asset source ")));
  if (owned) await buildRelease(artifacts);
}, 120_000);
afterAll(async () => {
  if (owned) await rm(owned, { recursive: true, force: true });
});

async function fixture() {
  const metadata = releaseObject(await Bun.file(join(artifacts, "release-build.json")).json());
  if (
    typeof metadata.commit !== "string" ||
    typeof metadata.version !== "string" ||
    !Array.isArray(metadata.packages)
  )
    throw new Error("Invalid source fixture");
  const root = await mkdtemp(join(tmpdir(), "rukie Release asset fixture "));
  for (const name of [
    "release-build.json",
    "release-modules.json",
    ...metadata.packages.map((value) => {
      const pkg = releaseObject(value);
      if (typeof pkg.tarball !== "string") throw new Error("Invalid fixture tarball");
      return pkg.tarball;
    }),
  ])
    await Bun.write(join(root, name), await readFile(join(artifacts, name)));
  const audit = {
    schemaVersion: 1,
    commit: metadata.commit,
    platform: metadata.platform,
    repository: "example/rukie",
    runId: "123",
    runAttempt: "1",
    event: "push",
    releaseBuildSha256: createHash("sha256")
      .update(await readFile(join(root, "release-build.json")))
      .digest("hex"),
    releaseModulesSha256: createHash("sha256")
      .update(await readFile(join(root, "release-modules.json")))
      .digest("hex"),
    packages: metadata.packages,
  };
  for (const name of ["ci-acceptance.json", "current-acceptance.json"])
    await Bun.write(join(root, name), JSON.stringify(audit));
  const stored = new Map<number, { name: string; bytes: Uint8Array }>();
  let immutable = false;
  let assetState = "uploaded";
  let sizeOffset = 0;
  let success = true;
  let runCommit = metadata.commit;
  const tag = `coding-agent-v${metadata.version}`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 128 * 1024 * 1024,
    async fetch(request): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path.endsWith(`/releases/tags/${tag}`))
        return Response.json({
          id: 1,
          tag_name: tag,
          immutable,
          upload_url: `${server.url.origin}/repos/example/rukie/releases/1/assets{?name}`,
          assets: [...stored].map(([id, value]) => ({
            id,
            name: value.name,
            size: value.bytes.length + sizeOffset,
            state: assetState,
          })),
        });
      const attempt = /\/attempts\/(\d+)(?:\/jobs)?$/.exec(path)?.[1];
      if (attempt && !path.endsWith("/jobs"))
        return Response.json({
          id: 123,
          run_attempt: Number(attempt),
          head_sha: runCommit,
          repository: { full_name: "example/rukie" },
          path: ".github/workflows/release-publish.yml",
          event: "push",
          status: "in_progress",
          conclusion: null,
        });
      if (attempt && path.endsWith("/jobs"))
        return Response.json({
          jobs: [
            {
              name: "Verify source and installed darwin-arm64",
              head_sha: runCommit,
              status: "completed",
              conclusion: success ? "success" : "failure",
            },
          ],
        });
      if (path.endsWith("/releases/1/assets") && request.method === "POST") {
        const name = new URL(request.url).searchParams.get("name");
        if (!name) throw new Error("Missing fixture asset name");
        const bytes = new Uint8Array(await request.arrayBuffer());
        stored.set(stored.size + 1, { name, bytes });
        return Response.json({ ok: true }, { status: 201 });
      }
      const match = /\/releases\/assets\/(\d+)$/.exec(path);
      if (match) {
        const asset = stored.get(Number(match[1]));
        return asset ? new Response(asset.bytes) : new Response(null, { status: 404 });
      }
      return new Response(null, { status: 404 });
    },
  });
  return {
    root,
    stored,
    context: {
      repository: "example/rukie",
      tag,
      commit: metadata.commit,
      token: "fabricated-GitHub-token",
      api: server.url.origin,
      runId: "123",
      runAttempt: "1",
    },
    incompleteAsset() {
      assetState = "starter";
    },
    wrongSize() {
      sizeOffset = 1;
    },
    failJob() {
      success = false;
    },
    wrongCommit() {
      runCommit = "0".repeat(40);
    },
    immutable() {
      immutable = true;
    },
    cleanup: async () => {
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("original bytes are preserved only after exact completed read-only job confirmation, while the workflow remains in progress", async () => {
  const value = await fixture();
  try {
    await preserveOriginalAssets(value.context, value.root);
    expect(value.stored.size).toBe(5);
    const before = [...value.stored.values()].map((asset) =>
      createHash("sha256").update(asset.bytes).digest("hex"),
    );
    await preserveOriginalAssets(value.context, value.root);
    expect(value.stored.size).toBe(5);
    expect(
      [...value.stored.values()].map((asset) =>
        createHash("sha256").update(asset.bytes).digest("hex"),
      ),
    ).toEqual(before);
  } finally {
    await value.cleanup();
  }
}, 120_000);

test("self-authored witness does not authorize assets when trusted job failed or run commit differs", async () => {
  const value = await fixture();
  try {
    value.failJob();
    await expect(verifyAcceptanceWitness(value.context, value.root)).rejects.toThrow(
      "job has not succeeded",
    );
    value.wrongCommit();
    await expect(verifyAcceptanceWitness(value.context, value.root)).rejects.toThrow(
      "run identity mismatch",
    );
    expect(value.stored.size).toBe(0);
  } finally {
    await value.cleanup();
  }
}, 120_000);

test("partial or immutable original asset state stops before reconstruction or npm writes", async () => {
  const value = await fixture();
  try {
    value.immutable();
    await expect(
      downloadOriginalAssets(value.context, join(value.root, "download")),
    ).rejects.toThrow("Immutable Release");
    value.stored.set(1, {
      name: "release-build.json",
      bytes: await readFile(join(value.root, "release-build.json")),
    });
    await expect(
      downloadOriginalAssets(value.context, join(value.root, "download")),
    ).rejects.toThrow("Partial original");
    expect(value.stored.size).toBe(1);
  } finally {
    await value.cleanup();
  }
}, 120_000);

test("conflicting preserved bytes are never overwritten by a newly accepted upload", async () => {
  const value = await fixture();
  try {
    await preserveOriginalAssets(value.context, value.root);
    const asset = [...value.stored.values()].find((asset) => asset.name.endsWith(".tgz"));
    if (!asset) throw new Error("Missing preserved tarball");
    asset.bytes[0] = asset.bytes[0]! ^ 1;
    const corrupted = createHash("sha256").update(asset.bytes).digest("hex");
    await expect(preserveOriginalAssets(value.context, value.root)).rejects.toThrow();
    expect(createHash("sha256").update(asset.bytes).digest("hex")).toBe(corrupted);
    expect(value.stored.size).toBe(5);
  } finally {
    await value.cleanup();
  }
}, 120_000);

for (const failure of ["incompleteAsset", "wrongSize"] as const)
  test(`original assets reject ${failure} before accepting replay`, async () => {
    const value = await fixture();
    try {
      await preserveOriginalAssets(value.context, value.root);
      value[failure]();
      await expect(
        downloadOriginalAssets(value.context, join(value.root, "download")),
      ).rejects.toThrow(failure === "incompleteAsset" ? "incomplete" : "size mismatch");
      expect(value.stored.size).toBe(5);
    } finally {
      await value.cleanup();
    }
  }, 120_000);

test("a later successful verification witness preserves the original producing attempt", async () => {
  const value = await fixture();
  try {
    await preserveOriginalAssets(value.context, value.root);
    const original = [...value.stored.values()].find(
      (asset) => asset.name === "ci-acceptance.json",
    )!;
    const bytes = Buffer.from(original.bytes);
    const current = releaseObject(
      await Bun.file(join(value.root, "current-acceptance.json")).json(),
    );
    current.runAttempt = "2";
    await Bun.write(join(value.root, "current-acceptance.json"), JSON.stringify(current));
    await preserveOriginalAssets({ ...value.context, runAttempt: "2" }, value.root);
    expect(Buffer.from(original.bytes).equals(bytes)).toBe(true);
    expect(releaseObject(JSON.parse(Buffer.from(original.bytes).toString())).runAttempt).toBe("1");
    value.failJob();
    await expect(
      preserveOriginalAssets({ ...value.context, runAttempt: "2" }, value.root),
    ).rejects.toThrow("has not succeeded");
    expect(value.stored.size).toBe(5);
  } finally {
    await value.cleanup();
  }
}, 120_000);

test("freshly downloaded originals pass the complete installed acceptance without rebuilding", async () => {
  const value = await fixture();
  try {
    await preserveOriginalAssets(value.context, value.root);
    const directory = join(value.root, "fresh-originals");
    expect(await downloadOriginalAssets(value.context, directory)).toBe(true);
    const child = Bun.spawn(["bun", "scripts/release/accept.ts", "--artifact-dir", directory], {
      cwd: join(import.meta.dir, "../../.."),
      env: { ...process.env, RUKIE_RELEASE_ARTIFACTS: directory },
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(120_000),
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`Preserved installed acceptance failed: ${stdout}\n${stderr}`);
    expect(code).toBe(0);
  } finally {
    await value.cleanup();
  }
}, 120_000);

test("downloaded module inventory is bound to the producing audit identity", async () => {
  const value = await fixture();
  try {
    await preserveOriginalAssets(value.context, value.root);
    const inventory = [...value.stored.values()].find(
      (asset) => asset.name === "release-modules.json",
    );
    if (!inventory) throw new Error("Missing preserved module inventory");
    inventory.bytes = new TextEncoder().encode('["fabricated/module.js"]\n');
    await expect(
      downloadOriginalAssets(value.context, join(value.root, "changed-inventory")),
    ).rejects.toThrow("witness identity mismatch");
    expect(value.stored.size).toBe(5);
  } finally {
    await value.cleanup();
  }
}, 120_000);

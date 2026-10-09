import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { link, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReleaseArtifacts, type ReleaseMetadata } from "../verify.ts";
import { buildRelease, MAIN_PACKAGE, PLATFORM_PACKAGE } from "../build.ts";

let artifacts: string;
let owned: string | undefined;
let metadata: ReleaseMetadata;
beforeAll(async () => {
  artifacts =
    process.env.RUKIE_RELEASE_ARTIFACTS ??
    (owned = await mkdtemp(join(tmpdir(), "rukie-artifact-build-")));
  if (owned) await buildRelease(artifacts);
  metadata = await verifyReleaseArtifacts(artifacts);
}, 120_000);
afterAll(async () => {
  if (owned) await rm(owned, { recursive: true, force: true });
});

async function changedMetadata(
  change: (value: ReleaseMetadata) => void,
  check: (directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "rukie-artifact-change-"));
  try {
    const value = structuredClone(metadata);
    change(value);
    await Bun.write(join(directory, "release-build.json"), JSON.stringify(value));
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function run(argv: string[]) {
  const child = Bun.spawn(argv, {
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(30_000),
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`Artifact fixture command failed: ${stderr}`);
}

async function alteredTarball(
  name: string,
  change: (packageDirectory: string) => Promise<void>,
  message: string,
) {
  const directory = await mkdtemp(join(tmpdir(), "rukie-artifact-tarball-"));
  try {
    const value = structuredClone(metadata);
    for (const entry of value.packages)
      await link(join(artifacts, entry.tarball), join(directory, entry.tarball));
    const entry = value.packages.find((entry) => entry.name === name);
    if (!entry) throw new Error("Missing fixture package");
    const tarball = join(directory, entry.tarball);
    const unpack = join(directory, "unpack");
    await run(["mkdir", "-p", unpack]);
    await run(["tar", "-xzf", tarball, "-C", unpack]);
    await change(join(unpack, "package"));
    // Break the fixture hard link before repacking, keeping shared acceptance artifacts intact.
    await rm(tarball);
    await run([
      "tar",
      "-czf",
      tarball,
      "--options",
      "gzip:compression-level=1",
      "-C",
      unpack,
      "package",
    ]);
    const bytes = await readFile(tarball);
    entry.sha256 = createHash("sha256").update(bytes).digest("hex");
    entry.integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    await Bun.write(join(directory, "release-build.json"), JSON.stringify(value));
    await expect(verifyReleaseArtifacts(directory)).rejects.toThrow(message);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("release verification rejects malformed metadata before consuming artifact paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rukie-invalid-artifact-"));
  try {
    await Bun.write(
      join(directory, "release-build.json"),
      JSON.stringify({
        schemaVersion: 1,
        version: "0.1.0",
        packages: [{ tarball: "../../outside.tgz" }],
      }),
    );
    await expect(verifyReleaseArtifacts(directory)).rejects.toThrow("Invalid release metadata");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verified tarballs identify the source commit, one product version and the exact arm64 package pair", () => {
  expect(metadata.platform).toBe("darwin-arm64");
  expect(metadata.packages.map((entry) => entry.name).sort()).toEqual(
    [MAIN_PACKAGE, PLATFORM_PACKAGE].sort(),
  );
  expect(metadata.packages.every((entry) => entry.version === metadata.version)).toBe(true);
});

test("formal publication rejects dirty metadata and a different reviewed source commit", async () => {
  await changedMetadata(
    (value) => {
      value.dirty = true;
    },
    async (directory) => {
      await expect(verifyReleaseArtifacts(directory, { requireClean: true })).rejects.toThrow(
        "Formal release rejects dirty",
      );
    },
  );
  await expect(
    verifyReleaseArtifacts(artifacts, { expectedCommit: "0".repeat(40) }),
  ).rejects.toThrow("does not match the reviewed commit");
});

test("metadata traversal, version drift, unsupported platforms and invalid tool identities are rejected", async () => {
  const changes: ((value: ReleaseMetadata) => void)[] = [
    (value) => {
      value.packages[0]!.tarball = "../outside.tgz";
    },
    (value) => {
      value.packages[0]!.version = "0.2.0";
    },
    (value) => {
      Object.assign(value, { platform: "darwin-x64" });
    },
    (value) => {
      value.nodeVersion = "v24.14.9";
    },
    (value) => {
      value.bunVersion = "1.4.1";
    },
    (value) => {
      value.npmVersion = "unknown";
    },
  ];
  for (const change of changes)
    await changedMetadata(change, async (directory) => {
      await expect(verifyReleaseArtifacts(directory)).rejects.toThrow("Invalid release metadata");
    });
});

test("tarball checksums are verified before unpacking", async () => {
  await changedMetadata(
    (value) => {
      value.packages[0]!.sha256 = "0".repeat(64);
    },
    async (directory) => {
      for (const entry of metadata.packages)
        await link(join(artifacts, entry.tarball), join(directory, entry.tarball));
      await expect(verifyReleaseArtifacts(directory)).rejects.toThrow("tarball digest mismatch");
    },
  );
});

test("a product version inconsistent with source is rejected before artifact access", async () => {
  await changedMetadata(
    (value) => {
      value.version = "0.2.0";
      for (const entry of value.packages) {
        entry.tarball = entry.tarball.replace(`-${entry.version}.tgz`, "-0.2.0.tgz");
        entry.version = value.version;
      }
    },
    async (directory) => {
      await expect(verifyReleaseArtifacts(directory)).rejects.toThrow(
        "product version differs from its source manifest",
      );
    },
  );
});

test("a real packed manifest cannot introduce an Intel dependency", async () => {
  await alteredTarball(
    MAIN_PACKAGE,
    async (directory) => {
      const value: unknown = await Bun.file(join(directory, "package.json")).json();
      if (!value || typeof value !== "object") throw new Error("Missing fixture manifest");
      await Bun.write(
        join(directory, "package.json"),
        JSON.stringify({
          ...value,
          optionalDependencies: {
            [PLATFORM_PACKAGE]: metadata.version,
            "@rukie/coding-agent-darwin-x64": metadata.version,
          },
        }),
      );
    },
    "platform dependency or launcher differs",
  );
});

test("wrong executable architecture is rejected from an actual repacked platform tarball", async () => {
  await alteredTarball(
    PLATFORM_PACKAGE,
    async (directory) => {
      const path = join(directory, "bin/rg");
      const bytes = await readFile(path);
      bytes.writeUInt32LE(0x01000007, 4);
      await Bun.write(path, bytes);
    },
    "bin/rg is not an arm64 Mach-O",
  );
}, 30_000);

test("a different arm64 ripgrep cannot masquerade as the explicitly selected source binary", async () => {
  await alteredTarball(
    PLATFORM_PACKAGE,
    async (directory) => {
      const path = join(directory, "bin/rg");
      const bytes = await readFile(path);
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
      await Bun.write(path, bytes);
    },
    "resource differs from explicit arm64 source: bin/rg",
  );
}, 30_000);

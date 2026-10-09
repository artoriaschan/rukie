import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  BUILD_BUN_VERSION,
  MAIN_PACKAGE,
  isReleasePlatform,
  releasePlatforms,
  type ReleasePlatform,
} from "./platforms.ts";

type ArtifactPackage = {
  name: string;
  version: string;
  tarball: string;
  sha256: string;
  integrity: string;
};
export type ReleaseMetadata = {
  schemaVersion: 1;
  version: string;
  commit: string;
  dirty: boolean;
  platform: ReleasePlatform;
  bunVersion: string;
  nodeVersion: string;
  npmVersion: string;
  compileDurationMs: number;
  buildDurationMs: number;
  avatarSha256: string;
  packages: ArtifactPackage[];
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid release metadata: expected an object");
  // A non-null non-array object has string-keyed properties, which remain unknown.
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, names: string[]) {
  if (Object.keys(value).sort().join(",") !== names.sort().join(","))
    throw new Error("Invalid release metadata: unexpected or missing fields");
}
function string(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`Invalid release metadata: ${field}`);
  return value;
}
function duration(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid release metadata: ${field}`);
  return value;
}
function parseMetadata(value: unknown): ReleaseMetadata {
  const data = object(value);
  exactKeys(data, [
    "schemaVersion",
    "version",
    "commit",
    "dirty",
    "platform",
    "bunVersion",
    "nodeVersion",
    "npmVersion",
    "compileDurationMs",
    "buildDurationMs",
    "avatarSha256",
    "packages",
  ]);
  if (
    data.schemaVersion !== 1 ||
    !isReleasePlatform(data.platform) ||
    typeof data.dirty !== "boolean"
  )
    throw new Error("Invalid release metadata: schema, platform or dirty state");
  const version = string(data.version, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/, "version");
  const platform = data.platform;
  const target = releasePlatforms[platform];
  if (!Array.isArray(data.packages) || data.packages.length !== 2)
    throw new Error("Invalid release metadata: expected main and platform packages");
  const packages = data.packages.map((input: unknown) => {
    const entry = object(input);
    exactKeys(entry, ["name", "version", "tarball", "sha256", "integrity"]);
    const name = string(entry.name, /^@rukie\/[a-z0-9-]+$/, "package name");
    if (name !== MAIN_PACKAGE && name !== target.packageName)
      throw new Error("Invalid release metadata: package name is outside the selected platform");
    if (entry.version !== version)
      throw new Error("Invalid release metadata: package version drift");
    const tarball = string(entry.tarball, /^[a-z0-9][a-z0-9.-]*\.tgz$/, "tarball filename");
    if (tarball !== `${name.slice(1).replace("/", "-")}-${version}.tgz`)
      throw new Error("Invalid release metadata: tarball identity");
    return {
      name,
      version,
      tarball,
      sha256: string(entry.sha256, /^[a-f0-9]{64}$/, "sha256"),
      integrity: string(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, "integrity"),
    };
  });
  if (new Set(packages.map((entry) => entry.name)).size !== 2)
    throw new Error("Invalid release metadata: duplicate package identity");
  const bunVersion = string(data.bunVersion, /^\d+\.\d+\.\d+$/, "Bun version");
  if (bunVersion !== BUILD_BUN_VERSION)
    throw new Error(`Invalid release metadata: expected Bun ${BUILD_BUN_VERSION}`);
  const nodeVersion = string(data.nodeVersion, /^v\d+\.\d+\.\d+$/, "Node version");
  const [major = 0, minor = 0] = nodeVersion.slice(1).split(".").map(Number);
  if (major < 24 || (major === 24 && minor < 15))
    throw new Error("Invalid release metadata: Node is older than 24.15.0");
  return {
    schemaVersion: 1,
    version,
    commit: string(data.commit, /^[a-f0-9]{40}$/, "commit"),
    dirty: data.dirty,
    platform,
    bunVersion,
    nodeVersion,
    npmVersion: string(data.npmVersion, /^\d+\.\d+\.\d+$/, "npm version"),
    compileDurationMs: duration(data.compileDurationMs, "compile duration"),
    buildDurationMs: duration(data.buildDurationMs, "build duration"),
    avatarSha256: string(data.avatarSha256, /^[a-f0-9]{64}$/, "avatar digest"),
    packages,
  };
}
async function run(argv: string[], cwd?: string) {
  const child = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(30_000),
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`Artifact verification ${argv[0]} failed: ${stderr || stdout}`);
  return stdout.trim();
}
function digest(bytes: Uint8Array, algorithm = "sha256", encoding: "hex" | "base64" = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}
function architecture(bytes: Buffer, name: string, platform: ReleasePlatform) {
  const target = releasePlatforms[platform];
  if (
    bytes.length < 32 ||
    bytes.readUInt32LE(0) !== 0xfeedfacf ||
    bytes.readUInt32LE(4) !== target.machCpuType
  )
    throw new Error(`Artifact ${name} is not an ${target.cpu} Mach-O`);
}
async function sourceResources(root: string, platform: ReleasePlatform) {
  const target = releasePlatforms[platform];
  const rg = await realpath(join(root, "packages/agent/node_modules/@vscode/ripgrep"));
  const sharp = await realpath(join(root, "packages/coding-agent/node_modules/sharp"));
  const rgRoot = dirname(Bun.resolveSync(`${target.ripgrepPackage}/package.json`, rg));
  const sharpRoot = dirname(Bun.resolveSync(`${target.sharpPackage}/package.json`, sharp));
  const vipsRoot = dirname(Bun.resolveSync(`${target.vipsPackage}/package.json`, sharp));
  const resources = new Map<string, string>([["bin/rg", join(rgRoot, "bin/rg")]]);
  for (const [name, directory] of [
    [target.sharpPackage, sharpRoot],
    [target.vipsPackage, vipsRoot],
  ]) {
    if (!name || !directory) throw new Error("Missing release resource descriptor");
    const lib = join(directory, "lib");
    for (const file of await readdir(lib, { recursive: true, withFileTypes: true }))
      if (file.isFile()) {
        const source = join(file.parentPath, file.name);
        resources.set(`bin/native/${name}/lib/${source.slice(lib.length + 1)}`, source);
      }
  }
  for (const path of [
    `bin/native/${target.sharpPackage}/lib/${target.sharpBinary}`,
    `bin/native/${target.vipsPackage}/lib/${target.vipsBinary}`,
  ])
    if (!resources.has(path))
      throw new Error(`Release resource layout differs from its descriptor: ${path}`);
  return resources;
}

/** Verify the actual tarballs. Formal publication must require clean source and the reviewed commit. */
export async function verifyReleaseArtifacts(
  artifactDirectory: string,
  options: { root?: string; expectedCommit?: string; requireClean?: boolean } = {},
): Promise<ReleaseMetadata> {
  const root = options.root ?? resolve(import.meta.dir, "../..");
  const directory = await realpath(artifactDirectory);
  const metadata = parseMetadata(await Bun.file(join(directory, "release-build.json")).json());
  if (options.requireClean && metadata.dirty)
    throw new Error("Formal release rejects dirty build metadata");
  if (options.expectedCommit && metadata.commit !== options.expectedCommit)
    throw new Error("Release source commit does not match the reviewed commit");
  await run(["git", "cat-file", "-e", `${metadata.commit}^{commit}`], root);
  const sourceManifest: unknown = JSON.parse(
    await run(["git", "show", `${metadata.commit}:packages/coding-agent/package.json`], root),
  );
  const currentManifest: unknown = await Bun.file(
    join(root, "packages/coding-agent/package.json"),
  ).json();
  if (
    object(metadata.dirty && !options.requireClean ? currentManifest : sourceManifest).version !==
    metadata.version
  )
    throw new Error("Release product version differs from its source manifest");
  if (digest(await readFile(join(root, "brand/rukie-avatar.png"))) !== metadata.avatarSha256)
    throw new Error("Release avatar identity differs from the source asset");
  const resources = await sourceResources(root, metadata.platform);
  const target = releasePlatforms[metadata.platform];
  const extracted = await mkdtemp(join(tmpdir(), "rukie-artifact-verify-"));
  try {
    let notice: string | undefined;
    for (const entry of [...metadata.packages].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const tarball = join(directory, entry.tarball);
      if (!(await realpath(tarball)).startsWith(`${directory}${sep}`))
        throw new Error("Release tarball escapes its artifact directory");
      const bytes = await readFile(tarball);
      if (
        digest(bytes) !== entry.sha256 ||
        `sha512-${digest(bytes, "sha512", "base64")}` !== entry.integrity
      )
        throw new Error(`Release tarball digest mismatch: ${entry.tarball}`);
      const isMain = entry.name === MAIN_PACKAGE;
      const expected = new Set([
        "package.json",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        ...(isMain ? ["bin/rukie.cjs"] : ["bin/rukie", ...resources.keys()]),
      ]);
      const listing = (await run(["tar", "-tzf", tarball])).split("\n");
      const files = listing.filter((name) => !name.endsWith("/"));
      const directories = new Set(["package/"]);
      for (const file of expected) {
        const components = file.split("/");
        for (let count = 1; count < components.length; count++)
          directories.add(`package/${components.slice(0, count).join("/")}/`);
      }
      if (
        new Set(files).size !== files.length ||
        files.some((name) => !name.startsWith("package/") || !expected.has(name.slice(8))) ||
        files.length !== expected.size ||
        listing.some((name) => name.endsWith("/") && !directories.has(name)) ||
        listing.some((name) => name.startsWith("/") || name.split("/").includes(".."))
      )
        throw new Error(`Release tarball file whitelist differs: ${entry.tarball}`);
      const detailed = (await run(["tar", "-tvzf", tarball])).split("\n");
      if (detailed.some((line) => !line.startsWith("-") && !line.startsWith("d")))
        throw new Error(`Release tarball contains links or special files: ${entry.tarball}`);
      const unpack = join(extracted, isMain ? "main" : "platform");
      await mkdir(unpack);
      await run(["tar", "-xzf", tarball, "-C", unpack]);
      const pkg = join(unpack, "package");
      const manifest = object(await Bun.file(join(pkg, "package.json")).json());
      if (
        manifest.name !== entry.name ||
        manifest.version !== metadata.version ||
        manifest.license !== "MIT" ||
        "private" in manifest ||
        "exports" in manifest ||
        "dependencies" in manifest ||
        "devDependencies" in manifest ||
        JSON.stringify(manifest).includes("workspace:")
      )
        throw new Error(`Release manifest identity differs: ${entry.name}`);
      if (isMain) {
        const deps = object(manifest.optionalDependencies);
        if (
          Object.keys(deps).length !== 1 ||
          deps[target.packageName] !== metadata.version ||
          JSON.stringify(manifest.bin) !== JSON.stringify({ rukie: "bin/rukie.cjs" })
        )
          throw new Error("Main release platform dependency or launcher differs");
      } else {
        if (
          JSON.stringify(manifest.os) !== JSON.stringify([target.os]) ||
          JSON.stringify(manifest.cpu) !== JSON.stringify([target.cpu]) ||
          "optionalDependencies" in manifest
        )
          throw new Error("Platform release architecture or dependencies differ");
        for (const executable of ["bin/rukie", "bin/rg"]) {
          architecture(await readFile(join(pkg, executable)), executable, metadata.platform);
          if (((await stat(join(pkg, executable))).mode & 0o111) === 0)
            throw new Error(`Release executable permissions missing: ${executable}`);
        }
        for (const [path, source] of resources)
          if (digest(await readFile(join(pkg, path))) !== digest(await readFile(source)))
            throw new Error(`Release resource differs from explicit ${target.cpu} source: ${path}`);
      }
      if (!(await readFile(join(pkg, "LICENSE"), "utf8")).includes("MIT License"))
        throw new Error("Release project MIT license missing");
      const nextNotice = await readFile(join(pkg, "THIRD_PARTY_NOTICES.md"), "utf8");
      if (
        !nextNotice.includes("Bun runtime 1.4.2") ||
        (notice !== undefined && notice !== nextNotice)
      )
        throw new Error("Release third-party notices missing or inconsistent");
      notice = nextNotice;
    }
    return metadata;
  } finally {
    await rm(extracted, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "artifact-dir": { type: "string", default: "dist/release" },
      "require-clean": { type: "boolean", default: false },
      commit: { type: "string" },
    },
  });
  console.log(
    JSON.stringify(
      await verifyReleaseArtifacts(values["artifact-dir"]!, {
        requireClean: values["require-clean"],
        expectedCommit: values.commit,
      }),
      null,
      2,
    ),
  );
}

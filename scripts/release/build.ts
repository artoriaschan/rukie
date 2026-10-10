import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { compiledBunOptions } from "../compiled-bun.ts";
import { generateNotices } from "./notices.ts";

import {
  BUILD_BUN_VERSION,
  DEFAULT_PLATFORM,
  MAIN_PACKAGE,
  isReleasePlatform,
  releasePlatforms,
  type ReleasePlatform,
} from "./platforms.ts";
export { BUILD_BUN_VERSION, MAIN_PACKAGE } from "./platforms.ts";
export const PLATFORM_PACKAGE = releasePlatforms[DEFAULT_PLATFORM].packageName;
const defaultRoot = resolve(import.meta.dir, "../..");

async function run(argv: string[], cwd = defaultRoot) {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${argv[0]} failed (${code}): ${stderr || stdout}`);
  return stdout.trim();
}

function productManifest(value: unknown): { version: string } {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(value.version)
  )
    throw new Error("coding-agent manifest has no valid product version");
  return { version: value.version };
}

/** Build and pack only; writes no registry state. The output directory must be task-owned. */
export async function buildRelease(
  output: string,
  platformId: ReleasePlatform = DEFAULT_PLATFORM,
  sourceRoot = defaultRoot,
) {
  const root = await realpath(resolve(sourceRoot));
  const coding = join(root, "packages/coding-agent");
  const agent = join(root, "packages/agent");
  const target = releasePlatforms[platformId];
  const startedAt = performance.now();
  if (Bun.version !== BUILD_BUN_VERSION)
    throw new Error(`Release builds require Bun ${BUILD_BUN_VERSION}; found ${Bun.version}`);
  if (process.platform !== target.os || process.arch !== target.cpu)
    throw new Error(`Release build requires a ${platformId} host for native resource verification`);
  const out = resolve(output);
  if (out === root || root.startsWith(`${out}/`))
    throw new Error("Release output cannot contain the source checkout");
  await mkdir(out, { recursive: true });
  const staging = join(out, "staging");
  await rm(staging, { recursive: true, force: true });
  const main = join(staging, "coding-agent");
  const platform = join(staging, target.packageName.replace("@rukie/", ""));
  const bin = join(platform, "bin");
  await Promise.all([
    mkdir(join(main, "bin"), { recursive: true }),
    mkdir(bin, { recursive: true }),
  ]);
  const { version } = productManifest(await Bun.file(join(coding, "package.json")).json());
  const commit = await run(["git", "rev-parse", "HEAD"], root);
  const dirty = (await run(["git", "status", "--porcelain"], root)).length > 0;
  const avatar = join(root, "brand/rukie-avatar.png");
  const avatarBytes = await readFile(avatar);
  if (avatarBytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error("Release avatar PNG is missing or invalid");
  const sharpRoot = await realpath(join(coding, "node_modules/sharp"));
  const rgRoot = dirname(
    Bun.resolveSync(
      `${target.ripgrepPackage}/package.json`,
      await realpath(join(agent, "node_modules/@vscode/ripgrep")),
    ),
  );
  const nativeRoot = dirname(Bun.resolveSync(`${target.sharpPackage}/package.json`, sharpRoot));
  const vipsRoot = dirname(Bun.resolveSync(`${target.vipsPackage}/package.json`, sharpRoot));
  const sharpManifest: unknown = await Bun.file(join(sharpRoot, "package.json")).json();
  if (
    !sharpManifest ||
    typeof sharpManifest !== "object" ||
    !("version" in sharpManifest) ||
    sharpManifest.version !== "0.35.4"
  )
    throw new Error("Update the native release adapter when sharp changes from locked 0.35.4");
  await cp(join(rgRoot, "bin/rg"), join(bin, "rg"));
  await Promise.all([
    cp(join(nativeRoot, "lib"), join(bin, "native", target.sharpPackage, "lib"), {
      recursive: true,
    }),
    cp(join(vipsRoot, "lib"), join(bin, "native", target.vipsPackage, "lib"), {
      recursive: true,
    }),
  ]);
  const compileStartedAt = performance.now();
  const result = await Bun.build({
    entrypoints: [join(coding, "src/main.ts"), join(coding, "src/ink/sixel-worker.ts")],
    ...compiledBunOptions(target.bunTarget, join(bin, "rukie")),
    metafile: true,
    plugins: [
      {
        name: "release-resources",
        setup(build) {
          build.onLoad({ filter: /[/]coding-agent[/]src[/]main\.ts$/ }, async ({ path }) => ({
            loader: "ts",
            contents: `import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";\nimport { bedrockProviderModule } from "@earendil-works/pi-ai/bedrock-provider";\nimport { setBedrockProviderModule } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";\nregisterBunOAuthFlows();\nsetBedrockProviderModule(bedrockProviderModule);\n${(await Bun.file(path).text()).replace(/^#![^\n]*\n/, "")}`,
          }));
          build.onLoad({ filter: /[/]sixel-graphics\.ts$/ }, async ({ path }) => {
            const source = await Bun.file(path).text();
            const reference = "new URL('./sixel-worker.js', import.meta.url)";
            if (!source.includes(reference))
              throw new Error("Sixel worker locator changed; update the release adapter");
            // Bun merges the owner module into the primary entry, while the extra worker retains ink/.
            return {
              loader: "ts",
              contents: source.replace(
                reference,
                "new URL('./ink/sixel-worker.js', import.meta.url)",
              ),
            };
          });
          build.onLoad({ filter: /[/]sixel[/]upng\.js$/ }, async ({ path }) => {
            const source = await Bun.file(path).text();
            const reference = "module.exports = UPNG = {};";
            if (!source.includes(reference))
              throw new Error("Sixel UPNG declaration changed; update the release adapter");
            // The pinned CommonJS source assigns an undeclared global; strict compiled workers reject it.
            return {
              loader: "js",
              contents: source.replace(reference, "var UPNG = module.exports = {};"),
            };
          });
          build.onLoad({ filter: /[/]avatar-portrait\.ts$/ }, async ({ path }) => {
            const source = await Bun.file(path).text();
            const reference =
              'new URL("../../../../../../brand/rukie-avatar.png", import.meta.url)';
            if (!source.includes(reference))
              throw new Error("Avatar resource locator changed; update the release adapter");
            return {
              loader: "ts",
              contents: `import portraitPath from ${JSON.stringify(avatar)} with { type: "file" };\n${source.replace(reference, "portraitPath")}`,
            };
          });
          build.onLoad({ filter: /[/]sharp[/]dist[/]sharp\.(mjs|cjs)$/ }, () => ({
            loader: "js",
            contents: `import {realpathSync} from "node:fs"; import {dirname,join} from "node:path"; import {createRequire} from "node:module"; const require=createRequire(import.meta.url); export default require(join(dirname(realpathSync(process.execPath)),"native/${target.sharpPackage}/lib/${target.sharpBinary}"));`,
          }));
        },
      },
    ],
  });
  const compileDurationMs = Math.round(performance.now() - compileStartedAt);
  if (!result.success) throw new AggregateError(result.logs, "Release compilation failed");
  await Promise.all([chmod(join(bin, "rukie"), 0o755), chmod(join(bin, "rg"), 0o755)]);
  if (!result.metafile) throw new Error("Release compilation did not produce its module graph");
  const modules = Object.keys(result.metafile.inputs)
    .map((path) => {
      const local = relative(root, resolve(path));
      if (local === ".." || local.startsWith(`..${sep}`))
        throw new Error("Release module is outside the repository");
      return local.split(sep).join("/");
    })
    .sort();
  // This audit is embedding evidence only, separate from tarball identity and publisher authorization.
  await Bun.write(join(out, "release-modules.json"), `${JSON.stringify(modules, null, 2)}\n`);
  const notices = join(staging, "THIRD_PARTY_NOTICES.md");
  await generateNotices(root, modules, [rgRoot, nativeRoot, vipsRoot], notices);
  for (const directory of [main, platform]) {
    await cp(join(root, "LICENSE"), join(directory, "LICENSE"));
    await cp(notices, join(directory, "THIRD_PARTY_NOTICES.md"));
  }
  await cp(join(import.meta.dir, "launcher.cjs"), join(main, "bin/rukie.cjs"));
  await chmod(join(main, "bin/rukie.cjs"), 0o755);
  const repository = process.env.GITHUB_REPOSITORY;
  const shared = {
    version,
    license: "MIT",
    ...(repository
      ? { repository: { type: "git", url: `git+https://github.com/${repository}.git` } }
      : {}),
  };
  await Bun.write(
    join(main, "package.json"),
    JSON.stringify(
      {
        ...shared,
        name: MAIN_PACKAGE,
        description: "Rukie coding agent for macOS Apple Silicon",
        engines: { node: ">=24.15.0" },
        bin: { rukie: "bin/rukie.cjs" },
        files: ["bin/rukie.cjs", "LICENSE", "THIRD_PARTY_NOTICES.md"],
        optionalDependencies: { [target.packageName]: version },
      },
      null,
      2,
    ) + "\n",
  );
  await Bun.write(
    join(platform, "package.json"),
    JSON.stringify(
      {
        ...shared,
        name: target.packageName,
        description: "Rukie standalone Bun executable and native resources for macOS arm64",
        os: [target.os],
        cpu: [target.cpu],
        files: ["bin", "LICENSE", "THIRD_PARTY_NOTICES.md"],
      },
      null,
      2,
    ) + "\n",
  );
  const packages = [];
  for (const [name, directory] of [
    [target.packageName, platform],
    [MAIN_PACKAGE, main],
  ] as const) {
    const output = JSON.parse(
      await run(["npm", "pack", "--json", "--pack-destination", out], directory),
    ) as unknown;
    if (
      !Array.isArray(output) ||
      !output[0] ||
      typeof output[0] !== "object" ||
      typeof output[0].filename !== "string"
    )
      throw new Error("npm pack did not return a tarball filename");
    const tarball = output[0].filename;
    const bytes = await readFile(join(out, tarball));
    packages.push({
      name,
      version,
      tarball,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    });
  }
  const metadata = {
    schemaVersion: 1,
    version,
    commit,
    dirty,
    platform: platformId,
    bunVersion: Bun.version,
    compileDurationMs,
    buildDurationMs: Math.round(performance.now() - startedAt),
    nodeVersion: await run(["node", "--version"], root),
    npmVersion: await run(["npm", "--version"], root),
    avatarSha256: createHash("sha256").update(avatarBytes).digest("hex"),
    packages,
  };
  await Bun.write(join(out, "release-build.json"), JSON.stringify(metadata, null, 2) + "\n");
  return metadata;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      out: { type: "string", default: "dist/release" },
      platform: { type: "string", default: DEFAULT_PLATFORM },
    },
  });
  if (!isReleasePlatform(values.platform))
    throw new Error(`Unsupported release build target: ${values.platform}`);
  console.log(JSON.stringify(await buildRelease(values.out!, values.platform), null, 2));
}

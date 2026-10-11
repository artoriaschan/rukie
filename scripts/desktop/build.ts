import { chmod, cp, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build, Platform, Arch } from "electron-builder";
import {
  flipFuses,
  FuseState,
  FuseVersion,
  FuseV1Options,
  getCurrentFuseWire,
} from "@electron/fuses";
import { compiledBunOptions } from "../compiled-bun.ts";
import { BUILD_BUN_VERSION } from "../release/platforms.ts";

const root = resolve(import.meta.dir, "../..");
async function run(argv: string[], env = process.env) {
  const child = Bun.spawn(argv, { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${argv[0]} failed (${code}): ${stderr || stdout}`);
  return stdout + stderr;
}
const jitProbe = `const {numberOfDFGCompiles}=require("bun:jsc"); function f(n){let s=0;for(let i=0;i<n;i++)s=(s+i*7)%1000003;return s} f(3e7);const n=numberOfDFGCompiles(f);if(n===1000000)throw Error("JIT unavailable");console.log(n);`;

/** Builds a local ad-hoc arm64 application. Output must be owned by this build. */
export async function buildDesktop(output: string) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Desktop build requires macOS arm64");
  if (Bun.version !== BUILD_BUN_VERSION)
    throw new Error(`Desktop build requires Bun ${BUILD_BUN_VERSION}`);
  const out = resolve(output);
  if (out === root || root.startsWith(out + "/"))
    throw new Error("Build output cannot contain the source checkout");
  await mkdir(out, { recursive: true });
  const canonicalOut = await realpath(out);
  if (canonicalOut === root || root.startsWith(canonicalOut + "/"))
    throw new Error("Build output cannot contain the source checkout");
  const staging = join(out, "staging");
  await rm(staging, { recursive: true, force: true });
  const appSource = join(staging, "app");
  const sidecar = join(staging, "sidecar");
  await Promise.all([mkdir(appSource, { recursive: true }), mkdir(sidecar, { recursive: true })]);
  const manifest: unknown = await Bun.file(join(root, "packages/coding-agent/package.json")).json();
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  )
    throw new Error("Missing product version");
  await Bun.write(
    join(appSource, "package.json"),
    JSON.stringify({
      name: "rukie-desktop",
      version: manifest.version,
      type: "module",
      main: "main.js",
      author: "Rukie",
      description: "Rukie coding agent",
      license: "MIT",
    }),
  );
  const server = await Bun.build({
    entrypoints: [join(root, "packages/server/src/main.ts")],
    ...compiledBunOptions("bun-darwin-arm64", join(sidecar, "rukie-server")),
  });
  if (!server.success) throw new AggregateError(server.logs, "Sidecar compilation failed");
  const rgModule = await realpath(join(root, "packages/agent/node_modules/@vscode/ripgrep"));
  const rgRoot = dirname(Bun.resolveSync("@vscode/ripgrep-darwin-arm64/package.json", rgModule));
  const rgManifest: unknown = await Bun.file(join(rgRoot, "package.json")).json();
  if (
    !rgManifest ||
    typeof rgManifest !== "object" ||
    !("version" in rgManifest) ||
    rgManifest.version !== "1.18.0"
  )
    throw new Error("Desktop requires locked ripgrep 1.18.0");
  await cp(join(rgRoot, "bin/rg"), join(sidecar, "rg"));
  await Promise.all([
    chmod(join(sidecar, "rg"), 0o755),
    chmod(join(sidecar, "rukie-server"), 0o755),
  ]);
  for (const [entry, format, name] of [
    ["main", "esm", "main.js"],
    ["preload", "cjs", "preload.cjs"],
  ] as const) {
    const result = await Bun.build({
      entrypoints: [join(root, `packages/desktop/src/${entry}.ts`)],
      target: "node",
      format,
      external: ["electron"],
      outdir: appSource,
      naming: name,
    });
    if (!result.success) throw new AggregateError(result.logs, `${entry} compilation failed`);
  }
  console.log(
    await run([
      "node",
      join(root, "node_modules/vite/bin/vite.js"),
      "build",
      "packages/ui",
      "--config",
      "packages/ui/vite.config.ts",
      "--outDir",
      join(appSource, "dist"),
    ]),
  );
  const resultDirectory = join(out, "package");
  let integrityPresent = false;
  await build({
    projectDir: appSource,
    targets: Platform.MAC.createTarget("dir", Arch.arm64),
    config: {
      appId: "dev.rukie.desktop",
      productName: "Rukie",
      electronVersion: "41.0.3",
      npmRebuild: false,
      asar: true,
      directories: { output: resultDirectory, buildResources: join(root, "scripts/desktop") },
      files: ["main.js", "preload.cjs", "dist/**", "package.json"],
      extraResources: [{ from: sidecar, to: "sidecar", filter: ["rukie-server", "rg"] }],
      mac: {
        target: "dir",
        icon: join(root, "brand/rukie-app-icon.icns"),
        identity: "-",
        hardenedRuntime: true,
        notarize: false,
        entitlements: join(root, "scripts/desktop/electron.entitlements.plist"),
        entitlementsInherit: join(root, "scripts/desktop/electron.entitlements.plist"),
      },
      afterPack: async (context) => {
        const app = join(context.appOutDir, "Rukie.app");
        // Builder 26.15.3 computes the asar hash and writes Info.plist before this hook.
        const integrity = await run([
          "/usr/bin/plutil",
          "-extract",
          "ElectronAsarIntegrity",
          "json",
          "-o",
          "-",
          join(app, "Contents/Info.plist"),
        ]);
        integrityPresent = integrity.includes("app.asar") && integrity.includes("SHA256");
        if (!integrityPresent) throw new Error("Builder did not write ElectronAsarIntegrity");
        await flipFuses(app, {
          version: FuseVersion.V1,
          [FuseV1Options.RunAsNode]: false,
          // Desktop uses token-authenticated WS and stores no credentials in cookies.
          // Enabling this unused feature initializes Keychain on every ad-hoc build.
          [FuseV1Options.EnableCookieEncryption]: false,
          [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
          [FuseV1Options.EnableNodeCliInspectArguments]: false,
          [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
          [FuseV1Options.OnlyLoadAppFromAsar]: true,
        });
      },
      afterSign: async (context) => {
        const app = join(context.appOutDir, "Rukie.app");
        const resources = join(app, "Contents/Resources/sidecar");
        await run([
          "codesign",
          "--sign",
          "-",
          "--force",
          "--options",
          "runtime",
          "--entitlements",
          join(root, "scripts/desktop/sidecar.entitlements.plist"),
          join(resources, "rukie-server"),
        ]);
        await run([
          "codesign",
          "--sign",
          "-",
          "--force",
          "--options",
          "runtime",
          join(resources, "rg"),
        ]);
        await run([
          "codesign",
          "--sign",
          "-",
          "--force",
          "--options",
          "runtime",
          "--preserve-metadata=entitlements,identifier,flags",
          app,
        ]);
      },
    },
  });
  const app = join(resultDirectory, "mac-arm64/Rukie.app");
  await run(["codesign", "--verify", "--deep", "--strict", app]);
  const resources = join(app, "Contents/Resources/sidecar");
  const executable = join(resources, "rukie-server");
  const entitlements = await run(["codesign", "-d", "--entitlements", "-", "--xml", executable]);
  const flags = await run(["codesign", "-dv", executable]);
  const rgEntitlements = await run([
    "codesign",
    "-d",
    "--entitlements",
    "-",
    "--xml",
    join(resources, "rg"),
  ]);
  const rgFlags = await run(["codesign", "-dv", join(resources, "rg")]);
  if (
    !flags.includes("runtime") ||
    !rgFlags.includes("runtime") ||
    !entitlements.includes("com.apple.security.cs.allow-jit") ||
    entitlements.includes("allow-unsigned-executable-memory") ||
    entitlements.includes("disable-library-validation") ||
    rgEntitlements.includes("<key>")
  )
    throw new Error("Unexpected sidecar/rg signature capabilities");
  const jit = await run([executable, "-e", jitProbe], { ...process.env, BUN_BE_BUN: "1" });
  const jitCompiles = Number(jit.trim());
  if (!Number.isSafeInteger(jitCompiles) || jitCompiles < 0 || jitCompiles === 1000000)
    throw new Error("Invalid JIT probe output");
  const appEntitlements = await run(["codesign", "-d", "--entitlements", "-", "--xml", app]);
  const appFlags = await run(["codesign", "-dv", app]);
  if (
    !appFlags.includes("runtime") ||
    !appEntitlements.includes("com.apple.security.cs.disable-library-validation")
  )
    throw new Error("Electron signature is missing hardened-runtime capabilities");
  const rgVersion = await run([join(resources, "rg"), "--version"]);
  const fuses = await getCurrentFuseWire(app);
  if (fuses[FuseV1Options.EnableCookieEncryption] !== FuseState.DISABLE)
    throw new Error(
      "Desktop cookie encryption must remain disabled to avoid startup Keychain access",
    );
  const metadata = {
    app,
    commit: (await run(["git", "rev-parse", "HEAD"])).trim(),
    dirty: (await run(["git", "status", "--porcelain"])).trim().length > 0,
    bunVersion: Bun.version,
    electronVersion: "41.0.3",
    integrityPresent,
    fuses,
    jitCompiles,
    appEntitlements,
    appFlags,
    rgVersion: rgVersion.trim(),
    entitlements,
    flags,
    rgEntitlements,
    rgFlags,
  };
  await Bun.write(join(out, "desktop-build.json"), JSON.stringify(metadata, null, 2) + "\n");
  return metadata;
}
if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { out: { type: "string", default: "dist/desktop" } },
  });
  console.log(JSON.stringify(await buildDesktop(values.out!), null, 2));
}

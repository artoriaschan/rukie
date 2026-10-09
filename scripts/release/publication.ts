import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { gt, satisfies, valid } from "semver";
import { verifyReleaseArtifacts } from "./verify.ts";
import { releaseCommand, verifyReleaseTag } from "./tag.ts";
import { MAIN_PACKAGE } from "./platforms.ts";
import { installRelease } from "./tests/installed-fixture.ts";
import { providerProtocol } from "./tests/provider-protocol.ts";

export function releaseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid publication object");
  return Object.fromEntries(Object.entries(value));
}
/** Bound binary downloads before retaining untrusted registry or Release asset bytes. */
export async function releaseBytes(response: Response) {
  if (!response.body) throw new Error("Missing release download body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128 * 1024 * 1024) throw new Error("Release download exceeds 128MiB");
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks, size));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function localRegistry(registry: string) {
  const url = new URL(registry);
  const local =
    url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (!local && url.href !== "https://registry.npmjs.org/") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Registry must be npmjs HTTPS or an isolated loopback registry");
  return local;
}

export async function verifyPublicationArtifacts(
  directory: string,
  commit?: string,
  repository?: string,
  requireClean = true,
  sourceRoot = resolve(import.meta.dir, "../.."),
) {
  const root = resolve(sourceRoot);
  if (commit && (await releaseCommand(["git", "rev-parse", "HEAD"], root)) !== commit)
    throw new Error("Publication checkout differs from accepted commit");
  const metadata = await verifyReleaseArtifacts(directory, {
    root,
    expectedCommit: commit,
    requireClean,
  });
  if (repository) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
      throw new Error("Invalid GitHub repository identity");
    for (const pkg of metadata.packages) {
      const manifest = releaseObject(
        JSON.parse(
          await releaseCommand(
            ["tar", "-xOf", join(directory, pkg.tarball), "package/package.json"],
            root,
          ),
        ),
      );
      const repo = releaseObject(manifest.repository);
      if (repo.type !== "git" || repo.url !== `git+https://github.com/${repository}.git`)
        throw new Error("Package repository identity differs from publishing repository");
    }
  }
  return metadata;
}

export type RegistryAcceptance = {
  artifactDirectory: string;
  registry: string;
  npm: string;
  env: NodeJS.ProcessEnv;
  sourceRoot?: string;
};

/** Fresh npm cache and isolated runtime exercise the registry's bytes through the normal launcher. */
export async function acceptRegistryRelease(options: RegistryAcceptance, protocolError = false) {
  const fixture = await installRelease(options.artifactDirectory, {
    registry: options.registry,
    npm: options.npm,
    npmEnv: options.env,
    sourceRoot: options.sourceRoot,
  });
  const provider = providerProtocol("openai-responses", { error: protocolError });
  try {
    const version = await fixture.run(["--version"]);
    const help = await fixture.run(["--help"]);
    if (
      version.code !== 0 ||
      version.stdout.trim() !== fixture.version ||
      help.code !== 0 ||
      !help.stdout.includes("Usage:")
    )
      throw new Error("Registry command information acceptance failed");
    await Bun.write(
      join(fixture.homeDir, ".rukie/settings.json"),
      JSON.stringify({
        model: "local/m",
        providers: [
          {
            id: "local",
            api: "openai-responses",
            baseUrl: provider.baseUrl + "/v1",
            apiKeyEnv: "FAKE_API_KEY",
            models: [{ id: "m" }],
          },
        ],
      }),
    );
    const result = await fixture.run(["-p", "registry installed Session acceptance"]);
    if (
      result.code !== 0 ||
      result.stdout.trim() !== "packaged protocol reply" ||
      !provider.requests.some((request) =>
        JSON.stringify(request.body).includes("registry installed Session acceptance"),
      )
    )
      throw new Error(`Registry Session acceptance failed: ${result.stderr}`);
  } finally {
    provider.stop();
    await fixture.cleanup();
  }
}

export type PublicationOptions = {
  artifactDirectory: string;
  registry?: string;
  npm?: string;
  env?: NodeJS.ProcessEnv;
  commit?: string;
  repository?: string;
  tag?: string;
  /** Caller-owned source checkout for loopback integration; production always uses its exact tag checkout. */
  sourceRoot?: string;
  operation?: "publish" | "rollback";
  /** Trusted caller must resolve only after exact-version installed command and Session acceptance. */
  accept?: (options: RegistryAcceptance) => Promise<void>;
};

export async function publishRelease(options: PublicationOptions) {
  const registry = options.registry ?? "https://registry.npmjs.org/";
  const local = localRegistry(registry);
  const operation = options.operation ?? "publish";
  if (!["publish", "rollback"].includes(operation))
    throw new Error("Unknown publication operation");
  const inherited = options.env ?? process.env;
  if (!local) {
    if (options.sourceRoot && resolve(options.sourceRoot) !== resolve(import.meta.dir, "../.."))
      throw new Error("Production source root cannot be overridden");
    if (operation === "rollback" && inherited.GITHUB_EVENT_NAME !== "workflow_dispatch")
      throw new Error("Rollback requires explicit manual dispatch");
    if (
      !options.commit ||
      !options.repository ||
      !options.tag ||
      inherited.GITHUB_REPOSITORY !== options.repository ||
      inherited.GITHUB_SHA !== options.commit ||
      inherited.GITHUB_REF !== `refs/tags/${options.tag}`
    )
      throw new Error("Production publication requires the exact GitHub tag commit and repository");
    const selected = await verifyReleaseTag(resolve(import.meta.dir, "../.."), options.tag);
    if (selected.commit !== options.commit)
      throw new Error("Publication tag commit differs from accepted source");
    if (
      Object.keys(inherited).some(
        (name) => /^(npm_token|node_auth_token)$/i.test(name) && inherited[name],
      )
    )
      throw new Error("Stored npm token fallback is forbidden");
    if (
      !inherited.ACTIONS_ID_TOKEN_REQUEST_URL ||
      !inherited.ACTIONS_ID_TOKEN_REQUEST_TOKEN ||
      inherited.NPM_TOKEN ||
      inherited.NODE_AUTH_TOKEN
    )
      throw new Error("Production publication requires OIDC without stored npm token fallback");
  }
  const directory = resolve(options.artifactDirectory);
  const metadata = await verifyPublicationArtifacts(
    directory,
    options.commit,
    options.repository,
    !local,
    options.sourceRoot,
  );
  if (!local) {
    const { verifyAcceptanceWitness, verifyOriginalAssetEquality } = await import("./assets.ts");
    if (!inherited.GH_TOKEN)
      throw new Error("Read-only GitHub identity is required to verify accepted assets");
    const context = {
      repository: options.repository!,
      tag: options.tag!,
      commit: options.commit!,
      token: inherited.GH_TOKEN,
      runId: inherited.GITHUB_RUN_ID,
      runAttempt: inherited.GITHUB_RUN_ATTEMPT,
    };
    await verifyAcceptanceWitness(context, directory, "current-acceptance.json", true);
    await verifyOriginalAssetEquality(context, directory);
  }
  const root = await mkdtemp(join(tmpdir(), "rukie publication "));
  try {
    const npm = options.npm ?? "npm";
    const home = join(root, "home");
    await mkdir(home);
    const userconfig = join(root, "npmrc");
    const globalconfig = join(root, "globalnpmrc");
    const auth = local ? `//${new URL(registry).host}/:_authToken=local-fabricated\n` : "";
    await Bun.write(userconfig, `registry=${registry}\n@rukie:registry=${registry}\n${auth}`);
    await Bun.write(globalconfig, "");
    const sanitized = Object.fromEntries(
      Object.entries(inherited).filter(
        ([name]) => !/^npm_config_/i.test(name) && !/^(npm_token|node_auth_token)$/i.test(name),
      ),
    );
    const env = {
      ...sanitized,
      HOME: home,
      NPM_CONFIG_USERCONFIG: userconfig,
      NPM_CONFIG_GLOBALCONFIG: globalconfig,
      NPM_CONFIG_CACHE: join(root, "publisher-cache"),
      NPM_CONFIG_FETCH_RETRIES: "0",
      NPM_CONFIG_REGISTRY: registry,
    };
    const npmVersion = await releaseCommand([npm, "--version"], root, env);
    if (!satisfies(npmVersion, ">=11.21.0 <12 || >=12.2.0") || (!local && npmVersion !== "11.21.0"))
      throw new Error(
        "Publication requires npm11.21.0 (production pin) or a supported OIDC dist-tag version",
      );
    const channel = metadata.version.includes("-beta.") ? "next" : "latest";
    const uploadTag = channel === "next" ? "next" : "candidate";
    const packages = [...metadata.packages].sort(
      (left, right) => Number(left.name === MAIN_PACKAGE) - Number(right.name === MAIN_PACKAGE),
    );
    const request = async (path: string) =>
      fetch(new URL(path, registry), {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    const channelVersion = (value: unknown) => {
      if (value === undefined) return undefined;
      if (typeof value !== "string" || valid(value) !== value)
        throw new Error("Invalid registry channel version");
      return value;
    };
    const expected = new Map<string, Record<string, unknown>>();
    for (const pkg of packages)
      expected.set(
        pkg.name,
        releaseObject(
          JSON.parse(
            await releaseCommand(
              ["tar", "-xOf", join(directory, pkg.tarball), "package/package.json"],
              root,
            ),
          ),
        ),
      );
    // Registry metadata affects installation independently of the tarball's package.json.
    const identityFields = [
      "name",
      "version",
      "repository",
      "os",
      "cpu",
      "engines",
      "bin",
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
      "peerDependenciesMeta",
      "bundledDependencies",
      "bundleDependencies",
      "scripts",
      "exports",
      "main",
      "type",
      "overrides",
    ];
    async function inspect(pkg: (typeof packages)[number]) {
      const response = await request(encodeURIComponent(pkg.name));
      if (response.status === 404) return { present: false, next: undefined };
      if (!response.ok)
        throw new Error(`Registry lookup uncertain (${response.status}); no write is safe`);
      const doc = releaseObject(await response.json());
      const next = channelVersion(releaseObject(doc["dist-tags"]).next);
      const value = releaseObject(doc.versions)[metadata.version];
      if (value === undefined) return { present: false, next };
      const manifest = releaseObject(value);
      const original = expected.get(pkg.name)!;
      for (const field of identityFields)
        if (!isDeepStrictEqual(manifest[field], original[field]))
          throw new Error(`Registry ${pkg.name} identity conflict (${field}); use a new version`);
      const dist = releaseObject(manifest.dist);
      if (typeof dist.tarball !== "string" || dist.integrity !== pkg.integrity)
        throw new Error(`Registry ${pkg.name} tarball metadata conflict; use a new version`);
      const url = new URL(dist.tarball);
      if (
        url.host !== new URL(registry).host ||
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        (local && url.protocol !== "http:")
      )
        throw new Error("Registry tarball origin mismatch");
      if (!local) url.protocol = "https:";
      const download = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!download.ok) throw new Error("Registry tarball download uncertain; no write is safe");
      const bytes = await releaseBytes(download);
      if (
        createHash("sha256").update(bytes).digest("hex") !== pkg.sha256 ||
        `sha512-${createHash("sha512").update(bytes).digest("base64")}` !== pkg.integrity
      )
        throw new Error(`Registry ${pkg.name} stored bytes conflict; use a new version`);
      return { present: true, next };
    }
    const existing = new Map<string, Awaited<ReturnType<typeof inspect>>>();
    for (const pkg of packages) existing.set(pkg.name, await inspect(pkg));
    if (operation === "rollback" && [...existing.values()].some((state) => !state.present))
      throw new Error(
        "Rollback requires both complete existing registry packages; it never uploads",
      );
    const newerNext = [...existing.values()].some(
      (state) => state.next && gt(state.next, metadata.version),
    );
    if (channel === "next" && newerNext && [...existing.values()].some((state) => !state.present))
      throw new Error(
        "Beta publication is superseded by newer next; no upload can regress that channel",
      );
    for (const pkg of packages) {
      if (existing.get(pkg.name)!.present) continue;
      try {
        await releaseCommand(
          [
            npm,
            "publish",
            join(directory, pkg.tarball),
            "--registry",
            registry,
            "--access",
            "public",
            "--tag",
            uploadTag,
            "--ignore-scripts",
            ...(local ? ["--provenance=false"] : ["--provenance=true"]),
          ],
          root,
          env,
        );
      } catch {
        // A failed CLI exit can mean the server accepted the PUT before losing its response.
        if (!(await inspect(pkg)).present)
          throw new Error(
            `Publication outcome for ${pkg.name} is not stored; rerun with preserved originals after reconciling registry state`,
          );
        continue;
      }
      if (!(await inspect(pkg)).present)
        throw new Error("Registry did not retain the uploaded package");
    }
    await (options.accept ?? acceptRegistryRelease)({
      artifactDirectory: directory,
      registry,
      npm,
      env,
      sourceRoot: options.sourceRoot,
    });
    const readTags = async () => {
      const response = await request(`-/package/${encodeURIComponent(MAIN_PACKAGE)}/dist-tags`);
      if (!response.ok) throw new Error("Registry channel lookup uncertain");
      return releaseObject(await response.json());
    };
    const before = await readTags();
    const current = channelVersion(before[channel]);
    let superseded =
      operation !== "rollback" && typeof current === "string" && gt(current, metadata.version);
    if (!superseded && current !== metadata.version) {
      try {
        await releaseCommand(
          [
            npm,
            "dist-tag",
            "add",
            `${MAIN_PACKAGE}@${metadata.version}`,
            channel,
            "--registry",
            registry,
          ],
          root,
          env,
        );
      } catch {
        const actual = channelVersion((await readTags())[channel]);
        superseded =
          operation !== "rollback" && typeof actual === "string" && gt(actual, metadata.version);
        if (!superseded && actual !== metadata.version)
          throw new Error(
            "Channel update outcome has not reached target; rerun preserved originals and acceptance before retrying",
          );
      }
    }
    const tags = await readTags();
    if (!superseded && tags[channel] !== metadata.version)
      throw new Error("Registry channel verification failed");
    const receipt = {
      schemaVersion: 1,
      operation,
      previousVersion: current ?? null,
      commit: metadata.commit,
      version: metadata.version,
      platform: metadata.platform,
      registry,
      channel,
      superseded,
      packages: metadata.packages,
    };
    await Bun.write(
      join(directory, "publication-result.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    return receipt;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "artifact-dir": { type: "string" },
      commit: { type: "string" },
      tag: { type: "string" },
      operation: { type: "string", default: "publish" },
    },
  });
  if (!values["artifact-dir"] || !values.commit || !values.tag)
    throw new Error("--artifact-dir, --commit and --tag are required");
  if (values.operation !== "publish" && values.operation !== "rollback")
    throw new Error("--operation must be publish or rollback");
  console.log(
    JSON.stringify(
      await publishRelease({
        artifactDirectory: values["artifact-dir"],
        commit: values.commit,
        tag: values.tag,
        operation: values.operation,
        repository: process.env.GITHUB_REPOSITORY,
      }),
    ),
  );
}

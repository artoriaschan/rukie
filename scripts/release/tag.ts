import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { valid } from "semver";
import { MAIN_PACKAGE, releasePlatforms } from "./platforms.ts";

export async function releaseCommand(argv: string[], cwd: string, env = process.env) {
  const child = Bun.spawn(argv, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(120_000),
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${argv[0]} failed (${code}): ${stderr || stdout}`);
  return stdout.trim();
}

export function releaseVersion(tag: string) {
  const match = /^coding-agent-v(\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?)$/.exec(tag);
  if (!match || valid(match[1]) !== match[1])
    throw new Error("Publication requires an existing coding-agent product version tag");
  return match[1]!;
}

/** Resolve an existing tag, including annotated tags; branch names are never release inputs. */
export async function verifyReleaseTag(root: string, tag: string, mainRef = "origin/main") {
  const version = releaseVersion(tag);
  const commit = await releaseCommand(
    ["git", "rev-parse", "--verify", `refs/tags/${tag}^{commit}`],
    root,
  );
  try {
    await releaseCommand(["git", "merge-base", "--is-ancestor", commit, mainRef], root);
  } catch {
    throw new Error(`Release tag ${tag} is not reachable from ${mainRef}`);
  }
  const value: unknown = JSON.parse(
    await releaseCommand(["git", "show", `${commit}:packages/coding-agent/package.json`], root),
  );
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== version)
    throw new Error("Release tag and committed product version differ");
  return { tag, version, commit };
}

/** No original assets means only a wholly unpublished version may be built. */
export async function requireUnpublished(
  version: string,
  registry = "https://registry.npmjs.org/",
) {
  const { localRegistry, releaseObject } = await import("./publication.ts");
  localRegistry(registry);
  for (const name of [MAIN_PACKAGE, releasePlatforms["darwin-arm64"].packageName]) {
    const response = await fetch(new URL(encodeURIComponent(name), registry), {
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error("Registry prebuild lookup failed");
    if (releaseObject(releaseObject(await response.json()).versions)[version])
      throw new Error(
        "Existing registry version has no preserved original assets; refusing rebuild",
      );
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      tag: { type: "string" },
      "artifact-dir": { type: "string" },
      "require-unpublished": { type: "boolean" },
    },
  });
  if (!values.tag) throw new Error("--tag is required");
  const result = await verifyReleaseTag(resolve(import.meta.dir, "../.."), values.tag);
  if (values["require-unpublished"]) await requireUnpublished(result.version);
  if (values["artifact-dir"]) {
    if (!process.env.GITHUB_REPOSITORY) throw new Error("Publishing repository is required");
    const { verifyPublicationArtifacts } = await import("./publication.ts");
    await verifyPublicationArtifacts(
      resolve(values["artifact-dir"]),
      result.commit,
      process.env.GITHUB_REPOSITORY,
    );
  }
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT)
    await Bun.write(
      process.env.GITHUB_OUTPUT,
      `tag=${result.tag}\ncommit=${result.commit}\nversion=${result.version}\n`,
    );
}

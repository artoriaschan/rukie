import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildRelease } from "../build.ts";
import { releaseCommand, releaseVersion } from "../tag.ts";

/** Distinct public versions own source, Git identity, locked dependencies and compilation.
 * Never edit the shared checkout: Bun's parallel acceptance suites read its manifest concurrently.
 */
export async function buildVersionFixture(version: string) {
  releaseVersion(`coding-agent-v${version}`);
  const root = await mkdtemp(join(tmpdir(), "rukie release version "));
  const sourceRoot = join(root, "source");
  const artifacts = join(root, "artifacts");
  try {
    await mkdir(sourceRoot);
    const archive = join(root, "source.tar");
    const repo = resolve(import.meta.dir, "../../..");
    await releaseCommand(["git", "archive", "HEAD", "--format=tar", `--output=${archive}`], repo);
    await releaseCommand(["tar", "-xf", archive, "-C", sourceRoot], root);
    const file = join(sourceRoot, "packages/coding-agent/package.json");
    const manifest: unknown = await Bun.file(file).json();
    if (!manifest || typeof manifest !== "object" || !("version" in manifest))
      throw new Error("Missing product manifest");
    await Bun.write(file, JSON.stringify({ ...manifest, version }, null, 2) + "\n");
    await releaseCommand(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], sourceRoot);
    await releaseCommand(["git", "init", "--initial-branch=main"], sourceRoot);
    await releaseCommand(["git", "add", "."], sourceRoot);
    await releaseCommand(
      [
        "git",
        "-c",
        "user.name=Release Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        `feat: version fixture ${version}`,
      ],
      sourceRoot,
    );
    const metadata = await buildRelease(artifacts, "darwin-arm64", sourceRoot);
    return {
      artifactDirectory: artifacts,
      sourceRoot,
      metadata,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

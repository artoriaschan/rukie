import { createHash } from "node:crypto";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import sources from "./licenses/sources.ts";

type Snapshot = keyof typeof sources;
type Package = { name: string; version: string; license: string; directory: string };

function manifest(value: unknown, directory: string): Package | undefined {
  if (!value || typeof value !== "object" || !("name" in value)) return undefined;
  if (
    typeof value.name !== "string" ||
    !("version" in value) ||
    typeof value.version !== "string" ||
    !("license" in value) ||
    typeof value.license !== "string"
  )
    throw new Error(`Invalid release dependency manifest: ${directory}`);
  return { name: value.name, version: value.version, license: value.license, directory };
}

async function owningPackage(path: string): Promise<Package | undefined> {
  let directory = path;
  while (true) {
    const file = join(directory, "package.json");
    if (await Bun.file(file).exists()) {
      const dependency = manifest(await Bun.file(file).json(), directory);
      if (dependency) return dependency;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function snapshot(name: Snapshot) {
  const text = await readFile(join(import.meta.dir, "licenses", name), "utf8");
  const metadata = sources[name];
  if (createHash("sha256").update(text).digest("hex") !== metadata.sha256)
    throw new Error(`Release license snapshot digest mismatch: ${name}`);
  return `Source: ${metadata.source}\nSHA-256: ${metadata.sha256}\n\n${text}`;
}

function fallback(dependency: Package): Snapshot | undefined {
  if (dependency.name.startsWith("@earendil-works/") && dependency.version === "1.0.4")
    return "pi-1.0.4.txt";
  if (dependency.name.startsWith("@aws-sdk/") && dependency.license === "Apache-2.0")
    return "aws-sdk-3.1127.0.txt";
  if (dependency.name === "standardwebhooks" && dependency.version === "1.1.1")
    return "standardwebhooks-1.1.1.txt";
  if (dependency.name === "proxy-agent-negotiate" && dependency.version === "1.1.0")
    return "proxy-agent-negotiate-1.1.0.txt";
  return undefined;
}

/** Generate the shipped notice from the actual bundle inputs and copied native packages. */
export async function generateNotices(
  root: string,
  inputPaths: string[],
  resourceDirectories: string[],
  destination: string,
): Promise<void> {
  const packages = new Map<string, Package>();
  for (const input of inputPaths) {
    if (!input.includes(`node_modules${sep}`) && !input.includes("node_modules/")) continue;
    const path = await realpath(isAbsolute(input) ? input : resolve(root, input));
    const dependency = await owningPackage(dirname(path));
    if (!dependency) throw new Error(`No package identity for release input: ${input}`);
    packages.set(`${dependency.name}@${dependency.version}`, dependency);
  }
  for (const directory of resourceDirectories) {
    const dependency = await owningPackage(await realpath(directory));
    if (!dependency) throw new Error(`No package identity for release resource: ${directory}`);
    packages.set(`${dependency.name}@${dependency.version}`, dependency);
  }
  const sections = [
    "# Third-party notices\n\nThese declarations accompany the bundled code and native resources. Rukie's own MIT license is distributed separately.",
  ];
  for (const [identity, dependency] of [...packages].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const files = (await readdir(dependency.directory, { withFileTypes: true }))
      .filter(
        (file) => file.isFile() && /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(file.name),
      )
      .map((file) => file.name)
      .sort();
    if (dependency.name.startsWith("@img/sharp-libvips-")) files.push("README.md", "versions.json");
    const texts = await Promise.all(
      files.map(
        async (file) =>
          `### ${file}\n\n${await readFile(join(dependency.directory, file), "utf8")}`,
      ),
    );
    if (files.length === 0) {
      const source = fallback(dependency);
      if (!source) throw new Error(`No original license text for release dependency ${identity}`);
      texts.push(await snapshot(source));
    }
    if (dependency.name === "standardwebhooks")
      texts.unshift(
        "The npm package declares MIT; the matching upstream release repository declares Apache-2.0. Both declarations are retained here.",
      );
    if (dependency.name === "proxy-agent-negotiate" && dependency.version === "1.1.0")
      texts.unshift(
        "Its own original license notice is unavailable in the npm package and the inspected upstream release source. Supplemental context only: the following text belongs to sibling package http-proxy-agent@9.1.0; the shared repository and author does not establish that the sibling copyright applies to this package. The package's own MIT declaration is recorded above; no package-specific copyright notice is inferred.",
      );
    if (dependency.name.startsWith("@img/sharp-libvips-"))
      texts.push(await snapshot("lgpl-3.0.txt"));
    sections.push(
      `## ${identity}\n\nPackage license declaration: ${dependency.license}\n\n${texts.join("\n\n")}`,
    );
  }
  sections.push(`## Bun runtime 1.4.2\n\n${await snapshot("bun-1.4.2.txt")}`);
  sections.push(
    `## Vendored dsh ink and Yoga\n\nFixed source: 3c89ea516e4f7d2777efe979200016528722a0b4. This retains the existing source declaration and the ADR-0023 distribution scope exception; it does not resolve Yoga provenance.\n\n${await snapshot("dsh-ink.txt")}`,
  );
  await writeFile(destination, `${sections.join("\n\n")}\n`);
}

import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateNotices } from "../release/notices.ts";

test("release notices include emitted dependencies and explicit resources with original texts", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-license-"));
  try {
    const used = join(root, "node_modules/runtime-dependency");
    const unused = join(root, "node_modules/dev-only");
    const native = join(root, "native-package");
    for (const directory of [used, unused, native]) await mkdir(directory, { recursive: true });
    await writeFile(
      join(used, "package.json"),
      JSON.stringify({ name: "runtime-dependency", version: "2.1.0", license: "MIT" }),
    );
    await writeFile(
      join(used, "LICENSE"),
      "Original Runtime Copyright 2024 Example\nPermission notice retained.\n",
    );
    await writeFile(join(used, "index.js"), "export const value = 1;");
    await writeFile(
      join(unused, "package.json"),
      JSON.stringify({ name: "dev-only", version: "1.0.0", license: "MIT" }),
    );
    await writeFile(join(unused, "LICENSE"), "Excluded developer dependency");
    await writeFile(
      join(native, "package.json"),
      JSON.stringify({ name: "native-resource", version: "3.0.0", license: "Apache-2.0" }),
    );
    await writeFile(join(native, "LICENSE"), "Original Native Copyright\nNative license terms.\n");
    const destination = join(root, "THIRD_PARTY_NOTICES.md");
    await generateNotices(
      root,
      ["node_modules/runtime-dependency/index.js"],
      [native],
      destination,
    );
    const notice = await readFile(destination, "utf8");
    expect(notice).toContain("runtime-dependency@2.1.0");
    expect(notice).toContain(
      "Original Runtime Copyright 2024 Example\nPermission notice retained.",
    );
    expect(notice).toContain("native-resource@3.0.0");
    expect(notice).toContain("Original Native Copyright\nNative license terms.");
    expect(notice).not.toContain("dev-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release generation rejects a dependency whose original notice is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-license-missing-"));
  try {
    const directory = join(root, "node_modules/missing-notice");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "missing-notice", version: "1.0.0", license: "MIT" }),
    );
    await writeFile(join(directory, "index.js"), "export const value = 1;");
    await expect(
      generateNotices(root, ["node_modules/missing-notice/index.js"], [], join(root, "notice.md")),
    ).rejects.toThrow("No original license text for release dependency missing-notice@1.0.0");
    expect(await Bun.file(join(root, "notice.md")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a sibling license is labelled supplemental when the package omits its own notice", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-license-supplemental-"));
  try {
    const directory = join(root, "node_modules/proxy-agent-negotiate");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "proxy-agent-negotiate", version: "1.1.0", license: "MIT" }),
    );
    await writeFile(join(directory, "index.js"), "export const value = 1;");
    const destination = join(root, "notice.md");
    await generateNotices(root, ["node_modules/proxy-agent-negotiate/index.js"], [], destination);
    const notice = await readFile(destination, "utf8");
    expect(notice).toContain("Its own original license notice is unavailable");
    expect(notice).toContain("Supplemental context only");
    expect(notice).toContain(
      "does not establish that the sibling copyright applies to this package",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

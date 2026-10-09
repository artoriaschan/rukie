import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

test("isolated model hooks load only the read-only tool capabilities", async () => {
  const src = fileURLToPath(new URL("../../src/", import.meta.url));
  const loaded = new Set<string>();
  const result = await Bun.build({
    entrypoints: [`${src}hooks/model.ts`],
    target: "bun",
    packages: "external",
    // Observe resolved local imports, including modules removed by dead-code elimination.
    plugins: [
      {
        name: "observe-hook-imports",
        setup(build) {
          build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (args) => {
            loaded.add(relative(src, args.path));
            return undefined;
          });
        },
      },
    ],
  });
  expect(result.success).toBe(true);
  expect(loaded.has("tools/glob.ts")).toBe(true);
  expect(loaded.has("tools/grep.ts")).toBe(true);
  expect(loaded.has("tools/support/runtime.ts")).toBe(true);
  expect(
    [...loaded].filter((path) =>
      /^tools\/(?:builtin\.ts|(?:bash|jobs|todo|web-fetch)\/|(?:question|skill)\.ts)/.test(path),
    ),
  ).toEqual([]);
});

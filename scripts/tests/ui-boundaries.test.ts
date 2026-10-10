import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("oxlint rejects forbidden UI imports and permits downward/type imports", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "rukie-ui-lint-"));
  try {
    await writeFile(
      resolve(root, ".oxlintrc.json"),
      await readFile(resolve(import.meta.dir, "../../.oxlintrc.json")),
    );
    const violations = [
      ["app", "@rukie/agent"],
      ["app", "@rukie/coding-agent"],
      ["app", "electron"],
      ["app", "@rukie/server"],
      ["app", "@rukie/desktop"],
      ["app", "node:fs"],
      ["app", "fs"],
      ["app", "fs/promises"],
      ["app", "bun"],
      ["app", "bun:sqlite"],
      ["components", "../app/screen"],
      ["components", "../store/state"],
      ["components", "../client/socket"],
      ["components", "../host/index"],
      ["store", "../app/screen"],
      ["store", "../components/button"],
      ["store", "../host/index"],
      ["store", "react"],
      ["client", "../store/state"],
      ["client", "../components/button"],
      ["client", "../app/screen"],
      ["client", "react"],
      ["client", "zustand"],
      ["host", "../client/socket"],
    ];
    for (const [index, [layer, module]] of violations.entries()) {
      const file = resolve(root, `packages/ui/src/${layer}/bad-${index}.ts`);
      await mkdir(resolve(file, ".."), { recursive: true });
      await writeFile(file, `import { value } from "${module}"; export { value };`);
    }
    const lint = Bun.spawn(
      [
        resolve(import.meta.dir, "../../node_modules/.bin/oxlint"),
        "--format",
        "json",
        "packages/ui/src",
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(lint.stdout).text();
    expect(await lint.exited).toBe(1);
    for (const index of violations.keys()) expect(output).toContain(`bad-${index}.ts`);
    await rm(resolve(root, "packages"), { recursive: true });
    const file = resolve(root, "packages/ui/src/store/good.ts");
    await mkdir(resolve(file, ".."), { recursive: true });
    await writeFile(
      file,
      'import type { Session } from "@rukie/agent"; import { client } from "../client/index"; export type { Session }; export { client };',
    );
    const valid = Bun.spawn(
      [resolve(import.meta.dir, "../../node_modules/.bin/oxlint"), "packages/ui/src"],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    expect(await valid.exited).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

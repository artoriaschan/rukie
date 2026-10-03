import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertNoHardcodedHan } from "../helpers/hardcoded-han";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sourceTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "neant-han-scan-"));
  fixtures.push(root);
  for (const directory of ["apps/neant-tui/src", "packages/agent/src", "packages/tui/src"])
    await mkdir(join(root, directory), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

test("hardcoded Han in TUI and Agent Core fails with every file and one-based line", async () => {
  const root = await sourceTree({
    "apps/neant-tui/src/components/example.tsx":
      '\nexport const english = "Ready";\nexport const label = "准备好了";\n',
    "packages/agent/src/tools/example.ts": '\r\nthrow new Error("拒绝");\r\nconst text = `𠀀`;\r\n',
    "packages/tui/src/components/example.tsx": 'export const label = "中文";\n',
  });
  await expect(assertNoHardcodedHan(root)).rejects.toThrow(
    "Hardcoded Han found (including comments):\n" +
      "apps/neant-tui/src/components/example.tsx:3\n" +
      "packages/agent/src/tools/example.ts:2\n" +
      "packages/agent/src/tools/example.ts:3\n" +
      "packages/tui/src/components/example.tsx:1",
  );
});

test("only the exact TUI dictionary and activity phrase pool may contain Han", async () => {
  const root = await sourceTree({
    "apps/neant-tui/src/i18n/locales.ts": 'export const zh = { ready: "准备好了" };\n',
    "apps/neant-tui/src/screens/chat/activity/phrases.ts": 'export const phrases = ["在想了"];\n',
    "apps/neant-tui/tests/example.test.ts": 'const fixture = "测试";\n',
    "packages/agent/tests/example.test.ts": 'const fixture = "测试";\n',
  });
  await expect(assertNoHardcodedHan(root)).resolves.toBeUndefined();
});

test("new files beside dictionaries and phrase pools cannot bypass the scan", async () => {
  const root = await sourceTree({
    "apps/neant-tui/src/i18n/extra.ts": 'export const label = "中文";\n',
    "apps/neant-tui/src/screens/chat/activity/extra.ts": 'export const label = "中文";\n',
    "apps/neant-tui/src/components/phrases.ts": 'export const label = "中文";\n',
    "packages/agent/src/i18n/locales.ts": 'export const label = "中文";\n',
    "packages/tui/src/.copy.json": '{"label": "中文"}\n',
  });
  await expect(assertNoHardcodedHan(root)).rejects.toThrow(
    "Hardcoded Han found (including comments):\n" +
      "apps/neant-tui/src/components/phrases.ts:1\n" +
      "apps/neant-tui/src/i18n/extra.ts:1\n" +
      "apps/neant-tui/src/screens/chat/activity/extra.ts:1\n" +
      "packages/agent/src/i18n/locales.ts:1\n" +
      "packages/tui/src/.copy.json:1",
  );
});

// No existing Han comments need an exemption; comments deliberately fail too.
test("Han in line and block comments is rejected", async () => {
  const root = await sourceTree({
    "apps/neant-tui/src/example.ts":
      '// 中文注释\nconst label = "English";\n/*\n * 中文注释\n */\n',
  });
  await expect(assertNoHardcodedHan(root)).rejects.toThrow(
    "Hardcoded Han found (including comments):\n" +
      "apps/neant-tui/src/example.ts:1\n" +
      "apps/neant-tui/src/example.ts:4",
  );
});

test("current TUI and Agent Core sources have no Han outside localized files", async () => {
  await expect(assertNoHardcodedHan(join(import.meta.dir, "../../../.."))).resolves.toBeUndefined();
});

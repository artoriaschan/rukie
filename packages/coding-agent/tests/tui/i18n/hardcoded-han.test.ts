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
  for (const directory of [
    "packages/coding-agent/src/tui",
    "packages/agent/src",
    "packages/coding-agent/src/ink",
  ])
    await mkdir(join(root, directory), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

test("hardcoded Han in TUI and Agent Core fails with every file and one-based line", async () => {
  const root = await sourceTree({
    "packages/coding-agent/src/tui/components/example.tsx":
      '\nexport const english = "Ready";\nexport const label = "准备好了";\n',
    "packages/agent/src/tools/example.ts": '\r\nthrow new Error("拒绝");\r\nconst text = `𠀀`;\r\n',
    "packages/coding-agent/src/ink/primitives/example.tsx": 'export const label = "中文";\n',
  });
  await expect(assertNoHardcodedHan(root)).rejects.toThrow(
    "Hardcoded Han found (including comments):\n" +
      "packages/coding-agent/src/tui/components/example.tsx:3\n" +
      "packages/agent/src/tools/example.ts:2\n" +
      "packages/agent/src/tools/example.ts:3\n" +
      "packages/coding-agent/src/ink/primitives/example.tsx:1",
  );
});

test("only the exact TUI dictionary and activity phrase pool may contain Han", async () => {
  const root = await sourceTree({
    "packages/coding-agent/src/tui/i18n/locales.ts": 'export const zh = { ready: "准备好了" };\n',
    "packages/coding-agent/src/tui/screens/chat/activity/phrases.ts":
      'export const phrases = ["在想了"];\n',
    "packages/coding-agent/tests/tui/example.test.ts": 'const fixture = "测试";\n',
    "packages/agent/tests/example.test.ts": 'const fixture = "测试";\n',
  });
  await expect(assertNoHardcodedHan(root)).resolves.toBeUndefined();
});

test("new files beside dictionaries and phrase pools cannot bypass the scan", async () => {
  const root = await sourceTree({
    "packages/coding-agent/src/tui/i18n/extra.ts": 'export const label = "中文";\n',
    "packages/coding-agent/src/tui/screens/chat/activity/extra.ts":
      'export const label = "中文";\n',
    "packages/coding-agent/src/tui/components/phrases.ts": 'export const label = "中文";\n',
    "packages/agent/src/i18n/locales.ts": 'export const label = "中文";\n',
    "packages/coding-agent/src/ink/.copy.json": '{"label": "中文"}\n',
  });
  await expect(assertNoHardcodedHan(root)).rejects.toThrow(
    "Hardcoded Han found (including comments):\n" +
      "packages/coding-agent/src/tui/components/phrases.ts:1\n" +
      "packages/coding-agent/src/tui/i18n/extra.ts:1\n" +
      "packages/coding-agent/src/tui/screens/chat/activity/extra.ts:1\n" +
      "packages/agent/src/i18n/locales.ts:1\n" +
      "packages/coding-agent/src/ink/.copy.json:1",
  );
});

// No existing Han comments need an exemption; comments deliberately fail too.
test("Han in line and block comments is rejected", async () => {
  const root = await sourceTree({
    "packages/coding-agent/src/tui/example.ts":
      '// 中文注释\nconst label = "English";\n/*\n * 中文注释\n */\n',
  });
  await expect(assertNoHardcodedHan(root)).rejects.toThrow(
    "Hardcoded Han found (including comments):\n" +
      "packages/coding-agent/src/tui/example.ts:1\n" +
      "packages/coding-agent/src/tui/example.ts:4",
  );
});

test("current TUI and Agent Core sources have no Han outside localized files", async () => {
  await expect(
    assertNoHardcodedHan(join(import.meta.dir, "../../../../..")),
  ).resolves.toBeUndefined();
});

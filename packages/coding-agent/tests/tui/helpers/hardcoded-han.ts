import { join } from "node:path";

const localizedFiles = new Set([
  "packages/coding-agent/src/view/i18n/locales.ts",
  "packages/coding-agent/src/view/conversation/activity/phrases.ts",
]);

// ADR-0013 preserves these exact explanatory comments from the pinned dsh
// source 3c89ea5. No entire file/directory exemption: new copy and comments
// in the same files, product design-system, TUI and Agent Core still fail.
const upstreamComments = new Set([
  'packages/coding-agent/src/ink/ink.tsx\n// text itself (the "↓ 回到底部" pill leaking into bottom-to-top copies)',
  "packages/coding-agent/src/ink/screen.ts\n// Scenario: [a, 💻, spacer] → [本, spacer, ORPHAN spacer] when",
  "packages/coding-agent/src/ink/screen.ts\n// yoga squishes a💻 to height 0 and 本 renders at the same y.",
  'packages/coding-agent/src/ink/selection.ts\n* highlight happens to cover — including the chrome row itself ("↓ 回到底部"',
  'packages/coding-agent/src/ink/terminal-image.ts\n* block between "100%" and "原像素" in a preview tooltip).',
  'packages/coding-agent/src/ink/timeline-rail.ts\n* always what you can click ("看得到但点不中" impossible by construction).',
]);

export async function assertNoHardcodedHan(root: string): Promise<void> {
  const violations: string[] = [];
  for (const directory of [
    "packages/coding-agent/src/tui",
    "packages/coding-agent/src/view",
    "packages/agent/src",
    "packages/coding-agent/src/ink",
  ]) {
    const files = Array.from(
      new Bun.Glob("**/*").scanSync({ cwd: join(root, directory), onlyFiles: true, dot: true }),
    ).sort();
    for (const file of files) {
      const path = `${directory}/${file}`;
      if (localizedFiles.has(path) || file === "README.md") continue;
      const lines = (await Bun.file(join(root, path)).text()).split(/\r\n|\n|\r/);
      for (const [index, line] of lines.entries())
        if (/\p{Script=Han}/u.test(line) && !upstreamComments.has(`${path}\n${line.trim()}`))
          violations.push(`${path}:${index + 1}`);
    }
  }
  if (violations.length)
    throw new Error(`Hardcoded Han found (including comments):\n${violations.join("\n")}`);
}

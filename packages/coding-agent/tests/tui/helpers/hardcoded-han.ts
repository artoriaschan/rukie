import { join } from "node:path";

const localizedFiles = new Set([
  "packages/coding-agent/src/view/i18n/locales.ts",
  "packages/coding-agent/src/tui/screens/chat/activity/phrases.ts",
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
        if (/\p{Script=Han}/u.test(line)) violations.push(`${path}:${index + 1}`);
    }
  }
  if (violations.length)
    throw new Error(`Hardcoded Han found (including comments):\n${violations.join("\n")}`);
}

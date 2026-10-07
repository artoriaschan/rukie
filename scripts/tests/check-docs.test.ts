import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const checker = resolve(import.meta.dir, "../check-docs.ts");
const adr =
  "---\nstatus: accepted\n---\n\n# 决策\n\n## 问题\n\n问题。\n\n## 决定\n\n决定。\n\n## 备选方案\n\n真实备选。\n\n## 影响\n\n代价。\n";

const index =
  "# 决策记录\n\n<!-- ADR_INDEX_START -->\n\n- [0001 决策](0001-test.md) — `accepted`\n\n<!-- ADR_INDEX_END -->\n";

function check(files: Record<string, string>, write = false) {
  const root = mkdtempSync(join(tmpdir(), "rukie-docs-"));
  try {
    for (const [path, body] of Object.entries(files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
    const result = Bun.spawnSync([
      process.execPath,
      checker,
      "--root",
      root,
      ...(write ? ["--write"] : []),
    ]);
    const indexPath = join(root, "docs/adr/README.md");
    return {
      code: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
      index:
        files["docs/adr/README.md"] === undefined ? undefined : readFileSync(indexPath, "utf8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts Markdown links, reference links, duplicate and explicit anchors; ignores code examples", () => {
  const result = check({
    "docs/guide.md":
      "[read](target.md#重复-1)\n\n[ref][target]\n\n[target]: <target.md#自定义>\n\n![image](image.svg)\n\n`[code](missing.md)`\n\n```md\n[example](missing.md)\n```\n",
    "docs/target.md": '# 标题\n\n## 重复\n\n## 重复\n\n<a id="自定义"></a>\n',
    "docs/image.svg": "<svg/>",
    "docs/adr/0001-test.md": adr,
    "docs/adr/README.md": index,
    ".agents/skills/example/SKILL.md":
      '---\nname: example\ndescription: "用于示例文档维护。"\n---\n\n# 示例\n',
  });
  expect(result.output).toContain("Documentation checks passed");
  expect(result.code).toBe(0);
});

test("detects stale ADR indexes and synchronizes titles, status and ordering while preserving prose", () => {
  const files = {
    "docs/adr/0002-next.md": adr.replace("accepted", "proposed").replace("# 决策", "# 新决定"),
    "docs/adr/0001-test.md": adr,
    "docs/adr/README.md": index + "\n手写说明。\n",
  };
  const stale = check(files);
  expect(stale.code).toBe(1);
  expect(stale.output).toContain("docs:update");
  const updated = check(files, true);
  expect(updated.code).toBe(0);
  expect(updated.index).toContain("- [0002 新决定](0002-next.md) — `proposed`");
  expect(updated.index).toEndWith("手写说明。\n");
  expect(updated.index?.indexOf("0001")).toBeLessThan(updated.index?.indexOf("0002") ?? 0);
  expect(check({ ...files, "docs/adr/README.md": updated.index ?? "" }).code).toBe(0);
  expect(check({ ...files, "docs/adr/README.md": updated.index ?? "" }, true).index).toBe(
    updated.index,
  );
});

test("removes deleted decisions and does not rewrite invalid or unmarked indexes", () => {
  const files = {
    "docs/adr/0001-test.md": adr,
    "docs/adr/README.md": index.replace(
      "<!-- ADR_INDEX_END -->",
      "- [0002 旧决定](0002-old.md) — `accepted`\n\n<!-- ADR_INDEX_END -->",
    ),
  };
  // A deleted target must be removed before the normal link check.
  expect(check(files, true).index).toBe(index);
  const invalid = { ...files, "docs/adr/0001-test.md": adr.replace("accepted", "invalid") };
  expect(check(invalid, true).code).toBe(1);
  expect(check(invalid, true).index).toBe(files["docs/adr/README.md"]);
  const unmarked = { "docs/adr/0001-test.md": adr, "docs/adr/README.md": "# 手写目录\n" };
  expect(check(unmarked, true).code).toBe(1);
  expect(check(unmarked, true).index).toBe(unmarked["docs/adr/README.md"]);
});

test.each([
  ["[broken](missing.md)", "missing.md"],
  ["[broken](target.md#missing)", "#missing"],
  ["[broken][ref]\n\n[ref]: missing.md", "missing.md"],
  ["[local](/Users/someone/file.md)", "relative"],
  ["[bad](target.md#%ZZ)", "encoding"],
])("rejects invalid repository links: %s", (body, diagnostic) => {
  const result = check({ "docs/guide.md": body, "docs/target.md": "# Target\n" });
  expect(result.code).toBe(1);
  expect(result.output).toContain("docs/guide.md");
  expect(result.output).toContain(diagnostic);
});

test.each([
  [adr.replace("accepted", "implemented"), "status"],
  [adr.replace("## 备选方案\n\n真实备选。\n\n", ""), "备选方案"],
  [adr.replace("---\nstatus: accepted\n---", "Status: accepted"), "frontmatter"],
  [adr.replace("决定。", ""), "决定"],
  [adr.replace("status: accepted", "status: ["), "YAML"],
])("rejects invalid ADR metadata or sections: %s", (body, diagnostic) => {
  const result = check({ "docs/adr/0001-test.md": body });
  expect(result.code).toBe(1);
  expect(result.output).toContain(diagnostic);
});

test.each([
  ['name: wrong\ndescription: "Some workflow"', "name"],
  ["name: example", "description"],
  ['name: example\ndescription: ""', "description"],
])("rejects invalid skill discovery metadata: %s", (metadata, diagnostic) => {
  const result = check({
    ".agents/skills/example/SKILL.md": `---\n${metadata}\n---\n\n# Example\n`,
  });
  expect(result.code).toBe(1);
  expect(result.output).toContain(diagnostic);
});

test.each([
  ["missing.md", "valid.md", 1],
  ["valid.md", "missing.md", 0],
])("resolves the first duplicate reference definition (%s before %s)", (first, second, code) => {
  const result = check({
    "docs/guide.md": `[read][target]\n\n[target]: ${first}\n\n[target]: ${second}\n`,
    "docs/valid.md": "# Valid\n",
  });
  expect(result.code).toBe(code);
  if (code === 1) expect(result.output).toContain("missing.md");
});

import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

/** Enforce DESIGN.md's interface font scale in UI source, including composed classes. */
export function checkUiTypography(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures: string[] = [];
  function fail(node: ts.Node) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    failures.push(`${file}:${line}: use text-ui-* for interface font sizes`);
  }
  function visit(node: ts.Node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (
        /(?:^|[\s:!])text-(?:xs|sm|base|lg|xl|[2-9]xl|\[(?:[\d.]|length:|calc\(|clamp\(|var\())[^\s]*/u.test(
          node.text,
        )
      )
        fail(node);
    }
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = ts.isComputedPropertyName(node.name) ? node.name.expression : node.name;
      if (
        (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
        ["fontSize", "font-size"].includes(name.text)
      )
        fail(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const failures: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/u.test(file))
        failures.push(...checkUiTypography(relative(root, file), readFileSync(file, "utf8")));
    }
  }
  walk(resolve(root, "packages/ui/src"));
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log("UI typography checks passed.");
}

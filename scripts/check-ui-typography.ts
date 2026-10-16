import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

/** Enforce DESIGN.md's interface font scale in UI source, including composed classes. */
export function checkUiTypography(file: string, text: string): string[] {
  if (file.endsWith(".css")) return checkCssTypography(file, text);
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

/** Mask inert CSS text without moving declaration offsets or line numbers. */
function checkCssTypography(file: string, text: string): string[] {
  const masked = text.replace(
    /\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/gu,
    (inert) => inert.replace(/[^\n]/gu, " "),
  );
  const failures: string[] = [];
  for (const declaration of masked.matchAll(/(?:^|[;{])\s*(font-size)\s*:\s*([^;{}]*)/giu)) {
    if (/^var\(--(?:text-ui-[a-z0-9-]+|text-code)\)\s*(?:!important)?\s*$/iu.test(declaration[2]!))
      continue;
    const offset = declaration.index + declaration[0].indexOf(declaration[1]!);
    const line = text.slice(0, offset).split("\n").length;
    failures.push(`${file}:${line}: use text-ui-* or text-code for interface font sizes`);
  }
  return failures;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const failures: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:tsx?|css)$/u.test(file))
        failures.push(...checkUiTypography(relative(root, file), readFileSync(file, "utf8")));
    }
  }
  walk(resolve(root, "packages/ui/src"));
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log("UI typography checks passed.");
}

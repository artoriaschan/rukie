import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

/** Check mechanical test rules; lifecycle and behavior evidence still require review. */
export function checkTestSource(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const failures: string[] = [];
  const lines = text.split("\n");
  const delayNames = new Set(["sleep"]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const module = statement.moduleSpecifier.text;
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(module))
      failures.push(`${file}: import reusable fixtures, not another spec`);
    const bindings = statement.importClause?.namedBindings;
    if (module === "node:timers/promises" && bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        if ((element.propertyName ?? element.name).text === "setTimeout")
          delayNames.add(element.name.text);
  }
  function fail(node: ts.Node, message: string) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    failures.push(`${file}:${line}: ${message}`);
  }
  function checkRunner(module: string) {
    const desktopRunner = /(?:^|\/)packages\/(?:ui|desktop)\//.test(file.replaceAll("\\", "/"));
    if (desktopRunner && module === "bun:test")
      failures.push(`${file}: ui/desktop tests must use Vitest`);
    if (!desktopRunner && (module === "vitest" || module.startsWith("vitest/")))
      failures.push(`${file}: Bun runtime tests must use bun:test`);
  }
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkRunner(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(source) === "require")
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) checkRunner(argument.text);
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const name = expression.getText(source);
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      const previous = lines[line - 1] ?? "";
      const transport = /^\s*\/\/ test-policy: transport-delay .+/.test(previous);
      if (
        (name === "Bun.sleep" ||
          (ts.isIdentifier(expression) && delayNames.has(expression.text))) &&
        !transport
      )
        fail(node, "fixed delay is not synchronization; await an observable result");
      if (/^(?:test|describe|it)\.only(?:\.|$)/.test(name))
        fail(node, "focused tests must not exclude the suite");
      if (name === "setTimeout" || name === "globalThis.setTimeout") {
        // A direct Promise resolver schedules successful continuation after elapsed time.
        let parent: ts.Node | undefined = node.parent;
        while (parent && !ts.isSourceFile(parent)) {
          if (ts.isNewExpression(parent) && parent.expression.getText(source) === "Promise") {
            const executor = parent.arguments?.[0];
            if (executor && (ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))) {
              const resolver = executor.parameters[0]?.name.getText(source);
              let resolves = node.arguments[0]?.getText(source) === resolver;
              const callback = node.arguments[0];
              if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
                function findResolution(child: ts.Node) {
                  if (ts.isCallExpression(child) && child.expression.getText(source) === resolver)
                    resolves = true;
                  ts.forEachChild(child, findResolution);
                }
                findResolution(callback.body);
              }
              if (resolver && resolves && !transport)
                fail(node, "timer resolves synchronization Promise; use readiness or completion");
            }
            break;
          }
          parent = parent.parent;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const failures: string[] = [];
  let checked = 0;
  function walk(directory: string, inTests = false) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const file = resolve(directory, entry.name);
      const ownedTests = inTests || entry.name === "tests";
      if (entry.isDirectory()) walk(file, ownedTests);
      else if (ownedTests && /\.tsx?$/.test(file)) {
        checked++;
        failures.push(...checkTestSource(relative(root, file), readFileSync(file, "utf8")));
      }
    }
  }
  walk(resolve(root, "packages"));
  walk(resolve(root, "scripts"));
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log(`Test policy checks passed (${checked} test and fixture files).`);
}

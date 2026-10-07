import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const inkRoot = resolve(import.meta.dir, "../packages/coding-agent/src/ink");
const sharedRoot = resolve(import.meta.dir, "../packages/shared");
const failures: string[] = [];

function within(root: string, target: string) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}
function check(file: string, specifier: string) {
  const resolved = ts.resolveModuleName(
    specifier,
    file,
    {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.Preserve,
      allowImportingTsExtensions: true,
    },
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  const forbiddenPackage = /^@rukie\/(?:agent|i18n|coding-agent)(?:\/|$)/u.test(specifier);
  const target =
    resolved ?? (specifier.startsWith(".") ? resolve(dirname(file), specifier) : undefined);
  if (
    forbiddenPackage ||
    (target &&
      !target.includes("node_modules") &&
      !within(inkRoot, target) &&
      !within(sharedRoot, target))
  ) {
    failures.push(`${relative(inkRoot, file)}: ${specifier}`);
  }
}
function walk(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (!/\.tsx?$/u.test(file)) continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        check(file, node.moduleSpecifier.text);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        check(file, node.moduleReference.expression.text);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        const argument = node.arguments[0];
        if (
          argument &&
          (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
        )
          check(file, argument.text);
        else
          failures.push(
            `${relative(inkRoot, file)}: computed module import cannot be boundary checked`,
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
walk(inkRoot);
if (failures.length) {
  console.error(`ink dependency boundary violations:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("ink dependency boundaries pass (imports, reexports, dynamic imports)");

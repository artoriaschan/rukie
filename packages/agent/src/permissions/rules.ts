import { createUserVisibleError } from "@neant/shared";
import { analyzeBashCommand, matchesBashPattern } from "./bash.ts";
import { matchesPermissionPath, resolvePermissionPath } from "./path.ts";

export type PermissionRule = {
  decision: "allow" | "ask" | "deny";
  raw: string;
} & (
  | { kind: "tool"; pattern: string }
  | { kind: "bash"; tool: "bash"; pattern: string }
  | { kind: "path"; tool: "read" | "edit" | "write" | "glob" | "grep"; pattern: string }
);

/** Parse once at settings/session startup; keep the original text for denial feedback. */
export function parsePermissionRules(
  permissions:
    | { allow?: readonly string[]; ask?: readonly string[]; deny?: readonly string[] }
    | undefined,
  source = "settings.permissions",
): PermissionRule[] {
  const rules: PermissionRule[] = [];
  for (const decision of ["deny", "ask", "allow"] as const) {
    for (const raw of permissions?.[decision] ?? []) {
      const text = raw.trim();
      const fail = () => {
        throw createUserVisibleError(`${source}: invalid permission rule ${JSON.stringify(raw)}`, {
          code: "permission-rule-invalid",
          params: { source, rule: raw },
        });
      };
      if (!text) fail();
      if (!/[()]/.test(text)) {
        rules.push({ decision, raw, kind: "tool", pattern: text });
        continue;
      }
      const match = /^([^()]+)\((.+)\)$/s.exec(text);
      if (!match) fail();
      const tool = match![1]!;
      const pattern = match![2]!;
      // Specifiers may contain balanced parentheses, e.g. bash(echo $(pwd)).
      let depth = 0;
      for (const char of pattern) {
        if (char === "(") depth++;
        if (char === ")" && --depth < 0) fail();
      }
      if (depth !== 0 || !pattern.trim()) fail();
      if (tool === "bash") rules.push({ decision, raw, kind: "bash", tool, pattern });
      else if (
        tool === "read" ||
        tool === "edit" ||
        tool === "write" ||
        tool === "glob" ||
        tool === "grep"
      )
        rules.push({ decision, raw, kind: "path", tool, pattern });
      else fail();
    }
  }
  return rules;
}

/** Rule seam: canonicalize file targets once, then match already parsed rules. */
export function evaluatePermissionRules({
  rules,
  toolName,
  args,
  cwd,
  homeDir,
}: {
  rules: readonly PermissionRule[];
  toolName: string;
  args: unknown;
  cwd: string;
  homeDir: string;
}): { decision: "allow" | "ask" | "deny"; rule: string } | undefined {
  const target = rules.some((rule) => rule.kind === "path" && rule.tool === toolName)
    ? resolvePermissionPath({ toolName, args, cwd, homeDir })
    : undefined;
  const bash =
    toolName === "bash" &&
    typeof args === "object" &&
    args !== null &&
    "command" in args &&
    typeof args.command === "string"
      ? analyzeBashCommand(args.command)
      : undefined;
  const matchesRule = (rule: PermissionRule, command?: string): boolean =>
    rule.kind === "tool"
      ? new Bun.Glob(rule.pattern).match(toolName)
      : rule.kind === "bash" && command !== undefined
        ? matchesBashPattern(rule.pattern, command)
        : rule.kind === "path" && rule.tool === toolName && target !== undefined
          ? matchesPermissionPath(rule.pattern, rule.decision, target, cwd, homeDir)
          : false;
  for (const decision of ["deny", "ask", "allow"] as const) {
    if (decision === "allow" && bash) {
      if (!bash.allowMatching) return undefined;
      let matched: PermissionRule | undefined;
      for (const segment of bash.segments) {
        const match = rules.find((rule) => rule.decision === "allow" && matchesRule(rule, segment));
        if (!match) return undefined;
        matched ??= match;
      }
      return matched ? { decision, rule: matched.raw } : undefined;
    }
    for (const rule of rules) {
      if (rule.decision !== decision) continue;
      const matches = bash
        ? [bash.text, ...bash.segments].some((command) => matchesRule(rule, command))
        : matchesRule(rule);
      if (matches) return { decision, rule: rule.raw };
    }
  }
  return undefined;
}

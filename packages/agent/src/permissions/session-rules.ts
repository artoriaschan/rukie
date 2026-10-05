import { statSync } from "node:fs";
import { dirname, sep } from "node:path";
import { permissionUrlDomain } from "./domain.ts";
import { resolvePermissionPath } from "./path.ts";
import type { PermissionRule } from "./rules.ts";

/** Mutable memory grants; pass the same collection to related permission gates. */
export type SessionAllowRule = PermissionRule & { decision: "allow" };
export interface SessionAllow {
  kind: "command" | "directory" | "domain" | "tool";
  rule: string;
}

const literalPattern = (text: string) => text.replace(/[\\*?[\]{}!]/g, "\\$&");

export function sessionAllowRule(
  toolName: string,
  args: unknown,
  cwd: string,
  homeDir: string,
): { description: SessionAllow; rule: SessionAllowRule } {
  if (toolName === "web_fetch") {
    // Malformed URLs must never turn a session approval into a tool-wide grant.
    const domain = permissionUrlDomain(args) ?? "";
    const raw = `web_fetch(domain:${domain})`;
    return {
      description: { kind: "domain", rule: raw },
      rule: {
        decision: "allow",
        raw,
        kind: "domain",
        tool: "web_fetch",
        domain,
        subdomains: false,
      },
    };
  }
  if (
    toolName === "bash" &&
    typeof args === "object" &&
    args !== null &&
    "command" in args &&
    typeof args.command === "string"
  ) {
    const command = args.command.trim();
    const raw = `bash(${literalPattern(command)})`;
    return {
      description: { kind: "command", rule: raw },
      rule: { decision: "allow", raw, kind: "bash-exact", tool: "bash", command },
    };
  }
  const target = resolvePermissionPath({ toolName, args, cwd, homeDir });
  if (target) {
    let directory = dirname(target.realPath);
    if (toolName === "glob" || toolName === "grep") {
      try {
        if (statSync(target.realPath).isDirectory()) directory = target.realPath;
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw error;
      }
    }
    const tool = toolName as "read" | "edit" | "write" | "glob" | "grep";
    const raw = `${tool}(${literalPattern(directory)}${directory.endsWith(sep) ? "" : sep}**)`;
    return {
      description: { kind: "directory", rule: raw },
      rule: { decision: "allow", raw, kind: "directory", tool, directory },
    };
  }
  return {
    description: { kind: "tool", rule: toolName },
    rule: { decision: "allow", raw: toolName, kind: "tool", pattern: toolName, exact: true },
  };
}

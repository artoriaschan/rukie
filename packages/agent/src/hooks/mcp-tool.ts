import type { McpClient } from "@earendil-works/pi-mcp";
import { createUserVisibleError, type HookHandler } from "@neant/shared";
import type { CommandOutput } from "./command.ts";

export type CallMcpHookTool = (
  server: string,
  tool: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
) => ReturnType<McpClient["callTool"]>;

/** Exact placeholders retain JSON value types; embedded placeholders become text. */
function substitute(value: unknown, input: Record<string, unknown>): unknown {
  const read = (path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (current, key) =>
          current !== null && typeof current === "object" && Object.hasOwn(current, key)
            ? (current as Record<string, unknown>)[key]
            : undefined,
        input,
      );
  if (typeof value === "string") {
    const exact = /^\$\{(tool_input(?:\.[A-Za-z0-9_]+)*)\}$/.exec(value);
    if (exact) return read(exact[1]!);
    return value.replace(/\$\{(tool_input(?:\.[A-Za-z0-9_]+)*)\}/g, (_literal, path: string) => {
      const replacement = read(path);
      return typeof replacement === "string"
        ? replacement
        : replacement === undefined
          ? ""
          : JSON.stringify(replacement);
    });
  }
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, input));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, substitute(entry, input)]),
    );
  return value;
}

export async function executeMcpTool(
  handler: Extract<HookHandler, { type: "mcp_tool" }>,
  input: Record<string, unknown>,
  signal: AbortSignal,
  callTool: CallMcpHookTool | undefined,
): Promise<CommandOutput> {
  if (!callTool)
    throw createUserVisibleError(`Hook MCP server is not connected: ${handler.server}`, {
      code: "hook-mcp-unconnected",
      params: { server: handler.server },
    });
  const result = await callTool(
    handler.server,
    handler.tool,
    substitute(handler.input ?? {}, input) as Record<string, unknown>,
    signal,
  );
  if (result.isError)
    throw createUserVisibleError(`Hook MCP tool failed: ${handler.server}/${handler.tool}`, {
      code: "hook-mcp-failed",
      params: { server: handler.server, tool: handler.tool },
    });
  return {
    stdout: (result.content ?? [])
      .flatMap((content) => (content.type === "text" ? [content.text] : []))
      .join("\n"),
    stderr: "",
    exitCode: 0,
  };
}

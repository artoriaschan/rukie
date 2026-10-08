import { toToolDeclaration, type Api, type Model, type Tool } from "@earendil-works/pi-ai";
import { declarationsEqual } from "@earendil-works/pi-ai/utils/transcript";
import type { ToolRegistration } from "@earendil-works/pi-durable";

export function isDeferredToolCandidate(tool: { name: string }): boolean {
  return tool.name.startsWith("mcp__") && !tool.name.endsWith("__authenticate");
}

/** Keep surviving declarations in Transcript order; native tool changes append new entries. */
export function planToolSearchLoadout(input: {
  tools: readonly ToolRegistration[];
  currentTools: readonly Tool[];
  model: Pick<Model<Api>, "contextWindow" | "compat">;
  mode?: "auto" | "on" | "off";
}): { enabled: boolean; tools: ToolRegistration[]; deferred: ToolRegistration[] } {
  const candidates = input.tools.filter(isDeferredToolCandidate);
  const compat = input.model.compat;
  const supported = Boolean(
    compat &&
    (("supportsMidConvoToolChanges" in compat && compat.supportsMidConvoToolChanges) ||
      ("supportsToolSearch" in compat && compat.supportsToolSearch)),
  );
  const mode = input.mode ?? "auto";
  const estimatedTokens = candidates.reduce(
    (sum, tool) => sum + JSON.stringify(toToolDeclaration(tool)).length / 4,
    0,
  );
  const enabled =
    supported &&
    candidates.length > 0 &&
    mode !== "off" &&
    (mode === "on" || estimatedTokens > input.model.contextWindow * 0.1);
  const available = new Map(input.tools.map((tool) => [tool.name, tool]));
  const tools: ToolRegistration[] = [];
  const visible = new Set<string>();
  const replaced: ToolRegistration[] = [];
  for (const declaration of input.currentTools) {
    const tool = available.get(declaration.name);
    if (tool && !visible.has(tool.name)) {
      if (declarationsEqual(declaration, toToolDeclaration(tool))) tools.push(tool);
      else replaced.push(tool);
      visible.add(tool.name);
    }
  }
  const deferred: ToolRegistration[] = [];
  for (const tool of input.tools) {
    if (visible.has(tool.name)) continue;
    if (enabled && isDeferredToolCandidate(tool)) {
      deferred.push(tool);
    } else if (tool.name !== "ToolSearch" || enabled) {
      tools.push(tool);
      visible.add(tool.name);
    }
  }
  tools.push(...replaced);
  return { enabled, tools, deferred };
}

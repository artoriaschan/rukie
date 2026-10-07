import type { createTuiI18n } from "../../../view/i18n";

export function commandCatalog(t: ReturnType<typeof createTuiI18n>) {
  return (
    [
      "compact",
      "clear",
      "rewind",
      "goal",
      "plan",
      "help",
      "exit",
      "model",
      "resume",
      "context",
      "settings",
      "mcp",
      "btw",
      "rename",
      "jobs",
    ] as const
  ).map((name) => ({
    name,
    description: t(`command.${name}`),
    parameters:
      name === "goal"
        ? "[<objective>|edit <objective>|pause|resume|clear]"
        : name === "context"
          ? "[all]"
          : name === "mcp"
            ? "[login|logout|reconnect <server>]"
            : undefined,
    duringRun: ["exit", "help", "btw", "context", "rename", "goal", "mcp", "jobs"].includes(name),
  }));
}

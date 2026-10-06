import type { createTuiI18n } from "../../i18n";

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
          : undefined,
    duringRun: ["exit", "help", "btw", "context", "rename", "jobs", "goal"].includes(name),
  }));
}

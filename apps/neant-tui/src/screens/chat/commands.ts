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
    ] as const
  ).map((name) => ({
    name,
    description: t(`command.${name}`),
    duringRun: ["exit", "help", "btw", "context", "rename"].includes(name),
  }));
}

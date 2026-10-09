import { parseArgs } from "node:util";
import { parsePermissionRules } from "@rukie/agent";
import {
  PERMISSION_MODES,
  THINKING_LEVELS,
  type PermissionMode,
  type ThinkingLevel,
} from "@rukie/shared";
import { createTuiI18n, formatError } from "../view/i18n";

const options = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  print: { type: "boolean", short: "p" },
  goal: { type: "string" },
  "max-goal-rounds": { type: "string" },
  model: { type: "string" },
  thinking: { type: "string" },
  resume: { type: "string" },
  "output-format": { type: "string" },
  "allow-tools": { type: "string", multiple: true },
  "permission-mode": { type: "string" },
  yolo: { type: "boolean" },
  "trust-project-mcp": { type: "boolean" },
} as const;

export type CliOptions = ReturnType<typeof parseCli>;

/** Parse one option table for both modes; --allow-tools owns following pattern positionals. */
export function parseCli(argv: string[], t: ReturnType<typeof createTuiI18n>) {
  const parsed = parseArgs({ args: argv, tokens: true, allowPositionals: true, options });
  const values = parsed.values;
  let prompt: string | undefined;
  let collectingTools = false;
  for (const token of parsed.tokens) {
    if (token.kind === "option") collectingTools = token.name === "allow-tools";
    else if (token.kind === "positional" && collectingTools)
      values["allow-tools"]!.push(token.value);
    else if (token.kind === "positional" && prompt === undefined) prompt = token.value;
    else if (token.kind === "positional")
      throw new Error(t("argv.unexpected", { argument: token.value }));
    else collectingTools = false;
  }
  if (values.help || values.version) {
    const information = values.help ? "help" : "version";
    if (
      parsed.tokens.some(
        (token) =>
          token.kind === "positional" || (token.kind === "option" && token.name !== information),
      )
    )
      throw new Error(t("argv.information-exclusive"));
    return { values, prompt, mode: information };
  }
  parsePermissionRules({ allow: values["allow-tools"] }, "--allow-tools");
  if (values.goal !== undefined && values.print) throw new Error(t("argv.goal-print"));
  if (values.goal !== undefined && !values.goal.trim()) throw new Error(t("argv.goal-empty"));
  if (values.goal !== undefined && prompt !== undefined)
    throw new Error(t("argv.unexpected", { argument: prompt }));
  const mode = values.print || values.goal !== undefined ? "headless" : "tui";
  if (mode === "tui") {
    for (const option of ["output-format", "max-goal-rounds"] as const)
      if (values[option] !== undefined)
        throw new Error(t("argv.headless-only", { option: `--${option}` }));
  }
  if (values["max-goal-rounds"] !== undefined) {
    if (values.goal === undefined) throw new Error(t("argv.rounds-goal"));
    if (
      !/^\d+$/.test(values["max-goal-rounds"]) ||
      !Number.isSafeInteger(Number(values["max-goal-rounds"])) ||
      Number(values["max-goal-rounds"]) < 1
    )
      throw new Error(t("argv.rounds-invalid"));
  }
  if (
    values["output-format"] !== undefined &&
    values["output-format"] !== "text" &&
    values["output-format"] !== "stream-json"
  )
    throw new Error(t("argv.output-format"));
  if (
    values["permission-mode"] !== undefined &&
    !PERMISSION_MODES.includes(values["permission-mode"] as PermissionMode)
  )
    throw new Error(t("argv.permission-mode", { values: PERMISSION_MODES.join(", ") }));
  if (
    values.yolo &&
    values["permission-mode"] !== undefined &&
    values["permission-mode"] !== "full-access"
  )
    throw new Error(t("argv.yolo-conflict"));
  if (values.model !== undefined && !/^[^/]+\/.+/.test(values.model))
    throw new Error(t("argv.model", { model: values.model }));
  if (values.thinking !== undefined && !THINKING_LEVELS.includes(values.thinking as ThinkingLevel))
    throw new Error(t("argv.thinking", { values: THINKING_LEVELS.join(", ") }));
  return { values, prompt, mode };
}

export function formatArgvError(error: unknown, t: ReturnType<typeof createTuiI18n>): string {
  if (!(error instanceof Error)) return formatError(error, t);
  const code = "code" in error ? error.code : undefined;
  const option = /'([^']+)'/.exec(error.message)?.[1] ?? "";
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") return t("argv.unknown-option", { option });
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE")
    return t(
      error.message.includes("argument missing")
        ? "argv.missing-value"
        : error.message.includes("does not take an argument")
          ? "argv.unexpected-value"
          : "argv.invalid-value",
      { option },
    );
  return formatError(error, t);
}

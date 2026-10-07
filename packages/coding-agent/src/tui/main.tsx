#!/usr/bin/env bun
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { loadSettings, parsePermissionRules, type SessionOptions } from "@neant/agent";
import { resolveLocale } from "@neant/i18n";
import {
  PERMISSION_MODES,
  THINKING_LEVELS,
  type PermissionMode,
  type ThinkingLevel,
} from "@neant/shared";
import { render, ThemeProvider, TooltipProvider, type RenderOptions } from "../ink/index.ts";
import { createDefaultHost, type TuiHost } from "./host";
import { createChat } from "./screens/chat";
import { createTuiI18n, formatError } from "./i18n";

export interface TuiIo extends RenderOptions {
  /** Host capabilities; defaults to the platform clipboard and external viewer. */
  host?: TuiHost;
  term?: string;
  env?: Record<string, string | undefined>;
  stderr(text: string): void;
  /** Session overrides; in-process tests inject a model and streamFn. */
  session?: Partial<SessionOptions>;
}

/** Run the interactive frontend and resolve to its process exit code. */
export async function main(argv: string[], io: TuiIo): Promise<number> {
  const env = io.env ?? process.env;
  const environmentLocale = resolveLocale([env.LC_ALL, env.LC_MESSAGES, env.LANG]);
  const argvT = createTuiI18n(environmentLocale);
  let values;
  let prompt: string | undefined;
  try {
    const parsed = parseArgs({
      args: argv,
      tokens: true,
      allowPositionals: true,
      options: {
        model: { type: "string" },
        thinking: { type: "string" },
        resume: { type: "string" },
        "allow-tools": { type: "string", multiple: true },
        "permission-mode": { type: "string" },
        yolo: { type: "boolean" },
        "trust-project-mcp": { type: "boolean" },
      },
    });
    values = parsed.values;
    let collectingTools = false;
    for (const token of parsed.tokens) {
      if (token.kind === "option") collectingTools = token.name === "allow-tools";
      else if (token.kind === "positional" && collectingTools)
        values["allow-tools"]!.push(token.value);
      else if (token.kind === "positional" && prompt === undefined) prompt = token.value;
      else if (token.kind === "positional")
        throw new Error(argvT("argv.unexpected", { argument: token.value }));
      else collectingTools = false;
    }
    parsePermissionRules({ allow: values["allow-tools"] }, "--allow-tools");
    if (
      values["permission-mode"] !== undefined &&
      !PERMISSION_MODES.includes(values["permission-mode"] as PermissionMode)
    ) {
      throw new Error(argvT("argv.permission-mode", { values: PERMISSION_MODES.join(", ") }));
    }
    if (
      values.yolo &&
      values["permission-mode"] !== undefined &&
      values["permission-mode"] !== "full-access"
    ) {
      throw new Error(argvT("argv.yolo-conflict"));
    }
    if (values.model !== undefined && !/^[^/]+\/.+/.test(values.model)) {
      throw new Error(argvT("argv.model", { model: values.model }));
    }
    if (
      values.thinking !== undefined &&
      !THINKING_LEVELS.includes(values.thinking as ThinkingLevel)
    ) {
      throw new Error(argvT("argv.thinking", { values: THINKING_LEVELS.join(", ") }));
    }
  } catch (error) {
    const failure = error as Error & { code?: string };
    const option = /'([^']+)'/.exec(failure.message)?.[1] ?? "";
    const message =
      failure.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION"
        ? argvT("argv.unknown-option", { option })
        : failure.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE"
          ? argvT(
              failure.message.includes("argument missing")
                ? "argv.missing-value"
                : failure.message.includes("does not take an argument")
                  ? "argv.unexpected-value"
                  : "argv.invalid-value",
              { option },
            )
          : formatError(error, argvT);
    io.stderr(`${message}\n`);
    return 2;
  }
  let t = argvT;
  let app: ReturnType<typeof render> | undefined;
  let chat: Awaited<ReturnType<typeof createChat>> | undefined;
  const defaultHost = io.host
    ? undefined
    : createDefaultHost({ env, writeTerminal: (text) => io.stdout.write(text) });
  let closing = false;
  const close = () => {
    closing = true;
    app?.unmount();
  };
  // Own process signals until Agent Core's parent and child Runs have settled.
  // Terminal restoration alone must not terminate the process before saving.
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  try {
    const cwd = io.session?.cwd ?? process.cwd();
    const homeDir = io.session?.homeDir ?? homedir();
    const { settings, warnings, hookWarnings } = await loadSettings({ cwd, homeDir });
    const locale = resolveLocale([settings.locale, env.LC_ALL, env.LC_MESSAGES, env.LANG]);
    t = createTuiI18n(locale);
    if (!io.stdin.isTTY || !io.stdout.isTTY || (io.term ?? process.env.TERM) === "dumb") {
      io.stderr(`${t("startup.terminal")}\n`);
      return 1;
    }
    const hookDiagnostics = new Map(
      (hookWarnings ?? []).map((warning) => [warning.message, warning]),
    );
    for (const warning of warnings) {
      const diagnostic = hookDiagnostics.get(warning);
      io.stderr(
        `${t("startup.warning", { warning: diagnostic?.error ? formatError(diagnostic.error, t) : warning })}\n`,
      );
    }
    if (values.model) settings.model = values.model;
    if (values.thinking) settings.thinking = values.thinking as ThinkingLevel;
    const model = io.session?.model;
    chat = await createChat(
      {
        cwd,
        homeDir,
        settings,
        onWarning: (warning) => {
          // Session's Goal ask-mode warning has no typed diagnostic; translate this known copy.
          const localized =
            warning ===
            "Goal continuation may wait for permissions in ask mode. Consider switching to auto-review."
              ? t("goal.permission-warning")
              : warning;
          // MCP and hook diagnostics also arrive as inline SessionEvent notices.
          if (!warning.startsWith("MCP server ") && !/^[A-Za-z]+ hook /.test(warning))
            io.stderr(`${t("startup.warning", { warning: localized })}\n`);
        },
        ...io.session,
        resumeId: values.resume,
        allowRules: [...(io.session?.allowRules ?? []), ...(values["allow-tools"] ?? [])],
        permissionMode: values.yolo
          ? "full-access"
          : ((values["permission-mode"] as PermissionMode | undefined) ??
            io.session?.permissionMode),
        trustProjectMcp: values["trust-project-mcp"] ?? io.session?.trustProjectMcp,
      },
      model ? `${model.provider}/${model.id}` : settings.model!,
      io.host ?? defaultHost!.host,
      locale,
      (title) => io.stdout.write(`\x1b]0;${title}\x07`),
    );
    app = render(
      <ThemeProvider>
        <TooltipProvider>
          <chat.Chat onExit={() => app?.unmount()} />
        </TooltipProvider>
      </ThemeProvider>,
      { ...io, fullscreen: true },
    );
    if (closing) app.unmount();
    else if (prompt !== undefined) chat.submitInitial(prompt);
    await app.waitUntilExit();
    return 0;
  } catch (error) {
    app?.unmount();
    io.stderr(`${formatError(error, t)}\n`);
    return 1;
  } finally {
    app?.unmount();
    try {
      await chat?.stop();
    } finally {
      try {
        await defaultHost?.dispose();
      } finally {
        process.off("SIGINT", close);
        process.off("SIGTERM", close);
      }
    }
  }
}

if (import.meta.main) {
  process.exitCode = await main(Bun.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: (text) => process.stderr.write(text),
  });
}

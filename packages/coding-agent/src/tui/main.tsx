#!/usr/bin/env bun
import { Writable } from "node:stream";
import { homedir } from "node:os";
import { loadSettings } from "@rukie/agent";
import { resolveLocale } from "@rukie/i18n";
import type { PermissionMode, ThinkingLevel } from "@rukie/shared";
import type { CliOptions } from "../cli";
import type { TuiIo } from "../io";
import { renderSync, AlternateScreen, ThemeProvider, TooltipProvider } from "../ink/index.ts";
import { createDefaultHost } from "./host";
import { createChat } from "./screens/chat";
import { createTuiI18n, formatError } from "../view/i18n";

/** Run the interactive frontend and resolve to its process exit code. */
export async function runTui(options: CliOptions, io: TuiIo): Promise<number> {
  if (io.signal?.aborted) return 0;
  const { values, prompt } = options;
  const env = io.env ?? process.env;
  const environmentLocale = resolveLocale([env.LC_ALL, env.LC_MESSAGES, env.LANG]);
  const argvT = createTuiI18n(environmentLocale);
  let t = argvT;
  let app: ReturnType<typeof renderSync> | undefined;
  let chat: Awaited<ReturnType<typeof createChat>> | undefined;
  const defaultHost = io.host
    ? undefined
    : createDefaultHost({ env, writeTerminal: (text) => io.stdout.write(text) });
  let closing = io.signal?.aborted ?? false;
  const close = () => {
    closing = true;
    app?.unmount();
  };
  // Own process signals until Agent Core's parent and child Runs have settled.
  // Terminal restoration alone must not terminate the process before saving.
  io.signal?.addEventListener("abort", close);
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
    app = renderSync(
      <AlternateScreen>
        <ThemeProvider>
          <TooltipProvider>
            <chat.Chat onExit={() => app?.unmount()} />
          </TooltipProvider>
        </ThemeProvider>
      </AlternateScreen>,
      {
        stdin: io.stdin,
        stdout: io.stdout,
        stderr: new Writable({
          write(chunk, _encoding, callback) {
            io.stderr(chunk.toString());
            callback();
          },
        }) as NodeJS.WriteStream,
        exitOnCtrlC: false,
        selectionIncludeNoSelectCells: false,
        patchConsole: false,
      },
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
    app?.cleanup();
    try {
      await chat?.stop();
    } finally {
      try {
        await defaultHost?.dispose();
        if (chat)
          io.stdout.write(`\r\n${t("exit.resume")}\r\n  rukie --resume ${chat.sessionId}\r\n`);
      } finally {
        io.signal?.removeEventListener("abort", close);
        process.off("SIGINT", close);
        process.off("SIGTERM", close);
      }
    }
  }
}

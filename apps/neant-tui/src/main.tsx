#!/usr/bin/env bun
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { loadSettings, type SessionOptions } from "@neant/agent";
import { THINKING_LEVELS, type ThinkingLevel } from "@neant/shared";
import { render, type RenderOptions } from "@neant/tui";
import { createChat } from "./screens/chat";

export interface TuiIo extends RenderOptions {
  stderr(text: string): void;
  /** Session overrides; in-process tests inject a model and streamFn. */
  session?: Partial<SessionOptions>;
}

/** Run the interactive frontend and resolve to its process exit code. */
export async function main(argv: string[], io: TuiIo): Promise<number> {
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
      else if (token.kind === "positional") throw new Error(`Unexpected argument: ${token.value}`);
      else collectingTools = false;
    }
    if (values["allow-tools"]?.some((pattern) => !pattern)) {
      throw new Error("--allow-tools requires non-empty tool patterns");
    }
    if (values.model !== undefined && !/^[^/]+\/.+/.test(values.model)) {
      throw new Error(`--model must be provider/id, got "${values.model}"`);
    }
    if (
      values.thinking !== undefined &&
      !THINKING_LEVELS.includes(values.thinking as ThinkingLevel)
    ) {
      throw new Error(`--thinking must be one of ${THINKING_LEVELS.join(", ")}`);
    }
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);
    return 2;
  }
  let app: ReturnType<typeof render> | undefined;
  let chat: Awaited<ReturnType<typeof createChat>> | undefined;
  try {
    const cwd = io.session?.cwd ?? process.cwd();
    const homeDir = io.session?.homeDir ?? homedir();
    const { settings, warnings } = await loadSettings({ cwd, homeDir });
    for (const warning of warnings) io.stderr(`Warning: ${warning}\n`);
    if (values.model) settings.model = values.model;
    if (values.thinking) settings.thinking = values.thinking as ThinkingLevel;
    const model = io.session?.model;
    chat = await createChat(
      {
        cwd,
        homeDir,
        settings,
        onWarning: (warning) => {
          // MCP errors also arrive as SessionEvents and are rendered as inline notices.
          if (!warning.startsWith("MCP server ")) io.stderr(`Warning: ${warning}\n`);
        },
        ...io.session,
        resumeId: values.resume,
        allowTools: [...(io.session?.allowTools ?? []), ...(values["allow-tools"] ?? [])],
        yolo: values.yolo ?? io.session?.yolo,
        trustProjectMcp: values["trust-project-mcp"] ?? io.session?.trustProjectMcp,
      },
      model ? `${model.provider}/${model.id}` : settings.model!,
    );
    app = render(<chat.Chat onExit={() => app?.unmount()} />, io);
    if (prompt !== undefined) chat.submit(prompt);
    await app.waitUntilExit();
    return 0;
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);
    return 1;
  } finally {
    app?.unmount();
    await chat?.stop();
  }
}

if (import.meta.main) {
  process.exitCode = await main(Bun.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: (text) => process.stderr.write(text),
  });
}

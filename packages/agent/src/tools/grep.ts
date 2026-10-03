import { truncateHead, type AgentTool } from "@earendil-works/pi-agent-core";
import { createUserVisibleError } from "@neant/shared";
import { Type } from "typebox";

const schema = Type.Object({
  pattern: Type.String({ description: "Regular expression to search for." }),
  path: Type.Optional(
    Type.String({ description: "File or directory to search; defaults to cwd." }),
  ),
});

export function createGrepTool(cwd: string): AgentTool<typeof schema> {
  return {
    name: "grep",
    label: "grep",
    description:
      "Search file contents with ripgrep (rg), respecting ignore files. Returns path:line:text matches.",
    parameters: schema,
    async execute(_id, { pattern, path }, signal) {
      signal?.throwIfAborted();
      let proc;
      try {
        const { rgPath: rg } = await import("@vscode/ripgrep");
        signal?.throwIfAborted();
        proc = Bun.spawn(
          [
            rg,
            "--line-number",
            "--with-filename",
            "--no-heading",
            "--color",
            "never",
            "--regexp",
            pattern,
            "--",
            path ?? ".",
          ],
          {
            cwd,
            signal,
            timeout: 60_000,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          },
        );
      } catch (error) {
        signal?.throwIfAborted();
        const cause = error instanceof Error ? error.message : String(error);
        throw createUserVisibleError(
          `Bundled ripgrep is unavailable. Reinstall Neant dependencies (including optionalDependencies) and check platform compatibility or binary execution permissions. Cause: ${cause}`,
          { code: "ripgrep-unavailable", params: { cause } },
          { cause: error },
        );
      }
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      signal?.throwIfAborted();
      if (code !== 0 && code !== 1)
        throw new Error(stderr.trim() || `rg failed with exit code ${code}.`);
      const output = truncateHead(stdout.trimEnd());
      return {
        content: [
          {
            type: "text",
            text: output.content
              ? output.content +
                (output.truncated ? "\n[Output truncated; narrow the search.]" : "")
              : "No matches.",
          },
        ],
        details: undefined,
      };
    },
  };
}

// Tool category palette follows dsh-TUI's AssistantToolUseMessage.toolNameColor.
// https://github.com/ccch1mneyyy/dsh-TUI (MIT, copyright 2026 chimney)
const mutate = new Set(["edit", "write", "multiedit", "notebookedit"]);
const execute = new Set(["bash", "bashpersistent", "sh", "shell", "terminal"]);

/** Pure presentation choice, shared by tool displays without Agent Core types. */
export function toolNameColor(name: string): "toolNameMutate" | "toolNameExec" | "accent" {
  const lower = name.toLowerCase();
  if (mutate.has(lower)) return "toolNameMutate";
  if (execute.has(lower)) return "toolNameExec";
  return "accent";
}

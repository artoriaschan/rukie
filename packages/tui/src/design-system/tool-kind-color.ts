import type { ToolKind } from "@neant/shared";
/** Category colors depend on the Tool View's facts, shared by names and status dots. */
export function toolKindColor(kind?: ToolKind) {
  switch (kind) {
    case "execute":
      return "toolDotExec";
    case "read":
    case "search":
      return "toolDotRead";
    case "edit":
    case "delete":
    case "move":
      return "toolDotWrite";
    case "fetch":
      return "toolDotWeb";
    case "task":
      return "toolDotTask";
    default:
      return "text";
  }
}

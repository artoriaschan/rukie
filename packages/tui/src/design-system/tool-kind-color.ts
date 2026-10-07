import type { ToolKind } from "@neant/shared";
/** Tool View facts choose mutation gold or execution cyan; all other tools use the accent family. */
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
    case "task":
    default:
      return "toolDotRead";
  }
}

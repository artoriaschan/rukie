import type { GoalView } from "@rukie/agent";
import type { ThemeColor } from "../../../ink/index.ts";

export const goalPhasePresentation: Record<
  GoalView["phase"],
  { glyph: string; color: ThemeColor | undefined; dimColor: boolean }
> = {
  active: { glyph: "●", color: "success", dimColor: false },
  paused: { glyph: "⏸", color: "warning", dimColor: false },
  blocked: { glyph: "⛔", color: "error", dimColor: false },
  complete: { glyph: "✓", color: undefined, dimColor: true },
};

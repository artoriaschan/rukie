// moon8 activity preset from dsh-working-activity src/frames.ts (0.5.1),
// used by dsh-TUI src/components/activityFrames.ts.
export const figures = {
  assistant: process.platform === "darwin" ? "⏺" : "●",
  user: "❯",
  result: "⎿",
  success: "•",
  error: "✗",
  spinner: ["·", "•", "●", "•"],
  activityFrames: {
    frames: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
    intervalMs: 120,
  },
};

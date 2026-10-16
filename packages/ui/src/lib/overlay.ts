/** Ordinary hints stay below dialogs; modal-owned hints sit above their owner and below menus. */
export const OVERLAY_LAYER = {
  localBackground: "-z-10",
  localBase: "z-0",
  localForeground: "z-10",
  navigationScrim: "z-10",
  navigation: "z-20",
  settings: "z-30",
  previewRail: "z-10",
  transcriptScrollbar: "z-30",
  summary: "z-20",
  hint: "z-40",
  modal: "z-50",
  modalHint: "z-55",
  interactive: "z-60",
} as const;

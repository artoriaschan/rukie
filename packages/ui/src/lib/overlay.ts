/** Ordinary hints stay below dialogs; modal-owned hints sit above their owner and below menus. */
export const OVERLAY_LAYER = {
  hint: "z-40",
  modal: "z-50",
  modalHint: "z-55",
  interactive: "z-60",
} as const;

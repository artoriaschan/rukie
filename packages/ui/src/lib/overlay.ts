/** Passive hints stay below modal surfaces; interactive menus can open above dialogs. */
export const OVERLAY_LAYER = {
  hint: "z-40",
  modal: "z-50",
  interactive: "z-60",
} as const;

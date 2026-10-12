import type { DesktopHost } from "../../src/host";

/** Inert host boundary for tests which do not exercise model management. */
export const modelServicesFixture: DesktopHost["modelServices"] = {
  list: async () => [],
  save: async () => {},
  delete: async () => {},
  test: async () => {},
  revealKey: async () => undefined,
  templates: async () => [],
  prices: async () => ({ status: "unavailable" }),
};

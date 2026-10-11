/** Native capabilities are injected by the Electron or browser entry. */
import type {
  ModelServiceSave,
  ModelServiceSummary,
  ModelPriceRequest,
  ModelPriceResult,
} from "@rukie/shared";
export interface DesktopHost {
  getConnection(): Promise<{ port: number; token: string }>;
  pickProjectFolder(): Promise<string | null>;
  revealPath(path: string): Promise<void>;
  openInTerminal(path: string): Promise<void>;
  modelServices?: {
    prices?(input: ModelPriceRequest): Promise<ModelPriceResult>;
    /** Explicit user reveal only; never persist or log the returned key. */
    revealKey?(id: string): Promise<string | undefined>;
    list(): Promise<ModelServiceSummary[]>;
    save(input: ModelServiceSave): Promise<void>;
    delete(id: string): Promise<void>;
    test?(id: string, modelId: string): Promise<void>;
    templates?(): Promise<import("@rukie/shared").ModelService[]>;
  };
}

export function browserHost(): Pick<DesktopHost, "getConnection"> {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const port = Number(parameters.get("port"));
  const token = parameters.get("token") ?? "";
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return {
    getConnection: async () => {
      if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token)
        throw new Error("Missing development connection fragment");
      return { port, token };
    },
  };
}
declare global {
  interface Window {
    rukieHost?: DesktopHost;
  }
}

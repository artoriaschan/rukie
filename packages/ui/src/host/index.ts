/** Native capabilities are injected by the Electron or browser entry. */
import { WireError, type WireClient } from "../client";
import type {
  ModelServiceSave,
  ModelServiceSummary,
  ModelPriceRequest,
  ModelPriceResult,
} from "@rukie/shared";
export interface DesktopHost {
  getConnection(): Promise<{ port: number; token: string }>;
  pickProjectFolder(): Promise<string | null>;
  /** App binds its single connection before host actions; host never opens or closes it. */
  bindClient?(client: WireClient): void;
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

export function browserHost(): Pick<
  DesktopHost,
  "getConnection" | "pickProjectFolder" | "bindClient"
> {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const port = Number(parameters.get("port"));
  const token = parameters.get("token") ?? "";
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  const connection = {
    getConnection: async () => {
      if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token)
        throw new Error("Missing development connection fragment");
      return { port, token };
    },
  };
  let client: WireClient | undefined;
  return {
    ...connection,
    bindClient: (value) => {
      client = value;
    },
    pickProjectFolder: async () => {
      if (!client) throw new Error("Browser host client is not connected");
      try {
        await client.connect();
        const result: unknown = await client.request({ type: "host.pickFolder" });
        if (result !== null && typeof result !== "string")
          throw new Error("Invalid folder response");
        return result;
      } catch (error) {
        if (error instanceof WireError && error.code === "unsupported") return null;
        throw error;
      }
    },
  };
}
declare global {
  interface Window {
    rukieHost?: DesktopHost;
  }
}

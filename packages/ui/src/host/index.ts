/** Native capabilities are injected by the Electron or browser entry. */
import { WireError, type WireClient, type ClientCommand } from "../client";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ModelServiceSchema } from "@rukie/shared";
import type {
  ModelServiceSave,
  ModelServiceSummary,
  ModelPriceRequest,
  ModelPriceResult,
} from "@rukie/shared";
export interface DesktopHost {
  /** Presentation-only native theme selection; browser hosts perform no operation. */
  setThemeSource(source: "system" | "light" | "dark"): Promise<void>;
  getConnection(): Promise<{ port: number; token: string }>;
  pickProjectFolder(multiple?: boolean): Promise<string[] | null>;
  /** App binds its single connection before host actions; host never opens or closes it. */
  bindClient?(client: WireClient): void;
  modelServices: {
    prices(input: ModelPriceRequest): Promise<ModelPriceResult>;
    /** Explicit user reveal only; never persist or log the returned key. */
    revealKey(id: string): Promise<string | undefined>;
    list(): Promise<ModelServiceSummary[]>;
    save(input: ModelServiceSave): Promise<void>;
    delete(id: string): Promise<void>;
    test(id: string, modelId: string): Promise<void>;
  };
}

export function browserHost(): DesktopHost {
  const storageKey = "rukie.webDevelopment.connection";
  const fragment = location.hash.slice(1);
  let handshake = fragment;
  // Retain only the local sidecar handshake for reloads in this tab, never API keys.
  try {
    if (!fragment) handshake = sessionStorage.getItem(storageKey) ?? "";
  } catch {
    // Storage can be blocked; the launch fragment still works for this page.
  }
  const parameters = new URLSearchParams(handshake);
  const port = Number(parameters.get("port"));
  const token = parameters.get("token") ?? "";
  const valid =
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535 &&
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(token);
  try {
    if (valid)
      sessionStorage.setItem(
        storageKey,
        new URLSearchParams({ port: String(port), token }).toString(),
      );
    else sessionStorage.removeItem(storageKey);
  } catch {
    // Storage availability must not prevent the initial connection.
  }
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  const connection = {
    getConnection: async () => {
      if (!valid) throw new WireError("connection_missing");
      return { port, token };
    },
  };
  let client: WireClient | undefined;
  const request = async (command: ClientCommand): Promise<unknown> => {
    if (!client) throw new Error("Browser host client is not connected");
    await client.connect();
    return client.request(command);
  };
  const checked = <T>(value: unknown, check: (input: unknown) => input is T): T => {
    if (!check(value)) throw new Error("Invalid model service response");
    return value;
  };
  return {
    ...connection,
    setThemeSource: async () => {},
    modelServices: {
      list: async () =>
        checked(
          await request({ type: "modelServices.list" }),
          (input): input is ModelServiceSummary[] =>
            Value.Check(
              Type.Array(
                Type.Object(
                  { ...ModelServiceSchema.properties, hasCredential: Type.Boolean() },
                  { additionalProperties: false },
                ),
              ),
              input,
            ),
        ),
      save: async (input) => {
        await request({ type: "modelServices.save", ...input });
      },
      delete: async (id) => {
        await request({ type: "modelServices.delete", providerId: id });
      },
      test: async (id, modelId) => {
        await request({ type: "modelServices.test", providerId: id, modelId });
      },
      revealKey: async (id) => {
        const result = await request({ type: "modelServices.revealKey", providerId: id });
        if (
          typeof result !== "object" ||
          result === null ||
          !("value" in result) ||
          (result.value !== null && typeof result.value !== "string")
        )
          throw new Error("Invalid model service response");
        return result.value ?? undefined;
      },
      prices: async (input) => {
        const result = await request({ type: "modelServices.prices", ...input });
        return checked(result, isModelPriceResult);
      },
    },
    bindClient: (value) => {
      client = value;
    },
    pickProjectFolder: async (multiple) => {
      if (!client) throw new Error("Browser host client is not connected");
      await client.connect();
      const result: unknown = await client.request({
        type: "host.pickFolder",
        ...(multiple === undefined ? {} : { multiple }),
      });
      if (
        result !== null &&
        (!Array.isArray(result) ||
          !result.every((path): path is string => typeof path === "string"))
      )
        throw new Error("Invalid folder response");
      return result;
    },
  };
}
declare global {
  interface Window {
    rukieHost?: DesktopHost;
  }
}

function isModelPriceResult(value: unknown): value is ModelPriceResult {
  return Value.Check(
    Type.Union([
      Type.Object(
        { status: Type.Enum(["unmatched", "ambiguous", "unavailable"]) },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          status: Type.Literal("found"),
          prices: Type.Object(
            {
              inputPrice: Type.Number({ minimum: 0 }),
              outputPrice: Type.Number({ minimum: 0 }),
              cacheReadPrice: Type.Optional(Type.Number({ minimum: 0 })),
              cacheWritePrice: Type.Optional(Type.Number({ minimum: 0 })),
            },
            { additionalProperties: false },
          ),
          priceSource: Type.String(),
        },
        { additionalProperties: false },
      ),
    ]),
    value,
  );
}

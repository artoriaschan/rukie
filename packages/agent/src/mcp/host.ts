import { createMcpAuthState, createMcpConnections } from "./index.ts";
import { createMcpManager } from "./manager.ts";
import type { CustomSessionEvent } from "@rukie/shared";

type Connections = ReturnType<typeof createMcpConnections>;
type ConnectOptions = Parameters<Connections["connect"]>[0];
type ManagerOptions = Parameters<typeof createMcpManager>[0];

/** Session-specific callers and configuration; these do not belong to the Host lifetime. */
export interface McpViewOptions {
  applicationVersion?: string;
  connectOptions(): Omit<
    ConnectOptions,
    "signal" | "onlyServer" | "skipServer" | "loadOnly" | "reconnect" | "onEvent" | "getOrigin"
  >;
  getRunning: ManagerOptions["getRunning"];
  getBusy: ManagerOptions["getBusy"];
  onChange: ManagerOptions["onChange"];
  onEvent(event: CustomSessionEvent): void;
}

function createMcpView(options: McpViewOptions, released: () => void) {
  const auth = createMcpAuthState();
  const connections = createMcpConnections(auth, options.applicationVersion);
  const manager = createMcpManager({
    createConnections: () => createMcpConnections(auth, options.applicationVersion),
    connectOptions: options.connectOptions,
    getRunning: options.getRunning,
    getBusy: options.getBusy,
    onChange: options.onChange,
  });
  const reconnectServers = new Set<string>();
  let closing: Promise<void> | undefined;
  return {
    get tools() {
      return connections.tools;
    },
    get toolServers() {
      return connections.toolServers;
    },
    get authTools() {
      return connections.authTools;
    },
    get hasServers() {
      return connections.hasServers;
    },
    get busy() {
      return manager.busy;
    },
    reminder: connections.reminder,
    callHookTool: connections.callHookTool,
    snapshot: manager.snapshot,
    authenticate: manager.authenticate,
    clearAuth: manager.clearAuth,
    waitForIdle: manager.waitForIdle,
    stopManagement: manager.close,
    adopt() {
      manager.adopt(connections.snapshot());
    },
    async reconnect(name: string) {
      await manager.reconnect(name);
      reconnectServers.add(name);
    },
    /** The caller's Run signal bounds connection preparation, independently of Host disposal. */
    async prepareRun(
      input: { signal?: AbortSignal; getOrigin?: ConnectOptions["getOrigin"] } = {},
    ) {
      if (closing) throw new Error("MCP view has been closed.");
      const connect = {
        ...options.connectOptions(),
        ...input,
        onEvent: (event: CustomSessionEvent) => {
          options.onEvent(event);
          manager.adopt(connections.snapshot());
        },
      };
      for (const name of reconnectServers) {
        await connections.connect({ ...connect, onlyServer: name, reconnect: true });
        reconnectServers.delete(name);
      }
      await connections.connect(connect);
      manager.adopt(connections.snapshot());
    },
    close(): Promise<void> {
      return (closing ??= (async () => {
        try {
          await manager.close();
        } finally {
          try {
            await connections.close();
          } finally {
            released();
          }
        }
      })());
    },
  };
}

/** Owns MCP resources; each acquired view holds its Session connections and authorization state. */
export function createMcpHost() {
  const views = new Set<ReturnType<typeof createMcpView>>();
  let closing: Promise<void> | undefined;
  let closed = false;
  return {
    acquire(options: McpViewOptions) {
      if (closed) throw new Error("MCP Host has been closed.");
      const view = createMcpView(options, () => views.delete(view));
      views.add(view);
      return view;
    },
    close(): Promise<void> {
      closed = true;
      return (closing ??= Promise.allSettled([...views].map((view) => view.close())).then(
        (results) => {
          for (const result of results) if (result.status === "rejected") throw result.reason;
        },
      ));
    },
  };
}

export type McpHost = ReturnType<typeof createMcpHost>;

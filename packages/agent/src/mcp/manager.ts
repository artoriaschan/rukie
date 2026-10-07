import { isDeepStrictEqual } from "node:util";
import { createUserVisibleError, type McpSnapshot, type McpServerView } from "@rukie/shared";
import type { createMcpConnections } from "./index.ts";

type Connections = ReturnType<typeof createMcpConnections>;
type ConnectOptions = Parameters<Connections["connect"]>[0];

/** Host status probes and management own temporary connections, independent of native Runs. */
export function createMcpManager(options: {
  createConnections(): Connections;
  connectOptions(): Omit<
    ConnectOptions,
    "signal" | "onlyServer" | "skipServer" | "loadOnly" | "reconnect"
  >;
  getRunning(): boolean;
  getBusy?(): boolean;
  onChange(snapshot: McpSnapshot): void;
}) {
  let cached: McpSnapshot | undefined;
  let revision = 0;
  let probe: Promise<McpSnapshot> | undefined;
  let managing = false;
  let refreshing = false;
  let settled: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  const controllers = new Set<AbortController>();
  let closing: Promise<void> | undefined;
  let closed = false;
  const busyError = () =>
    createUserVisibleError("Session is managing MCP servers.", {
      code: "session-mcp-busy",
      params: {},
    });
  const assertOpen = () => {
    if (closed) throw new Error("Session has been closed.");
  };
  const assertIdle = () => {
    assertOpen();
    if (options.getRunning())
      throw createUserVisibleError("Session already has an active Run.", {
        code: "session-run-active",
        params: {},
      });
    if (managing || options.getBusy?.()) throw busyError();
  };
  const adopt = (snapshot: McpSnapshot) => {
    if (closed) return;
    // A newer Run invalidates an older probe even when its snapshot is identical.
    revision++;
    if (cached && isDeepStrictEqual(cached, snapshot)) return;
    cached = structuredClone(snapshot);
    options.onChange(structuredClone(cached));
  };
  const probeServers = async (skipServer?: string) => {
    const controller = new AbortController();
    controllers.add(controller);
    const connections = options.createConnections();
    try {
      await connections.connect({
        ...options.connectOptions(),
        signal: controller.signal,
        skipServer,
      });
      return connections.snapshot();
    } finally {
      try {
        await connections.close();
      } finally {
        controllers.delete(controller);
      }
    }
  };
  const manage = async <Result>(
    name: string,
    action: (connections: Connections, signal: AbortSignal, view: McpServerView) => Promise<Result>,
    management: { requireCallback?: boolean; reconnect?: boolean } = {},
  ): Promise<Result> => {
    assertIdle();
    managing = true;
    const completion = Promise.withResolvers<void>();
    settled = completion;
    const controller = new AbortController();
    controllers.add(controller);
    const connections = options.createConnections();
    let loaded = false;
    try {
      const connect = options.connectOptions();
      if (management.requireCallback && !connect.onMcpAuth)
        throw createUserVisibleError("MCP authentication requires an onMcpAuth callback.", {
          code: "mcp-auth-callback-required",
          params: {},
        });
      await probe;
      controller.signal.throwIfAborted();
      await connections.connect({
        ...connect,
        signal: controller.signal,
        onlyServer: name,
        loadOnly: !management.reconnect,
        reconnect: management.reconnect,
      });
      loaded = true;
      const view = connections.snapshot().servers.find((entry) => entry.name === name);
      if (!view)
        throw createUserVisibleError(`Unknown MCP server: ${name}`, {
          code: "mcp-unknown-server",
          params: { server: name },
        });
      return await action(connections, controller.signal, view);
    } finally {
      try {
        const snapshot = connections.snapshot();
        // Loading configuration alone must not overwrite a recorded connection status.
        const recorded = snapshot.servers.filter(
          (view) => view.status !== "failed" || view.error !== undefined,
        );
        if (loaded && !closed && (recorded.length || snapshot.configErrors.length || cached)) {
          const base =
            cached ??
            (await probeServers(name).catch((error: unknown) => {
              if (closed) return undefined;
              throw error;
            }));
          if (base && !closed) {
            controller.signal.throwIfAborted();
            adopt({
              configErrors: snapshot.configErrors,
              servers: [
                ...base.servers.filter(
                  (entry) => !recorded.some((view) => view.name === entry.name),
                ),
                ...recorded,
              ].sort((a, b) => a.name.localeCompare(b.name)),
            });
          }
        }
      } finally {
        try {
          await connections.close();
        } finally {
          controllers.delete(controller);
          managing = false;
          settled = undefined;
          completion.resolve();
        }
      }
    }
  };
  const requireValid = (view: McpServerView) => {
    if (view.error)
      throw view.errorData
        ? createUserVisibleError(view.error, view.errorData)
        : new Error(view.error);
  };
  return {
    adopt,
    get busy() {
      return managing;
    },
    async waitForIdle() {
      await settled?.promise;
    },
    async snapshot({ refresh = false }: { refresh?: boolean } = {}): Promise<McpSnapshot> {
      assertOpen();
      if (refresh && options.getRunning())
        throw createUserVisibleError("Session already has an active Run.", {
          code: "session-run-active",
          params: {},
        });
      if (refresh && !refreshing && (managing || options.getBusy?.())) throw busyError();
      if (managing && !refreshing && !cached) await settled?.promise;
      assertOpen();
      if (!refresh && cached) return structuredClone(cached);
      const ownsRefresh = refresh && !refreshing;
      if (ownsRefresh) {
        refreshing = true;
        managing = true;
        settled = Promise.withResolvers<void>();
      }
      try {
        if (!probe) {
          const startedRevision = revision;
          probe = probeServers()
            .then((snapshot) => {
              assertOpen();
              if (startedRevision === revision) adopt(snapshot);
              return cached ?? snapshot;
            })
            .finally(() => {
              probe = undefined;
            });
        }
        return structuredClone(await probe);
      } finally {
        if (ownsRefresh) {
          refreshing = false;
          managing = false;
          settled?.resolve();
          settled = undefined;
        }
      }
    },
    authenticate(name: string) {
      return manage(
        name,
        async (connections, signal, view) => {
          if (view.transport !== "http")
            throw createUserVisibleError(`MCP authentication requires an HTTP server: ${name}`, {
              code: "mcp-auth-http-required",
              params: { server: name },
            });
          requireValid(view);
          return connections.authenticate(name, signal);
        },
        { requireCallback: true },
      );
    },
    clearAuth(name: string) {
      return manage(name, async (connections, _signal, view) => {
        requireValid(view);
        await connections.clearAuth(name);
      });
    },
    reconnect(name: string) {
      return manage(
        name,
        async (_connections, _signal, view) => {
          requireValid(view);
        },
        { reconnect: true },
      );
    },
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      for (const controller of controllers) controller.abort();
      closing = Promise.resolve().then(async () => {
        await probe?.catch(() => {});
        await settled?.promise;
      });
      return closing;
    },
  };
}

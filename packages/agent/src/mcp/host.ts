import { isDeepStrictEqual } from "node:util";
import { createMcpAuthState, createMcpConnections } from "./index.ts";
import {
  readMcpConfiguration,
  configurationSignature,
  type McpConfigurationEntry,
  type McpConfigurationOptions,
} from "./configuration.ts";
import { createUserVisibleError, type CustomSessionEvent, type McpSnapshot } from "@rukie/shared";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { PreflightTool } from "../tools/support/preflight.ts";

type Connections = ReturnType<typeof createMcpConnections>;
type ConnectOptions = Parameters<Connections["connect"]>[0];
type Caller = Omit<
  ConnectOptions,
  "signal" | "onlyServer" | "skipServer" | "loadOnly" | "reconnect" | "onEvent" | "getOrigin"
> &
  Pick<ConnectOptions, "getOrigin">;

/** Caller-specific interactions and presentation, independent of transport lifetime. */
export interface McpViewOptions {
  applicationVersion?: string;
  /** Status-only Frontends may lease the global view without a selected project. */
  noProject?: boolean;
  connectOptions(): Caller;
  getRunning(): boolean;
  getBusy?(): boolean;
  onChange(snapshot: McpSnapshot): void;
  onEvent(event: CustomSessionEvent): void;
}

export interface McpHostOptions {
  /** Configures background global warming before the first Session exists. */
  configuration?: Omit<Caller, "cwd">;
  applicationVersion?: string;
}

/** One process owns transports; project views lease entries and supply operation interactions. */
export function createMcpHost(options: McpHostOptions = {}) {
  type Entry = {
    key: string;
    name: string;
    scope: string;
    connections: Connections;
    caller?: Caller;
    connecting?: Promise<void>;
    leases: Set<object>;
    timer?: ReturnType<typeof setTimeout>;
    retired: boolean;
    closing?: Promise<void>;
  };
  const limits = {
    stdio: { active: 0, maximum: 3, pending: [] as (() => void)[] },
    http: { active: 0, maximum: 8, pending: [] as (() => void)[] },
  };
  const schedule = async (transport: keyof typeof limits, connect: () => Promise<void>) => {
    const queue = limits[transport];
    if (queue.active >= queue.maximum)
      await new Promise<void>((resolve) => queue.pending.push(resolve));
    queue.active++;
    try {
      if (!closed) await connect();
    } finally {
      queue.active--;
      queue.pending.shift()?.();
    }
  };
  const entries = new Map<string, Entry>();
  const resources = new Set<Entry>();
  const current = new Map<string, Entry>();
  const views = new Set<ReturnType<typeof acquire>>();
  const statusObservers = new Set<() => void>();
  const reading = new Map<string, ReturnType<typeof readMcpConfiguration>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const assertOpen = () => {
    if (closed) throw new Error("MCP Host has been closed.");
  };
  const read = (caller: Omit<Caller, "cwd"> & { cwd?: string }) => {
    const key = configurationSignature({
      cwd: caller.cwd,
      homeDir: caller.homeDir,
      dataRoot: caller.dataRoot,
      settings: caller.settings,
      trust: caller.trustProjectMcp,
    });
    let pending = reading.get(key);
    if (!pending) {
      pending = readMcpConfiguration(caller).finally(() => reading.delete(key));
      reading.set(key, pending);
    }
    return pending;
  };
  const notify = (entry: Entry, event?: CustomSessionEvent) => {
    for (const observer of statusObservers) observer();
    for (const view of views) if (view.includes(entry)) view.changed(event);
  };
  const retire = (entry: Entry) => {
    entry.retired = true;
    clearTimeout(entry.timer);
    if (current.get(configurationSignature([entry.scope, entry.name])) === entry)
      current.delete(configurationSignature([entry.scope, entry.name]));
    return (entry.closing ??= (async () => {
      await entry.connections.waitForCalls();
      await entry.connections.close();
      if (entries.get(entry.key) === entry) entries.delete(entry.key);
      resources.delete(entry);
    })());
  };
  const obtain = (name: string, config: McpConfigurationEntry, caller: Caller): Entry => {
    const slot = configurationSignature([config.connectionScope, name]);
    const key = configurationSignature([config.connectionScope, name, config.value]);
    const existing = entries.get(key);
    if (existing && !existing.retired) {
      clearTimeout(existing.timer);
      existing.timer = undefined;
      return existing;
    }
    const previous = current.get(slot);
    if (previous) void retire(previous);
    const connections = createMcpConnections(
      createMcpAuthState(),
      options.applicationVersion ?? [...views][0]?.applicationVersion,
    );
    const entry: Entry = {
      key,
      name,
      scope: config.connectionScope,
      connections,
      leases: new Set(),
      retired: false,
    };
    entries.set(key, entry);
    resources.add(entry);
    current.set(slot, entry);
    const connect: ConnectOptions = {
      ...caller,
      // Connections always prepare authentication declarations; each view controls exposure.
      interactive: true,
      get onMcpAuth() {
        return entry.caller?.onMcpAuth;
      },
      get onInteractionStart() {
        return entry.caller?.onInteractionStart;
      },
      get getOrigin() {
        return entry.caller?.getOrigin;
      },
      onWarning: (message) => {
        const listeners = [...views].filter((view) => view.includes(entry));
        if (!listeners.length) (options.configuration?.onWarning ?? caller.onWarning)?.(message);
        else for (const view of listeners) view.warning(message);
      },
      onEvent: (event) => notify(entry, event),
      onChange: () => notify(entry),
      configuration: { servers: new Map([[name, config]]), configErrors: [] },
    };
    const transport =
      typeof config.value === "object" && config.value !== null && "url" in config.value
        ? "http"
        : "stdio";
    entry.connecting = schedule(transport, () => connections.connect(connect)).finally(() => {
      entry.connecting = undefined;
      notify(entry);
    });
    return entry;
  };
  const release = (entry: Entry, lease: object) => {
    entry.leases.delete(lease);
    if (entry.scope !== "global" && !entry.leases.size && !entry.retired && !entry.timer)
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        if (!entry.leases.size) void retire(entry);
      }, 30_000);
    entry.timer?.unref?.();
  };
  const refreshGlobals = async (caller: Caller) => {
    const configuration = await read({ ...caller, cwd: undefined });
    assertOpen();
    const desired = new Set<string>();
    for (const [name, config] of configuration.servers) {
      if (config.connectionScope !== "global") continue;
      desired.add(name);
      obtain(name, config, caller);
    }
    for (const entry of current.values())
      if (entry.scope === "global" && !desired.has(entry.name)) void retire(entry);
    return configuration;
  };
  const describe = (
    name: string,
    config: McpConfigurationEntry,
  ): McpSnapshot["servers"][number] => {
    const value = config.value;
    const http = typeof value === "object" && value !== null && "url" in value;
    return {
      name,
      scope: config.scope,
      configPath: config.configPath,
      transport: http ? "http" : "stdio",
      status: config.connectionScope === "project-required" ? "project-required" : "pending",
      auth: "none",
      tools: [],
      toolCount: 0,
    };
  };
  /** Read existing connection facts without obtaining a lease or starting a transport. */
  const inspect = async (input: McpConfigurationOptions): Promise<McpSnapshot> => {
    assertOpen();
    const configuration = await read(input);
    assertOpen();
    return {
      configErrors: structuredClone(configuration.configErrors),
      servers: [...configuration.servers]
        .map(([name, config]) => {
          const key = configurationSignature([config.connectionScope, name, config.value]);
          const entry = entries.get(key);
          return (
            (!entry?.retired && entry?.connections.snapshot().servers[0]) || describe(name, config)
          );
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  };
  function acquire(viewOptions: McpViewOptions) {
    assertOpen();
    const lease = {};
    const selected = new Map<string, Entry>();
    const tools: ToolRegistration[] = [];
    const toolServers = new Map<string, string>();
    const authTools = new Set<string>();
    const controller = new AbortController();
    const operations = new Set<Promise<unknown>>();
    let publishing = false;
    let adopted: McpSnapshot | undefined;
    const seenEvents = new Set<string>();
    let getOrigin: ConnectOptions["getOrigin"];
    const callerOptions = () => ({ ...viewOptions.connectOptions(), getOrigin });
    let configErrors: McpSnapshot["configErrors"] = [];
    let deferred: McpSnapshot["servers"] = [];
    let closingView: Promise<void> | undefined;
    let released = false;
    let stopping = false;
    let admittingManagement = false;
    let statusRefresh: Promise<McpSnapshot> | undefined;
    let refreshing: Promise<void> | undefined;
    const ensureOpen = () => {
      if (released || closed) throw new Error("MCP view has been closed.");
    };
    const snapshot = (): McpSnapshot => ({
      servers: [
        ...deferred,
        ...[...selected.values()].flatMap((entry) => entry.connections.snapshot().servers),
      ].sort((a, b) => a.name.localeCompare(b.name)),
      configErrors: structuredClone(configErrors),
    });
    const rebuild = () => {
      tools.length = 0;
      toolServers.clear();
      authTools.clear();
      for (const [name, entry] of selected) {
        for (const registration of entry.connections.tools) {
          if (entry.connections.authTools.has(registration.name)) {
            if (!viewOptions.connectOptions().onMcpAuth) continue;
            authTools.add(registration.name);
          }
          // MCP's optional preflight capability is attached to native ToolRegistration objects.
          const tool: ToolRegistration & Partial<Pick<PreflightTool, "preflight">> = registration;
          // A declaration belongs to this view; the transport and active call accounting are shared.
          tools.push({
            ...tool,
            ...(tool.preflight && {
              preflight: (...args: Parameters<NonNullable<typeof tool.preflight>>) => {
                entry.caller = callerOptions();
                return tool.preflight!(...args);
              },
            }),
            execute: (...args: Parameters<typeof tool.execute>) => {
              entry.caller = callerOptions();
              return tool.execute(...args);
            },
          });
          toolServers.set(registration.name, name);
        }
      }
    };
    const changed = (event?: CustomSessionEvent) => {
      if (
        released ||
        stopping ||
        admittingManagement ||
        operations.size ||
        [...selected.values()].some((entry) => entry.retired)
      )
        return;
      rebuild();
      if (event) {
        const key = configurationSignature(event);
        if (!seenEvents.has(key)) {
          seenEvents.add(key);
          viewOptions.onEvent(event);
        }
      }
      const next = snapshot();
      if (!isDeepStrictEqual(adopted, next)) {
        adopted = structuredClone(next);
        publishing = true;
        try {
          viewOptions.onChange(next);
        } finally {
          publishing = false;
        }
      }
    };
    const refresh = () => {
      ensureOpen();
      return (refreshing ??= (async () => {
        const caller = viewOptions.connectOptions();
        await refreshGlobals(caller);
        const configuration = await read({
          ...caller,
          ...(viewOptions.noProject ? { cwd: undefined } : {}),
        });
        ensureOpen();
        configErrors = configuration.configErrors;
        const next = new Map<string, Entry>();
        deferred = [];
        for (const [name, config] of configuration.servers) {
          if (config.connectionScope === "project-required") {
            deferred.push(describe(name, config));
            continue;
          }
          const entry = obtain(name, config, caller);
          entry.leases.add(lease);
          next.set(name, entry);
        }
        for (const [name, entry] of selected) if (next.get(name) !== entry) release(entry, lease);
        selected.clear();
        for (const [name, entry] of next) selected.set(name, entry);
        for (const entry of selected.values()) {
          for (const event of [...entry.connections.errors, ...entry.connections.authRequired]) {
            const key = configurationSignature(event);
            if (!seenEvents.has(key)) {
              seenEvents.add(key);
              viewOptions.onEvent(event);
            }
          }
        }
        for (const error of configErrors) {
          const event = {
            type: "mcp_server_error",
            server: error.path,
            error: error.error,
            ...(error.errorData && { errorData: error.errorData }),
          } as const;
          const key = configurationSignature(event);
          if (!seenEvents.has(key)) {
            seenEvents.add(key);
            viewOptions.onEvent(event);
            caller.onWarning?.(`MCP server ${error.path}: ${error.error}`);
          }
        }
        ensureOpen();
        changed();
        for (const observer of statusObservers) observer();
      })().finally(() => {
        refreshing = undefined;
      }));
    };
    const wait = async <T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> => {
      signal?.throwIfAborted();
      if (!signal) return pending;
      const cancelled = Promise.withResolvers<never>();
      const abort = () => cancelled.reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      try {
        return await Promise.race([pending, cancelled.promise]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    };
    const settleConnections = (signal?: AbortSignal) =>
      wait(
        Promise.all(
          [...selected.values()].map(async (entry) => {
            await entry.connecting;
            await entry.connections.waitForReady();
          }),
        ),
        signal,
      );
    const manage = async <T>(
      name: string,
      action: (entry: Entry) => Promise<T>,
      requireHttp = false,
    ): Promise<T> => {
      ensureOpen();
      if (viewOptions.getRunning())
        throw createUserVisibleError("Session already has an active Run.", {
          code: "session-run-active",
          params: {},
        });
      if (viewOptions.getBusy?.())
        throw createUserVisibleError("Session is managing MCP servers.", {
          code: "session-mcp-busy",
          params: {},
        });
      if (operations.size || admittingManagement || statusRefresh)
        throw createUserVisibleError("Session is managing MCP servers.", {
          code: "session-mcp-busy",
          params: {},
        });
      if (requireHttp && !viewOptions.connectOptions().onMcpAuth)
        throw createUserVisibleError("MCP authentication requires an onMcpAuth callback.", {
          code: "mcp-auth-callback-required",
          params: {},
        });
      admittingManagement = true;
      try {
        const configuration = await read(viewOptions.connectOptions());
        const definition = configuration.servers.get(name);
        if (!definition)
          throw createUserVisibleError(`Unknown MCP server: ${name}`, {
            code: "mcp-unknown-server",
            params: { server: name },
          });
        if (
          requireHttp &&
          !(
            typeof definition.value === "object" &&
            definition.value !== null &&
            "url" in definition.value
          )
        )
          throw createUserVisibleError(`MCP authentication requires an HTTP server: ${name}`, {
            code: "mcp-auth-http-required",
            params: { server: name },
          });
        await refresh();
        ensureOpen();
        controller.signal.throwIfAborted();
        const entry = selected.get(name);
        if (!entry)
          throw createUserVisibleError(`Unknown MCP server: ${name}`, {
            code: "mcp-unknown-server",
            params: { server: name },
          });
        await entry.connecting;
        ensureOpen();
        controller.signal.throwIfAborted();
        const fact = entry.connections.snapshot().servers[0];
        if (fact?.error && fact.errorData?.code.startsWith("mcp-config"))
          throw fact.errorData
            ? createUserVisibleError(fact.error, fact.errorData)
            : new Error(fact.error);
        if (
          [...entries.values()].some(
            (candidate) =>
              candidate.name === name &&
              candidate.scope === entry.scope &&
              candidate.connections.activeCalls,
          ) ||
          (!requireHttp && entry.connections.authenticating)
        )
          throw createUserVisibleError("MCP server has active calls.", {
            code: "session-mcp-busy",
            params: {},
          });
        entry.caller = callerOptions();
        const operation = action(entry);
        operations.add(operation);
        admittingManagement = false;
        try {
          return await operation;
        } finally {
          operations.delete(operation);
          notify(entry);
          changed();
        }
      } finally {
        admittingManagement = false;
      }
    };
    const view = {
      applicationVersion: viewOptions.applicationVersion,
      tools,
      toolServers,
      authTools,
      includes: (entry: Entry) => [...selected.values()].includes(entry),
      warning: (message: string) => viewOptions.connectOptions().onWarning?.(message),
      changed,
      get hasServers() {
        return selected.size > 0;
      },
      get busy() {
        return admittingManagement || operations.size > 0 || !!statusRefresh;
      },
      reminder: () =>
        selected.size
          ? `MCP servers:\n${[...selected.values()].map((entry) => (entry.connections.authTools.size && !viewOptions.connectOptions().onMcpAuth ? `${entry.name}: requires authentication.` : entry.connections.reminder().replace(/^MCP servers:\n/, ""))).join("\n\n")}`
          : "MCP servers: none.",
      callHookTool: (
        name: string,
        tool: string,
        input: Record<string, unknown>,
        signal: AbortSignal,
      ) => {
        const entry = selected.get(name);
        if (!entry)
          return Promise.reject(
            createUserVisibleError(`Hook MCP server is not connected: ${name}`, {
              code: "hook-mcp-unconnected",
              params: { server: name },
            }),
          );
        return entry.connections.callHookTool(name, tool, input, signal);
      },
      /** Ordinary state reads expose pending immediately; explicit idle refresh waits for readiness. */
      snapshot({ refresh: force = false }: { refresh?: boolean } = {}): Promise<McpSnapshot> {
        if (publishing && !force) return Promise.resolve(structuredClone(snapshot()));
        const operation = async () => {
          if (force && viewOptions.getRunning())
            throw createUserVisibleError("Session already has an active Run.", {
              code: "session-run-active",
              params: {},
            });
          ensureOpen();
          await refresh();
          if (force) await settleConnections(controller.signal);
          ensureOpen();
          changed();
          return structuredClone(snapshot());
        };
        if (!force) return operation();
        if (statusRefresh) return statusRefresh;
        if (operations.size || admittingManagement)
          return Promise.reject(
            createUserVisibleError("Session is managing MCP servers.", {
              code: "session-mcp-busy",
              params: {},
            }),
          );
        return (statusRefresh = operation().finally(() => {
          statusRefresh = undefined;
        }));
      },
      authenticate: (name: string) =>
        manage(
          name,
          (entry) => entry.connections.authenticate(name, controller.signal),
          true,
        ).catch((error: unknown) => {
          if (controller.signal.aborted) return { type: "cancelled" as const, server: name };
          throw error;
        }),
      clearAuth: (name: string) =>
        manage(name, async (entry) => {
          await entry.connecting;
          await entry.connections.clearAuth(name);
        }),
      reconnect: (name: string) =>
        manage(name, async (entry) => {
          if (operations.size)
            throw createUserVisibleError("Session is managing MCP servers.", {
              code: "session-mcp-busy",
              params: {},
            });
          await retire(entry);
          selected.delete(name);
          await refresh();
          await Promise.all([...selected.values()].map((next) => next.connecting));
        }),
      /** Finish accepted list changes without tying shared transport work to this Turn's signal. */
      async prepareTurn(signal?: AbortSignal) {
        await wait(
          Promise.all([...selected.values()].map((entry) => entry.connections.waitForToolSync())),
          signal,
        );
        ensureOpen();
        changed();
      },
      async prepareRun(
        input: { signal?: AbortSignal; getOrigin?: ConnectOptions["getOrigin"] } = {},
      ) {
        ensureOpen();
        getOrigin = input.getOrigin;
        await wait(refresh(), input.signal);
        await settleConnections(input.signal);
        ensureOpen();
        // Re-read after discovery so configuration changes while waiting apply to this Run.
        await wait(refresh(), input.signal);
        await settleConnections(input.signal);
        ensureOpen();
        for (const entry of selected.values()) entry.caller = callerOptions();
        changed();
      },
      adopt: () => changed(),
      async waitForIdle() {
        await Promise.allSettled(operations);
      },
      async stopManagement() {
        stopping = true;
        controller.abort();
        await Promise.allSettled(operations);
      },
      close(): Promise<void> {
        if (closingView) return closingView;
        released = true;
        controller.abort();
        return (closingView = (async () => {
          await Promise.allSettled(operations);
          // A released waiter never holds shared transport preparation open.
          void refreshing?.catch(() => {});
          for (const entry of selected.values()) release(entry, lease);
          selected.clear();
          views.delete(view);
        })());
      },
    };
    views.add(view);
    return view;
  }
  const ready = options.configuration
    ? refreshGlobals({ ...options.configuration, cwd: options.configuration.homeDir })
        .then(async () => {
          await Promise.all([...entries.values()].map((entry) => entry.connecting));
        })
        .catch((error: unknown) => {
          // Shutdown can finish while asynchronous configuration discovery is pending.
          if (closed) return;
          options.configuration?.onWarning?.(
            `MCP startup: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
    : Promise.resolve();
  return {
    acquire,
    inspect,
    /** Observe current facts without acquiring any connection lease. Configuration is read on each change. */
    observe(input: McpConfigurationOptions, onChange: (snapshot: McpSnapshot) => void) {
      assertOpen();
      let disposed = false;
      let revision = 0;
      let adopted: McpSnapshot | undefined;
      const changed = () => {
        const currentRevision = ++revision;
        void inspect(input)
          .then((snapshot) => {
            if (
              !closed &&
              !disposed &&
              currentRevision === revision &&
              !isDeepStrictEqual(adopted, snapshot)
            ) {
              adopted = structuredClone(snapshot);
              onChange(snapshot);
            }
          })
          .catch(() => {});
      };
      statusObservers.add(changed);
      return {
        snapshot: () => inspect(input),
        close: async () => {
          disposed = true;
          statusObservers.delete(changed);
        },
      };
    },
    ready,
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      statusObservers.clear();
      return (closing = (async () => {
        await Promise.allSettled([...views].map((view) => view.close()));
        await Promise.allSettled(
          [...resources].map((entry) => {
            clearTimeout(entry.timer);
            // Process disposal cancels transports immediately, including in-flight calls.
            return entry.connections.close();
          }),
        );
        await ready;
      })());
    },
  };
}

export type McpHost = ReturnType<typeof createMcpHost>;

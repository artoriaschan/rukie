import { WIRE_SUBPROTOCOL, type WireCommand, type WireErrorCode } from "@rukie/shared";
import type { DesktopHost } from "../host";

export type ConnectionState = "connected" | "reconnecting" | "disconnected";
export type ClientCommand = WireCommand extends infer C
  ? C extends WireCommand
    ? Omit<C, "id">
    : never
  : never;
export class WireError extends Error {
  constructor(readonly code: WireErrorCode | "disconnected" | "superseded") {
    super(code);
  }
}
/** One socket owns request correlation and subscriptions. Every reconnect reads the host again. */
export function createWireClient(host: Pick<DesktopHost, "getConnection">) {
  let socket: WebSocket | undefined;
  let state: ConnectionState = "disconnected";
  let generation = 0;
  let stopped = false;
  let reconnecting = false;
  let connecting: Promise<void> | undefined;
  const subscriptions = new Set<string>();
  const subscriptionListeners = new Set<(sessionId: string, busy: boolean) => void>();
  const subscribeSession = async (sessionId: string) => {
    try {
      await request({ type: "session.subscribe", sessionId });
      for (const listener of subscriptionListeners) listener(sessionId, false);
    } catch (error) {
      if (error instanceof WireError && error.code === "session_busy")
        for (const listener of subscriptionListeners) listener(sessionId, true);
      throw error;
    }
  };
  const stateListeners = new Set<() => void>();
  const messageListeners = new Set<(message: unknown) => void>();
  const pending = new Map<
    string,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  const setState = (next: ConnectionState) => {
    state = next;
    for (const listener of stateListeners) listener();
  };
  const rejectPending = (code: "disconnected" | "superseded") => {
    for (const value of pending.values()) value.reject(new WireError(code));
    pending.clear();
  };
  const request = (command: ClientCommand): Promise<unknown> => {
    if (socket?.readyState !== WebSocket.OPEN || state !== "connected")
      return Promise.reject(new WireError("disconnected"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket!.send(JSON.stringify({ ...command, id }));
    });
  };
  const connect = (): Promise<void> => {
    if (connecting) return connecting;
    if (state === "connected" && socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    stopped = false;
    const attempt = ++generation;
    setState("reconnecting");
    connecting = (async () => {
      const connection = await host.getConnection();
      if (attempt !== generation || stopped) return;
      await new Promise<void>((resolve, reject) => {
        const current = new WebSocket(`ws://127.0.0.1:${connection.port}/ws`, [
          WIRE_SUBPROTOCOL,
          `rukie.auth.${connection.token}`,
        ]);
        socket = current;
        current.addEventListener("message", (event) => {
          if (attempt !== generation) return;
          let message: unknown;
          try {
            message = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (typeof message !== "object" || message === null || !("type" in message)) return;
          if (message.type === "response" && "id" in message && typeof message.id === "string") {
            const waiter = pending.get(message.id);
            if (!waiter) return;
            pending.delete(message.id);
            if (
              "error" in message &&
              typeof message.error === "object" &&
              message.error !== null &&
              "code" in message.error &&
              typeof message.error.code === "string"
            ) {
              const code = message.error.code;
              waiter.reject(new WireError(isErrorCode(code) ? code : "invalid_command"));
            } else waiter.resolve("result" in message ? message.result : undefined);
          } else for (const listener of messageListeners) listener(message);
        });
        current.addEventListener("open", () => {
          if (attempt !== generation) {
            current.close();
            return;
          }
          setState("connected");
          reconnecting = false;
          for (const sessionId of subscriptions) void subscribeSession(sessionId).catch(() => {});
          resolve();
        });
        current.addEventListener("error", () => reject(new WireError("disconnected")), {
          once: true,
        });
        current.addEventListener("close", (event) => {
          if (attempt !== generation) return;
          socket = undefined;
          rejectPending(event.reason === "superseded" ? "superseded" : "disconnected");
          reject(new WireError("disconnected"));
          if (event.reason === "superseded" || stopped || reconnecting) {
            stopped = true;
            setState("disconnected");
            return;
          }
          reconnecting = true;
          setState("reconnecting");
          void Promise.resolve()
            .then(() => connect())
            .catch(() => {});
        });
      });
    })()
      .catch((error) => {
        if (attempt === generation) setState("disconnected");
        throw error;
      })
      .finally(() => {
        if (attempt === generation) connecting = undefined;
      });
    return connecting;
  };
  const close = () => {
    stopped = true;
    generation++;
    socket?.close();
    socket = undefined;
    connecting = undefined;
    rejectPending("disconnected");
    setState("disconnected");
  };
  return {
    connect,
    request,
    close,
    getState: () => state,
    subscribeState: (listener: () => void) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeMessages: (listener: (message: unknown) => void) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    subscribeSubscriptions: (listener: (sessionId: string, busy: boolean) => void) => {
      subscriptionListeners.add(listener);
      return () => subscriptionListeners.delete(listener);
    },
    subscribe: async (sessionId: string) => {
      subscriptions.add(sessionId);
      if (state === "connected") await subscribeSession(sessionId);
    },
    unsubscribe: async (sessionId: string) => {
      subscriptions.delete(sessionId);
      if (state === "connected") await request({ type: "session.unsubscribe", sessionId });
    },
    hostState: (next: ConnectionState) => {
      if (next === "disconnected") close();
      else if (next === "reconnecting") {
        close();
        stopped = false;
        setState("reconnecting");
      } else void connect().catch(() => {});
    },
  };
}

function isErrorCode(code: string): code is WireErrorCode {
  return (
    code === "session_busy" ||
    code === "session_not_found" ||
    code === "project_not_found" ||
    code === "invalid_command" ||
    code === "not_queued" ||
    code === "interaction_stale" ||
    code === "internal"
  );
}

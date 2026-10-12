import type { WireCommand } from "@rukie/shared";

/** Seed only through the authenticated browser command boundary; drain the socket before UI connects. */
export async function seedIsolatedProvider(
  connection: { port: number; token: string },
  baseUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const socket = new WebSocket(`ws://127.0.0.1:${connection.port}/ws`, {
    protocols: ["rukie.v1", `rukie.auth.${connection.token}`],
    headers: { Origin: "http://localhost:5173" },
  });
  const closed = new Promise<void>((resolve) =>
    socket.addEventListener("close", () => resolve(), { once: true }),
  );
  const command: Extract<WireCommand, { type: "modelServices.save" }> = {
    id: crypto.randomUUID(),
    type: "modelServices.save",
    provider: {
      id: "isolated",
      name: "Isolated acceptance",
      api: "openai-responses",
      baseUrl,
      models: [
        { id: "isolated-reply", name: "Isolated reply", contextWindow: 32768, maxTokens: 1024 },
      ],
    },
    credential: { type: "replace", value: "fabricated" },
  };
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(new Error("Isolated provider setup cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      socket.addEventListener(
        "error",
        () => reject(new Error("Isolated provider connection failed")),
        { once: true },
      );
      socket.addEventListener(
        "close",
        () => reject(new Error("Isolated provider connection closed")),
        { once: true },
      );
      socket.addEventListener("open", () => socket.send(JSON.stringify(command)), { once: true });
      socket.addEventListener("message", (event) => {
        try {
          const message: unknown = JSON.parse(String(event.data));
          if (
            !message ||
            typeof message !== "object" ||
            !("type" in message) ||
            message.type !== "response" ||
            !("id" in message) ||
            message.id !== command.id
          )
            return;
          if ("error" in message && message.error)
            reject(new Error("Isolated provider setup rejected"));
          else resolve();
        } catch {
          reject(new Error("Invalid isolated provider response"));
        }
      });
    });
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    socket.close();
    await closed;
  }
}

import { startServer, type ServerOptions } from "./server.ts";

/** Signals wait for Session cancellation and resource release before the sidecar exits. */
export async function runServer(options: ServerOptions) {
  const server = await startServer(options);
  const shutdown = () => {
    void server.close().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

import { homedir } from "node:os";
import { startServer } from "./server.ts";

const server = await startServer({
  homeDir: homedir(),
  development: process.argv.includes("--dev"),
});
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

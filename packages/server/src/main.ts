import { homedir } from "node:os";
import { runServer } from "./process.ts";

const dataRoot = process.env.RUKIE_DESKTOP_DATA_ROOT;
if (!dataRoot) throw new Error("Desktop sidecar requires an explicit application data root.");
await runServer({
  homeDir: process.env.RUKIE_DESKTOP_HOME_DIR ?? homedir(),
  dataRoot,
  development: process.argv.includes("--dev"),
});

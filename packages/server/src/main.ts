import { homedir } from "node:os";
import { runServer } from "./process.ts";
import { privateSecretEncryption } from "./storage/secrets.ts";

const dataRoot = process.env.RUKIE_DESKTOP_DATA_ROOT;
if (!dataRoot) throw new Error("Desktop sidecar requires an explicit application data root.");
const secretUrl = process.env.RUKIE_DESKTOP_SECRET_URL;
const secretToken = process.env.RUKIE_DESKTOP_SECRET_TOKEN;
const managementToken = process.env.RUKIE_DESKTOP_MANAGEMENT_TOKEN;
// Tools retain the normal system environment, without private channel capabilities.
for (const name of [
  "RUKIE_DESKTOP_SECRET_URL",
  "RUKIE_DESKTOP_SECRET_TOKEN",
  "RUKIE_DESKTOP_MANAGEMENT_TOKEN",
])
  delete process.env[name];
await runServer({
  homeDir: process.env.RUKIE_DESKTOP_HOME_DIR ?? homedir(),
  dataRoot,
  managementToken,
  encryption:
    secretUrl && secretToken ? privateSecretEncryption(secretUrl, secretToken) : undefined,
  development: process.argv.includes("--dev"),
});

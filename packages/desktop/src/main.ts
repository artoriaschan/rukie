import { app } from "electron";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startDesktop } from "./main/desktop.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = app.getAppPath();
void startDesktop({
  rendererDirectory: app.isPackaged ? join(root, "dist") : resolve(here, "../../ui/dist"),
  preload: join(here, "preload.cjs"),
  userDataDirectory: process.env.RUKIE_DESKTOP_USER_DATA,
  sidecar: app.isPackaged
    ? { command: join(process.resourcesPath, "sidecar/rukie-server"), args: [] }
    : {
        command: process.env.RUKIE_DESKTOP_BUN ?? "bun",
        args: [resolve(here, "../../server/src/main.ts")],
        cwd: resolve(here, "../../.."),
      },
}).catch((error: unknown) => {
  console.error(error);
  app.quit();
});

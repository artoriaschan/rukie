import { app } from "electron";
import { join } from "node:path";
import { startDesktop } from "./main/desktop.ts";

declare const RUKIE_DESKTOP_DEVELOPMENT_ROOT: string;
const root = RUKIE_DESKTOP_DEVELOPMENT_ROOT;
const local = join(root, ".desktop-dev");
// Electron 41 configures macOS OSCrypt service/account from Browser::GetName after main runs.
app.setName("rukie-desktop-development");
app.setPath("sessionData", join(local, "session"));
const quit = () => app.quit();
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
app.on("will-quit", () => {
  process.off("SIGINT", quit);
  process.off("SIGTERM", quit);
});
void startDesktop({
  rendererDirectory: join(local, "build/renderer"),
  preload: join(local, "build/preload.cjs"),
  userDataDirectory: join(local, "electron"),
  dataRoot: join(local, "data"),
  sidecar: { command: join(local, "build/rukie-server"), args: [], cwd: root },
})
  .then(({ window }) => window?.webContents.openDevTools({ mode: "detach" }))
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });

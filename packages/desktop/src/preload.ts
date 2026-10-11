import { contextBridge, ipcRenderer } from "electron";
import type { DesktopHost } from "@rukie/ui";

const host: DesktopHost = {
  getConnection: () => ipcRenderer.invoke("rukie:getConnection"),
  pickProjectFolder: () => ipcRenderer.invoke("rukie:pickProjectFolder"),
  revealPath: (path) => ipcRenderer.invoke("rukie:revealPath", path),
  openInTerminal: (path) => ipcRenderer.invoke("rukie:openInTerminal", path),
};
contextBridge.exposeInMainWorld("rukieHost", host);
// Notifications add no callable native capability to the four-method host interface.
ipcRenderer.on("rukie:connection-change", (_event, state: unknown) => {
  if (state === "connected" || state === "disconnected" || state === "reconnecting")
    window.dispatchEvent(new CustomEvent("rukie:connection-change", { detail: state }));
});

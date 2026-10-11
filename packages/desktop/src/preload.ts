import { contextBridge, ipcRenderer } from "electron";
import type { DesktopHost } from "@rukie/ui";

const host: DesktopHost = {
  getConnection: () => ipcRenderer.invoke("rukie:getConnection"),
  pickProjectFolder: () => ipcRenderer.invoke("rukie:pickProjectFolder"),
  revealPath: (path) => ipcRenderer.invoke("rukie:revealPath", path),
  openInTerminal: (path) => ipcRenderer.invoke("rukie:openInTerminal", path),
  modelServices: {
    list: () => ipcRenderer.invoke("rukie:modelServices:list"),
    save: (input) => ipcRenderer.invoke("rukie:modelServices:save", input),
    delete: (id) => ipcRenderer.invoke("rukie:modelServices:delete", id),
  },
};
contextBridge.exposeInMainWorld("rukieHost", host);
// Notifications add no callable native capability.
ipcRenderer.on("rukie:connection-change", (_event, state: unknown) => {
  if (state === "connected" || state === "disconnected" || state === "reconnecting")
    window.dispatchEvent(new CustomEvent("rukie:connection-change", { detail: state }));
});

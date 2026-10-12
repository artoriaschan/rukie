import { contextBridge, ipcRenderer } from "electron";
import type { DesktopHost } from "@rukie/ui";

const host: DesktopHost = {
  getConnection: () => ipcRenderer.invoke("rukie:getConnection"),
  pickProjectFolder: () => ipcRenderer.invoke("rukie:pickProjectFolder"),
  modelServices: {
    prices: (input) => ipcRenderer.invoke("rukie:modelServices:prices", input),
    revealKey: (id) => ipcRenderer.invoke("rukie:modelServices:revealKey", id),
    templates: () => ipcRenderer.invoke("rukie:modelServices:templates"),
    test: (id, modelId) => ipcRenderer.invoke("rukie:modelServices:test", id, modelId),
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

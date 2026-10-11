/** Native capabilities are injected by the Electron or browser entry. */
export interface DesktopHost {
  getConnection(): Promise<{ port: number; token: string }>;
  pickProjectFolder(): Promise<string | null>;
  revealPath(path: string): Promise<void>;
  openInTerminal(path: string): Promise<void>;
}

export function browserHost(): Pick<DesktopHost, "getConnection"> {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const port = Number(parameters.get("port"));
  const token = parameters.get("token") ?? "";
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return {
    getConnection: async () => {
      if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token)
        throw new Error("Missing development connection fragment");
      return { port, token };
    },
  };
}
declare global {
  interface Window {
    rukieHost?: DesktopHost;
  }
}

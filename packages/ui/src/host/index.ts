/** Native capabilities are injected by the Electron or browser entry. */
export interface DesktopHost {
  getConnection(): Promise<{ port: number; token: string }>;
  pickProjectFolder(): Promise<string | null>;
  revealPath(path: string): Promise<void>;
  openInTerminal(path: string): Promise<void>;
}

declare module "vitest/browser" {
  interface BrowserCommands {
    startWire(): Promise<{ port: number; token: string }>;
    stopWire(port: number): Promise<void>;
  }
}
export {};

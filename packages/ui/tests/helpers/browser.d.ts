declare module "vitest/browser" {
  interface BrowserCommands {
    reducedMotion(reduced: boolean): Promise<void>;
    startWire(): Promise<{ port: number; token: string }>;
    stopWire(port: number): Promise<void>;
  }
}
export {};

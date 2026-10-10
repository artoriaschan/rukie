import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

export interface SidecarConnection {
  port: number;
  token: string;
}
export interface SidecarOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  onChange?: (state: "connected" | "disconnected" | "reconnecting") => void;
}

/** Owns one child, including its exit and the single automatic recovery attempt. */
export class Sidecar {
  private child?: ChildProcess;
  private connection?: SidecarConnection;
  private starting?: Promise<SidecarConnection>;
  private stopping?: Promise<void>;
  private automaticRestarts = 0;
  private intentionalStop = false;
  constructor(private readonly options: SidecarOptions) {}

  getConnection(): Promise<SidecarConnection> {
    if (this.stopping) return this.stopping.then(() => this.getConnection());
    if (this.connection) return Promise.resolve(this.connection);
    if (this.starting) return this.starting;
    this.automaticRestarts = 0;
    this.intentionalStop = false;
    return this.start();
  }

  private start(): Promise<SidecarConnection> {
    this.options.onChange?.("reconnecting");
    const env = { ...(this.options.env ?? process.env) };
    for (const name of Object.keys(env)) {
      if (["BUN_BE_BUN", "BUN_OPTIONS", "NODE_OPTIONS"].includes(name) || name.startsWith("DYLD_"))
        delete env[name];
    }
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    // Drain diagnostics without forwarding secrets or blocking the child on a full pipe.
    child.stderr?.resume();
    const lines = createInterface({ input: child.stdout! });
    let ready = false;
    const promise = new Promise<SidecarConnection>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Sidecar handshake timed out"));
        void this.stop();
      }, 10_000);
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      child.once("error", (error) => {
        if (this.child === child) this.child = undefined;
        lines.close();
        this.options.onChange?.("disconnected");
        fail(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        lines.close();
        if (this.child === child) {
          this.child = undefined;
          this.connection = undefined;
        }
        if (!ready) reject(new Error("Sidecar exited before handshake"));
        if (this.intentionalStop) return;
        this.options.onChange?.("disconnected");
        if (this.automaticRestarts++ === 0) {
          // Clear the completed start before acquiring the replacement child.
          this.starting = undefined;
          void this.start().catch(() => this.options.onChange?.("disconnected"));
        }
      });
      lines.on("line", (line) => {
        if (ready || this.intentionalStop) return;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          return;
        }
        if (
          typeof value !== "object" ||
          value === null ||
          !("port" in value) ||
          !("token" in value) ||
          typeof value.port !== "number" ||
          !Number.isInteger(value.port) ||
          value.port < 1 ||
          value.port > 65535 ||
          typeof value.token !== "string" ||
          value.token.length === 0
        )
          return;
        ready = true;
        clearTimeout(timer);
        this.connection = { port: value.port, token: value.token };
        this.options.onChange?.("connected");
        resolve(this.connection);
      });
    });
    this.starting = promise;
    void promise
      .finally(() => {
        if (this.starting === promise) this.starting = undefined;
      })
      .catch(() => {});
    return promise;
  }

  /** Stop resolves after actual child exit; repeated calls share the same cleanup. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.intentionalStop = true;
    this.connection = undefined;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    const stopping = new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      child.once("exit", done);
      child.once("error", done);
      child.kill("SIGTERM");
    });
    this.stopping = stopping;
    void stopping.finally(() => {
      if (this.stopping === stopping) this.stopping = undefined;
    });
    return stopping;
  }
}

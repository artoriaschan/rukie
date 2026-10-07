import { afterEach, beforeEach } from "bun:test";

const proxyVariables = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

/** Isolate local HTTP fixtures from the developer's proxy environment. */
export function isolateProxyEnvironment() {
  let saved: (string | undefined)[];
  beforeEach(() => {
    saved = proxyVariables.map((name) => process.env[name]);
    for (const name of proxyVariables) delete process.env[name];
  });
  afterEach(() => {
    for (const [index, name] of proxyVariables.entries()) {
      const value = saved[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

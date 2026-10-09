// Bun substitutes the bare undici import with a stub that ignores connect.lookup.
// Bun's global fetch also ignores dispatcher; use the real package's fetch and Agent.
import { Agent, EnvHttpProxyAgent, fetch } from "undici/index.js";
import type { Address } from "./addresses.ts";
import type { ProxyOptions } from "./proxy.ts";

function directAgent(addresses: Address[]) {
  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        if (typeof options === "object" && options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
    },
  });
}

export async function request(
  url: URL,
  addresses: Address[],
  signal: AbortSignal,
  proxy?: ProxyOptions,
  applicationVersion?: string,
) {
  const agent = proxy ? new EnvHttpProxyAgent(proxy) : directAgent(addresses);
  try {
    const response = await fetch(url, {
      dispatcher: agent,
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": applicationVersion ? `Rukie/${applicationVersion}` : "Rukie",
        Accept: "text/markdown, text/html;q=0.9, */*;q=0.8",
      },
    });
    return { response, close: () => agent.destroy() };
  } catch (error) {
    await agent.destroy();
    throw error;
  }
}

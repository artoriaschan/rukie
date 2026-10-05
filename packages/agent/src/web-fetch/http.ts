// Bun substitutes the bare undici import with a stub that ignores connect.lookup.
// Bun's global fetch also ignores dispatcher; use the real package's fetch and Agent.
import { Agent, fetch } from "undici/index.js";
import { version } from "../../package.json";
import type { Address } from "./addresses.ts";

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

export async function request(url: URL, addresses: Address[], signal: AbortSignal) {
  const agent = directAgent(addresses);
  try {
    const response = await fetch(url, {
      dispatcher: agent,
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": `Neant/${version}`,
        Accept: "text/markdown, text/html;q=0.9, */*;q=0.8",
      },
    });
    return { response, close: () => agent.destroy() };
  } catch (error) {
    await agent.destroy();
    throw error;
  }
}

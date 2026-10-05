import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface Address {
  address: string;
  family: number;
}
export interface WebFetchOptions {
  resolve?: (host: string) => Promise<Address[]>;
  allowAddresses?: string[];
  timeoutMs?: number;
  maxBytes?: number;
}

export function validateUrl(input: string): URL {
  if (input.length > 2048) throw new Error("Invalid URL: exceeds 2048 characters.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL: expected an absolute HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw new Error(
      "Invalid URL: only HTTP/HTTPS URLs with a host and without credentials are allowed.",
    );
  return url;
}

function ipv4(address: string): number {
  return address.split(".").reduce((value, octet) => (value * 256 + Number(octet)) >>> 0, 0);
}
function inRange(address: number, base: string, bits: number) {
  return address >>> (32 - bits) === ipv4(base) >>> (32 - bits);
}
function publicV4(address: string) {
  const value = ipv4(address);
  const denied: [string, number][] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return !denied.some(([base, bits]) => inRange(value, base, bits));
}
function publicAddress(address: string) {
  if (isIP(address) === 4) return publicV4(address);
  if (isIP(address) !== 6) return false;
  let hex = address.toLowerCase();
  if (hex.includes("."))
    hex = hex.replace(/(\d+\.\d+\.\d+\.\d+)$/, (v4) => {
      const value = ipv4(v4);
      return `${(value >>> 16).toString(16)}:${(value & 65535).toString(16)}`;
    });
  const halves = hex.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words =
    halves.length === 2
      ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
      : left;
  const value = words.reduce((total, word) => (total << 16n) | BigInt(`0x${word}`), 0n);
  if (value >> 32n === 0n || value >> 32n === 65535n)
    return publicV4(
      `${Number((value >> 24n) & 255n)}.${Number((value >> 16n) & 255n)}.${Number((value >> 8n) & 255n)}.${Number(value & 255n)}`,
    );
  // Only allocated global unicast space is eligible; exclude documentation and transition ranges.
  if (value >> 125n !== 1n) return false;
  return !(
    value >> 96n === 0x20010db8n ||
    value >> 112n === 0x2002n ||
    value >> 105n === 0x100080n ||
    value >> 108n === 0x3fff0n
  );
}

export async function resolveAddresses(url: URL, options: WebFetchOptions): Promise<Address[]> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family
    ? [{ address: host, family }]
    : await (options.resolve ?? ((name) => lookup(name, { all: true })))(host);
  if (!addresses.length) throw new Error(`SSRF rejected: no addresses for ${host}.`);
  for (const { address } of addresses) {
    if (options.allowAddresses?.includes(address)) continue;
    if (!publicAddress(address))
      throw new Error(`SSRF rejected: ${host} resolves to non-public address ${address}.`);
  }
  return addresses;
}

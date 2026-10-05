import { isIP } from "node:net";

const normalizeHost = (host: string) => host.toLowerCase().replace(/\.$/, "");

/** Only a hostname (or bracketed IPv6 literal), without URL, port or path syntax. */
export function parsePermissionDomain(
  pattern: string,
): { domain: string; subdomains: boolean } | undefined {
  const subdomains = pattern.startsWith("*.");
  const domain = normalizeHost(subdomains ? pattern.slice(2) : pattern);
  const ipv6 = domain.startsWith("[") && domain.endsWith("]") && isIP(domain.slice(1, -1)) === 6;
  const hostname =
    domain.length <= 253 &&
    domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (ipv6 && !subdomains) return { domain: new URL(`http://${domain}`).hostname, subdomains };
  return hostname ? { domain, subdomains } : undefined;
}

export function permissionUrlDomain(args: unknown): string | undefined {
  if (args === null || typeof args !== "object" || !("url" in args) || typeof args.url !== "string")
    return undefined;
  try {
    return normalizeHost(new URL(args.url).hostname) || undefined;
  } catch {
    return undefined;
  }
}

export interface ProxyOptions {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}

function bypassesProxy(url: URL, noProxy: string): boolean {
  const host = url.hostname
    .replace(/^\[(.+)\]$/, "$1")
    .replace(/^(.+)\.$/, "$1")
    .toLowerCase();
  const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  // Match EnvHttpProxyAgent in locked Undici 8.11.2, including wildcard apex
  // distinctions and IPv6 ports. A mismatch could skip DNS checks on a direct route.
  return noProxy.split(/[,\s]/).some((entry) => {
    if (!entry) return false;
    const bracketedPort = entry.match(/^\[(.+)\]:(\d+)$/);
    const unbracketed = entry.replace(/^\[(.+)\]$/, "$1");
    const hostPort =
      (unbracketed.match(/:/g) ?? []).length === 1 ? unbracketed.match(/^(.+):(\d+)$/) : null;
    const parsed = bracketedPort || hostPort;
    const entryPort = parsed ? Number.parseInt(parsed[2]!, 10) : 0;
    const entryHost = (parsed ? parsed[1]! : unbracketed)
      .replace(/^\*?\./, "")
      .replace(/^(.+)\.$/, "$1")
      .toLowerCase();
    if (entryPort && entryPort !== port) return false;
    if (entryHost === "*") return true;
    if (!entry.startsWith("*") && host === entryHost) return true;
    return host.endsWith(`.${entryHost}`);
  });
}

/** Use one environment snapshot for DNS policy and the actual proxy dispatcher. */
export function proxyFor(url: URL): ProxyOptions | undefined {
  const options = {
    httpProxy: process.env.http_proxy ?? process.env.HTTP_PROXY ?? "",
    httpsProxy: process.env.https_proxy ?? process.env.HTTPS_PROXY ?? "",
    noProxy: process.env.no_proxy ?? process.env.NO_PROXY ?? "",
  };
  const proxy =
    url.protocol === "https:" ? options.httpsProxy || options.httpProxy : options.httpProxy;
  return proxy && !bypassesProxy(url, options.noProxy) ? options : undefined;
}

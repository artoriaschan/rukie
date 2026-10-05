import { resolveAddresses, validateUrl, type WebFetchOptions } from "./addresses.ts";
import { request } from "./http.ts";
import { decodeBody, render } from "./content.ts";
import { proxyFor } from "./proxy.ts";
export type { WebFetchOptions } from "./addresses.ts";

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function fetchWeb(
  input: string,
  runSignal?: AbortSignal,
  options: WebFetchOptions = {},
) {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const signal = runSignal ? AbortSignal.any([runSignal, timeout]) : timeout;
  try {
    let url = validateUrl(input);
    let redirects = 0;
    while (true) {
      const proxy = proxyFor(url);
      const addresses = await abortable(resolveAddresses(url, options, !!proxy), signal);
      const { response, close } = await request(url, addresses, signal, proxy);
      try {
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          let destination: URL;
          try {
            destination = new URL(location, url);
          } catch {
            throw new Error("Invalid URL: redirect Location cannot be resolved.");
          }
          destination = validateUrl(destination.href);
          if (destination.origin === url.origin) {
            if (redirects === 5)
              throw new Error("Too many redirects: exceeded 5 same-origin hops.");
            redirects++;
            url = destination;
            continue;
          }
          return render(
            url,
            response.status,
            `Redirected to ${destination.href}; call web_fetch again with it to continue.`,
            false,
          );
        }
        const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
        if (Number(response.headers.get("content-length")) > maxBytes)
          throw new Error(`Response too large: Content-Length exceeds ${maxBytes} bytes.`);
        const chunks: Uint8Array[] = [];
        let size = 0;
        let truncated = false;
        const reader = response.body?.getReader();
        if (reader) {
          try {
            while (true) {
              const { done, value } = await abortable(reader.read(), signal);
              if (done) break;
              const remaining = maxBytes - size;
              chunks.push(value.subarray(0, remaining));
              size += Math.min(value.length, remaining);
              if (value.length > remaining) {
                truncated = true;
                await reader.cancel();
                break;
              }
            }
          } finally {
            reader.releaseLock();
          }
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const body = decodeBody(bytes, response.headers.get("content-type"));
        if (!response.ok)
          throw new Error(`HTTP ${response.status} from ${url.href}\n${body.slice(0, 2000)}`);
        return render(url, response.status, body, truncated);
      } finally {
        await response.body?.cancel().catch(() => {});
        await close();
      }
    }
  } catch (error) {
    if (runSignal?.aborted) throw new Error("Web fetch aborted: Run cancelled.");
    if (timeout.aborted) throw new Error("Web fetch timeout: request exceeded the total timeout.");
    if (
      error instanceof Error &&
      /^(Invalid URL|SSRF rejected|Response too large|Unsupported content type|Too many redirects|HTTP \d)/.test(
        error.message,
      )
    )
      throw error;
    throw new Error(
      `Web fetch network error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

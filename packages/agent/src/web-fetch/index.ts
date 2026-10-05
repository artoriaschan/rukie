import { resolveAddresses, validateUrl, type WebFetchOptions } from "./addresses.ts";
import { request } from "./http.ts";
import { decodeBody, render } from "./content.ts";
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
    const url = validateUrl(input);
    const addresses = await abortable(resolveAddresses(url, options), signal);
    const { response, close } = await request(url, addresses, signal);
    try {
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
  } catch (error) {
    if (runSignal?.aborted) throw new Error("Web fetch aborted: Run cancelled.");
    if (timeout.aborted) throw new Error("Web fetch timeout: request exceeded the total timeout.");
    if (
      error instanceof Error &&
      /^(Invalid URL|SSRF rejected|Response too large|Unsupported content type|HTTP \d)/.test(
        error.message,
      )
    )
      throw error;
    throw new Error(
      `Web fetch network error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

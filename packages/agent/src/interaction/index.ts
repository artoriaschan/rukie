/** Wait for a frontend reply until the Run aborts, then discard any late reply. */
export async function requestInteraction<Request extends { signal: AbortSignal }, Reply>(
  request: Request,
  respond: (request: Request) => Promise<Reply>,
  cancelled: Reply,
): Promise<Reply> {
  const { signal } = request;
  if (signal.aborted) return cancelled;
  const aborted = Promise.withResolvers<Reply>();
  const abort = () => aborted.resolve(cancelled);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const reply = await Promise.race([respond(request), aborted.promise]);
    return signal.aborted ? cancelled : reply;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

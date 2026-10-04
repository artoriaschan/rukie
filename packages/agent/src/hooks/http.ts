import { createUserVisibleError, type HookHandler } from "@neant/shared";
import type { CommandOutput } from "./command.ts";

export async function executeHttp(
  handler: Extract<HookHandler, { type: "http" }>,
  input: unknown,
  signal: AbortSignal,
): Promise<CommandOutput> {
  const allowed = new Set(handler.allowedEnvVars ?? []);
  const headers = Object.fromEntries(
    Object.entries(handler.headers ?? {}).map(([name, value]) => [
      name,
      value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (literal, variable: string) =>
        allowed.has(variable) ? (process.env[variable] ?? "") : literal,
      ),
    ]),
  );
  const response = await fetch(handler.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok)
    throw createUserVisibleError(`Hook HTTP response: ${response.status}`, {
      code: "hook-http-status",
      params: { status: String(response.status) },
    });
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body))
      throw new Error("Hook output must be a JSON object");
  } catch (error) {
    throw createUserVisibleError(`Invalid hook HTTP JSON: ${(error as Error).message}`, {
      code: "hook-invalid-json",
      params: { cause: (error as Error).message },
    });
  }
  return { stdout: text, stderr: "", exitCode: 0 };
}

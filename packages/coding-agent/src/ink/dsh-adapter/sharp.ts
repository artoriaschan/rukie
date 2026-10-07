export type SharpModule = Awaited<typeof import("sharp")>["default"];
export async function loadSharp(): Promise<SharpModule | undefined> {
  try { return (await import("sharp")).default; } catch { return undefined; }
}

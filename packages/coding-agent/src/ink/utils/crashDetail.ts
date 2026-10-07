export const appendCrashLog = (..._args: unknown[]) => {};
export const serializeCrashDetail = (error: unknown) => ({ summary: String(error), text: String(error) });

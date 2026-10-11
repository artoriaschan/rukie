import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLoginShellEnvironment } from "../src/main/environment.ts";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.map((path) => rm(path, { recursive: true, force: true })));
  homes.length = 0;
});
async function home(profile: string) {
  const path = await mkdtemp(join(tmpdir(), "rukie-shell-env-"));
  homes.push(path);
  await writeFile(join(path, ".zshenv"), profile);
  return path;
}

// The macOS host contract uses its installed zsh; other platforms do not launch a login shell.
test.skipIf(process.platform !== "darwin")(
  "Finder startup receives exported credentials despite profile output and preserves explicit environment",
  async () => {
    const HOME = await home(
      "printf 'profile output\\n'\nexport RUKIE_TEST_PROVIDER_KEY='local-test-value'\nexport RUKIE_TEST_OVERRIDE='profile-value'\nexport HOME='/must-not-override'\n",
    );
    const env = {
      HOME,
      SHELL: "/bin/zsh",
      PATH: "/usr/bin:/bin",
      RUKIE_TEST_OVERRIDE: "inherited-value",
    };
    const result = await readLoginShellEnvironment(env, "darwin");
    expect(result.RUKIE_TEST_PROVIDER_KEY).toBe("local-test-value");
    expect(result.RUKIE_TEST_OVERRIDE).toBe("inherited-value");
    expect(result.HOME).toBe(HOME);
  },
);

test.skipIf(process.platform !== "darwin")(
  "failed shell and non-macOS launches retain the inherited environment",
  async () => {
    const env = { HOME: await home("exit 1\n"), SHELL: "/bin/zsh" };
    expect(await readLoginShellEnvironment(env, "darwin")).toEqual(env);
    const missing = { ...env, SHELL: "/missing/rukie-login-shell" };
    expect(await readLoginShellEnvironment(missing, "darwin")).toEqual(missing);
    expect(await readLoginShellEnvironment(env, "linux")).toEqual(env);
  },
);

test.skipIf(process.platform !== "darwin")(
  "shell acquisition expires at five seconds and waits for child exit",
  async () => {
    const HOME = await home("exec /usr/bin/tail -f /dev/null\n");
    vi.useFakeTimers();
    const signals = vi.spyOn(process, "kill");
    const env = { HOME, SHELL: "/bin/zsh" };
    const result = readLoginShellEnvironment(env, "darwin");
    try {
      vi.advanceTimersByTime(4_999);
      expect(signals).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(signals).toHaveBeenCalledWith(expect.any(Number), "SIGKILL");
      expect(await result).toEqual(env);
    } finally {
      try {
        vi.runAllTimers();
        await result;
      } finally {
        signals.mockRestore();
        vi.useRealTimers();
      }
    }
  },
);

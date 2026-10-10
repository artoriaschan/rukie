import { afterEach, expect, test, vi } from "vitest";
import { Sidecar } from "../src/main/sidecar.ts";
import { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const owners: Sidecar[] = [];
afterEach(async () => {
  await Promise.all(owners.map((owner) => owner.stop()));
  owners.length = 0;
});
test("a real sidecar handshake is validated and its environment is scrubbed", async () => {
  const sidecar = new Sidecar({
    command: process.execPath,
    args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url))],
    env: {
      ...process.env,
      BUN_BE_BUN: "1",
      BUN_OPTIONS: "bad",
      NODE_OPTIONS: "bad",
      DYLD_INSERT_LIBRARIES: "bad",
    },
  });
  owners.push(sidecar);
  expect(await sidecar.getConnection()).toEqual({ port: 32123, token: "test-token" });
  await sidecar.stop();
});

test("handshake expires at ten seconds and waits for actual subprocess cleanup", async () => {
  vi.useFakeTimers();
  const sidecar = new Sidecar({
    command: process.execPath,
    args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url)), "--no-handshake"],
  });
  owners.push(sidecar);
  try {
    const result = sidecar.getConnection();
    const rejected = expect(result).rejects.toThrow("handshake timed out");
    vi.advanceTimersByTime(9_999);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1);
    await rejected;
    await sidecar.stop();
  } finally {
    vi.useRealTimers();
  }
});

test("shutdown sends TERM then KILL exactly at the five second deadline", async () => {
  vi.useFakeTimers();
  const signals = vi.spyOn(ChildProcess.prototype, "kill");
  const sidecar = new Sidecar({
    command: process.execPath,
    args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url)), "--ignore-term"],
  });
  owners.push(sidecar);
  try {
    await sidecar.getConnection();
    const stopped = sidecar.stop();
    expect(signals.mock.calls.map(([signal]) => signal)).toEqual(["SIGTERM"]);
    vi.advanceTimersByTime(4_999);
    expect(signals).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(signals.mock.calls.map(([signal]) => signal)).toEqual(["SIGTERM", "SIGKILL"]);
    await stopped;
  } finally {
    signals.mockRestore();
    vi.useRealTimers();
  }
});

test("unexpected exit recovers once and then requires manual connection retry", async () => {
  let nextConnected: (() => void) | undefined;
  let nextDisconnected: (() => void) | undefined;
  const states: string[] = [];
  const sidecar = new Sidecar({
    command: process.execPath,
    args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url)), "--pid-token"],
    onChange: (state) => {
      states.push(state);
      if (state === "connected") nextConnected?.();
      if (state === "disconnected") nextDisconnected?.();
    },
  });
  owners.push(sidecar);
  const first = await sidecar.getConnection();
  const restarted = new Promise<void>((resolve) => {
    nextConnected = resolve;
  });
  process.kill(Number(first.token), "SIGKILL");
  await restarted;
  const second = await sidecar.getConnection();
  expect(second.token).not.toBe(first.token);
  const disconnected = new Promise<void>((resolve) => {
    nextDisconnected = resolve;
  });
  process.kill(Number(second.token), "SIGKILL");
  await disconnected;
  expect(states).toEqual([
    "reconnecting",
    "connected",
    "disconnected",
    "reconnecting",
    "connected",
    "disconnected",
  ]);
  const third = await sidecar.getConnection();
  expect(third.token).not.toBe(second.token);
  await sidecar.stop();
});

test("missing executable fails without leaving cleanup waiting for a nonexistent child", async () => {
  const sidecar = new Sidecar({ command: "/missing/rukie-sidecar", args: [] });
  owners.push(sidecar);
  await expect(sidecar.getConnection()).rejects.toThrow("ENOENT");
  await sidecar.stop();
});

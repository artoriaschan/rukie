import { expect, jest, test } from "bun:test";
import { watch } from "node:fs";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultHost } from "../../src/host";

test("SSH uses UTF8 OSC52 rather than the remote native clipboard; missing transport fails", async () => {
  const output: string[] = [];
  const instance = createDefaultHost({
    env: { SSH_CONNECTION: "host", TERM: "xterm" },
    writeTerminal: (text) => {
      output.push(text);
    },
  });
  try {
    expect(await instance.host.writeClipboard("中文🐋")).toBe("sent");
    expect(output).toEqual([`\x1b]52;c;${Buffer.from("中文🐋").toString("base64")}\x07`]);
  } finally {
    await instance.dispose();
  }
  const unavailable = createDefaultHost({ env: { SSH_CONNECTION: "host" } });
  try {
    expect(await unavailable.host.writeClipboard("x")).toBe(false);
  } finally {
    await unavailable.dispose();
  }
});

test("tmux actual helper success wraps OSC; failed helper falls back raw and iTerm2 avoids -w", async () => {
  const root = await mkdtemp(join(tmpdir(), "neant-copy-"));
  const calls = join(root, "calls");
  const output: string[] = [];
  try {
    await Bun.write(
      join(root, "tmux"),
      `#!${process.execPath}
await Bun.write(${JSON.stringify(calls)},JSON.stringify(Bun.argv.slice(2)));process.exit(process.env.FAIL === "yes" ? 1 : 0);`,
    );
    await chmod(join(root, "tmux"), 0o700);
    for (const fail of [false, true]) {
      const instance = createDefaultHost({
        env: {
          PATH: root,
          SSH_CONNECTION: "host",
          TMUX: "pane",
          LC_TERMINAL: "iTerm2",
          FAIL: fail ? "yes" : "no",
        },
        writeTerminal: (text) => {
          output.push(text);
        },
      });
      try {
        expect(await instance.host.writeClipboard("hi")).toBe(fail ? "sent" : true);
        expect(await Bun.file(calls).text()).toBe('["load-buffer","-"]');
        expect(output.at(-1)).toBe(
          fail ? "\x1b]52;c;aGk=\x07" : "\x1bPtmux;\x1b\x1b]52;c;aGk=\x07\x1b\\",
        );
      } finally {
        await instance.dispose();
      }
    }
    const normal = createDefaultHost({
      env: { PATH: root, SSH_CONNECTION: "host", TMUX: "pane" },
      writeTerminal: () => {},
    });
    try {
      expect(await normal.host.writeClipboard("hi")).toBe(true);
      expect(await Bun.file(calls).text()).toBe('["load-buffer","-w","-"]');
    } finally {
      await normal.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local native helper receives exact text despite stale SSH_TTY; failed native falls back to Kitty or screen transport", async () => {
  const root = await mkdtemp(join(tmpdir(), "neant-native-copy-"));
  const bytes = join(root, "text");
  const output: string[] = [];
  try {
    const command =
      process.platform === "darwin"
        ? "pbcopy"
        : process.platform === "win32"
          ? "clip.exe"
          : "wl-copy";
    await Bun.write(
      join(root, command),
      `#!${process.execPath}\nawait Bun.write(${JSON.stringify(bytes)},await Bun.stdin.text());process.exit(process.env.FAIL === "yes" ? 1 : 0);`,
    );
    await chmod(join(root, command), 0o700);
    const local = createDefaultHost({
      env: { PATH: root, SSH_TTY: "old-pane" },
      writeTerminal: (text) => {
        output.push(text);
      },
    });
    try {
      expect(await local.host.writeClipboard("local 中文🐋")).toBe(true);
      expect(await Bun.file(bytes).text()).toBe("local 中文🐋");
    } finally {
      await local.dispose();
    }
    for (const screen of [false, true]) {
      const instance = createDefaultHost({
        env: { PATH: root, FAIL: "yes", TERM: "xterm-kitty", STY: screen ? "pane" : undefined },
        writeTerminal: (text) => {
          output.push(text);
        },
      });
      try {
        expect(await instance.host.writeClipboard("x")).toBe("sent");
        expect(output.at(-1)).toBe(
          screen ? "\x1bP\x1b]52;c;eA==\x1b\\\x1b\\" : "\x1b]52;c;eA==\x1b\\",
        );
      } finally {
        await instance.dispose();
      }
    }
    const broken = createDefaultHost({
      env: { PATH: root, SSH_CONNECTION: "host" },
      writeTerminal: () => {
        throw new Error("closed");
      },
    });
    try {
      expect(await broken.host.writeClipboard("x")).toBe(false);
    } finally {
      await broken.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stalled native clipboard helper is bounded at 2000ms and reports only the terminal fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "neant-copy-timeout-"));
  const ready = join(root, "ready");
  const command =
    process.platform === "darwin"
      ? "pbcopy"
      : process.platform === "win32"
        ? "clip.exe"
        : "wl-copy";
  await Bun.write(
    join(root, command),
    `#!${process.execPath}\nawait Bun.stdin.text();await Bun.write(${JSON.stringify(ready)},"ready");setInterval(()=>{},1000);`,
  );
  await chmod(join(root, command), 0o700);
  let observe: ReturnType<typeof watch>;
  const started = new Promise<void>((resolve) => {
    observe = watch(root, (_event, name) => {
      if (name === "ready") resolve();
    });
  });
  jest.useFakeTimers();
  const instance = createDefaultHost({ env: { PATH: root }, writeTerminal: () => {} });
  try {
    let done = false;
    const completion = instance.host.writeClipboard("x").then((value) => {
      done = true;
      return value;
    });
    // Await the child's actual ready signal; only the parent deadline uses virtual time.
    await started;
    jest.advanceTimersByTime(1999);
    expect(done).toBe(false);
    jest.advanceTimersByTime(1);
    expect(await completion).toBe("sent");
    const output: string[] = [];
    const closing = createDefaultHost({
      env: { PATH: root },
      writeTerminal: (text) => {
        output.push(text);
      },
    });
    const pending = closing.host.writeClipboard("x");
    await closing.dispose();
    expect(await pending).toBe(false);
    expect(output).toEqual([]);
    expect(await closing.host.writeClipboard("x")).toBe(false);
  } finally {
    observe!.close();
    jest.useRealTimers();
    await instance.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

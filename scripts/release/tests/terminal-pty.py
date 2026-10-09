"""Real macOS PTY acceptance; waits observe bytes/process exit, never fixed sleeps."""
import os, sys, json, pty, termios, fcntl, struct, subprocess, selectors, time, re, signal

config = json.load(open(sys.argv[1]))
if len(sys.argv) > 2 and sys.argv[2] == "runner":
    before = termios.tcgetattr(0)
    product = subprocess.Popen([config["command"], *config["args"]])
    print("__PRODUCT_PID__" + str(product.pid), flush=True)
    code = product.wait()
    after = termios.tcgetattr(0)
    print("__RESTORED__" + json.dumps({"code": code, "canonical": bool(after[3] & termios.ICANON), "echo": bool(after[3] & termios.ECHO), "restoredFullTermios": before == after}), flush=True)
    sys.stdin.readline()
    sys.exit(code)

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 110, 640, 880))
def session():
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
child = subprocess.Popen([sys.executable, __file__, sys.argv[1], "runner"], stdin=slave, stdout=slave, stderr=slave, cwd=config["cwd"], env=config["env"], preexec_fn=session)
selector = selectors.DefaultSelector()
selector.register(master, selectors.EVENT_READ, "terminal")
exit_read, exit_write = os.pipe()
os.set_blocking(exit_write, False)
previous_wakeup = signal.set_wakeup_fd(exit_write)
previous_sigchld = signal.signal(signal.SIGCHLD, lambda signum, frame: None)
selector.register(exit_read, selectors.EVENT_READ, "exit")
transcript = bytearray()
pending = bytearray()
index = 0
action_start = 0
restoration = None
deadline = time.monotonic() + config["timeoutMs"] / 1000
query = re.compile(rb"\x1b_G[^\x1b]*\x1b\\|\x1b\[\??[0-9;]*\$p|\x1b\[\??[0-9;]*[cutn]|\x1b\[>[0-9]*[cq]|\x1b\][0-9]+;\?(?:\x07|\x1b\\)")
def send(value):
    os.write(master, value)
def interrupt(signum, frame):
    raise RuntimeError("PTY harness interrupted")
signal.signal(signal.SIGTERM, interrupt)
try:
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("PTY predicate timed out at action " + str(index) + ": " + repr(bytes(transcript[-2500:])))
        events = selector.select(remaining)
        if any(key.data == "exit" for key, mask in events):
            os.read(exit_read, 4096)
            if child.poll() is not None:
                break
        if any(key.data == "terminal" for key, mask in events):
            try:
                data = os.read(master, 1024 * 1024)
            except OSError:
                data = b""
            transcript.extend(data)
            pending.extend(data)
            for match in list(query.finditer(pending)):
                value = match.group()
                if value.startswith(b"\x1b_G") and b"a=q" in value:
                    send(b"\x1b_Gi=31;" + (b"OK" if config["graphics"] == "kitty" else b"ENOTSUP") + b"\x1b\\")
                elif value == b"\x1b[c":
                    send(b"\x1b[?1;2;4c" if config["graphics"] == "sixel" else b"\x1b[?1;2c")
                elif value == b"\x1b[16t":
                    send(b"\x1b[6;16;8t")
                elif value == b"\x1b[14t":
                    send(b"\x1b[4;640;880t")
                elif value.endswith(b"$p"):
                    number = re.search(rb"([0-9]+)\$p", value).group(1)
                    send(b"\x1b[?" + number + b";2$y")
                elif value == b"\x1b[?u":
                    send(b"\x1b[?0u")
                elif value == b"\x1b[?6n":
                    send(b"\x1b[?1;1R")
                elif value.startswith(b"\x1b]"):
                    number = re.search(rb"\]([0-9]+);", value).group(1)
                    send(b"\x1b]" + number + b";rgb:0000/0000/0000\x07")
            esc = pending.rfind(b"\x1b")
            pending = bytearray(pending[esc:] if esc >= 0 and len(pending) - esc < 120 and not pending[esc:].endswith((b"\x07", b"\x1b\\", b"c", b"t", b"p", b"q", b"n", b"u")) else b"")
            while index < len(config["actions"]):
                action = config["actions"][index]
                action_bytes = bytes(transcript[action_start:])
                target = action_bytes.decode("utf-8", "replace") if action.get("raw") else re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", action_bytes).decode("utf-8", "replace")
                if not re.search(action["when"], target):
                    break
                if "send" in action:
                    send(action["send"].encode())
                if "signal" in action:
                    pid = int(re.search(rb"__PRODUCT_PID__(\d+)", transcript).group(1))
                    os.kill(pid, getattr(signal, action["signal"]))
                if "resize" in action:
                    columns, rows = action["resize"]["columns"], action["resize"]["rows"]
                    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, rows * 16, columns * 8))
                    pid = int(re.search(rb"__PRODUCT_PID__(\d+)", transcript).group(1))
                    os.kill(pid, signal.SIGWINCH)
                index += 1
                action_start = len(transcript)
            completed = re.search(rb"__RESTORED__(\{[^\r\n]+\})", transcript)
            if completed and restoration is None:
                restoration = json.loads(completed.group(1))
                send(b"\n")
            if child.poll() is not None:
                break
        elif child.poll() is not None:
            break
    code = child.wait(timeout=2)
    try:
        os.killpg(child.pid, 0)
    except ProcessLookupError:
        pass
    else:
        os.killpg(child.pid, signal.SIGKILL)
        raise RuntimeError("Installed product left a process in its owned PTY group")
    if restoration is None or index != len(config["actions"]):
        raise RuntimeError("PTY exited before completing actions/restoration")
    kitty = bool(re.search(rb"\x1b_G[^;\x1b]*a=[tT][^;\x1b]*;[^\x1b]{20,}\x1b\\", transcript))
    sixel = bool(re.search(rb"\x1bP[0-9;]*q[^\x1b]{20,}\x1b\\", transcript))
    print(json.dumps({"code": code, **restoration, "transcript": transcript.decode("utf-8", "replace"), "alternateEnter": b"\x1b[?1049h" in transcript, "alternateExit": b"\x1b[?1049l" in transcript, "cursorShow": b"\x1b[?25h" in transcript, "kittyUpload": kitty, "sixelUpload": sixel}))
finally:
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=2)
    signal.set_wakeup_fd(previous_wakeup)
    signal.signal(signal.SIGCHLD, previous_sigchld)
    os.close(exit_read)
    os.close(exit_write)
    selector.close()
    os.close(master)
    os.close(slave)

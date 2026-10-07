"""Export macOS and Windows icon packages from the current 1024px PNG master."""

from pathlib import Path
import struct
import subprocess
import tempfile

ROOT = Path(__file__).parent
MASTER = ROOT / "rukie-app-icon.png"


def run(*args):
    subprocess.run(args, check=True, capture_output=True)


header = MASTER.read_bytes()[:26]
assert header[:8] == b"\x89PNG\r\n\x1a\n", "Expected a PNG master"
assert struct.unpack(">II", header[16:24]) == (1024, 1024), "Expected 1024x1024"
assert header[25] == 6, "Expected RGBA transparency"

with tempfile.TemporaryDirectory(prefix="rukie-icons-") as temporary:
    work = Path(temporary)
    iconset = work / "rukie.iconset"
    iconset.mkdir()
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            pixels = str(size * scale)
            suffix = "@2x" if scale == 2 else ""
            destination = iconset / f"icon_{size}x{size}{suffix}.png"
            run("sips", "-z", pixels, pixels, str(MASTER), "--out", str(destination))
    run("iconutil", "-c", "icns", str(iconset), "-o", str(ROOT / "rukie-app-icon.icns"))

    sizes = (16, 24, 32, 48, 64, 128, 256)
    entries, payloads = [], []
    offset = 6 + 16 * len(sizes)
    for size in sizes:
        destination = work / f"windows-{size}.png"
        run("sips", "-z", str(size), str(size), str(MASTER), "--out", str(destination))
        payload = destination.read_bytes()
        # ICO stores 256 as zero; each directory entry points at a full PNG.
        dimension = size if size < 256 else 0
        entries.append(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(payload), offset))
        payloads.append(payload)
        offset += len(payload)
    (ROOT / "rukie-app-icon.ico").write_bytes(
        struct.pack("<HHH", 0, 1, len(sizes)) + b"".join(entries) + b"".join(payloads)
    )

print("Exported rukie-app-icon.icns and rukie-app-icon.ico from the PNG master.")

"""Standalone design prototype. No Neant application code is imported or changed."""

from pathlib import Path
import html
import json
import re
import struct
import zlib

ROOT = Path(__file__).parent
WIDTH, HEIGHT = 40, 28
PALETTE = {
    "D": "#3B506F",  # outline
    "B": "#ADC8EE",  # body
    "L": "#EDF5FF",  # highlight
    "S": "#789BCE",  # shade
    "T": "#5D7DAC",  # deepest fold
    "E": "#202E46",  # eyes
    "W": "#FFFFFF",  # eye glint
    "C": "#CCB2CC",  # cheek
    "P": "#527AAF",  # terminal prompt
    "Z": "#202C3E",  # floating shadow
}


def rgb(color):
    return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))


def standard():
    mask = set()
    spans = {
        1: [(20, 20)], 2: [(19, 22)], 3: [(13, 25)],
        4: [(11, 28)], 5: [(10, 29)], 6: [(9, 30)],
        7: [(8, 31)], 8: [(8, 31)],
        **{y: [(7, 32)] for y in range(9, 20)},
        20: [(8, 31)], 21: [(8, 14), (17, 23), (26, 31)],
        22: [(9, 13), (18, 22), (27, 30)],
        23: [(10, 12), (19, 21), (28, 29)],
    }
    for y, ranges in spans.items():
        for lo, hi in ranges:
            mask.update((x, y) for x in range(lo, hi + 1))
    # A raised left hand and relaxed right hand break the silhouette's symmetry.
    for y, lo, hi in [(11, 5, 7), (12, 4, 8), (13, 3, 8), (14, 3, 8),
                      (15, 4, 8), (16, 5, 8), (13, 31, 34), (14, 31, 35),
                      (15, 31, 36), (16, 31, 36), (17, 31, 35), (18, 31, 33)]:
        mask.update((x, y) for x in range(lo, hi + 1))
    grid = [["." for _ in range(WIDTH)] for _ in range(HEIGHT)]
    for x, y in mask:
        exposed = any((x + dx, y + dy) not in mask
                      for dx, dy in [(0, -1), (0, 1), (-1, 0), (1, 0)])
        if exposed:
            tone = "D"
        elif y >= 20:
            tone = "T" if x >= 24 else "S"
        elif x >= 29 or (y >= 17 and x >= 25):
            tone = "S"
        elif y <= 6 or (9 <= x <= 12 and y <= 10):
            tone = "L"
        else:
            tone = "B"
        grid[y][x] = tone
    # A broken curved highlight follows the forehead and left cheek.
    for y, lo, hi in [(5, 13, 23), (6, 11, 15), (7, 10, 12),
                      (8, 10, 11), (9, 9, 10), (10, 9, 10)]:
        for x in range(lo, hi + 1):
            grid[y][x] = "L"
    for origin in (12, 22):
        for dy, lo, hi in [(0, 1, 3), (1, 0, 4), (2, 0, 4), (3, 0, 4), (4, 1, 3)]:
            for dx in range(lo, hi + 1):
                grid[9 + dy][origin + dx] = "E"
        grid[10][origin + 1] = "W"
        grid[10][origin + 2] = "W"
        grid[11][origin + 1] = "L"
    for x in (10, 11, 12, 27, 28, 29):
        grid[14][x] = "C"
    # A pixel-drawn >_ is a quiet identity detail, rather than another pair of eyes.
    for x, y in [(16, 15), (17, 16), (18, 17), (17, 18), (16, 19)]:
        grid[y][x] = "P"
    for x in range(21, 25):
        grid[19][x] = "P"
    for x in range(13, 28):
        grid[26][x] = "Z"
    for x in range(16, 25):
        grid[27][x] = "Z"
    return grid


def blink(base):
    result = [row[:] for row in base]
    for origin in (12, 22):
        for y in range(9, 14):
            for x in range(origin, origin + 5):
                result[y][x] = "B"
        for dx, dy in [(0, 0), (1, 1), (2, 1), (3, 1), (4, 0)]:
            result[11 + dy][origin + dx] = "E"
    return result


def floating(base):
    result = [["." for _ in range(WIDTH)] for _ in range(HEIGHT)]
    for y in range(1, 24):
        for x in range(WIDTH):
            result[y - 1][x] = base[y][x]
    for x in range(16, 25):
        result[27][x] = "Z"
    return result


def ansi(grid):
    result = []
    for y in range(0, HEIGHT, 2):
        out, previous = "", None
        for x in range(WIDTH):
            up, lo = grid[y][x], grid[y + 1][x]
            if up == lo == ".":
                style, char = "\x1b[0m", " "
            else:
                upper = up if up != "." else lo
                style = "\x1b[38;2;" + ";".join(map(str, rgb(PALETTE[upper]))) + "m"
                style += ("\x1b[48;2;" + ";".join(map(str, rgb(PALETTE[lo]))) + "m"
                          if up != "." and lo != "." else "\x1b[49m")
                char = "▄" if up == "." else "▀"
            if style != previous:
                out += style
                previous = style
            out += char
        result.append(out + "\x1b[0m")
    return "\n".join(result) + "\n"


def ansi_html(text):
    """Preview the actual ANSI glyphs and SGR colors, not a replacement image."""
    foreground, background, output = "inherit", "transparent", []
    for piece in re.split(r"(\x1b\[[0-9;]*m)", text):
        if piece.startswith("\x1b["):
            values = [int(n) for n in piece[2:-1].split(";")]
            if values == [0]:
                foreground, background = "inherit", "transparent"
            elif values == [49]:
                background = "transparent"
            elif values[:2] == [38, 2]:
                foreground = "rgb(" + ",".join(map(str, values[2:])) + ")"
            elif values[:2] == [48, 2]:
                background = "rgb(" + ",".join(map(str, values[2:])) + ")"
        else:
            for char in piece:
                if char == "\n":
                    output.append("\n")
                    continue
                up = foreground if char == "▀" else background
                lo = foreground if char == "▄" else background
                output.append(f'<span class="cell" style="--up:{up};--lo:{lo}">{html.escape(char)}</span>')
    return "".join(output)


def png(grid):
    # Lossless enlarged pixel proof generated from the same palette grid.
    scale = 16
    width, height = WIDTH * scale, HEIGHT * scale
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            symbol = grid[y // scale][x // scale]
            rows.extend(rgb(PALETTE.get(symbol, "#101318")))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


base = standard()
frames = {"standard": base, "blink": blink(base), "float": floating(base)}
for name, grid in frames.items():
    assert len(grid) == HEIGHT and all(len(row) == WIDTH for row in grid)
    assert set("".join("".join(row) for row in grid)) <= set(PALETTE) | {"."}
    encoded = ansi(grid)
    assert encoded.endswith("\x1b[0m\n")
    assert all(len(row) == WIDTH for row in re.sub(r"\x1b\[[0-9;]*m", "", encoded).splitlines())
    (ROOT / f"{name}.ansi").write_text(encoded)
(ROOT / "standard.png").write_bytes(png(base))
(ROOT / "frames.json").write_text(json.dumps({
    "width": WIDTH, "height": HEIGHT, "palette": PALETTE,
    "frames": [{"name": name, "rows": ["".join(row) for row in grid]} for name, grid in frames.items()],
}, ensure_ascii=False, indent=2) + "\n")
titles = {"standard": "01 · 睁眼", "blink": "02 · 眨眼", "float": "03 · 轻浮"}
cards = "".join(f'<article><pre aria-label="{titles[name]}">{ansi_html(ansi(grid))}</pre><h2>{titles[name]}</h2></article>' for name, grid in frames.items())
chips = "".join(f'<span class="chip"><i style="background:{value}"></i>{key} {value}</span>' for key, value in PALETTE.items())
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Neant · 小夜灵 v2</title>
<style>*{box-sizing:border-box}body{margin:0;background:#101318;color:#E8E6E0;font-family:system-ui,sans-serif;padding:42px 48px}main{max-width:1120px;margin:auto}.eyebrow{font-size:12px;letter-spacing:3px;color:#7DA1DE}h1{font-size:30px;font-weight:550;margin:14px 0 8px}.subtitle{color:#99A5B8;font-size:14px;margin:0}.hero{display:flex;align-items:center;justify-content:center;gap:64px;padding:18px 0 28px}.hero pre{font-size:20px;line-height:20px}.wordmark{font-size:36px;letter-spacing:6px}.caption{font-size:13px;color:#99A5B8;margin-top:14px;line-height:1.8}pre{font-family:Menlo,Monaco,'Courier New',monospace;font-weight:normal;white-space:pre;letter-spacing:0;font-variant-ligatures:none;margin:0}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;border-top:1px solid #293241;padding-top:28px}article{background:#151A23;border:1px solid #242D3B;border-radius:10px;padding:20px 12px;text-align:center}article pre{font-size:12px;line-height:12px;display:inline-block}h2{font-size:12px;color:#AAB8CD;font-weight:500;margin:20px 0 0}.chips{display:flex;gap:14px;flex-wrap:wrap;margin-top:26px}.chip{font-size:10px;color:#99A5B8;display:flex;align-items:center;gap:6px}.chip i{width:10px;height:10px;border-radius:2px}footer{font-size:12px;color:#718096;margin-top:24px}@media(max-width:800px){body{padding:24px}.hero{gap:16px}.hero pre{font-size:13px;line-height:13px}.wordmark{font-size:24px}.cards{grid-template-columns:1fr}}</style>
<main><div class="eyebrow">NEANT / CHARACTER STUDY 02</div><h1>小夜灵</h1><p class="subtitle">厚轮廓 · 额头高光 · 反光双眼 · 不对称小手 · 波浪下摆</p><div class="hero"><pre aria-label="主形象">__HERO__</pre><div><div class="wordmark">neant</div><div class="caption">安静、专注的 coding agent。<br>胸前藏着一枚像素提示符 &gt;_。</div></div></div><div class="cards">__CARDS__</div><div class="chips">__CHIPS__</div><footer>40 × 28 像素 → 40 列 × 14 行 ANSI 文本。预览直接解释 ANSI 字符与颜色，无图片参与渲染。v2 形象已接入 Neant TUI。</footer></main></html>'''
page = page.replace("</style>", ".cell{display:inline-block;width:1ch;height:1.2em;vertical-align:top;color:transparent;background:linear-gradient(to bottom,var(--up) 0 50%,var(--lo) 50% 100%)}.hero pre,article pre{line-height:1.2}</style>")
page = page.replace("预览直接解释 ANSI 字符与颜色，无图片参与渲染", "浏览器按 ANSI 半块字符及颜色模拟像素，无图片参与渲染")
(ROOT / "preview.html").write_text(page.replace("__HERO__", ansi_html(ansi(base))).replace("__CARDS__", cards).replace("__CHIPS__", chips))
print("Generated 3 palette-grid poses, 3 ANSI previews, PNG proof and text-only HTML preview.")

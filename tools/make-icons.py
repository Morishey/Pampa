#!/usr/bin/env python3
"""Draw Pampa's install icons.

The app has to be installable on a phone, and an installable web app needs real
PNG icons at 192 and 512 (plus a maskable one Android can crop to any shape).
This project has no image tooling and no build step, so the icons are drawn here
with nothing but zlib — run it again after changing the mark:

    python tools/make-icons.py

It writes img/icon-192.png, img/icon-512.png, img/icon-maskable-512.png and
img/apple-touch-icon.png. Every shape is rendered at three times the final size
and averaged down, which is what keeps the ring and the letter free of jaggies.
"""

import os
import struct
import zlib

# the app's own palette: the dark field it opens on and the gold it accents with
INK = (0x0b, 0x0d, 0x11)
INK_LIFT = (0x1a, 0x1e, 0x27)
GOLD = (0xef, 0xc2, 0x58)
GOLD_DEEP = (0xd9, 0xa6, 0x3c)

SS = 3  # supersample factor


def write_png(path, width, height, rows):
    """rows: list of rows, each a list of (r, g, b, a) tuples."""

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    raw = b"".join(
        b"\x00" + bytes(v for px in row for v in px) for row in rows
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", header) +
            chunk(b"IDAT", zlib.compress(raw, 9)) +
            chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(blob)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(size, bleed):
    """Render the mark at `size` px. `bleed` fills the whole square edge to edge
    for a maskable icon; otherwise the field is a rounded square on nothing."""
    n = size * SS
    c = n / 2.0
    # a maskable icon is cropped to whatever shape the launcher likes, so the
    # mark itself shrinks into the safe zone while the field goes full bleed
    scale = 0.72 if bleed else 0.86
    ring_out = 0.5 * scale * n
    ring_in = ring_out - 0.055 * scale * n
    gw = 0.46 * scale * n
    gh = 0.56 * scale * n
    gx0 = c - gw / 2.0
    gy0 = c - gh / 2.0
    radius = n * 0.22          # the rounded-square corner
    stem = (0.00, 0.20, 0.00, 1.00)
    top = (0.00, 1.00, 0.00, 0.20)
    right = (0.80, 1.00, 0.00, 0.58)
    bowl = (0.00, 1.00, 0.38, 0.58)
    glyph = (stem, top, right, bowl)

    def in_glyph(x, y):
        if not (gx0 <= x < gx0 + gw and gy0 <= y < gy0 + gh):
            return False
        u = (x - gx0) / gw
        v = (y - gy0) / gh
        for x0, x1, y0, y1 in glyph:
            if x0 <= u < x1 and y0 <= v < y1:
                return True
        return False

    def rounded(x, y):
        if bleed:
            return True
        cx = min(max(x, radius), n - radius)
        cy = min(max(y, radius), n - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius

    hi = size * SS
    pixels = [[(0, 0, 0, 0)] * size for _ in range(size)]
    for py in range(size):
        out = pixels[py]
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                y = py * SS + sy + 0.5
                for sx in range(SS):
                    x = px * SS + sx + 0.5
                    if not rounded(x, y):
                        continue
                    dist = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
                    # the field lifts towards the middle so the square reads as
                    # lit rather than flat
                    base = mix(INK_LIFT, INK, min(1.0, dist / (c * 1.5)))
                    if in_glyph(x, y):
                        base = GOLD
                    elif ring_in <= dist <= ring_out:
                        # the ring fades round its own sweep, the way the app's
                        # gold accents are never a flat single tone
                        base = mix(GOLD_DEEP, GOLD, 0.5 + 0.5 * (y / n))
                    r += base[0]
                    g += base[1]
                    b += base[2]
                    a += 255
            total = SS * SS
            out[px] = (
                round(r / total), round(g / total), round(b / total),
                round(a / total),
            )
    return pixels


def save(name, size, bleed):
    rows = make(size, bleed)
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "img", name)
    write_png(path, size, size, rows)
    print("wrote", os.path.relpath(path), size, "x", size)


if __name__ == "__main__":
    save("icon-192.png", 192, False)
    save("icon-512.png", 512, False)
    save("icon-maskable-512.png", 512, True)
    save("apple-touch-icon.png", 180, True)

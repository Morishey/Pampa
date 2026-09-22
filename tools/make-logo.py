#!/usr/bin/env python3
"""Derive Pampa's wordmark assets from img/pampaTextIcon.png.

The supplied wordmark is an 800x800 square with the letters sitting in a small
band across the middle: 556x118 of ink in 640,000 pixels, and 91% of the canvas
transparent. Used as-is, every place it appears — a 90px logo tile, a 32px tab
icon — would render a sliver of orange in a mostly empty square.

So this crops the mark to its ink and writes the sizes the app actually asks
for, with nothing but zlib and the standard library (same approach as
tools/make-icons.py — no image tooling, no build step):

    python tools/make-logo.py

It writes img/pampa-logo.png (the transparent wordmark the app shows) and
img/favicon-32.png / img/favicon-48.png (the tab and bookmark icons, the
wordmark fitted to each square). Downsampling averages every source pixel in
each target pixel's box, which is what keeps the bubble letters' edges clean
rather than sparkling.
"""

import os
import struct
import zlib

SRC = os.path.join("img", "pampaTextIcon.png")
ALPHA_FLOOR = 16  # what counts as ink rather than a transparent edge


def read_png(path):
    """Decode any non-interlaced 8-bit PNG into (w, h, channels, rows)."""

    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(path + " is not a PNG")
    i = 8
    idat = b""
    width = height = depth = kind = None
    while i < len(data):
        length = struct.unpack(">I", data[i:i + 4])[0]
        tag = data[i + 4:i + 8]
        body = data[i + 8:i + 8 + length]
        i += 12 + length
        if tag == b"IHDR":
            width, height, depth, kind, _, _, interlace = struct.unpack(
                ">IIBBBBB", body)
            if interlace:
                raise ValueError("interlaced PNGs are not supported")
            if depth != 8:
                raise ValueError("only 8-bit PNGs are supported")
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[kind]
    raw = zlib.decompress(idat)
    stride = width * channels
    rows = []
    prev = bytearray(stride)
    p = 0
    for _ in range(height):
        filt = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if filt == 1:
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 255
        elif filt == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif filt == 4:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                b = prev[x]
                c = prev[x - channels] if x >= channels else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                near = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + near) & 255
        rows.append(bytes(line))
        prev = line
    return width, height, channels, rows


def write_png(path, width, height, rows):
    """rows: list of rows of (r, g, b, a) tuples."""

    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body +
                struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    raw = b"".join(
        b"\x00" + bytes(v for px in row for v in px) for row in rows
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) +
            chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(blob)
    return len(blob)


def ink_box(width, height, channels, rows):
    """The tightest box around every pixel that is not transparent."""

    min_x, min_y, max_x, max_y = width, height, -1, -1
    for y in range(height):
        row = rows[y]
        for x in range(width):
            if row[x * channels + channels - 1] < ALPHA_FLOOR:
                continue
            if x < min_x:
                min_x = x
            if x > max_x:
                max_x = x
            if y < min_y:
                min_y = y
            if y > max_y:
                max_y = y
    if max_x < 0:
        raise ValueError("the source has no visible pixels")
    return min_x, min_y, max_x, max_y


def crop(channels, rows, box):
    min_x, min_y, max_x, max_y = box
    out = []
    for y in range(min_y, max_y + 1):
        row = rows[y]
        line = []
        for x in range(min_x, max_x + 1):
            o = x * channels
            if channels == 4:
                line.append(tuple(row[o:o + 4]))
            elif channels == 3:
                r, g, b = row[o:o + 3]
                line.append((r, g, b, 255))
            else:  # greyscale, with or without alpha
                v = row[o]
                a = row[o + 1] if channels == 2 else 255
                line.append((v, v, v, a))
        out.append(line)
    return out


def place(src, box_w, box_h, canvas_w, canvas_h):
    """Scale `src` into a box_w x box_h area, centred on a transparent canvas.

    Every source pixel inside a target pixel's box is averaged in, so the
    letters keep their weight when they shrink instead of dropping strokes.
    """

    sh = len(src)
    sw = len(src[0])
    off_x = (canvas_w - box_w) // 2
    off_y = (canvas_h - box_h) // 2
    rows = []
    for y in range(canvas_h):
        line = [(0, 0, 0, 0)] * canvas_w
        if off_y <= y < off_y + box_h:
            sy0 = (y - off_y) * sh // box_h
            sy1 = max(sy0 + 1, (y - off_y + 1) * sh // box_h)
            out = []
            for x in range(canvas_w):
                if not (off_x <= x < off_x + box_w):
                    out.append((0, 0, 0, 0))
                    continue
                sx0 = (x - off_x) * sw // box_w
                sx1 = max(sx0 + 1, (x - off_x + 1) * sw // box_w)
                r = g = b = a = n = 0
                for sy in range(sy0, sy1):
                    srow = src[sy]
                    for sx in range(sx0, sx1):
                        px = srow[sx]
                        r += px[0]
                        g += px[1]
                        b += px[2]
                        a += px[3]
                        n += 1
                out.append((r // n, g // n, b // n, a // n))
            line = out
        rows.append(line)
    return rows


def scale_to(src, out_w):
    """Scale the cropped mark to `out_w` wide, keeping its aspect."""

    sw = len(src[0])
    sh = len(src)
    out_h = max(1, round(out_w * sh / sw))
    return place(src, out_w, out_h, out_w, out_h)


def main():
    width, height, channels, rows = read_png(SRC)
    box = ink_box(width, height, channels, rows)
    mark = crop(channels, rows, box)
    sw = len(mark[0])
    sh = len(mark)

    print("%s: %dx%d, mark is %dx%d at %s (aspect %.2f:1)" %
          (SRC, width, height, sw, sh, box, sw / sh))

    # the in-app wordmark: 3x the widest plate it is shown in, so it stays sharp
    logo = scale_to(mark, 528)
    size = write_png(os.path.join("img", "pampa-logo.png"), len(logo[0]),
                     len(logo), logo)
    print("  img/pampa-logo.png      %dx%d  %d KB" %
          (len(logo[0]), len(logo), round(size / 1024)))

    # the tab icons: the wordmark fitted to the width it has to share with
    # nothing, on the square a browser asks for
    for canvas, inset in ((32, 2), (48, 3)):
        wide = canvas - inset * 2
        tall = max(1, round(wide * sh / sw))
        icon = place(mark, wide, tall, canvas, canvas)
        size = write_png(os.path.join("img", "favicon-%d.png" % canvas),
                         canvas, canvas, icon)
        print("  img/favicon-%d.png      %dx%d  %d KB" %
              (canvas, canvas, canvas, round(size / 1024)))


if __name__ == "__main__":
    main()

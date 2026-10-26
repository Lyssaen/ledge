"""Draws ledge.ico, the mascot as 16x16 pixel art, the Windows Terminal tab icon of `ledge tui`.

Run from this directory: python3 ledge-icon.py (needs Pillow).
"""
from PIL import Image
# 16x16 pixel mascot: antenna ball, dome shell with two tall eyes, paws on a ledge.
GRID = """
.......aa.......
.......aa.......
.......ss.......
.....hhhhhh.....
....hSSSSSSh....
...hSSSSSSSSh...
...SSeeSSeeSS...
...SSwESSwESS...
...SSEESSEESS...
...SSSSSSSSSS...
...SppSSSSppS...
.LLLLLLLLLLLLLL.
.DdDDDDDDDDDDdD.
.DDDDDDDDDDDDDD.
.DDDDDDDDDDDDDD.
................
"""
C = {
 '.': None,
 'a': '#f0b2ac',  # antenna ball
 's': '#6a2422',  # stalk
 'h': '#e2908a',  # dome highlight rim
 'S': '#c4554f',  # shell
 'e': '#2a0e0d', 'E': '#2a0e0d',  # eyes
 'w': '#ffffff',  # eye glint
 'p': '#f0b2ac', 'P': '#c4554f',  # paws
 'L': '#e48a83',  # ledge top
 'D': '#6a2422', 'd': '#8a3430',  # ledge body
}
rows = [r for r in GRID.strip('\n').split('\n')]
img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
for y, r in enumerate(rows):
    for x, ch in enumerate(r):
        c = C[ch]
        if c: img.putpixel((x, y), tuple(int(c[i:i+2], 16) for i in (1, 3, 5)) + (255,))
sizes = [16, 24, 32, 48, 64, 256]
big = {s: img.resize((s, s), Image.NEAREST) for s in sizes}
big[256].save('ledge.ico', sizes=[(s, s) for s in sizes], append_images=[big[s] for s in sizes[:-1]])

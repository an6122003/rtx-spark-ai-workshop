"""Draw the workshop's desktop icon as a Windows .ico file: the studio page's mark in NVIDIA's look,
a black chip with a 3 x 3 grid of cores and NVIDIA green at its centre.

    .venv/Scripts/python.exe windows/make_icon.py .run/workshop.ico

Pillow comes with matplotlib, so the workshop's Python environment has it.
"""

import sys

from PIL import Image, ImageDraw

im = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((8, 8, 248, 248), radius=40, fill=(0, 0, 0, 255), outline=(58, 58, 58, 255), width=6)
for row in range(3):
    for col in range(3):
        x, y = 62 + col * 48, 62 + row * 48
        green = row == 1 and col == 1
        d.rounded_rectangle((x, y, x + 36, y + 36), radius=6, fill=(118, 185, 0, 255) if green else (64, 64, 64, 255))
im.save(sys.argv[1], sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])

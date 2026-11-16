#!/usr/bin/env python3
"""Rasterize the existing GastroFlow SVG brands; never substitute generic graphics."""
from pathlib import Path
from io import BytesIO

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = (
    ("apps/customer-web/public", "food-logo"),
    ("apps/driver-web/public", "driver-logo"),
    ("apps/customer-web/public", "driver-logo"),
)

def render_icons():
    for folder, name in ASSETS:
        directory = ROOT / folder
        original = directory / f"{name}.svg"
        if not original.is_file():
            raise FileNotFoundError(f"Original app icon missing: {original}")
        svg = original.read_bytes()
        for size in (180, 192, 512):
            png = cairosvg.svg2png(bytestring=svg, output_width=size, output_height=size)
            with Image.open(BytesIO(png)) as picture:
                if picture.size != (size, size):
                    raise ValueError(f"Wrong icon dimensions: {name} {size}")
                output = picture.convert("RGBA")
                filename = f"{name}.png" if size == 512 else f"{name}-{size}.png"
                target = directory / filename
                output.save(target, format="PNG", optimize=True)
                print(f"Restored original artwork: {target.relative_to(ROOT)} ({size}x{size})")

if __name__ == "__main__":
    render_icons()

#!/usr/bin/env python3
"""Apply the existing approved GastroFlow Food logo to isolated Android resources.

Run only after apps/customer-web/android has been generated. No POS/root files,
signing, production or live data touched. Requires Pillow on the build runner.
"""
from __future__ import annotations
import argparse
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

REPO = Path(__file__).resolve().parents[1]
CUSTOMER = REPO / "apps" / "customer-web"
BG = (247, 247, 242, 255)
SIZES = {"mdpi":48, "hdpi":72, "xhdpi":96, "xxhdpi":144, "xxxhdpi":192}

def generate(customer_root: Path) -> list[str]:
    customer_root = customer_root.resolve()
    if customer_root != CUSTOMER.resolve():
        raise ValueError("Only the isolated apps/customer-web project is supported")
    app_root = customer_root / "android" / "app" / "src" / "main"
    res = app_root / "res"
    manifest = app_root / "AndroidManifest.xml"
    source = customer_root / "public" / "food-logo.png"
    if not manifest.is_file() or not res.is_dir():
        raise FileNotFoundError("Android project is not generated; run native:add:android first")
    if not source.is_file():
        raise FileNotFoundError("Approved customer food-logo.png is missing")
    logo = Image.open(source).convert("RGBA")
    if logo.size != (512, 512):
        raise ValueError(f"Expected 512x512 GastroFlow Food logo; got {logo.size}")
    output = []
    for density, side in SIZES.items():
        folder = res / f"mipmap-{density}"
        if not folder.is_dir():
            raise FileNotFoundError(f"Missing native Android folder {folder}")
        legacy = Image.new("RGBA", (side, side), BG)
        graphic = ImageOps.contain(logo, (int(side * .84), int(side * .84)), Image.Resampling.LANCZOS)
        legacy.alpha_composite(graphic, ((side-graphic.width)//2, (side-graphic.height)//2))
        for filename in ("ic_launcher.png", "ic_launcher_round.png"):
            path = folder / filename
            legacy.save(path, "PNG")
            output.append(str(path.relative_to(customer_root)))
        # Adaptive-icon safe zone: artwork stays within center of the 108dp canvas.
        foreground = Image.new("RGBA", (side, side), (0,0,0,0))
        icon = ImageOps.contain(logo, (int(side * .62), int(side * .62)), Image.Resampling.LANCZOS)
        foreground.alpha_composite(icon, ((side-icon.width)//2, (side-icon.height)//2))
        path = folder / "ic_launcher_foreground.png"
        foreground.save(path, "PNG")
        output.append(str(path.relative_to(customer_root)))
    # Preserve generated Android splash dimensions / orientation resource names.
    # Only replace raster data, not the platform's themes, dimensions or Gradle.
    splash_paths = list(res.glob("drawable*/splash.png"))
    if not splash_paths:
        raise FileNotFoundError("No generated Android splash resources found")
    for path in splash_paths:
        with Image.open(path) as prior:
            canvas = Image.new("RGBA", prior.size, BG)
        w,h = canvas.size
        # Leave ample clearance for system bars and landscape clipping.
        mark = ImageOps.contain(logo, (max(1,int(min(w,h)*.36)), max(1,int(min(w,h)*.36))), Image.Resampling.LANCZOS)
        canvas.alpha_composite(mark, ((w-mark.width)//2,(h-mark.height)//2))
        canvas.convert("RGB").save(path, "PNG")
        output.append(str(path.relative_to(customer_root)))
    return output

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--customer-root",default=str(CUSTOMER))
    args=parser.parse_args()
    files=generate(Path(args.customer_root))
    print(f"Generated {len(files)} isolated GastroFlow Food Android branded native resources")

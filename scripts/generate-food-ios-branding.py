#!/usr/bin/env python3
"""Brand isolated GastroFlow Food iOS assets with the approved customer logo.

Only modify image files in apps/customer-web/ios/App/App/Assets.xcassets.
Never change root POS, Xcode signing, bundle identifiers, or live data.
Run after cap add/sync ios. Requires Pillow.
"""
from __future__ import annotations

import json
from pathlib import Path
from PIL import Image, ImageOps

REPO = Path(__file__).resolve().parents[1]
CUSTOMER = REPO / "apps" / "customer-web"
BG = (247, 247, 242, 255)

def fill_icon(logo: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG)
    # Keep full square art with enough clearance for iOS's rounded masking.
    mark = ImageOps.contain(logo, (int(size * .84), int(size * .84)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((size - mark.width)//2, (size - mark.height)//2))
    return canvas.convert("RGB")  # iOS app-store icons must be opaque.

def fill_splash(logo: Image.Image, size: tuple[int,int]) -> Image.Image:
    canvas = Image.new("RGBA", size, BG)
    edge = max(1, int(min(size) * .34))
    mark = ImageOps.contain(logo, (edge, edge), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((size[0] - mark.width)//2, (size[1] - mark.height)//2))
    return canvas.convert("RGB")

def generate_assets(customer_root: Path, *, enforce_root: bool=True) -> list[str]:
    customer_root = customer_root.resolve()
    if enforce_root and customer_root != CUSTOMER.resolve():
        raise ValueError("Only apps/customer-web iOS assets may be branded")
    source = customer_root / "public" / "food-logo.png"
    resources = customer_root / "ios" / "App" / "App" / "Assets.xcassets"
    iconset = resources / "AppIcon.appiconset"
    splashset = resources / "Splash.imageset"
    if not (iconset / "Contents.json").is_file():
        raise FileNotFoundError("Generated customer Xcode AppIcon.appiconset is missing")
    if not source.is_file():
        raise FileNotFoundError("Existing approved GastroFlow Food logo is missing")
    with Image.open(source) as im:
        if im.size != (512,512):
            raise ValueError("Approved GastroFlow Food logo must be 512x512")
        logo = im.convert("RGBA")
    # Work with the icon filenames declared by the generated Xcode catalog.
    icon_contents = json.loads((iconset / "Contents.json").read_text())
    filenames = {part.get("filename") for part in icon_contents.get("images", []) if part.get("filename")}
    if "AppIcon-512@2x.png" not in filenames:
        raise ValueError("Unexpected iOS app icon catalog: no 1024px icon reference")
    for filename in filenames:
        if Path(filename).name != filename or not filename.lower().endswith(".png"):
            raise ValueError("Unsafe or unexpected icon asset filename")
        if not (iconset / filename).is_file():
            raise FileNotFoundError("Generated icon asset missing: "+filename)
    # Don't overwrite the source asset catalog with a new unverified schema.
    out = []
    # Modern Xcode catalogs use one 1024px icon, while older projects may
    # reference other icons. Preserve the existing image dimensions for those.
    for filename in sorted(filenames):
        target=iconset / filename
        if filename == "AppIcon-512@2x.png":
            size=1024
        else:
            with Image.open(target) as old:
                if old.width != old.height:
                    raise ValueError("Expected square iOS app icon: "+filename)
                size=old.width
        fill_icon(logo,size).save(target,"PNG")
        out.append(str(target.relative_to(customer_root)))
    if not (splashset / "Contents.json").is_file():
        raise FileNotFoundError("Generated customer Splash.imageset is missing")
    splash_contents=json.loads((splashset / "Contents.json").read_text())
    splashes=sorted({item.get("filename") for item in splash_contents.get("images", []) if item.get("filename")})
    if not splashes:
        raise ValueError("No generated iOS splash images referenced by catalog")
    for filename in splashes:
        if Path(filename).name != filename or not filename.lower().endswith(".png"):
            raise ValueError("Unsafe or unexpected splash asset filename")
        target=splashset / filename
        if not target.is_file():
            raise FileNotFoundError("Generated splash asset missing: "+filename)
        with Image.open(target) as old:
            size=old.size
        fill_splash(logo,size).save(target,"PNG")
        out.append(str(target.relative_to(customer_root)))
    return out

if __name__ == "__main__":
    changed=generate_assets(CUSTOMER)
    print(f"Generated {len(changed)} approved GastroFlow Food iPhone icon and splash assets")

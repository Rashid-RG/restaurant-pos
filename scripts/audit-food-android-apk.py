#!/usr/bin/env python3
"""Read-only checks for GastroFlow Food Android debug APKs.

Validates packaged customer assets, native launcher resources, and staging-only
API targeting. It cannot replace emulator, security or physical-phone testing.
"""
from __future__ import annotations
import argparse
import hashlib
import re
import sys
import zipfile
from pathlib import Path

STAGING_API = "https://gastroflow-staging.onrender.com"
DENSITIES = ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")
ICONS = ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png")

def audit_apk(path: Path) -> tuple[list[str], dict[str, str | int]]:
    errors: list[str] = []
    summary: dict[str, str | int] = {}
    if not path.is_file():
        return ["APK does not exist"], summary
    summary["apk_bytes"] = path.stat().st_size
    summary["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    try:
        with zipfile.ZipFile(path) as apk:
            if apk.testzip():
                errors.append("APK contains a corrupt ZIP member")
            names = set(apk.namelist())
            if "AndroidManifest.xml" not in names:
                errors.append("Compiled Android manifest missing")
            if "classes.dex" not in names:
                errors.append("Android DEX code missing")
            index = "assets/public/index.html"
            if index not in names:
                errors.append("Packaged customer index.html missing")
            else:
                html = apk.read(index).decode("utf-8")
                if '<div id="root"></div>' not in html:
                    errors.append("Customer React mount point missing")
                if "GastroFlow" not in html and "GastroFood" not in html:
                    errors.append("Unexpected packaged application identity")
            bundles = [n for n in names if re.fullmatch(r"assets/public/assets/index-[^/]+\.js", n)]
            if not bundles:
                errors.append("Customer JavaScript app bundle missing")
            else:
                js = b"".join(apk.read(n) for n in bundles)
                if STAGING_API.encode() not in js:
                    errors.append("Native bundle does not target staging HTTPS API")
                if b"https://gastroflow.onrender.com" in js:
                    errors.append("Native test APK includes a production API host")
                if b"serviceWorker.register" in js:
                    errors.append("Packaged native bundle attempts to register PWA service worker")
            for density in DENSITIES:
                for icon in ICONS:
                    if not any(re.fullmatch(r"res/mipmap-"+density+r"-v[0-9]+/"+re.escape(icon), n) for n in names):
                        errors.append("Branded launcher resource missing: "+density+"/"+icon)
            splash = [n for n in names if re.fullmatch(r"res/drawable[^/]*/splash\.(png|webp)", n)]
            if not splash:
                # Android 12+ can use XML splash and legacy bitmap resources named differently.
                # Do not infer runtime visuals from compiled density/resource renaming.
                summary["splash_resources"] = "check generated Android source"
            else:
                summary["splash_resources"] = len(splash)
            summary["dex_files"] = len([n for n in names if re.fullmatch(r"classes\d*\.dex", n)])
            summary["web_assets"] = len([n for n in names if n.startswith("assets/public/")])
    except (OSError, zipfile.BadZipFile, UnicodeError) as e:
        errors.append("Cannot inspect Android APK: "+str(e))
    return errors, summary

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    args = parser.parse_args()
    problems, info = audit_apk(args.apk)
    for k, v in info.items():
        print(f"{k}: {v}")
    for issue in problems:
        print("FAIL:", issue, file=sys.stderr)
    if problems:
        sys.exit(1)
    print("PASS: GastroFlow Food test APK contents meet static audit requirements.")

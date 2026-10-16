#!/usr/bin/env python3
"""Independent facts about the metadata inside image files.

Written with Pillow (not with the JavaScript under test) so that "the inspector
found the EXIF" and "the sanitizer removed it" are claims checked by a different
implementation. It also hashes the stored pixels, so a Node test can prove that
stripping metadata left the image data byte-identical.

Usage: verify_metadata.py <directory> [--only <substr>]
"""
import hashlib
import json
import os
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

GPS_IFD = 0x8825


def exif_facts(path, image):
    out = {"present": False, "tags": {}, "gps": {"present": False}}
    try:
        exif = image.getexif()
    except Exception:
        return out
    if not exif:
        return out
    out["present"] = True
    names = {
        0x010F: "make",
        0x0110: "model",
        0x0132: "datetime",
        0x010E: "description",
        0x0112: "orientation",
        0x011A: "xresolution",
        0x0131: "software",
        0x013B: "artist",
        0x8298: "copyright",
    }
    for tag, label in names.items():
        if tag in exif:
            value = exif[tag]
            out["tags"][label] = str(value)
    out["tag_count"] = len(list(exif.keys()))
    try:
        gps = exif.get_ifd(GPS_IFD)
    except Exception:
        gps = {}
    if gps:
        out["gps"]["present"] = True
        out["gps"]["tag_count"] = len(list(gps.keys()))
        out["gps"]["latitude"] = [float(v) for v in gps.get(2, [])] or None
        out["gps"]["longitude"] = [float(v) for v in gps.get(4, [])] or None
        out["gps"]["altitude"] = float(gps[6]) if 6 in gps else None
    return out


def facts(path):
    with open(path, "rb") as handle:
        raw = handle.read()
    image = Image.open(path)
    image.load()
    stored = image.convert("RGB").tobytes()
    info = {
        "size": len(raw),
        "format": image.format,
        "width": image.width,
        "height": image.height,
        "mode": image.mode,
        "pixel_sha256": hashlib.sha256(stored).hexdigest(),
        "pixel_bytes": len(stored),
        "exif": exif_facts(path, image),
        "icc_bytes": len(image.info.get("icc_profile") or b""),
        "png_text": sorted((image.text or {}).keys()) if getattr(image, "text", None) else [],
        "xmp_present": (b"x:xmpmeta" in raw) or (b"<?xpacket" in raw),
        "raw_has_gps_chars": b"GPS" in raw,
    }
    return info


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    root = sys.argv[1]
    only = ""
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]

    report = {"images": [], "errors": []}
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if not os.path.isfile(path) or (only and only not in name):
            continue
        if name.endswith(".json") or name.endswith(".bin"):
            continue
        try:
            report["images"].append(dict(facts(path), name=name))
        except Exception as exc:
            report["errors"].append({"name": name, "error": f"{type(exc).__name__}: {exc}"})
    print(json.dumps(report, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

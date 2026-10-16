#!/usr/bin/env python3
"""Independent facts about ZIP archives produced by the script.

Python's `zipfile` parses the container (central directory, local headers, EOCD)
and `zlib.crc32` recomputes every member's checksum, so a bug in the JavaScript
ZIP writer cannot be confirmed by a matching bug in a JavaScript reader. Members
are then decoded with Pillow to prove the payload really is the image we put in.

Usage: verify_zip.py <directory> [--only <substr>]
"""
import hashlib
import io
import json
import os
import sys
import zipfile
import zlib

from PIL import Image


def member_facts(archive, info):
    data = archive.read(info.filename)
    out = {
        "name": info.filename,
        "size": info.file_size,
        "crc": info.CRC,
        "crc_recomputed": zlib.crc32(data) & 0xFFFFFFFF,
        "crc_matches": (zlib.crc32(data) & 0xFFFFFFFF) == info.CRC,
        "compress_type": info.compress_type,
        "bytes_read": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
        out["decoded"] = {
            "format": image.format,
            "width": image.width,
            "height": image.height,
            "mode": image.mode,
            "pixel_sha256": hashlib.sha256(image.convert("RGB").tobytes()).hexdigest(),
        }
    except Exception as exc:
        out["decoded"] = None
        out["decode_error"] = f"{type(exc).__name__}: {exc}"
    return out


def archive_facts(path):
    out = {"size": os.path.getsize(path)}
    with zipfile.ZipFile(path, "r") as archive:
        out["testzip"] = archive.testzip()  # None when every CRC checks out
        out["comment"] = archive.comment.decode("utf-8", "replace") if archive.comment else ""
        infos = archive.infolist()
        out["member_count"] = len(infos)
        out["members"] = [member_facts(archive, info) for info in infos]
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    root = sys.argv[1]
    only = ""
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]

    report = {"archives": [], "errors": []}
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if not os.path.isfile(path) or not name.lower().endswith(".zip"):
            continue
        if only and only not in name:
            continue
        try:
            report["archives"].append(dict(archive_facts(path), name=name))
        except Exception as exc:
            report["errors"].append({"name": name, "error": f"{type(exc).__name__}: {exc}"})
    print(json.dumps(report, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

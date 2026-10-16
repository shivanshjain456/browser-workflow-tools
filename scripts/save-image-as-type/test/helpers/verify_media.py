#!/usr/bin/env python3
"""Independent verification of files produced by the userscript's encoders.

Deliberately written in a different language with different libraries so it
cannot share a bug with the JavaScript encoder under test:

  * Pillow decodes PNG/JPEG/WebP/GIF/BMP pixels and reports frames/delays.
  * pypdf parses the PDF (strict mode, so a wrong xref offset is an error).
  * Raw `struct` parsing re-reads the BMP header, GIF header/blocks and the PDF
    xref table byte by byte, independent of both libraries.

It prints a JSON document of *facts*. The Node test asserts on those facts, so
expectations live in exactly one place.

Usage: verify_media.py <directory> [--only <substr>]
"""
import json
import os
import struct
import sys


def sample_points(w, h):
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, h // 2)]
    if w > 4 and h > 4:
        pts += [(1, 1), (w - 2, h - 2), (w // 4, h // 2)]
    out, seen = [], set()
    for x, y in pts:
        if (x, y) not in seen and 0 <= x < w and 0 <= y < h:
            seen.add((x, y))
            out.append([x, y])
    return out


def pixels_of(img, w, h):
    rgba = img.convert("RGBA")
    return [[x, y, list(rgba.getpixel((x, y)))] for x, y in sample_points(w, h)]


def image_facts(path):
    from PIL import Image

    facts = {"path": path, "bytes": os.path.getsize(path)}
    with open(path, "rb") as fh:
        head = fh.read(32)
    facts["magic"] = head[:12].hex()
    with Image.open(path) as im:
        im.load()
        facts["format"] = im.format
        facts["mode"] = im.mode
        facts["size"] = list(im.size)
        try:
            facts["n_frames"] = getattr(im, "n_frames", 1)
        except Exception as exc:  # pragma: no cover
            facts["n_frames_error"] = str(exc)
            facts["n_frames"] = 1
        facts["info_keys"] = sorted(str(k) for k in im.info.keys())
        if "transparency" in im.info:
            facts["transparency_index"] = im.info["transparency"] if isinstance(im.info["transparency"], int) else str(im.info["transparency"])[:40]
        frames = []
        for i in range(facts["n_frames"]):
            try:
                im.seek(i)
                frames.append({
                    "index": i,
                    "duration_ms": im.info.get("duration"),
                    "size": list(im.size),
                    "pixels": pixels_of(im, im.size[0], im.size[1]),
                })
            except EOFError:
                break
        facts["frames"] = frames
        facts["pixels"] = pixels_of(im, im.size[0], im.size[1])

    base, _ext = os.path.splitext(path)
    ref_rgba = base + ".ref.rgba"
    ref_meta = base + ".ref.json"
    ref_png = base + ".ref.png"
    if os.path.exists(ref_rgba) and os.path.exists(ref_meta):
        # Exact raw RGBA reference written by the JS fixture: no encoder stands
        # between the source pixels and the comparison.
        with open(ref_meta) as fh:
            meta = json.load(fh)
        rw, rh = int(meta["width"]), int(meta["height"])
        with open(ref_rgba, "rb") as fh:
            raw = fh.read()
        if len(raw) != rw * rh * 4:
            facts["delta_vs_reference"] = {"error": f"reference has {len(raw)} bytes, expected {rw * rh * 4}"}
            return facts
        ref_img = Image.frombytes("RGBA", (rw, rh), raw)
        got = Image.open(path).convert("RGBA")
        facts["delta_vs_reference"] = compare_rgba(ref_img, got, os.path.basename(ref_rgba))
        return facts
    if os.path.exists(ref_png):
        from PIL import Image as _Image

        with _Image.open(ref_png) as ref:
            ref = ref.convert("RGBA")
            got = Image.open(path).convert("RGBA")
            if ref.size != got.size:
                facts["delta_vs_reference"] = {"error": f"size mismatch {ref.size} vs {got.size}"}
            else:
                rd, gd = ref.load(), got.load()
                total = 0
                max_delta = 0
                alpha_total = 0
                alpha_max = 0
                w, h = ref.size
                for y in range(h):
                    for x in range(w):
                        a, b = rd[x, y], gd[x, y]
                        for c in range(3):
                            d = abs(a[c] - b[c])
                            total += d
                            if d > max_delta:
                                max_delta = d
                        ad = abs(a[3] - b[3])
                        alpha_total += ad
                        if ad > alpha_max:
                            alpha_max = ad
                facts["delta_vs_reference"] = {
                    "reference": os.path.basename(ref_path),
                    "mean_channel_delta": round(total / (w * h * 3), 4),
                    "max_channel_delta": max_delta,
                    "mean_alpha_delta": round(alpha_total / (w * h), 4),
                    "max_alpha_delta": alpha_max,
                }
    return facts


def compare_rgba(ref, got, label):
    if ref.size != got.size:
        return {"error": f"size mismatch {ref.size} vs {got.size}"}
    rd, gd = ref.load(), got.load()
    w, h = ref.size
    total = 0
    max_delta = 0
    alpha_total = 0
    alpha_max = 0
    worst = None
    opaque_total = 0
    opaque_max = 0
    opaque_pixels = 0
    for y in range(h):
        for x in range(w):
            a, b = rd[x, y], gd[x, y]
            visible = a[3] > 0
            for c in range(3):
                d = abs(a[c] - b[c])
                total += d
                if d > max_delta:
                    max_delta = d
                    worst = [x, y, list(a), list(b)]
                if visible:
                    opaque_total += d
                    if d > opaque_max:
                        opaque_max = d
            if visible:
                opaque_pixels += 1
            ad = abs(a[3] - b[3])
            alpha_total += ad
            if ad > alpha_max:
                alpha_max = ad
    return {
        "reference": label,
        "mean_channel_delta": round(total / (w * h * 3), 4),
        "max_channel_delta": max_delta,
        # Formats with indexed/binary transparency cannot keep the RGB of a
        # fully transparent pixel, so the visible-only numbers are the honest
        # quality measure for GIF.
        "mean_channel_delta_visible": round(opaque_total / (opaque_pixels * 3), 4) if opaque_pixels else 0,
        "max_channel_delta_visible": opaque_max,
        "visible_pixels": opaque_pixels,
        "mean_alpha_delta": round(alpha_total / (w * h), 4),
        "max_alpha_delta": alpha_max,
        "worst_pixel": worst,
    }


def bmp_raw_facts(path):
    """Re-read the BMP header with struct, independent of Pillow."""
    with open(path, "rb") as fh:
        data = fh.read()
    out = {"file_size": len(data), "signature": data[:2].decode("latin-1")}
    (file_size, _r1, _r2, offset) = struct.unpack_from("<IHHI", data, 2)
    out["declared_file_size"] = file_size
    out["pixel_offset"] = offset
    (dib_size,) = struct.unpack_from("<I", data, 14)
    out["dib_header_size"] = dib_size
    if dib_size == 40:
        w, h = struct.unpack_from("<ii", data, 18)
        planes, bpp = struct.unpack_from("<HH", data, 26)
        (compression, image_size, xppm, yppm, clr_used, clr_important) = struct.unpack_from("<IIiiII", data, 30)
        out.update({"width": w, "height": h, "planes": planes, "bpp": bpp, "compression": compression,
                    "image_size": image_size, "x_ppm": xppm, "y_ppm": yppm, "clr_used": clr_used})
        out["variant"] = "BITMAPINFOHEADER (V3)"
        out["expected_pixel_offset"] = 14 + 40
        row_stride = ((w * (bpp // 8)) + 3) & ~3
        out["expected_image_size"] = row_stride * abs(h)
        out["row_stride"] = row_stride
    elif dib_size == 124:
        w, h = struct.unpack_from("<ii", data, 18)
        planes, bpp = struct.unpack_from("<HH", data, 26)
        (compression, image_size) = struct.unpack_from("<II", data, 30)
        masks = struct.unpack_from("<IIII", data, 54)
        (cstype,) = struct.unpack_from("<I", data, 70)
        (intent,) = struct.unpack_from("<I", data, 14 + 108)  # bV5Intent
        out.update({"width": w, "height": h, "planes": planes, "bpp": bpp, "compression": compression,
                    "image_size": image_size, "red_mask": hex(masks[0]), "green_mask": hex(masks[1]),
                    "blue_mask": hex(masks[2]), "alpha_mask": hex(masks[3]),
                    "cstype": hex(cstype), "cstype_ascii": struct.pack("<I", cstype).decode("latin-1"),
                    "intent": intent})
        out["variant"] = "BITMAPV5HEADER"
        out["expected_pixel_offset"] = 14 + 124
        out["expected_image_size"] = w * abs(h) * 4
    else:
        out["variant"] = f"unknown ({dib_size})"
    out["offset_matches"] = out.get("expected_pixel_offset") == offset
    out["size_matches"] = out.get("expected_image_size") == image_size
    out["file_size_matches"] = file_size == len(data)
    # Decode the first stored row by hand to confirm bottom-up BGRA/BGR order.
    if out.get("bpp") in (24, 32) and out.get("width"):
        bpp_bytes = out["bpp"] // 8
        stride = ((out["width"] * bpp_bytes) + 3) & ~3
        first = offset
        px = struct.unpack_from(f"<{bpp_bytes}B", data, first)
        out["first_stored_pixel_raw"] = list(px)
        last_row_start = offset + stride * (abs(out["height"]) - 1)
        px2 = struct.unpack_from(f"<{bpp_bytes}B", data, last_row_start)
        out["last_stored_row_first_pixel_raw"] = list(px2)
    return out


def gif_raw_facts(path):
    """Walk the GIF block structure by hand, independent of Pillow."""
    with open(path, "rb") as fh:
        data = fh.read()
    out = {"file_size": len(data), "signature": data[:6].decode("latin-1")}
    if out["signature"] not in ("GIF87a", "GIF89a"):
        out["error"] = "not a GIF"
        return out
    w, h, packed, bg, aspect = struct.unpack_from("<HHBBB", data, 6)
    gct_flag = bool(packed & 0x80)
    gct_size_bits = (packed & 0x07) + 1
    out.update({"width": w, "height": h, "global_color_table": gct_flag,
                "gct_entries": (1 << gct_size_bits) if gct_flag else 0,
                "color_resolution": ((packed >> 4) & 0x07) + 1,
                "background_index": bg, "aspect": aspect})
    i = 13
    if gct_flag:
        out["gct_first_entry"] = list(data[i:i + 3])
        out["gct_last_entry"] = list(data[i + 3 * ((1 << gct_size_bits) - 1): i + 3 * (1 << gct_size_bits)])
        i += 3 * (1 << gct_size_bits)
    frames = []
    loop_count = None
    max_block = 0
    while i < len(data):
        marker = data[i]
        if marker == 0x3B:
            out["trailer_at"] = i
            break
        if marker == 0x21:
            label = data[i + 1]
            j = i + 2
            sub_blocks = []
            while j < len(data) and data[j] != 0:
                sub_blocks.append(data[j])
                j += data[j] + 1
            if label == 0xFF and j - i >= 14 and data[i + 3:i + 14] == b"NETSCAPE2.0":
                loop_count = struct.unpack_from("<H", data, i + 16)[0]
                out["netscape_extension"] = True
            if label == 0xF9:
                flags = data[i + 3]
                delay, transparent = struct.unpack_from("<HB", data, i + 4)
                frames.append({"type": "gce", "disposal": (flags >> 2) & 0x07,
                               "transparent_flag": bool(flags & 0x01),
                               "delay_cs": delay, "transparent_index": transparent,
                               "block_size": data[i + 2]})
            i = j + 1
            continue
        if marker == 0x2C:
            left, top, fw, fh, fpacked = struct.unpack_from("<HHHHB", data, i + 1)
            lct_flag = bool(fpacked & 0x80)
            j = i + 10
            if lct_flag:
                j += 3 * (1 << ((fpacked & 0x07) + 1))
            min_code_size = data[j]
            j += 1
            blocks = []
            while j < len(data) and data[j] != 0:
                blocks.append(data[j])
                j += data[j] + 1
            max_block = max([max_block] + blocks)
            frames.append({"type": "image", "left": left, "top": top, "width": fw, "height": fh,
                           "local_color_table": lct_flag, "min_code_size": min_code_size,
                           "sub_block_sizes": blocks, "lzw_bytes": sum(blocks)})
            i = j + 1
            continue
        out["parse_error_at"] = i
        break
    out["blocks"] = frames
    out["image_descriptor_count"] = sum(1 for f in frames if f["type"] == "image")
    out["gce_count"] = sum(1 for f in frames if f["type"] == "gce")
    out["loop_count"] = loop_count
    out["max_sub_block_size"] = max_block
    out["sub_blocks_within_limit"] = max_block <= 255
    out["min_code_sizes"] = sorted({f["min_code_size"] for f in frames if f["type"] == "image"})
    return out


def lzw_decode(data, min_code_size, expected_pixels):
    """Independent GIF LZW decoder: proves the encoder's bit stream is legal."""
    if not (2 <= min_code_size <= 8):
        return {"error": f"min_code_size {min_code_size} outside the legal 2..8 range", "decoded": 0}
    if expected_pixels <= 0 or expected_pixels > 100_000_000:
        return {"error": f"expected_pixels {expected_pixels} is not sane", "decoded": 0}
    # Verified against Pillow's own GIF output (test/fixtures/animated.gif) and
    # against this project's encoder: the code-width bump must happen when the
    # next code to be assigned reaches 2**code_size (>=, not >), and the
    # "KwKwK" case (a code not yet in the table) must be reconstructed from the
    # previous entry rather than treated as corruption. With those two rules one
    # decoder reads both producers' streams, including 12-bit codes and
    # clear-code resets.
    clear = 1 << min_code_size
    eoi = clear + 1

    def fresh_table():
        table = {i: [i] for i in range(clear)}
        table[clear] = []
        table[eoi] = []
        return table

    code_size = min_code_size + 1
    next_code = eoi + 1
    table = fresh_table()
    out = []
    bit_pos = 0
    prev = None
    resets = 0
    max_width = code_size
    total_bits = len(data) * 8
    while bit_pos + code_size <= total_bits and len(out) < expected_pixels:
        code = 0
        for b in range(code_size):
            if data[(bit_pos + b) >> 3] & (1 << ((bit_pos + b) & 7)):
                code |= 1 << b
        bit_pos += code_size
        if code == clear:
            code_size = min_code_size + 1
            next_code = eoi + 1
            table = fresh_table()
            prev = None
            resets += 1
            continue
        if code == eoi:
            break
        if code in table:
            entry = table[code]
        elif prev is not None:
            entry = prev + [prev[0]]  # KwKwK
        else:
            return {"error": f"code {code} undefined with no previous entry (code_size {code_size})", "decoded": len(out)}
        out.extend(entry)
        if prev is not None:
            table[next_code] = prev + [entry[0]]
            next_code += 1
            if next_code >= (1 << code_size) and code_size < 12:
                code_size += 1
                max_width = max(max_width, code_size)
        prev = entry
    return {"decoded": len(out), "values": out[:8], "max_index": max(out) if out else None,
            "clear_resets": resets, "max_code_width": max_width}


def pdf_raw_facts(path):
    """Verify the xref table byte-exactly, then let pypdf parse it in strict mode."""
    with open(path, "rb") as fh:
        data = fh.read()
    out = {"file_size": len(data), "header": data[:9].decode("latin-1").rstrip("\n")}
    out["starts_with_pdf"] = data.startswith(b"%PDF-1.4")
    out["ends_with_eof"] = data.rstrip().endswith(b"%%EOF")
    idx = data.rfind(b"startxref")
    out["startxref_found"] = idx >= 0
    if idx >= 0:
        tail = data[idx + 9:].strip().split(b"\n")[0].strip()
        xref_offset = int(tail)
        out["startxref_value"] = xref_offset
        out["xref_keyword_at_offset"] = data[xref_offset:xref_offset + 4].decode("latin-1")
        out["startxref_points_to_xref"] = data[xref_offset:xref_offset + 4] == b"xref"
        # parse the table
        table = data[xref_offset:]
        lines = table.split(b"\n")
        header = lines[1].split()
        start_obj, count = int(header[0]), int(header[1])
        out["xref_start_obj"] = start_obj
        out["xref_count"] = count
        entries = []
        ok = True
        for k in range(count):
            line = lines[2 + k]
            if len(line) < 18:
                ok = False
                break
            off, gen, kind = int(line[0:10]), int(line[11:16]), line[17:18].decode("latin-1")
            entry = {"obj": start_obj + k, "offset": off, "gen": gen, "kind": kind, "entry_bytes": len(line) + 1}
            if kind == "n":
                expected = f"{start_obj + k} 0 obj".encode()
                entry["points_to_object"] = data[off:off + len(expected)] == expected
                ok = ok and entry["points_to_object"]
            entries.append(entry)
        out["xref_entries"] = entries
        out["all_entry_lengths_20"] = all(e["entry_bytes"] == 20 for e in entries)
        out["xref_consistent"] = ok
    # pypdf, strict
    try:
        from pypdf import PdfReader

        reader = PdfReader(path, strict=True)
        out["pypdf_pages"] = len(reader.pages)
        page = reader.pages[0]
        box = page.mediabox
        out["pypdf_mediabox"] = [float(box.left), float(box.bottom), float(box.right), float(box.top)]
        out["pypdf_version"] = reader.pdf_header
        images = list(page.images)
        out["pypdf_image_count"] = len(images)
        if images:
            img = images[0]
            out["pypdf_image_name"] = img.name
            out["pypdf_image_bytes"] = len(img.data)
            out["pypdf_image_data_head"] = img.data[:4].hex()
            try:
                from PIL import Image
                import io

                with Image.open(io.BytesIO(img.data)) as pim:
                    out["embedded_image_format"] = pim.format
                    out["embedded_image_size"] = list(pim.size)
                    out["embedded_image_mode"] = pim.mode
            except Exception as exc:
                out["embedded_image_error"] = str(exc)
        meta = reader.metadata
        if meta:
            out["pypdf_metadata"] = {k: str(v)[:80] for k, v in meta.items()}
    except Exception as exc:
        out["pypdf_error"] = f"{type(exc).__name__}: {exc}"
    return out


def gif_first_image_stream(path):
    """Walk the GIF container and return (min_code_size, lzw_bytes) of frame 1."""
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 14 or data[:3] != b"GIF":
        return None
    packed = data[10]
    i = 13
    if packed & 0x80:
        i += 3 * (1 << ((packed & 0x07) + 1))
    while i < len(data):
        marker = data[i]
        if marker == 0x3B:
            return None
        if marker == 0x21:  # extension: label + sub-blocks
            j = i + 2
            while j < len(data) and data[j] != 0:
                j += data[j] + 1
            i = j + 1
            continue
        if marker == 0x2C:  # image descriptor
            if i + 10 >= len(data):
                return None
            fpacked = data[i + 9]
            j = i + 10
            if fpacked & 0x80:
                j += 3 * (1 << ((fpacked & 0x07) + 1))
            min_code_size = data[j]
            j += 1
            stream = bytearray()
            while j < len(data) and data[j] != 0:
                size = data[j]
                stream.extend(data[j + 1: j + 1 + size])
                j += size + 1
            return min_code_size, bytes(stream)
        return None
    return None


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: verify_media.py <dir>"}))
        return 2
    root = sys.argv[1]
    only = sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--only" else ""
    results = {"images": [], "bmp_raw": [], "gif_raw": [], "gif_lzw": [], "pdf_raw": [], "errors": []}
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if not os.path.isfile(path) or (only and only not in name):
            continue
        if name.endswith(".ref.rgba") or name.endswith(".ref.json") or name.endswith(".ref.png"):
            continue
        ext = name.rsplit(".", 1)[-1].lower()
        rel = name
        try:
            if ext == "pdf":
                results["pdf_raw"].append(dict(pdf_raw_facts(path), name=rel))
            elif ext == "bmp":
                results["bmp_raw"].append(dict(bmp_raw_facts(path), name=rel))
                results["images"].append(dict(image_facts(path), name=rel))
            elif ext == "gif":
                raw = gif_raw_facts(path)
                results["gif_raw"].append(dict(raw, name=rel))
                results["images"].append(dict(image_facts(path), name=rel))
                # Decode the first frame's LZW stream independently, using the
                # offsets recorded by the block walk above (never a byte search:
                # 0x2C also occurs inside colour tables and compressed data).
                stream = gif_first_image_stream(path)
                if stream:
                    stream_min, stream_bytes = stream
                    results["gif_lzw"].append(dict(
                        lzw_decode(stream_bytes, stream_min, raw["width"] * raw["height"]),
                        name=rel, min_code_size=stream_min,
                        stream_bytes=len(stream_bytes),
                        expected_pixels=raw["width"] * raw["height"]))
            else:
                results["images"].append(dict(image_facts(path), name=rel))
        except Exception as exc:
            results["errors"].append({"name": rel, "error": f"{type(exc).__name__}: {exc}"})
    print(json.dumps(results, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

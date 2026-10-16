#!/usr/bin/env python3
"""Generate real image fixtures with Pillow.

These are independent of the JavaScript under test, so they are used both by the
animation-signature parser tests and as the actual page images in the browser
end-to-end tests (real animated WebP, real APNG, real JPEG photo, real
transparency). Run: python3 test/helpers/make_fixtures.py
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures")
os.makedirs(ROOT, exist_ok=True)


def gradient(w, h, hue=0, offset=0):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            r = int(255 * (x / max(1, w - 1)))
            g = int(255 * (y / max(1, h - 1)))
            b = int(128 + 100 * math.sin((x + offset) / 12.0 + hue))
            px[x, y] = (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
    return img


def solid(color, w, h):
    return Image.new("RGBA", (w, h), color)


def frame(color, w, h, label):
    img = Image.new("RGBA", (w, h), color)
    d = ImageDraw.Draw(img)
    d.rectangle([2, 2, w - 3, h - 3], outline=(255, 255, 255, 255), width=2)
    d.ellipse([w // 4, h // 4, w // 2, h // 2], fill=(0, 0, 0, 255))
    return img


written = []


def save(img, name, **kwargs):
    path = os.path.join(ROOT, name)
    img.save(path, **kwargs)
    written.append((name, os.path.getsize(path)))


# --- still images -----------------------------------------------------------
save(gradient(200, 140), "photo.jpg", format="JPEG", quality=90)
save(gradient(64, 48), "opaque.png", format="PNG")

transparent = Image.new("RGBA", (64, 48), (0, 0, 0, 0))
d = ImageDraw.Draw(transparent)
d.ellipse([8, 4, 56, 44], fill=(220, 40, 90, 255))
d.rectangle([0, 0, 6, 48], fill=(20, 120, 220, 180))  # partial alpha band
save(transparent, "transparent.png", format="PNG")

save(gradient(100, 80, hue=1), "still.webp", format="WEBP", quality=90)
save(solid((30, 144, 255, 255), 16, 16), "icon.bmp", format="BMP")
save(gradient(1200, 900), "big.png", format="PNG", optimize=False)  # ~1.1 MP, for the downscale path
save(solid((250, 200, 40, 255), 4, 4), "tiny.png", format="PNG")

with open(os.path.join(ROOT, "logo.svg"), "w", encoding="utf-8") as fh:
    fh.write(
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64">'
        '<rect width="96" height="64" rx="10" fill="#1f6feb"/>'
        '<circle cx="32" cy="32" r="18" fill="#ffd33d"/>'
        '<path d="M56 44 L72 20 L88 44 Z" fill="#ffffff"/>'
        "</svg>"
    )
written.append(("logo.svg", os.path.getsize(os.path.join(ROOT, "logo.svg"))))

# --- animated images (independent producers of the containers we must parse) --
gif_frames = [frame((220, 60, 60, 255), 50, 40, "a"), frame((60, 200, 90, 255), 50, 40, "b"),
              frame((70, 110, 230, 255), 50, 40, "c"), frame((240, 200, 60, 255), 50, 40, "d")]
save(gif_frames[0], "animated.gif", format="GIF", save_all=True, append_images=gif_frames[1:],
     duration=100, loop=0, disposal=1)

webp_frames = [frame((200, 60, 160, 255), 60, 40, "a"), frame((60, 200, 200, 255), 60, 40, "b"),
               frame((240, 160, 40, 255), 60, 40, "c")]
save(webp_frames[0], "animated.webp", format="WEBP", save_all=True, append_images=webp_frames[1:],
     duration=120, loop=0)

apng_frames = [frame((90, 90, 240, 255), 40, 40, "a"), frame((240, 90, 90, 255), 40, 40, "b"),
               frame((90, 240, 90, 255), 40, 40, "c")]
save(apng_frames[0], "animated.apng", format="PNG", save_all=True, append_images=apng_frames[1:],
     duration=150, loop=0)

print("fixtures written to", os.path.abspath(ROOT))
for name, size in written:
    print(f"  {name:16s} {size:>8d} bytes")

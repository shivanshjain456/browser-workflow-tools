#!/usr/bin/env python3
"""Generate images that really carry embedded metadata.

The metadata inspector/sanitizer cannot be tested against fixtures that have
nothing in them, and hand-writing EXIF bytes in JavaScript would mean testing
our writer against our reader. Pillow builds these instead:

  * exif.jpg   — JPEG with EXIF (Make/Model/DateTime/Description), a GPS IFD
                 (latitude, longitude, altitude) and an sRGB ICC profile;
  * exif.webp  — WebP with the same EXIF block (including GPS);
  * text.png   — PNG with tEXt chunks and an XMP packet in an iTXt chunk;
  * plain.jpg  — JPEG with no metadata at all (the negative case: stripping it
                 must be a no-op that changes nothing).

Usage: make_metadata_fixtures.py <output-directory>
"""
import os
import sys

from PIL import Image, ImageCms, PngImagePlugin
from PIL.TiffImagePlugin import IFDRational as Rational

XMP = (
    '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" '
    'dc:format="image/png" dc:title="Fixture with XMP"/>'
    '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
)


def exif_bytes():
    exif = Image.Exif()
    exif[0x010F] = "FixtureCam"          # Make
    exif[0x0110] = "FX-900"              # Model
    exif[0x0132] = "2026:03:04 05:06:07"  # DateTime
    exif[0x010E] = "A test image with location data"  # ImageDescription
    exif[0x0112] = 6                     # Orientation: rotated 90 CW
    exif[0x011A] = Rational(72, 1)       # XResolution
    exif[0x011B] = Rational(72, 1)       # YResolution
    gps = exif.get_ifd(0x8825)
    gps[0x0001] = "N"
    gps[0x0002] = (Rational(48, 1), Rational(51, 1), Rational(3000, 100))
    gps[0x0003] = "E"
    gps[0x0004] = (Rational(2, 1), Rational(20, 1), Rational(0, 1))
    gps[0x0006] = Rational(515, 1)       # altitude in metres
    return exif.tobytes()


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)

    # A gradient rather than a solid colour: identical pixel hashes after
    # stripping then prove the image data really survived, not just its size.
    image = Image.new("RGB", (40, 30))
    pixels = image.load()
    for y in range(30):
        for x in range(40):
            pixels[x, y] = ((x * 6) % 256, (y * 8) % 256, ((x + y) * 4) % 256)

    exif = exif_bytes()
    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()

    image.save(os.path.join(out, "exif.jpg"), exif=exif, icc_profile=icc, quality=92)
    image.save(os.path.join(out, "exif.webp"), exif=exif, quality=92)

    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", "fixture comment")
    info.add_text("Author", "Save Image as Type test harness")
    info.add_itxt("XML:com.adobe.xmp", XMP, lang="")
    image.save(os.path.join(out, "text.png"), pnginfo=info)

    image.save(os.path.join(out, "plain.jpg"), quality=92)

    for name in sorted(os.listdir(out)):
        print(name, os.path.getsize(os.path.join(out, name)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

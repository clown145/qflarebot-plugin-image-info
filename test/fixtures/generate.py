"""Generate tiny synthetic images; no personal photos or external downloads.

Run with: uv run --with pillow --with piexif test/fixtures/generate.py
"""
from pathlib import Path

import piexif
from PIL import Image

root = Path(__file__).parent
image = Image.new("RGB", (32, 24), (64, 128, 192))
metadata = {
    "0th": {piexif.ImageIFD.Make: b"QFlareBot", piexif.ImageIFD.Model: b"Test Camera"},
    "Exif": {
        piexif.ExifIFD.DateTimeOriginal: b"2026:01:02 03:04:05",
        piexif.ExifIFD.ExposureTime: (1, 125),
        piexif.ExifIFD.FNumber: (28, 10),
        piexif.ExifIFD.ISOSpeedRatings: 200,
    },
    "GPS": {
        piexif.GPSIFD.GPSLatitudeRef: b"N",
        piexif.GPSIFD.GPSLatitude: ((35, 1), (30, 1), (0, 1)),
        piexif.GPSIFD.GPSLongitudeRef: b"E",
        piexif.GPSIFD.GPSLongitude: ((139, 1), (45, 1), (0, 1)),
        piexif.GPSIFD.GPSAltitudeRef: 1,
        piexif.GPSIFD.GPSAltitude: (10, 1),
    },
}
exif = piexif.dump(metadata)
for extension in ["jpg", "png", "webp", "tiff"]:
    image.save(root / f"gps.{extension}", exif=exif)
for extension in ["jpg", "png", "gif", "webp"]:
    image.save(root / f"plain.{extension}")
image.save(root / "lossless.webp", lossless=True)
metadata["GPS"][piexif.GPSIFD.GPSLatitudeRef] = b"S"
metadata["GPS"][piexif.GPSIFD.GPSLongitudeRef] = b"W"
image.save(root / "south-west.jpg", exif=piexif.dump(metadata))
metadata["GPS"][piexif.GPSIFD.GPSLatitude] = ((0, 1), (0, 1), (0, 1))
metadata["GPS"][piexif.GPSIFD.GPSLongitude] = ((0, 1), (0, 1), (0, 1))
image.save(root / "zero.jpg", exif=piexif.dump(metadata))
metadata["GPS"][piexif.GPSIFD.GPSLatitude] = ((91, 1), (0, 1), (0, 1))
image.save(root / "invalid-gps.jpg", exif=piexif.dump(metadata))
damaged = bytearray((root / "gps.jpg").read_bytes())
start = damaged.index(b"Exif\0\0") + 6
damaged[start:start + 8] = b"\0" * 8
(root / "damaged-exif.jpg").write_bytes(damaged)

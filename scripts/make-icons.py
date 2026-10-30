#!/usr/bin/env python3
"""
Builds every app icon from resources/icon-source.jpg (the round Time Team
logo on a white square).

    python3 scripts/make-icons.py      # needs Pillow

Writes the web icons into public/icons/ and the Android launcher icons into
resources/android/res/, which the Android workflow copies over the generated
project's defaults. The output is committed, so this only needs re-running
when the logo changes.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'resources' / 'icon-source.jpg'
WEB = ROOT / 'public' / 'icons'
ANDROID = ROOT / 'resources' / 'android' / 'res'

# The logo's own navy, used wherever the icon needs a solid background.
NAVY = (0, 33, 91)
NAVY_HEX = '#00215B'
MASTER = 1024
SUPERSAMPLE = 4


def round_logo():
    """The logo as a crisp disc on transparency, MASTER pixels across."""
    logo = Image.open(SOURCE).convert('RGB').resize((MASTER, MASTER), Image.LANCZOS)
    # A supersampled mask gives an anti-aliased edge; the slight inset drops the
    # white JPEG fringe around the circle.
    big = MASTER * SUPERSAMPLE
    inset = int(big * 0.006)
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).ellipse((inset, inset, big - inset, big - inset), fill=255)
    disc = logo.convert('RGBA')
    disc.putalpha(mask.resize((MASTER, MASTER), Image.LANCZOS))
    return disc


def place(logo, size, scale, background=None):
    """The logo centred on a size x size canvas, its diameter `scale` of the side."""
    canvas = Image.new('RGBA', (size, size), background + (255,) if background else (0, 0, 0, 0))
    diameter = round(size * scale)
    resized = logo.resize((diameter, diameter), Image.LANCZOS)
    offset = (size - diameter) // 2
    canvas.alpha_composite(resized, (offset, offset))
    return canvas


def save(image, path, opaque=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    (image.convert('RGB') if opaque else image).save(path, optimize=True)
    print(f'  {path.relative_to(ROOT)}  {image.width}x{image.height}')


def main():
    logo = round_logo()

    print('Web icons')
    save(place(logo, 512, 1.0), WEB / 'icon-512.png')
    save(place(logo, 192, 1.0), WEB / 'icon-192.png')
    # Maskable icons get cropped to any shape; the logo has to sit inside the
    # central 80% safe zone, on a background that fills the rest.
    save(place(logo, 512, 0.8, NAVY), WEB / 'icon-maskable-512.png', opaque=True)
    # iOS rounds the corners itself and shows transparency as black.
    save(place(logo, 180, 0.9, NAVY), WEB / 'apple-touch-icon.png', opaque=True)
    save(place(logo, 48, 1.0), WEB / 'favicon-48.png')
    save(place(logo, 32, 1.0), WEB / 'favicon-32.png')

    print('Android launcher icons')
    densities = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
    for name, factor in densities.items():
        folder = ANDROID / f'mipmap-{name}'
        # Pre-Android 8 launchers show these as they are.
        legacy = round(48 * factor)
        save(place(logo, legacy, 0.92), folder / 'ic_launcher.png')
        save(place(logo, legacy, 0.92), folder / 'ic_launcher_round.png')
        # Adaptive icons: a 108dp layer of which launchers show at most the
        # middle 72dp, and only guarantee the central 66dp circle.
        save(place(logo, round(108 * factor), 66 / 108), folder / 'ic_launcher_foreground.png')

    values = ANDROID / 'values' / 'ic_launcher_background.xml'
    values.parent.mkdir(parents=True, exist_ok=True)
    values.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="ic_launcher_background">{NAVY_HEX}</color>\n</resources>\n'
    )
    print(f'  {values.relative_to(ROOT)}  {NAVY_HEX}')


if __name__ == '__main__':
    main()

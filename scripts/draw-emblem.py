#!/usr/bin/env python3
"""
Draws the app's emblem: "TIME" and "TEAM" set around a gold ring on a navy
disc, with a pointing trowel cutting into layers of soil in the middle.

    python3 scripts/draw-emblem.py     # needs Pillow and a serif font

Writes resources/icon-source.png, which scripts/make-icons.py turns into every
app icon. The PNG is committed, so this only needs re-running to change the
design.
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'resources' / 'icon-source.png'

SIZE = 1024
SCALE = 4  # drawn large and scaled down, for smooth edges
S = SIZE * SCALE
C = S / 2

NAVY = (0, 33, 91, 255)
GOLD = (214, 176, 76, 255)
GOLD_DARK = (168, 128, 44, 255)
GOLD_DEEP = (124, 92, 30, 255)

# Bold classical capitals; the first one installed wins.
FONTS = [
    '/usr/share/fonts/opentype/linux-libertine/LinLibertine_RB.otf',
    '/usr/share/fonts/opentype/urw-base35/C059-Bold.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
]

# Radii as fractions of the disc's radius.
OUTER_RING = 0.955
TEXT_RADIUS = 0.80  # the letters' vertical centre
INNER_RING = 0.635


def font(size):
    for path in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit('No serif font found; add one to FONTS.')


def ring(draw, radius, width):
    r = radius * C
    draw.ellipse((C - r, C - r, C + r, C + r), outline=GOLD, width=width)


def arched_word(canvas, word, centre_angle, bottom):
    """Letters spaced along an arc, upright to the reader at the arc's centre."""
    face = font(int(S * 0.14))
    radius = TEXT_RADIUS * C
    tracking = S * 0.028
    widths = [face.getlength(letter) for letter in word]
    total = sum(widths) + tracking * (len(word) - 1)
    # Top words run clockwise, bottom words anticlockwise, so both read left
    # to right.
    direction = -1 if bottom else 1
    position = -total / 2
    for letter, width in zip(word, widths):
        middle = position + width / 2
        angle = centre_angle + direction * middle / radius
        glyph = Image.new('RGBA', (int(width * 1.6), int(S * 0.2)), (0, 0, 0, 0))
        ImageDraw.Draw(glyph).text(
            (glyph.width / 2, glyph.height / 2), letter, font=face, fill=GOLD, anchor='mm'
        )
        # A letter at the top stands upright; elsewhere it leans with the arc.
        turn = math.degrees(angle + math.pi / 2) if not bottom else math.degrees(angle - math.pi / 2)
        glyph = glyph.rotate(-turn, resample=Image.BICUBIC, expand=True)
        x = C + radius * math.cos(angle) - glyph.width / 2
        y = C + radius * math.sin(angle) - glyph.height / 2
        canvas.alpha_composite(glyph, (round(x), round(y)))
        position += width + tracking


def diamond(draw, angle, size):
    x = C + TEXT_RADIUS * C * math.cos(angle)
    y = C + TEXT_RADIUS * C * math.sin(angle)
    d = size * S
    draw.polygon([(x, y - d), (x + d * 0.7, y), (x, y + d), (x - d * 0.7, y)], fill=GOLD)


def strata(canvas):
    """Wavy bands of soil filling the lower part of the inner circle."""
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    r = INNER_RING * C
    bands = [
        (0.20, GOLD, 0.030, 1.0),
        (0.40, GOLD_DARK, 0.022, 2.3),
        (0.60, GOLD_DEEP, 0.026, 3.1),
    ]
    gap = 0.045
    for top, colour, wave, phase in bands:
        edge = [
            (x, C + (top + wave * math.sin(x / S * 9 + phase)) * r)
            for x in range(0, S + 1, S // 128)
        ]
        draw.polygon(edge + [(S, S), (0, S)], fill=colour)
        # A navy seam above each band keeps the layers apart.
        draw.line(edge, fill=NAVY, width=int(gap * r * 0.5))
    # A few stones in the soil.
    for fx, fy, fr in [(-0.55, 0.32, 0.035), (0.48, 0.50, 0.03), (-0.2, 0.74, 0.04), (0.2, 0.30, 0.025)]:
        x, y, s = C + fx * r, C + fy * r, fr * r
        draw.ellipse((x - s, y - s * 0.75, x + s, y + s * 0.75), fill=NAVY)

    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).ellipse((C - r, C - r, C + r, C + r), fill=255)
    clipped = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    clipped.paste(layer, (0, 0), mask)
    canvas.alpha_composite(clipped)


def trowel(canvas):
    """A pointing trowel, tip down into the top layer, leaning to the right."""
    u = INNER_RING * C / 330  # trowel units: the inner circle is 300 across
    w, h = int(260 * u), int(620 * u)
    art = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(art)
    ox, oy = w / 2, 0

    def p(x, y):
        return (ox + x * u, oy + y * u)

    outline = int(6 * u)
    # Handle, with a ferrule where it meets the tang.
    draw.rounded_rectangle((*p(-30, 20), *p(30, 205)), radius=28 * u, fill=GOLD, outline=NAVY, width=outline)
    draw.rectangle((*p(-24, 195), *p(24, 228)), fill=GOLD_DARK, outline=NAVY, width=outline)
    # Tang from the handle down to the blade's heel.
    draw.rectangle((*p(-14, 224), *p(14, 292)), fill=GOLD, outline=NAVY, width=outline)
    # Blade: a long kite, widest just below the heel.
    blade = [p(0, 600), p(-92, 312), p(-84, 288), p(84, 288), p(92, 312)]
    draw.polygon(blade, fill=GOLD, outline=NAVY, width=outline)
    # Raised spine down the blade.
    draw.line([p(0, 296), p(0, 560)], fill=GOLD_DARK, width=int(10 * u))

    art = art.rotate(-28, resample=Image.BICUBIC, expand=True)
    x = C - art.width / 2 + 0.05 * INNER_RING * C
    y = C - art.height / 2 - 0.06 * INNER_RING * C
    canvas.alpha_composite(art, (round(x), round(y)))


def main():
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((0, 0, S - 1, S - 1), fill=NAVY)
    ring(draw, OUTER_RING, int(S * 0.008))
    ring(draw, INNER_RING, int(S * 0.012))

    strata(canvas)
    trowel(canvas)

    arched_word(canvas, 'TIME', -math.pi / 2, bottom=False)
    arched_word(canvas, 'TEAM', math.pi / 2, bottom=True)
    draw = ImageDraw.Draw(canvas)
    diamond(draw, math.pi, 0.022)
    diamond(draw, 0, 0.022)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.resize((SIZE, SIZE), Image.LANCZOS).save(OUTPUT, optimize=True)
    print(f'  {OUTPUT.relative_to(ROOT)}  {SIZE}x{SIZE}')


if __name__ == '__main__':
    main()

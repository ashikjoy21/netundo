#!/usr/bin/env python3
"""
Generate the static Open Graph images used by outage status share links
(apps/web/public/og/outage-*.png). The live numbers go in og:title /
og:description; these images just set the tone per status.

    python3 scripts/make-og-images.py [--font /path/to/Bold.ttf]

Requires Pillow. 1200x630 PNG, kept well under WhatsApp's ~300 KB limit.
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'apps', 'web', 'public', 'og')
W, H = 1200, 630

VARIANTS = {
    'down': ('#B91C1C', '#EF4444', 'Internet down?', 'Live outage reports from people near you'),
    'slow': ('#B45309', '#F59E0B', 'Internet very slow?', 'Live reports from people near you'),
    'dropping': ('#C2410C', '#FB923C', 'Connection keeps dropping?', 'Live reports from people near you'),
    'none': ('#7C2D12', '#FF5A1E', 'Is the net down near you?', 'Live internet outage reports across Kerala'),
}

FONT_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
]


def gradient(c1, c2):
    a = tuple(int(c1[i:i + 2], 16) for i in (1, 3, 5))
    b = tuple(int(c2[i:i + 2], 16) for i in (1, 3, 5))
    img = Image.new('RGB', (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            t = (x / W) * 0.6 + (y / H) * 0.4
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return img


def fit(draw, text, font_path, max_w, start):
    size = start
    while size > 30:
        f = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 4
    return ImageFont.truetype(font_path, size)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--font')
    args = ap.parse_args()
    font = args.font or next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
    if not font:
        raise SystemExit('No bold TTF found; pass --font')
    os.makedirs(OUT, exist_ok=True)

    for name, (c1, c2, title, sub) in VARIANTS.items():
        img = gradient(c1, c2)
        d = ImageDraw.Draw(img)
        # Signal-strength motif, top right.
        for i, h in enumerate((60, 110, 160, 210)):
            x = 930 + i * 58
            fill = (255, 255, 255, 255) if (name == 'none' or i < 1) else None
            d.rounded_rectangle([x, 290 - h, x + 40, 290], radius=10,
                                fill=(255, 255, 255) if fill else None,
                                outline=(255, 255, 255), width=5)
        if name != 'none':
            d.line([920, 70, 1160, 300], fill=(255, 255, 255), width=14)

        d.text((80, 70), 'netundo', font=ImageFont.truetype(font, 46), fill=(255, 255, 255))
        title_font = fit(d, title, font, 1040, 92)
        d.text((80, 360), title, font=title_font, fill=(255, 255, 255))
        d.text((80, 480), sub, font=ImageFont.truetype(font, 38), fill=(255, 235, 225))
        d.text((80, 545), 'Report it free at netundo.com', font=ImageFont.truetype(font, 30), fill=(255, 220, 205))

        path = os.path.join(OUT, f'outage-{name}.png')
        img.save(path, optimize=True)
        print(f'{path}  {os.path.getsize(path) // 1024} KB')


if __name__ == '__main__':
    main()

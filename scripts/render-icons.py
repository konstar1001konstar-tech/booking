"""Растровые иконки БьютиЛинк из SVG в brand/ и favicon.svg.

Нужны Playwright (Chromium/Chrome) и Pillow:
  python scripts/render-icons.py [--chrome /usr/bin/google-chrome]
Пишет apple-touch-icon.png (180, без скругления — iOS скругляет сам),
icon-192.png, icon-512.png и favicon.ico (16/32/48).
"""
import asyncio, io, os, sys
from PIL import Image
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = sys.argv[sys.argv.index('--chrome') + 1] if '--chrome' in sys.argv else None


async def render(page, svg_path, size):
    svg = open(os.path.join(ROOT, svg_path), encoding='utf-8').read()
    svg = svg.replace('<svg ', f'<svg width="{size}" height="{size}" ', 1)
    await page.set_viewport_size({'width': size, 'height': size})
    await page.set_content(f'<html><body style="margin:0">{svg}</body></html>')
    png = await page.screenshot(omit_background=True, clip={'x': 0, 'y': 0, 'width': size, 'height': size})
    return Image.open(io.BytesIO(png)).convert('RGBA')


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        page = await browser.new_page()
        (await render(page, 'brand/app-icon-square.svg', 180)).convert('RGB').save(os.path.join(ROOT, 'apple-touch-icon.png'), optimize=True)
        for size in (192, 512):
            (await render(page, 'brand/app-icon.svg', size)).save(os.path.join(ROOT, f'icon-{size}.png'), optimize=True)
        # Фавикон рисуется по размерам отдельно: так 16 и 32 px остаются чёткими.
        frames = [await render(page, 'favicon.svg', s) for s in (48, 32, 16)]
        frames[0].save(os.path.join(ROOT, 'favicon.ico'), sizes=[(48, 48), (32, 32), (16, 16)], append_images=frames[1:])
        await browser.close()

asyncio.run(main())

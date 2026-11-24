"""生成浏览器扩展用的 PNG 图标（和安卓应用同一个原创图案：悬浮的小球、向上的气流、影子）。
用法：python3 web/make-icons.py   （需要 Pillow；生成的 PNG 已提交，平时不用再跑）"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent / 'icons'
SS = 8  # 先画大图再缩小，边缘更平滑


def draw(size):
    s = size * SS
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    # 圆角方形背景，左上深蓝到右下靛蓝的渐变
    grad = Image.new('RGBA', (s, s))
    a, b = (0x14, 0x1A, 0x2E), (0x2B, 0x3F, 0x8F)
    px = grad.load()
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * (s - 1))
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=round(s * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # 坐标按 72×72 的设计稿（安卓图标的安全区 18..90）换算
    k = s / 72

    def p(x, y):
        return (x * k, y * k)

    r = 10 * k
    cx, cy = p(36, 17)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    w1 = max(1, round(4.2 * k))
    d.line([p(25, 43), p(36, 34), p(47, 43)], fill=(255, 255, 255, 220), width=w1, joint='curve')
    w2 = max(1, round(3.6 * k))
    d.line([p(28, 54), p(36, 47.5), p(44, 54)], fill=(255, 255, 255, 150), width=w2, joint='curve')
    ex, ey = p(36, 63)
    d.ellipse([ex - 15 * k, ey - 3.8 * k, ex + 15 * k, ey + 3.8 * k], fill=(255, 255, 255, 105))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    draw(size).save(OUT / f'icon{size}.png')
print('icons written to', OUT)

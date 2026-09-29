"""
X-SSH 图标生成器:一套几何 + 配色,产出所有平台的图标文件。

    python build/icon-src/make_icons.py        (需要 Python 3 + Pillow + numpy)

新标识是两根交叉的银色条(白天 / 夜间两套配色,见 reference/)。几何是从参考图拟合出来的:
两根镜像对称的平行四边形,上下端水平切口,倾角约 45.4°,四角倒圆 —— 和参考图的形状 IoU 0.97。

产出:
- build/icon.icon/            macOS 26 / 27 的 Icon Composer 文档(Liquid Glass 分层图标):
                              按 Apple HIG,图层是**不带圆角的方形**矢量(SVG),圆角、高光、阴影、
                              折射由系统加;默认 / 深色两种外观(背景 fill + 两套条的配色),
                              透明 / 着色外观由系统从默认外观生成。electron-builder >= 26.2 会用
                              Xcode 26 的 actool 把它编进 Assets.car(只能在 Mac 上打包)。
- build/icon.png / icon-512.png / icon-256.png / icon.ico / icon.svg
                              Windows、Linux、托盘、窗口图标:夜间配色的圆角方块(整块铺满)。
- src/renderer/src/assets/logo-light.png / logo-dark.png
                              欢迎页的标识(「X」+「SSH」),裁自参考图,背景抠成透明。
- src/renderer/src/assets/mark-light.svg / mark-dark.svg
                              只有「X」的矢量图:连接页背景水印、侧栏收起时的标。
- mobile/android/.../res/     自适应图标(白天 / 夜间)、单色主题图标、状态栏小图标。
"""
import io
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BUILD = os.path.join(ROOT, "build")
REF = os.path.join(HERE, "reference")
ANDROID_RES = os.path.join(ROOT, "mobile", "android", "app", "src", "main", "res")
RENDERER_ASSETS = os.path.join(ROOT, "src", "renderer", "src", "assets")

# ── 几何(1024 画布,居中) ──────────────────────────────────────────────
C = 512.0
H = 585.0          # 条的竖直高度(上下端水平切口之间)
W = 262.0          # 条的水平宽度
SLOPE = 1.015      # 每下降 1 水平移动多少(≈45.4°)
R = 63.0           # 圆角半径
SHIFT = H * SLOPE
T = W * math.cos(math.atan(SLOPE))   # 垂直于条方向的粗细


def bar_polys(cx=C, cy=C, scale=1.0):
    """(front, back):front 是「\\」(压在上面),back 是「/」。顶点顺时针。"""
    h, w, s = H * scale, W * scale, SHIFT * scale
    y0, y1 = cy - h / 2, cy + h / 2
    x0 = cx - (s + w) / 2
    front = [(x0, y0), (x0 + w, y0), (x0 + w + s, y1), (x0 + s, y1)]
    back = [(2 * cx - x, y) for (x, y) in front]
    back = [back[1], back[0], back[3], back[2]]
    return front, back


def bar_axis(poly):
    """条的中轴:上端中点 → 下端中点;以及指向「右下」的法向量(单位)。"""
    (a, b, c, d) = poly
    top = ((a[0] + b[0]) / 2, a[1])
    bot = ((c[0] + d[0]) / 2, c[1])
    ax, ay = bot[0] - top[0], bot[1] - top[1]
    ln = math.hypot(ax, ay)
    ux, uy = ax / ln, ay / ln
    nx, ny = -uy, ux
    if nx + ny < 0:
        nx, ny = -nx, -ny
    return top, bot, (nx, ny)


def rounded(pts, r, steps=32):
    """凸多边形每个角倒圆。返回 (折线点列, SVG 路径 d, Android pathData)。"""
    out, svg = [], []
    n = len(pts)
    for i in range(n):
        p, a, b = pts[i], pts[i - 1], pts[(i + 1) % n]
        ux, uy = a[0] - p[0], a[1] - p[1]
        vx, vy = b[0] - p[0], b[1] - p[1]
        lu, lv = math.hypot(ux, uy), math.hypot(vx, vy)
        ux, uy, vx, vy = ux / lu, uy / lu, vx / lv, vy / lv
        ang = math.acos(max(-1.0, min(1.0, ux * vx + uy * vy)))
        d = r / math.tan(ang / 2)
        t1 = (p[0] + ux * d, p[1] + uy * d)
        t2 = (p[0] + vx * d, p[1] + vy * d)
        bx, by = ux + vx, uy + vy
        lb = math.hypot(bx, by)
        cdist = r / math.sin(ang / 2)
        c = (p[0] + bx / lb * cdist, p[1] + by / lb * cdist)
        a1 = math.atan2(t1[1] - c[1], t1[0] - c[0])
        a2 = math.atan2(t2[1] - c[1], t2[0] - c[0])
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        for k in range(steps + 1):
            t = a1 + da * k / steps
            out.append((c[0] + r * math.cos(t), c[1] + r * math.sin(t)))
        sweep = 1 if da > 0 else 0
        svg.append(("L" if svg else "M") + f"{t1[0]:.2f},{t1[1]:.2f}")
        svg.append(f"A{r:.2f},{r:.2f} 0 0,{sweep} {t2[0]:.2f},{t2[1]:.2f}")
    d = " ".join(svg) + " Z"
    return out, d, d.replace(" Z", "Z")


# ── 配色(沿中轴的色标 t: 0 = 上端,1 = 下端;从参考图中轴取色) ──────────
PALETTES = {
    "light": {
        "bg": ("#ffffff", "#ffffff"),
        "front": [(0.0, "#e4e7eb"), (0.089, "#d6d9df"), (0.172, "#bec3cb"), (0.256, "#a5abb3"),
                  (0.339, "#8a929a"), (0.423, "#848c95"), (0.506, "#858d96"), (0.590, "#8b939c"),
                  (0.673, "#979da6"), (0.757, "#a4aab3"), (0.840, "#adb3bb"), (0.924, "#b6bbc5"),
                  (1.0, "#bfc4cc")],
        "back": [(0.0, "#878d94"), (0.080, "#6f757c"), (0.165, "#565c63"), (0.249, "#3f444b"),
                 (0.333, "#2e3338"), (0.500, "#262a2f"), (0.670, "#2c3138"), (0.754, "#4e555e"),
                 (0.838, "#7b828b"), (0.922, "#9fa4ad"), (1.0, "#b3b8bf")],
        # 横向:front 两条长边更亮(圆柱感);back 左上边暗、右下边亮。
        "front_edge": 0.35,
        "back_dark": 0.18,
        "back_light": 0.16,
    },
    "dark": {
        "bg": ("#0e0f13", "#030306"),
        "front": [(0.0, "#eef1f5"), (0.089, "#e2e6eb"), (0.172, "#bec5cf"), (0.256, "#9ea6b3"),
                  (0.339, "#818a99"), (0.423, "#77808f"), (0.506, "#6d7887"), (0.590, "#67707d"),
                  (0.673, "#6a7381"), (0.757, "#7b8494"), (0.840, "#8b94a3"), (0.924, "#8d97a3"),
                  (1.0, "#97a1ad")],
        "back": [(0.0, "#abb2bd"), (0.080, "#949ba6"), (0.165, "#646b77"), (0.249, "#40454f"),
                 (0.333, "#20262d"), (0.500, "#181c21"), (0.670, "#1c2026"), (0.754, "#333942"),
                 (0.838, "#535a66"), (0.922, "#808794"), (1.0, "#949ba7")],
        "front_edge": 0.45,
        "back_dark": 0.30,
        "back_light": 0.28,
    },
}


def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


# ── 位图渲染(numpy,与 SVG 同一套几何和色标) ─────────────────────────────
def poly_mask(pts, size, ss=4):
    img = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(img).polygon([(x * ss * size / 1024, y * ss * size / 1024) for x, y in pts], fill=255)
    return np.asarray(img.resize((size, size), Image.LANCZOS), dtype=np.float32) / 255.0


# 小尺寸优化:夜间配色里「/」条中段几乎和底一样黑(大图上是压在下面的阴影,很好看),
# 可 16~24px 时它会整段消失,只剩一撇「\」。所以小图把这根条最暗的部分往 SMALL_FLOOR 抬:
# 16px 抬满,64px 及以上完全不动(Apple 只要大图;Windows / 托盘的小图才受影响)。
SMALL_FLOOR = "#4d545e"
SMALL_FULL, SMALL_NONE = 16, 64


def small_lift(rgb, size):
    k = float(np.clip((SMALL_NONE - size) / (SMALL_NONE - SMALL_FULL), 0, 1))
    if k == 0:
        return rgb
    fl = hex2rgb(SMALL_FLOOR)
    lift = np.clip((fl.mean() - rgb.mean(axis=-1, keepdims=True)) / fl.mean(), 0, 1) * k
    return rgb + (fl - rgb) * lift


def bar_color(poly, stops, size, edge_mode, pal):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    k = 1024.0 / size
    px, py = (xx + 0.5) * k, (yy + 0.5) * k
    top, bot, (nx, ny) = bar_axis(poly)
    ax, ay = bot[0] - top[0], bot[1] - top[1]
    t = np.clip(((px - top[0]) * ax + (py - top[1]) * ay) / (ax * ax + ay * ay), 0, 1)
    ts = np.array([s[0] for s in stops], dtype=np.float32)
    cols = np.stack([hex2rgb(s[1]) for s in stops])
    rgb = np.stack([np.interp(t, ts, cols[:, i]) for i in range(3)], axis=-1)
    mx, my = (top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2
    v = np.clip(((px - mx) * nx + (py - my) * ny) / (T / 2), -1, 1)[..., None]
    if edge_mode == "front":
        w = pal["front_edge"] * v * v
        rgb = rgb + (255 - rgb) * w
    else:
        wl = pal["back_light"] * np.clip(v, 0, 1)
        wd = pal["back_dark"] * np.clip(-v, 0, 1)
        rgb = rgb + (255 - rgb) * wl
        rgb = rgb * (1 - wd)
        if pal is PALETTES["dark"]:
            rgb = small_lift(rgb, size)
    return rgb


def render_glyph(size, pal_name, scale=1.0, bg=True):
    """整块方形(不切圆角)。bg=False 时背景透明。返回 RGBA 的 PIL 图。"""
    pal = PALETTES[pal_name]
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    g = ((xx + yy) / (2 * size - 2))[..., None]
    c0, c1 = hex2rgb(pal["bg"][0]), hex2rgb(pal["bg"][1])
    rgb = c0 * (1 - g) + c1 * g
    alpha = np.ones((size, size), np.float32) if bg else np.zeros((size, size), np.float32)
    front, back = bar_polys(scale=scale)
    for poly, stops, mode in ((back, pal["back"], "back"), (front, pal["front"], "front")):
        pts, _, _ = rounded(poly, R * scale)
        m = poly_mask(pts, size)[..., None]
        col = bar_color(poly, stops, size, mode, pal)
        rgb = rgb * (1 - m) + col * m
        alpha = np.maximum(alpha, m[..., 0])
    out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


# 连续曲率的圆角方块(和原来 build/icon.svg 同一条超椭圆,n=5)
def squircle_pts(size, n=5.0, steps=720):
    r = size / 2
    pts = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        c, s = math.cos(a), math.sin(a)
        x = r + r * math.copysign(abs(c) ** (2 / n), c)
        y = r + r * math.copysign(abs(s) ** (2 / n), s)
        pts.append((x, y))
    return pts


def tile(size, pal_name):
    img = render_glyph(size, pal_name)
    ss = 4
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).polygon([(x * ss, y * ss) for x, y in squircle_pts(size)], fill=255)
    m = m.resize((size, size), Image.LANCZOS)
    img.putalpha(m)
    return img


# ── SVG ─────────────────────────────────────────────────────────────────
def svg_gradients(prefix, poly, pal, mode):
    top, bot, (nx, ny) = bar_axis(poly)
    stops = "".join(f'<stop offset="{t:.3f}" stop-color="{c}"/>' for t, c in pal[mode])
    axis = (f'<linearGradient id="{prefix}-axis" gradientUnits="userSpaceOnUse" '
            f'x1="{top[0]:.2f}" y1="{top[1]:.2f}" x2="{bot[0]:.2f}" y2="{bot[1]:.2f}">{stops}</linearGradient>')
    mx, my = (top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2
    e1 = (mx - nx * T / 2, my - ny * T / 2)
    e2 = (mx + nx * T / 2, my + ny * T / 2)
    if mode == "front":
        k = pal["front_edge"]
        ops = [(0, k), (0.25, k * 0.25), (0.5, 0), (0.75, k * 0.25), (1, k)]
        sheen = "".join(f'<stop offset="{o}" stop-color="#ffffff" stop-opacity="{a:.3f}"/>' for o, a in ops)
    else:
        sheen = (f'<stop offset="0" stop-color="#000000" stop-opacity="{pal["back_dark"]:.3f}"/>'
                 '<stop offset="0.5" stop-color="#000000" stop-opacity="0"/>'
                 '<stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>'
                 f'<stop offset="1" stop-color="#ffffff" stop-opacity="{pal["back_light"]:.3f}"/>')
    cross = (f'<linearGradient id="{prefix}-cross" gradientUnits="userSpaceOnUse" '
             f'x1="{e1[0]:.2f}" y1="{e1[1]:.2f}" x2="{e2[0]:.2f}" y2="{e2[1]:.2f}">{sheen}</linearGradient>')
    return axis + cross


def svg_bar(prefix, poly, pal, mode):
    _, d, _ = rounded(poly, R)
    return (f'<path d="{d}" fill="url(#{prefix}-axis)"/>'
            f'<path d="{d}" fill="url(#{prefix}-cross)"/>')


def svg_layer(pal_name, which):
    """Icon Composer 用的单层:1024 方形画布、透明背景、不切圆角(系统来切)。"""
    pal = PALETTES[pal_name]
    front, back = bar_polys()
    poly = front if which == "front" else back
    p = f"{which}-{pal_name}"
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
            f'<defs>{svg_gradients(p, poly, pal, which)}</defs>{svg_bar(p, poly, pal, which)}</svg>\n')


def svg_full(pal_name, masked):
    pal = PALETTES[pal_name]
    front, back = bar_polys()
    sq = " ".join(("M" if i == 0 else "L") + f"{x:.2f},{y:.2f}" for i, (x, y) in enumerate(squircle_pts(1024, steps=240))) + " Z"
    clip = f'<clipPath id="sq"><path d="{sq}"/></clipPath>' if masked else ""
    bg = (f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
          f'<stop offset="0" stop-color="{pal["bg"][0]}"/><stop offset="1" stop-color="{pal["bg"][1]}"/></linearGradient>')
    body = (f'<rect width="1024" height="1024" fill="url(#bg)"/>'
            f'{svg_bar("b", back, pal, "back")}{svg_bar("f", front, pal, "front")}')
    if masked:
        body = f'<g clip-path="url(#sq)">{body}</g>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
            f'<defs>{bg}{clip}{svg_gradients("b", back, pal, "back")}{svg_gradients("f", front, pal, "front")}</defs>'
            f'{body}</svg>\n')


# ── Icon Composer 文档 ────────────────────────────────────────────────────
def srgb(h, a=1.0):
    r, g, b = (hex2rgb(h) / 255.0).tolist()
    return f"srgb:{r:.5f},{g:.5f},{b:.5f},{a:.5f}"


def icon_json():
    import json

    def layer(which, pal, hidden_in_dark):
        return {
            "glass": True,
            "hidden-specializations": [
                {"value": not hidden_in_dark if pal == "dark" else False},
                {"appearance": "dark", "value": hidden_in_dark},
            ],
            "image-name": f"{which}-{pal}.svg",
            "name": f"{which}-{pal}",
        }

    doc = {
        "color-space-for-untagged-svg-colors": "srgb",
        "fill-specializations": [
            {"value": {"solid": srgb("#ffffff")}},
            {"appearance": "dark", "value": {
                "linear-gradient": [srgb(PALETTES["dark"]["bg"][0]), srgb(PALETTES["dark"]["bg"][1])],
                "orientation": {"start": {"x": 0.5, "y": 0}, "stop": {"x": 0.5, "y": 1}},
            }},
        ],
        # 第一组在最上面(和 Icon Composer 自己存的顺序一致):压在上面的「\」一组,「/」一组。
        # 分成两组,系统给两根条各自算高光和彼此之间的阴影 —— HIG:不要自己画阴影。
        "groups": [
            {
                "name": "front",
                "layers": [layer("front", "light", True), layer("front", "dark", False)],
                "lighting": "individual",
                "shadow": {"kind": "neutral", "opacity": 0.5},
                "specular": True,
                "translucency": {"enabled": True, "value": 0.2},
            },
            {
                "name": "back",
                "layers": [layer("back", "light", True), layer("back", "dark", False)],
                "lighting": "individual",
                "shadow": {"kind": "neutral", "opacity": 0.5},
                "specular": True,
                "translucency": {"enabled": True, "value": 0.2},
            },
        ],
        "supported-platforms": {"squares": ["macOS"]},
    }
    return json.dumps(doc, indent=2) + "\n"


# ── 欢迎页标识:从参考横幅裁出「X SSH」,背景抠成透明 ─────────────────────
def color_to_alpha(rgb, bg, floor=0.14):
    """GIMP「颜色转透明度」:把纯色背景去掉,半透明边缘也还原成正确的前景色 + alpha。"""
    rgb = rgb.astype(np.float32) / 255.0
    bg = np.array(bg, np.float32) / 255.0
    alpha = np.zeros(rgb.shape[:2], np.float32)
    # 只按一个方向算不透明度:深底上的画面都比底亮,浅底上的都比底暗。反方向的差只可能是噪点,
    # 而且分母很小会被放大 —— 22 级的黑底上暗 3 级就成了 14% 不透明,整片底子泛起一层雾。
    dark_bg = bg.mean() < 0.5
    for i in range(3):
        c, b = rgb[..., i], bg[i]
        a_i = np.where(c > b, (c - b) / (1 - b), 0) if dark_bg else np.where(c < b, (b - c) / b, 0)
        alpha = np.maximum(alpha, a_i)
    # 参考图是有损压缩的,纯色背景上有一层噪点:低于门槛 floor 的一律当背景,其余线性拉回 0~1。
    # 门槛要按每张图的底噪定 —— 定高了会把最浅的那部分画面也当成背景抠掉。
    alpha = np.clip((alpha - floor) / (1 - floor), 0, 1)
    fg = np.where(alpha[..., None] > 1e-4, (rgb - bg) / np.maximum(alpha[..., None], 1e-4) + bg, 0)
    out = np.dstack([np.clip(fg, 0, 1) * 255, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def main_run(flags, gap=80):
    """只取最大的那一块内容(参考图边缘有零星的压缩斑点,会把包围盒撑到整幅宽)。"""
    runs, start, last = [], None, None
    for i, f in enumerate(flags):
        if f:
            if start is None:
                start = i
            elif i - last > gap:
                runs.append((start, last))
                start = i
            last = i
    if start is not None:
        runs.append((start, last))
    return max(runs, key=lambda r: r[1] - r[0])


def matte(a, floor=0.14):
    """纯色底的参考图 → 透明底,裁到内容。"""
    bg = np.median(np.concatenate([a[:12, :12].reshape(-1, 3), a[-12:, -12:].reshape(-1, 3)]), axis=0)
    img = color_to_alpha(a, bg, floor)
    # 底噪上游已经按门槛清掉了,这里用低门槛找内容 —— 用 96 会把很浅的条端(白天版图标)裁掉一截。
    solid = np.asarray(img)[..., 3] > 8
    x0, x1 = main_run(solid.sum(axis=0) > 2)
    y0, y1 = main_run(solid[:, x0:x1 + 1].sum(axis=1) > 2)
    img = img.crop((max(0, x0 - 16), max(0, y0 - 16), x1 + 17, y1 + 17))
    return img.crop(img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())


def svg_mark(pal_name):
    """只有两根条的「X」矢量图(透明底、裁到图形本身),连接页的背景水印和侧栏收起时的标用。
    和图标同一套几何与渐变;矢量的好处是放大、旋转都不糊 —— 参考图里的 X 只有约 740px 高。"""
    pal = PALETTES[pal_name]
    front, back = bar_polys()
    xs = [x for poly in (front, back) for x, _ in poly]
    ys = [y for poly in (front, back) for _, y in poly]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    vb = f"{x0:.2f} {y0:.2f} {x1 - x0:.2f} {y1 - y0:.2f}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{x1 - x0:.0f}" height="{y1 - y0:.0f}">'
            f'<defs>{svg_gradients("b", back, pal, "back")}{svg_gradients("f", front, pal, "front")}</defs>'
            f'{svg_bar("b", back, pal, "back")}{svg_bar("f", front, pal, "front")}</svg>\n')


def lockups():
    """欢迎页字标 = 应用图标里的「X」+ 设计稿里的「SSH」,白天 / 夜间各一张。
    两样都直接用用户给的原图(reference/icon-*.webp、ssh-*.png),只抠底、缩放、排版 ——
    用户明确要求和应用图标统一,也否掉过自己改笔画的做法。"""
    res = {}
    for name in ("dark", "light"):
        # 图标原图很干净:白底底噪 ≤1 级,黑底有暗角、最多差 14 级;白天版前条最浅处只比底色深 25 级,
        # 默认门槛(约 36 级)会把它抠掉,所以按底噪单独给。
        floor = {"light": 0.02, "dark": 0.07}[name]
        mark = matte(np.asarray(Image.open(os.path.join(REF, f"icon-{name}.webp")).convert("RGB")), floor)
        mark = brighten(mark, MARK_GAMMA[name])
        text = matte(np.asarray(Image.open(os.path.join(REF, f"ssh-{name}.png")).convert("RGB")), 0.03)  # 底噪 ≤3 级
        res[name] = compose(mark, text)
    return res


# 用户定的比例(参照 MCode 那种字标):X 和字母一样高、上下对齐,间距约四分之一字高。
# 出图字高(px)。欢迎页整张显示 48px 高(含上下留白),应用默认缩放 1.2 × 系统缩放 300% = 3.6 倍,
# 要 173px 高才不被放大;这里出 192px(= 48 × 4)。「SSH」设计稿本身字高只有 130px,
# 要更清楚得换更大的原稿。
LOCKUP_H = 160
LOCKUP_X = 1.0
LOCKUP_GAP = 0.22


# 夜间版 X 放在几乎纯白的「SSH」旁边显得发暗(用户反馈):X 平均亮度 147,字母 242。
# 黑底抠出来的 X 颜色基本是白的、明暗全在不透明度里,所以提亮 = 对不透明度做 gamma:
# 0.6 时平均 172,金属渐变还在。只动欢迎页字标,应用图标本身不变。
MARK_GAMMA = {"dark": 0.6, "light": 1.0}


def brighten(img, gamma):
    if gamma == 1.0:
        return img
    a = np.asarray(img).copy()
    a[..., 3] = np.round(255 * (a[..., 3] / 255.0) ** gamma).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def compose(mark, text):
    th = LOCKUP_H
    text = text.resize((round(text.width * th / text.height), th), Image.LANCZOS)
    mh = round(th * LOCKUP_X)
    mark = mark.resize((round(mark.width * mh / mark.height), mh), Image.LANCZOS)
    gap = round(th * LOCKUP_GAP)
    pad = round(th * 0.1)   # 上下左右留白 = 0.1 倍字高(和欢迎页 48px 的排版对应,别单独改)
    out = Image.new("RGBA", (pad + mark.width + gap + text.width + pad, pad + mh + pad), (0, 0, 0, 0))
    out.alpha_composite(mark, (pad, pad))
    out.alpha_composite(text, (pad + mark.width + gap, pad + (mh - th) // 2))
    return out


# ── Android ──────────────────────────────────────────────────────────────
ANDROID_SCALE = 0.666   # 自适应图标只有中间 72/108 可见;和原来的 >_ 同样占比


def android_color(h, a=1.0):
    return "#%02X%s" % (round(a * 255), h.lstrip("#").upper())


def android_gradient(x1, y1, x2, y2, items):
    body = "".join(f'<item android:offset="{o:.3f}" android:color="{c}"/>' for o, c in items)
    return (f'<aapt:attr name="android:fillColor"><gradient android:type="linear" '
            f'android:startX="{x1:.2f}" android:startY="{y1:.2f}" android:endX="{x2:.2f}" android:endY="{y2:.2f}">'
            f'{body}</gradient></aapt:attr>')


def android_foreground(pal_name):
    pal = PALETTES[pal_name]
    front, back = bar_polys(scale=ANDROID_SCALE)
    paths = []
    global T
    t_saved = T
    T = t_saved * ANDROID_SCALE
    try:
        for poly, mode in ((back, "back"), (front, "front")):
            _, _, d = rounded(poly, R * ANDROID_SCALE)
            top, bot, (nx, ny) = bar_axis(poly)
            axis = android_gradient(top[0], top[1], bot[0], bot[1], [(t, android_color(c)) for t, c in pal[mode]])
            mx, my = (top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2
            e1 = (mx - nx * T / 2, my - ny * T / 2)
            e2 = (mx + nx * T / 2, my + ny * T / 2)
            if mode == "front":
                k = pal["front_edge"]
                items = [(0, android_color("#ffffff", k)), (0.25, android_color("#ffffff", k * 0.25)),
                         (0.5, android_color("#ffffff", 0)), (0.75, android_color("#ffffff", k * 0.25)),
                         (1, android_color("#ffffff", k))]
            else:
                items = [(0, android_color("#000000", pal["back_dark"])), (0.5, android_color("#000000", 0)),
                         (0.5, android_color("#ffffff", 0)), (1, android_color("#ffffff", pal["back_light"]))]
            cross = android_gradient(e1[0], e1[1], e2[0], e2[1], items)
            paths.append(f'    <path android:pathData="{d}">\n        {axis}\n    </path>\n'
                         f'    <path android:pathData="{d}">\n        {cross}\n    </path>\n')
    finally:
        T = t_saved
    return paths


ANDROID_HEAD = """<?xml version="1.0" encoding="utf-8"?>
<!-- 由 build/icon-src/make_icons.py 生成,别手改(改那个脚本再跑一遍)。{note} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="{w}dp"
    android:height="{w}dp"
    android:viewportWidth="{vp}"
    android:viewportHeight="{vp}"{extra}>
"""


def write(path, data, mode="w"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if mode == "wb":
        with open(path, "wb") as f:
            f.write(data)
    else:
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(data)
    print("wrote", os.path.relpath(path, ROOT))


def main():
    # macOS 26 / 27:Icon Composer 文档
    ic = os.path.join(BUILD, "icon.icon")
    for pal in ("light", "dark"):
        for which in ("front", "back"):
            write(os.path.join(ic, "Assets", f"{which}-{pal}.svg"), svg_layer(pal, which))
    write(os.path.join(ic, "icon.json"), icon_json())

    # 预览 / 文档用的整张 SVG
    write(os.path.join(HERE, "xssh-light.svg"), svg_full("light", masked=False))
    write(os.path.join(HERE, "xssh-dark.svg"), svg_full("dark", masked=False))
    write(os.path.join(BUILD, "icon.svg"), svg_full("dark", masked=True))

    # Windows / Linux / 托盘 / 窗口:夜间配色的圆角方块
    big = tile(1024, "dark")
    buf = io.BytesIO()
    big.save(buf, "PNG")
    write(os.path.join(BUILD, "icon.png"), buf.getvalue(), "wb")
    for s in (512, 256):
        buf = io.BytesIO()
        tile(s, "dark").save(buf, "PNG")
        write(os.path.join(BUILD, f"icon-{s}.png"), buf.getvalue(), "wb")
    # Windows 各缩放比例下要的尺寸(微软的图标指南:100% / 125% / 150% / 200% / 250% …),
    # 每个都单独渲染,系统直接拿对应那一帧,不用再缩放。
    sizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]
    frames = [tile(s, "dark") for s in sizes]
    buf = io.BytesIO()
    frames[-1].save(buf, "ICO", sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    write(os.path.join(BUILD, "icon.ico"), buf.getvalue(), "wb")

    # 预览:两种外观的整块(方形,Apple 会自己切圆角)
    for pal in ("light", "dark"):
        buf = io.BytesIO()
        render_glyph(1024, pal).save(buf, "PNG")
        write(os.path.join(HERE, f"preview-{pal}.png"), buf.getvalue(), "wb")

    # 欢迎页标识
    for name, img in lockups().items():
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        write(os.path.join(RENDERER_ASSETS, f"logo-{name}.png"), buf.getvalue(), "wb")
    for name in ("dark", "light"):
        write(os.path.join(RENDERER_ASSETS, f"mark-{name}.svg"), svg_mark(name))

    # Android 自适应图标:白天(默认)/ 夜间
    for pal, folder in (("light", "drawable"), ("dark", "drawable-night")):
        head = ANDROID_HEAD.format(note="前景:两根银条,只占中间 72dp 可见区的约 2/3。", w=108, vp=1024, extra="")
        write(os.path.join(ANDROID_RES, folder, "ic_launcher_foreground.xml"),
              head + "".join(android_foreground(pal)) + "</vector>\n")
        c0, c1 = PALETTES[pal]["bg"]
        bgxml = (ANDROID_HEAD.format(note="背景:铺满整块 108dp 画布(启动器按自己的形状裁)。", w=108, vp=108, extra="")
                 + '    <path android:pathData="M0,0h108v108h-108z">\n        '
                 + android_gradient(0, 0, 108, 108, [(0, android_color(c0)), (1, android_color(c1))])
                 + "\n    </path>\n</vector>\n")
        write(os.path.join(ANDROID_RES, folder, "ic_launcher_background.xml"), bgxml)

    # 单色(主题图标):系统只看形状和透明度;压在下面的那根淡一些,交叉关系还看得出来
    front, back = bar_polys(scale=ANDROID_SCALE)
    mono = ANDROID_HEAD.format(note="单色主题图标。", w=108, vp=1024, extra="")
    mono += f'    <path android:fillColor="#FFFFFF" android:fillAlpha="0.55" android:pathData="{rounded(back, R * ANDROID_SCALE)[2]}"/>\n'
    mono += f'    <path android:fillColor="#FFFFFF" android:pathData="{rounded(front, R * ANDROID_SCALE)[2]}"/>\n</vector>\n'
    write(os.path.join(ANDROID_RES, "drawable", "ic_launcher_monochrome.xml"), mono)

    # 状态栏小图标:24dp、四周留约 2dp、纯白(系统只认形状)。两根条合成一个实心的 X。
    s = 20.0 / 1024 * 1.18
    fr, bk = bar_polys(cx=512, cy=512)
    def to24(poly):
        return [(12 + (x - 512) * s, 12 + (y - 512) * s) for x, y in poly]
    fr24, bk24 = to24(fr), to24(bk)
    stat = ANDROID_HEAD.format(note="状态栏小图标:系统只认形状,自己上色。", w=24, vp=24, extra='\n    android:tint="#FFFFFF"')
    stat += f'    <path android:fillColor="#FFFFFF" android:pathData="{rounded(bk24, R * s)[2]}"/>\n'
    stat += f'    <path android:fillColor="#FFFFFF" android:pathData="{rounded(fr24, R * s)[2]}"/>\n</vector>\n'
    write(os.path.join(ANDROID_RES, "drawable", "ic_stat_session.xml"), stat)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

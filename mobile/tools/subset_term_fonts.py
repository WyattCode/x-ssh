# -*- coding: utf-8 -*-
# 终端候选字体截字。Iosevka 变体按默认字体(base.ttf)的字表截,其余只截拉丁 / 希腊 / 西里尔 / 标点 / 货币
# (画线、方块、箭头、盲文等一律由 Iosevka 画,保证格子接得上)。
import os, sys
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = r'D:\Documents\Claude Code\X-SSH\mobile\android\app\src\main\res\font'
os.chdir(HERE)

base_unicodes = sorted(TTFont('base.ttf').getBestCmap())
LATIN = [(0x20, 0x7E), (0xA0, 0x24F), (0x370, 0x3FF), (0x400, 0x4FF), (0x2000, 0x206F), (0x20A0, 0x20CF), (0x2100, 0x214F)]

def in_latin(u):
    return any(a <= u <= b for a, b in LATIN)

def run(src, dst, unicodes, keep_features=('locl',), font=None, half_only=False):
    f = font or TTFont(src)
    cmap = f.getBestCmap()
    hm = f['hmtx']
    # 非 Iosevka 的字体只留正好半格宽的字:思源等宽的拉丁补充是比例宽,留着会被挤扁或留缝,交给 Iosevka。
    wanted = [u for u in unicodes if u in cmap and (not half_only or hm[cmap[u]][0] == f['head'].unitsPerEm // 2)]
    opts = subset.Options()
    opts.layout_features = list(keep_features)
    opts.hinting = False
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.drop_tables += ['DSIG']
    s = subset.Subsetter(options=opts)
    s.populate(unicodes=wanted)
    s.subset(f)
    f.save(os.path.join(OUT, dst))
    print(f'{dst:32} {len(wanted):5} chars  {os.path.getsize(os.path.join(OUT, dst)) // 1024} KB')

for ss, name in [('SS14', 'jetbrains'), ('SS05', 'fira'), ('SS04', 'menlo'), ('SS15', 'plex')]:
    for w in ('Regular', 'Bold'):
        run(f'IosevkaTerm{ss}-{w}.ttf', f'xssh_term_{name}_{w.lower()}.ttf', base_unicodes)

latin = [u for u in range(0x20, 0x2150) if in_latin(u)]
for w in ('Regular', 'Bold'):
    run(f'UbuntuMono-{w}.ttf', f'xssh_term_ubuntu_{w.lower()}.ttf', latin, half_only=True)
    run(f'NotoSansMonoCJKsc-{w}.otf', f'xssh_term_noto_{w.lower()}.otf', latin, half_only=True)

var = TTFont('Inconsolata.ttf')
for w, wght in (('regular', 400), ('bold', 700)):
    inst = instancer.instantiateVariableFont(TTFont('Inconsolata.ttf'), {'wght': wght, 'wdth': 100})
    run(None, f'xssh_term_inconsolata_{w}.ttf', latin, font=inst, half_only=True)

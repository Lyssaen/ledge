import sys, os
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out+'/light', exist_ok=True); os.makedirs(out+'/dark', exist_ok=True)
SHADOW = (40, 36, 60, 90)

def add_shadow(im):
    """Bake an iso ground shadow under a sprite that has none."""
    a = im.getchannel('A'); bbox = a.getbbox()
    x0, y0, x1, y1 = bbox
    sh = Image.new('RGBA', im.size, (0,0,0,0)); d = ImageDraw.Draw(sh)
    w = (x1-x0)*0.8; cx = (x0+x1)/2 + 3
    d.ellipse([cx-w/2, y1-5, cx+w/2, y1+2], fill=SHADOW)
    sh.alpha_composite(im); return sh

def lum(r,g,b): return 0.299*r+0.587*g+0.114*b

def pebble(im):
    """Light theme bot: lift the shell toward its pebble tint, keep visor, eyes and shadow."""
    px = im.load(); o = im.copy(); po = o.load()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a = px[x,y]
            if a < 200: continue
            L = lum(r,g,b); sat = max(r,g,b)-min(r,g,b)
            if L < 55: continue                   # visor / outline
            if r > 200 and g > 150 and b < 120: continue  # glowing eyes
            k = 0.42
            po[x,y] = (int(r+(255-r)*k), int(g+(250-g)*k), int(b+(240-b)*k), a)
    return o

def night(im, glow_screens=False):
    """Dark theme prop/room: cool, dim lighting; bright screens and windows keep a glow."""
    px = im.load(); o = im.copy(); po = o.load()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a = px[x,y]
            if a == 0: continue
            if a < 200 and max(r,g,b) < 120:      # soft shadow stays a shadow
                po[x,y] = (10, 10, 20, a); continue
            L = lum(r,g,b)
            nr, ng, nb = r*.36+8, g*.38+10, b*.52+22
            if glow_screens and b > r+25 and b > 110 and L > 110:   # glass/windows: moonlit
                nr, ng, nb = r*.35+30, g*.45+50, b*.6+70
            po[x,y] = (int(min(255,nr)), int(min(255,ng)), int(min(255,nb)), a)
    return o

bots = ['claude','codex','cursor','omp','ledge']
props = ['desk','plant','coffee','whiteboard','sofa','room']
for n in bots:
    im = Image.open(f'{src}/{n}.png').convert('RGBA')
    if n in ('codex','cursor','omp'): im = add_shadow(im)
    im.save(f'{out}/dark/bot-{n}.png'); pebble(im).save(f'{out}/light/bot-{n}.png')
for n in props:
    im = Image.open(f'{src}/{n}.png').convert('RGBA')
    im.save(f'{out}/light/{n}.png'); night(im, glow_screens=True).save(f'{out}/dark/{n}.png')

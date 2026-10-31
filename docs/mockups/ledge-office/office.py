"""Procedural isometric open space (2:1 tiles) that grows with the number of desks, plus the PixelLab props on top."""
import sys, json, math
from PIL import Image
A, OUT = sys.argv[1], sys.argv[2]
TW, TH, WALL, SLAB = 32, 16, 84, 6
PAL = {
  'light': dict(bg=(246,241,232), plank=[(247,206,155),(243,201,154),(248,214,175),(240,196,148)], seam=(226,184,136),
                slab=(182,138,110), slab2=(140,96,78), wallL=(238,227,205), wallR=(246,236,215), cap=(252,250,234),
                base=(188,144,116), glass=(209,244,239), glass2=(186,226,224), frame=(70,69,90), shine=(240,252,250)),
  'dark':  dict(bg=(17,19,28), plank=[(74,56,52),(70,53,50),(80,61,55),(66,50,48)], seam=(52,38,38),
                slab=(42,31,34), slab2=(30,22,26), wallL=(44,48,66), wallR=(54,58,78), cap=(72,76,98),
                base=(34,30,42), glass=(52,78,128), glass2=(40,60,104), frame=(22,22,36), shine=(132,160,210)),
}

def build(theme, cols, rows):
    P = PAL[theme]
    ox, oy = rows*TW//2 + 8, WALL + 12
    w, h = (cols+rows)*TW//2 + 16, oy + (cols+rows)*TH//2 + SLAB + 10
    im = Image.new('RGBA', (w, h), P['bg']+(255,)); px = im.load()
    def uv(x, y):
        a, b = (x-ox)/(TW/2), (y-oy)/(TH/2)
        return (a+b)/2, (b-a)/2
    for y in range(h):
        for x in range(w):
            u, v = uv(x, y)
            if 0 <= u < cols and 0 <= v < rows:          # parquet: planks run along u, staggered joints
                lane = math.floor(v*4); off = 0.5 if lane % 2 else 0
                seam = (v*4 - lane) < 0.18 or ((u + off) % 2) < 0.06
                px[x,y] = (P['seam'] if seam else P['plank'][(lane*7 + math.floor(u+off)*3) % 4]) + (255,)
            elif 0 <= u < cols and rows <= v and y - (oy + (u+rows)*TH/2 - (x-ox-(u-rows)*TW/2)*0) >= 0:
                pass
    # slab front faces
    for x in range(w):
        for t in range(SLAB):
            # front-left edge v=rows, u in [0, cols]; front-right edge u=cols
            for (edge, col) in (('L', P['slab']), ('R', P['slab2'])):
                if edge == 'L':
                    u = (x - ox + rows*TW/2) / (TW/2)
                    if 0 <= u <= cols: y = oy + (u + rows)*TH/2 + t; px[x, int(y)] = col+(255,)
                else:
                    v = (ox + cols*TW/2 - x) / (TW/2)
                    if 0 <= v <= rows: y = oy + (cols + v)*TH/2 + t; px[x, int(y)] = col+(255,)
    # back walls: right wall along u (v=0), left wall along v (u=0)
    def wall(along, n, color, windows):
        for i in range(int(n*TW/2)):
            s = i/(TW/2)
            x = ox + i if along == 'u' else ox - i - 1
            ybase = oy + s*TH/2
            for hgt in range(WALL):
                y = int(ybase - hgt)
                c = color
                if hgt < 5: c = P['base']
                if hgt >= WALL-4: c = P['cap']
                for (s0, s1, h0, h1) in windows:
                    if s0 <= s <= s1 and h0 <= hgt <= h1:
                        edge = s - s0 < .12 or s1 - s < .12 or hgt - h0 < 2 or h1 - hgt < 2 or abs(s - (s0+s1)/2) < .07 or abs(hgt-(h0+h1)/2) < 1
                        c = P['frame'] if edge else (P['glass'] if hgt > (h0+h1)/2 else P['glass2'])
                px[x, y] = c+(255,)
    wins_u = [(s, s+2.2, 26, 66) for s in range(2, cols-2, 4)]
    wins_v = [(s, s+2.2, 26, 66) for s in range(3, rows-2, 5)]
    wall('u', cols, P['wallR'], wins_u); wall('v', rows, P['wallL'], wins_v)
    return im, (ox, oy)

def glow(im, origin, desks):
    """Night only: the monitors cast a soft cool pool of light on the floor in front of each desk."""
    ox, oy = origin; px = im.load()
    for (u, v) in desks:
        cx, cy = ox + (u+.6-v-.6)*TW/2, oy + (u+.6+v+.6)*TH/2
        for y in range(int(cy-22), int(cy+22)):
            for x in range(int(cx-44), int(cx+44)):
                d = ((x-cx)/44)**2 + ((y-cy)/22)**2
                if d < 1 and 0 <= x < im.width and 0 <= y < im.height:
                    r, g, b, a = px[x, y]; k = (1-d)*.28
                    px[x, y] = (int(r+(120-r)*k*.6), int(g+(170-g)*k), int(b+(230-b)*k), a)

def place(im, origin, theme, items):
    ox, oy = origin
    for name, u, v in sorted(items, key=lambda t: t[1]+t[2]):
        s = Image.open(f'{A}/{theme}/{name}.png').convert('RGBA')
        bb = s.getchannel('A').getbbox()
        x, y = ox + (u-v)*TW/2, oy + (u+v)*TH/2
        im.alpha_composite(s, (int(x - (bb[0]+bb[2])/2), int(y - bb[3])))

COLS, ROWS = 15, 12
DESKS = [(4.2, 2.8), (9.2, 2.8), (4.2, 7.6), (9.2, 7.6)]
BOTS = ['bot-claude', 'bot-codex', 'bot-cursor', 'bot-omp']
items = [('whiteboard', 1.4, 4.6), ('coffee', 1.6, 9.0), ('plant', .9, .9), ('plant', 14.2, .9),
         ('sofa', 13.8, 9.6), ('bot-ledge', 11.6, 11.2)]
seats = []
for (u, v), bot in zip(DESKS, BOTS):
    items.append(('desk', u, v)); items.append((bot, u + 2.2, v - .3)); seats.append({'desk': [u, v], 'bot': [u+2.2, v-.3]})
for theme in ('light', 'dark'):
    im, o = build(theme, COLS, ROWS)
    if theme == 'dark': glow(im, o, DESKS)
    place(im, o, theme, items)
    im.save(f'{OUT}/office-{theme}.png')
    im.resize((im.width*3, im.height*3), Image.NEAREST).save(f'{OUT}/office-{theme}_x3.png')
json.dump({'tile': [TW, TH], 'cols': COLS, 'rows': ROWS, 'origin': list(o), 'seats': seats}, open(f'{OUT}/layout.json', 'w'), indent=1)

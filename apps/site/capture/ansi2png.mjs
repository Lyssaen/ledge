import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const [dir, pw, ...names] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pw);
const B16 = ['#0c0c0d','#cd3131','#0dbc79','#e5e510','#2472c8','#bc3fbc','#11a8cd','#e5e5e5','#666666','#f14c4c','#23d18b','#f5f543','#3b8eea','#d670d6','#29b8db','#ffffff'];
const hex = (r, g, b) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
const c256 = n => n < 16 ? B16[n] : n < 232 ? (() => { n -= 16; const v = x => x === 0 ? 0 : 55 + 40 * x; return hex(v(Math.floor(n / 36)), v(Math.floor(n / 6) % 6), v(n % 6)); })() : (() => { const v = 8 + 10 * (n - 232); return hex(v, v, v); })();
const WRAP = new Set(['⎇', '⎿', ...(process.env.WRAP || '')]);
const esc = s => [...s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')].map(ch => WRAP.has(ch) ? `<span style="display:inline-block;width:1ch;text-align:center;white-space:nowrap">${ch}</span>` : ch).join('');
const FG = '#e5e5e5', BG = '#0c0c0d';
function convert(ansi) {
  const lines = ansi.split('\n');
  const width = Math.max(...lines.map(l => [...l.replace(/\x1b\[[0-9;]*m/g, '')].length));
  let st = { fg: null, bg: null, bold: false, dim: false, inv: false };
  const out = lines.map(line => {
    let html = '', n = 0, run = '';
    const flush = () => {
      if (!run) return;
      let fg = st.fg, bg = st.bg;
      if (st.inv) [fg, bg] = [bg ?? BG, fg ?? FG];
      const css = [fg && `color:${fg}`, bg && `background:${bg}`, st.bold && 'font-weight:700', st.dim && 'opacity:.6'].filter(Boolean).join(';');
      html += css ? `<span style="${css}">${esc(run)}</span>` : esc(run);
      run = '';
    };
    const re = /\x1b\[([0-9;]*)m|([^\x1b]+)/g; let m;
    while ((m = re.exec(line))) {
      if (m[2] !== undefined) { run += m[2]; n += [...m[2]].length; continue; }
      flush();
      const p = (m[1] || '0').split(';').map(Number);
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === 0) st = { fg: null, bg: null, bold: false, dim: false, inv: false };
        else if (c === 1) st.bold = true; else if (c === 2) st.dim = true; else if (c === 22) { st.bold = false; st.dim = false; }
        else if (c === 7) st.inv = true; else if (c === 27) st.inv = false;
        else if (c >= 30 && c <= 37) st.fg = B16[c - 30]; else if (c >= 90 && c <= 97) st.fg = B16[c - 82];
        else if (c >= 40 && c <= 47) st.bg = B16[c - 40]; else if (c >= 100 && c <= 107) st.bg = B16[c - 92];
        else if (c === 39) st.fg = null; else if (c === 49) st.bg = null;
        else if (c === 38 || c === 48) {
          let col;
          if (p[i + 1] === 5) { col = c256(p[i + 2]); i += 2; } else if (p[i + 1] === 2) { col = hex(p[i + 2], p[i + 3], p[i + 4]); i += 4; }
          if (c === 38) st.fg = col; else st.bg = col;
        }
      }
    }
    flush();
    if (n < width) { const keep = st; st = { fg: null, bg: null, bold: false, dim: false, inv: false }; run = ' '.repeat(width - n); flush(); st = keep; }
    return html;
  });
  return { html: out.join('\n'), width, rows: lines.length };
}
const FONT = process.env.FONT || 'DejaVu Sans Mono';
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
for (const name of names) {
  const { html, width, rows } = convert(readFileSync(`${dir}/${name}.ansi`, 'utf8'));
  writeFileSync(`${dir}/${name}.html-fragment`, html);
  const doc = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${BG}}pre{margin:0;display:inline-block;padding:16px;background:${BG};color:${FG};font-family:'${FONT}',monospace;font-size:14px;line-height:${process.env.LH || 1.25};white-space:pre;${process.env.FIX ? `width:${width}ch;height:calc(${rows} * 14px * ${process.env.LH || 1.25});overflow:hidden;` : ''}font-variant-ligatures:none}</style><pre id="t">${html}</pre>`;
  writeFileSync(`${dir}/${name}.html`, doc);
  await page.setContent(doc);
  const info = await page.evaluate(async font => {
    await document.fonts.ready;
    const pre = document.getElementById('t'), cs = getComputedStyle(pre);
    const cv = document.createElement('canvas').getContext('2d'); cv.font = `14px '${font}'`;
    const cell = cv.measureText('M').width;
    const odd = [...new Set(pre.textContent)].filter(ch => ch !== '\n' && Math.abs(cv.measureText(ch).width - cell) > 0.01);
    const r = pre.getBoundingClientRect(); const range = document.createRange(); const ws = new Set(); const tw = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT); let lineW = 0; /* widths per line via a probe */
    return { cell, odd, w: r.width, h: r.height, family: cs.fontFamily };
  }, FONT);
  await page.locator('#t').screenshot({ path: `${dir}/${name}.png` });
  console.log(name, `${width}x${rows}`, JSON.stringify(info), 'expected w', info.cell * width + 32);
}
await browser.close();

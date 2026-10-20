// Draws the resident mascot (the vector of @ledge/ui ResidentMascot, factory colours) and rasterises the app icons with
// Playwright's Chromium. Run `pnpm --filter @ledge/mobile icons`; the PNG and SVG outputs are committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
mkdirSync(out, { recursive: true });

const BG = '#0c0d0e';
const body = `<path d="M48 23v-9" fill="none" stroke="#313b3e" stroke-width="3" stroke-linecap="round"/><circle cx="48" cy="12" r="3" fill="#ffc3a8"/>
<rect x="30" y="74" width="12" height="8" rx="4" fill="#313b3e"/><rect x="54" y="74" width="12" height="8" rx="4" fill="#313b3e"/>
<path d="M23 33Q25 21 40 21h16q15 0 17 12l5 23q4 22-17 22H35Q14 78 18 56Z" fill="#566365" stroke="#91a2a272" stroke-width="1.2"/>
<path d="M28 34q3-7 14-7h12" fill="none" stroke="#ffffff50" stroke-width="1.5" stroke-linecap="round"/>
<rect x="25" y="37" width="46" height="27" rx="12" fill="#182224"/>
<g fill="#ffc3a8"><rect x="35" y="44" width="6" height="12" rx="3"/><rect x="55" y="44" width="6" height="12" rx="3"/></g>`;

// Favicon: the mascot alone, no halo, transparent background.
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="12 8 72 76" width="64" height="64">${body}</svg>\n`;
writeFileSync(resolve(out, 'favicon.svg'), faviconSvg);

const halo = 'drop-shadow(0 0 4px #ee9c87a6) drop-shadow(0 0 12px #8bc7b661)';
// scale = share of the canvas taken by the 96-unit mascot box (maskable keeps the content inside the 80 % safe circle).
const icon = (size, scale) => {
  const s = size * scale;
  return `<!doctype html><body style="margin:0;width:${size}px;height:${size}px;background:${BG};display:grid;place-items:center"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${s}" height="${s}" style="overflow:visible;filter:${halo.replace(/(\d+)px/g, (_, n) => `${(n * s) / 96 * 1.2}px`)}">${body}</svg></body>`;
};

const jobs = [
  { file: 'icon-180.png', size: 180, html: icon(180, 0.62) },
  { file: 'icon-192.png', size: 192, html: icon(192, 0.62) },
  { file: 'icon-512.png', size: 512, html: icon(512, 0.62) },
  { file: 'icon-maskable-512.png', size: 512, html: icon(512, 0.5) },
  { file: 'favicon-32.png', size: 32, transparent: true, html: `<!doctype html><body style="margin:0;width:32px;height:32px;background:transparent"><div style="width:32px;height:32px">${faviconSvg.replace('width="64" height="64"', 'width="32" height="32"')}</div></body>` }
];

const browser = await chromium.launch();
try {
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
    await page.setContent(j.html);
    await page.screenshot({ path: resolve(out, j.file), omitBackground: !!j.transparent });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`wrote ${jobs.length} PNG and favicon.svg to ${out}`);

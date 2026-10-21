// Draws the watcher (the vector of @ledge/ui ResidentMascot, its own deep red, as the desktop icon) and rasterises the app icons with
// Playwright's Chromium. Run `pnpm --filter @ledge/mobile icons`; the PNG and SVG outputs are committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
mkdirSync(out, { recursive: true });

const BG = '#0c0d0e';
const body = `<defs><linearGradient id="shell" x1=".15" y1="0" x2=".75" y2="1"><stop offset="0" stop-color="#dd7f78"/><stop offset="1" stop-color="#a63c37"/></linearGradient>
<radialGradient id="sheen" cx=".3" cy=".2" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<path d="M48 23v-7" fill="none" stroke="#6a2422" stroke-width="2.4" stroke-linecap="round"/><circle cx="48" cy="14" r="2.6" fill="#f0b2ac"/>
<path d="M25 60V41C25 28 35 23 48 23C61 23 71 28 71 41V60Z" fill="url(#shell)" stroke="#f3c2bd" stroke-width="1.2"/>
<path d="M25 60V41C25 28 35 23 48 23C61 23 71 28 71 41V60Z" fill="url(#sheen)"/>
<g fill="#2a0e0d"><rect x="37" y="35" width="6" height="12" rx="3"/><rect x="53" y="35" width="6" height="12" rx="3"/></g>
<g fill="#fff"><circle cx="38.8" cy="37.8" r="1.5"/><circle cx="54.8" cy="37.8" r="1.5"/></g>
<rect x="9" y="59" width="78" height="20" rx="6" fill="#6a2422"/>
<rect x="6" y="55" width="84" height="7" rx="3.5" fill="#cf6b64" stroke="#f3c2bd" stroke-width="1"/>
<path d="M12 56.4H84" fill="none" stroke="#f0b2ac" stroke-width="1.3" stroke-linecap="round" opacity=".8"/>
<g fill="url(#shell)" stroke="#f3c2bd" stroke-width="1.2"><rect x="26" y="50" width="12" height="9" rx="4.5"/><rect x="58" y="50" width="12" height="9" rx="4.5"/></g>`;

// Favicon: the mascot alone, no halo, transparent background.
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 8 86 74" width="64" height="64">${body}</svg>\n`;
writeFileSync(resolve(out, 'favicon.svg'), faviconSvg);

const halo = 'drop-shadow(0 0 4px #c45a54a6) drop-shadow(0 0 12px #e39a9461)';
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

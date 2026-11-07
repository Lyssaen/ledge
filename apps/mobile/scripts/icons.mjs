// Draws the Ledge mark (the desktop's src-tauri/icons/ledge-mark*.svg, mockup `ledgeMark()`) and rasterises the app icons with
// Playwright's Chromium. Run `pnpm --filter @ledge/mobile icons`; the PNG and SVG outputs are committed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public');
mkdirSync(out, { recursive: true });
const marks = resolve(here, '../../desktop/src-tauri/icons');
/** The mark's SVG drawn at `size` px: the 16 viewBox (thicker, legible) under 48 px, the 64 one above. */
const mark = size => readFileSync(resolve(marks, size < 48 ? 'ledge-mark-16.svg' : 'ledge-mark.svg'), 'utf8').trim()
  .replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
const BLACK = '#0A0A0A';   // the mark's own square

// Favicon: the small mark, its rounded corners transparent.
writeFileSync(resolve(out, 'favicon.svg'), `${mark(16)}\n`);

// An icon is the mark filling its canvas (the corners stay transparent; iOS fills them black, as the mark). The maskable one
// is cropped by the launcher: a black canvas, the mark at 80 % so the L and the dot stay inside the 80 % safe circle.
const canvas = (size, body, bg) => `<!doctype html><body style="margin:0;width:${size}px;height:${size}px;background:${bg};display:grid;place-items:center">${body}</body>`;
const icon = size => canvas(size, mark(size), 'transparent');
const maskable = size => canvas(size, mark(Math.round(size * 0.8)), BLACK);

const jobs = [
  { file: 'icon-180.png', size: 180, transparent: true, html: icon(180) },
  { file: 'icon-192.png', size: 192, transparent: true, html: icon(192) },
  { file: 'icon-512.png', size: 512, transparent: true, html: icon(512) },
  { file: 'icon-maskable-512.png', size: 512, html: maskable(512) },
  { file: 'favicon-32.png', size: 32, transparent: true, html: icon(32) }
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

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/**
 * Makes every product icon from the Ledge mark (src-tauri/icons/ledge-mark.svg, 64 viewBox, and ledge-mark-16.svg, the 16 one
 * drawn thicker for small sizes): the app's icons (`tauri icon` from the 64 mark), then the small sizes redrawn from the 16
 * mark, Playwright's Chromium rasterising: 32x32.png, the tray, icon.ico's 16/24/32 entries, and the Windows Terminal
 * profile's ledge.ico (packages/ledge). Run `pnpm --filter desktop icons`; the outputs are committed. The phone's icons have
 * their own script (`pnpm --filter @ledge/mobile icons`). After a change, the Windows build needs
 * `cargo clean --release -p ledge-desktop`, or the exe keeps its old icon.
 */
const app = fileURLToPath(new URL('..', import.meta.url));
const icons = join(app, 'src-tauri', 'icons');
const mark64 = join(icons, 'ledge-mark.svg');
const mark16 = join(icons, 'ledge-mark-16.svg');
const terminalIco = fileURLToPath(new URL('../../../packages/ledge/assets/ledge.ico', import.meta.url));

// 1. Every size and format Tauri bundles (ico, icns, png, the Store logos), from the 64 mark. Its mobile folders are not used.
const tauri = join(dirname(createRequire(join(app, 'package.json')).resolve('@tauri-apps/cli/package.json')), 'tauri.js');
const res = spawnSync(process.execPath, [tauri, 'icon', mark64, '--output', icons], { stdio: 'inherit' });
if (res.status !== 0) process.exit(res.status ?? 1);
for (const d of ['android', 'ios']) rmSync(join(icons, d), { recursive: true, force: true });

// 2. The small sizes from the 16 mark, the large ones from the 64 mark, each a transparent PNG.
const browser = await chromium.launch();
const png = async (svgFile, size) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const svg = readFileSync(svgFile, 'utf8').replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${svg}</body>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return buf;
};
const markPng = size => png(size < 48 ? mark16 : mark64, size);

/** An .ico whose entries are PNGs (Windows reads them since Vista), the sizes Windows asks for: 16 to 256. */
const ico = async () => {
  const sizes = [16, 24, 32, 48, 64, 256];
  const images = [];
  for (const s of sizes) images.push(await markPng(s));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s === 256 ? 0 : s, e); head.writeUInt8(s === 256 ? 0 : s, e + 1);   // 0 means 256
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);                        // planes, bits per pixel
    head.writeUInt32LE(images[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([head, ...images]);
};

try {
  writeFileSync(join(icons, '32x32.png'), await markPng(32));
  writeFileSync(join(icons, 'ledge-tray.png'), await png(mark16, 64));   // the tray shows it at 16-24 px: the 16 mark
  const ledgeIco = await ico();
  writeFileSync(join(icons, 'icon.ico'), ledgeIco);
  if (existsSync(dirname(terminalIco))) writeFileSync(terminalIco, ledgeIco);
} finally {
  await browser.close();
}
console.log(`wrote the Ledge mark icons to ${icons} and ${terminalIco}`);

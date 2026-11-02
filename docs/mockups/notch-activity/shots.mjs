import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Captures of the notch-activity mockup: the full page in both themes, then zooms on each delicate section.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(resolve(root, 'apps/overlay/package.json'));
const { chromium } = require('@playwright/test');
const url = pathToFileURL(resolve(root, 'docs/mockups/ledge-notch-activity.html')).href;
const out = (n) => resolve(root, `docs/mockups/ledge-notch-activity-${n}.png`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
await page.goto(url);
await page.waitForTimeout(600);
const only = process.argv[2];
const shot = async (name, sel) => { if (only && !name.startsWith(only)) return; await page.locator(sel).first().screenshot({ path: out(name) }); };

await shot('anatomy', 'section:has(#anatomy)');
await shot('rest', 'section:has(#rest)');
await shot('wake', 'section:has(#wake)');
await shot('long', 'section:has(#long)');
await shot('music', 'section:has(#music)');
await shot('collision', 'section:has(#collide)');
// The live demo: a message, then the cover hovered.
await page.getByRole('button', { name: 'Message agent → agent' }).click();
await page.waitForTimeout(300);
await shot('live-message', '.na-live');
await page.locator('.na-live .na-cover-btn').hover();
await page.waitForTimeout(400);
await shot('live-hover', '.na-live');
// English and light page.
await page.mouse.move(0, 800);
await page.getByRole('button', { name: 'EN', exact: true }).click();
await page.getByRole('button', { name: /^Page/ }).click();
await page.waitForTimeout(300);
await shot('wake-en-light', 'section:has(#wake)');
await shot('music-en-light', 'section:has(#music)');
// Phone width: the page must not scroll sideways.
await page.setViewportSize({ width: 390, height: 900 });
await page.waitForTimeout(200);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await shot('narrow', 'section:has(#wake)');
console.log(JSON.stringify({ overflow }));
await browser.close();

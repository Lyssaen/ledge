import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Captures of docs/mockups/ledge-sidebar-tidy.html. Usage: node shots.mjs <path to a playwright-core package>
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..');
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(resolve(out, 'ledge-sidebar-tidy.html')).href);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);
const shot = async (sel, name) => { await page.locator(sel).first().screenshot({ path: resolve(out, `ledge-sidebar-tidy-${name}.png`), animations: 'disabled' }); console.log(name); };
await shot('#s-compare', 'compare-dark');
await shot('#s-light', 'after-light');
await shot('#s-zoom', 'rigs-options');
await shot('#s-empty', 'empty-states');
await shot('#s-en', 'english');
// Alignment check: views box vs toggle box, ledge mascot vs views icon.
const m = await page.evaluate(() => {
  const a = document.querySelector('#f-after');
  const box = s => a.querySelector(s).getBoundingClientRect();
  const v = box('[data-k="views"]'), g = box('[data-k="toggle"]'), k = box('[data-k="kernelbox"]'), mascot = box('.st-mascot'), icon = a.querySelector('[data-k="views"] svg').getBoundingClientRect();
  return { views: [v.left, v.width], toggle: [g.left, g.width], kernel: [k.left, k.width], mascotLeft: mascot.left - v.left, iconLeft: icon.left - v.left };
});
console.log(JSON.stringify(m));
await browser.close();

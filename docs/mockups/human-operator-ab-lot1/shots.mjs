import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Captures of docs/mockups/ledge-human-operator-ab-lot1.html. Usage: node shots.mjs <path to a playwright-core package>
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..');
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL(resolve(out, 'ledge-human-operator-ab-lot1.html')).href);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(out, 'ledge-human-operator-ab-lot1.png'), fullPage: true });
await browser.close();

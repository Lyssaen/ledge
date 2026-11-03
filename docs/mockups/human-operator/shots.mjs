import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Captures of docs/mockups/ledge-human-operator.html. Usage: node shots.mjs <path to a playwright-core package>
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..');
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1900, height: 1100 }, deviceScaleFactor: 1.5 });
const url = pathToFileURL(resolve(out, 'ledge-human-operator.html')).href;
const name = n => resolve(out, `ledge-human-operator-${n}.png`);
for (const theme of ['dark', 'light']) {
  await page.goto(`${url}?theme=${theme}`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: name(`overview-${theme}`), fullPage: true });
  const rows = theme === 'dark' ? ['home', 'decision', 'goal', 'surfaces'] : ['home', 'goal'];
  for (const r of rows) for (const k of ['A', 'B', 'AB']) {
    await page.evaluate(id => window.openShot(id), `s-${k}-${r}`);
    await page.locator('#lb .app').screenshot({ path: name(`${k.toLowerCase()}-${r}-${theme}`) });
    await page.evaluate(() => document.getElementById('lb').classList.remove('on'));
  }
  console.log(theme);
}
await browser.close();

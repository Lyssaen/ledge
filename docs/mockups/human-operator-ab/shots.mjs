import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Captures of docs/mockups/ledge-human-operator-ab.html. Usage: node shots.mjs <path to a playwright-core package>
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..');
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1900, height: 1100 }, deviceScaleFactor: 1.5 });
const url = pathToFileURL(resolve(out, 'ledge-human-operator-ab.html')).href;
const name = n => resolve(out, `ledge-human-operator-ab-${n}.png`);
const SCREENS = ['homeDay1', 'homeLater', 'decision', 'decisionRaw', 'countdown', 'goalAsk', 'goalDone', 'settings', 'settingsMissing', 'empty', 'stopped', 'notChannel'];
const LIGHT = ['homeLater', 'decision', 'countdown', 'goalAsk', 'settings', 'settingsMissing', 'notChannel'];
for (const theme of ['dark', 'light']) {
  await page.goto(`${url}?theme=${theme}`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: name(`overview-${theme}`), fullPage: true });
  for (const k of theme === 'dark' ? SCREENS : LIGHT) {
    await page.evaluate(id => window.openShot(id), `s-${k}`);
    await page.locator('#lb .app').screenshot({ path: name(`${k}-${theme}`) });
    await page.evaluate(() => document.getElementById('lb').classList.remove('on'));
  }
  await page.locator('#strip').screenshot({ path: name(`states-${theme}`) });
  await page.locator('#r7').screenshot({ path: name(`mobile-${theme}`) });
  await page.locator('#r8').screenshot({ path: name(`tui-${theme}`) });
  console.log(theme);
}
await browser.close();

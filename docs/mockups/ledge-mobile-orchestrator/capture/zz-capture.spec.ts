// Mockup capture (not a test): the real PWA with the brainstorm's world, one screenshot per current screen.
import { devices, expect, test } from '@playwright/test';
import type { PhoneChatTurn, PhoneSession } from '@ledge/protocol';
import { copy } from '../src/copy';
import { startHarness, type Harness } from './harness';

const OUT = process.env.SHOTS ?? 'shots';
const { defaultBrowserType: _w, ...iPhone } = devices['iPhone 13'];
test.use({ ...iPhone, deviceScaleFactor: 2 });
test.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');

import { sessions, turns } from './zz-fixtures';

let h: Harness;
test.beforeAll(async () => {
  h = await startHarness();
  h.daemon.sessions = sessions;
  h.daemon.chat = true;
  h.daemon.turns = turns;
});
test.afterAll(async () => { await h?.close(); });

test('capture', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  const code = await h.pc.code();
  await expect(page.getByLabel(copy.compare.codeLabel(code))).toBeVisible();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await expect(page.getByRole('heading', { name: copy.compare.doneTitle(copy.yourPc) })).toBeVisible();
  await page.getByRole('link', { name: copy.compare.seePending }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/m-inbox.png` });
  await page.screenshot({ path: `${OUT}/m-inbox-full.png`, fullPage: true });
  (await import('node:fs')).writeFileSync(`${OUT}/inbox.html`, await page.content());
  await page.getByRole('link', { name: copy.nav.agents, exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/m-agents.png` });
  await page.screenshot({ path: `${OUT}/m-agents-full.png`, fullPage: true });
  (await import('node:fs')).writeFileSync(`${OUT}/agents.html`, await page.content());
  for (const [i, y] of [[1, 700], [2, 1400]] as const) { await page.locator('main').first().evaluate((m, y) => { m.scrollTop = y; }, y); await page.waitForTimeout(200); await page.screenshot({ path: `${OUT}/m-agents-${i}.png` }); }
  await page.getByRole('link', { name: copy.nav.chat, exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/m-chat.png` });
  await page.locator('header svg.resident').first().screenshot({ path: `${OUT}/a-mascot.png`, omitBackground: true });
  await page.getByRole('link', { name: copy.nav.agents, exact: true }).click();
  await page.waitForTimeout(600);
  const bots = page.locator('main svg[width]');
  const n = await bots.count();
  for (let i = 0; i < n; i++) { const b = bots.nth(i); if (await b.isVisible() && ((await b.boundingBox())?.width ?? 0) > 30) await b.screenshot({ path: `${OUT}/a-bot-${i}.png`, omitBackground: true }).catch(() => {}); }
  await page.goto(`${h.url}/#/request/orch/q1`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/m-request.png` });
  await page.goto(`${h.url}/#/thread/build`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/m-thread.png` });
  await page.goto(`${h.url}/#/teams`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/m-teams.png` });
  // Keep the page's markup and styles for the mockup.
  await page.goto(`${h.url}/#/chat`);
  await page.waitForTimeout(800);
  const fs = await import('node:fs');
  fs.writeFileSync(`${OUT}/chat.html`, await page.content());
  const css = await page.evaluate(() => [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n'));
  fs.writeFileSync(`${OUT}/app.css`, css);
});

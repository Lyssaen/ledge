// A phone turned on its side: the app fills the screen's width instead of keeping the 480 px column of a desktop window,
// and its tabs leave the bottom for a rail on the left.
// SHOTS=<dir> saves a capture of each screen there.
import { devices, expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _webkit, ...iPhone13 } = devices['iPhone 13 landscape'];
test.use(iPhone13);
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');

let h: Harness;
test.beforeAll(async () => { h = await startHarness(); });
test.afterAll(async () => { await h?.close(); });

async function shot(page: Page, name: string, browser: string) {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${browser}-${name}.png` });
}

test('in landscape the app spans the whole width with its tabs on the left, and a desktop window keeps its column', async ({ page, browserName }) => {
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  await h.pc.code();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: copy.compare.seePending }).click();
  await expect(page.getByRole('link', { name: /pnpm test/ })).toBeVisible();

  const width = async () => (await page.locator('.app').boundingBox())!.width;
  await shot(page, 'inbox', browserName);
  expect.soft(await width()).toBe(page.viewportSize()!.width);

  // The tabs are a rail on the left, the whole height, beside the list rather than under it.
  const nav = page.getByRole('navigation', { name: copy.nav.label });
  const rail = (await nav.boundingBox())!;
  const list = (await page.getByRole('main').boundingBox())!;
  expect.soft(rail.x).toBe(0);
  expect.soft(rail.height).toBe(page.viewportSize()!.height);
  expect.soft(list.x).toBeGreaterThanOrEqual(rail.x + rail.width);

  await page.getByRole('link', { name: /pnpm test/ }).click();
  await expect(page.getByRole('button', { name: copy.decide.allow })).toBeEnabled();
  await shot(page, 'request', browserName);
  expect.soft(await width()).toBe(page.viewportSize()!.width);

  await page.goBack();
  await page.setViewportSize({ width: 1280, height: 800 });
  expect.soft(await width()).toBe(480);
  // Back under the list.
  const bar = (await nav.boundingBox())!;
  expect.soft(bar.y).toBeGreaterThan((await page.getByRole('main').boundingBox())!.y);
  expect.soft(bar.width).toBe(480 - 36);
});

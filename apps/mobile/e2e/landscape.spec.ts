// A phone turned on its side: the app fills the screen's width instead of keeping its 480 px column, and its tabs leave
// the bottom for a rail on the left.
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

test('in landscape the app spans the whole width with its tabs on the left', async ({ page, browserName }) => {
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  // The app without a key opens on the choice (passkey-reinstall.html, 1 a): the code.
  await page.getByRole('button', { name: copy.recover.code }).click();
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
  // One pane with the rail, the command in view above the buttons (the user's « A », 2026-11-11 09:06Z).
  const command = (await page.getByText('pnpm test', { exact: true }).first().boundingBox())!;
  const allow = (await page.getByRole('button', { name: copy.decide.allow }).boundingBox())!;
  expect.soft(command.y).toBeGreaterThanOrEqual(0);
  expect.soft(command.y + command.height).toBeLessThanOrEqual(allow.y);
  expect.soft(allow.y + allow.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  // What « Toujours » grants stays, whole, in the hint's place under the buttons (Q67, design-ux c8cef0d4).
  const grants = page.getByText(copy.atoi.scope.project);
  await expect.soft(grants).toBeInViewport({ ratio: 1 });
  expect.soft((await grants.boundingBox())!.height).toBeLessThanOrEqual(2 * 16 + 1);
  await expect.soft(page.getByText(copy.decide.hint)).toBeHidden();
  expect.soft(await width()).toBe(page.viewportSize()!.width);

  await page.goBack();
  // A desktop window is a wide screen: the list keeps its rail and a pane beside it (tablet.spec.ts).
  await page.setViewportSize({ width: 1280, height: 800 });
  expect.soft(await width()).toBe(1280);
  expect.soft((await nav.boundingBox())!.x).toBe(0);
});

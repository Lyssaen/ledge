// An iPad, either way up: the tabs are a rail on the left, the list stays on the left and what it opens shows beside it
// (docs/mockups/mobile-multi-device.html, part 5). Narrower (Split View), the phone's single column comes back.
// SHOTS=<dir> saves a capture of each screen there.
import { devices, expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _webkit, ...iPad } = devices['iPad Pro 11 landscape'];
test.use(iPad);
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');

let h: Harness;
test.beforeAll(async () => { h = await startHarness(); });
test.afterAll(async () => { await h?.close(); });

async function shot(page: Page, name: string, browser: string) {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${browser}-tablet-${name}.png` });
}

test('on an iPad the list and the request sit side by side, either way up', async ({ page, browserName }) => {
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  await h.pc.code();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: copy.compare.seePending }).click();
  const row = page.getByRole('link', { name: /pnpm test/ });
  await expect(row).toBeVisible();

  // Nothing chosen yet: the right pane says what will open there.
  await expect(page.getByRole('heading', { name: copy.split.request.title })).toBeVisible();
  const nav = page.getByRole('navigation', { name: copy.nav.label });
  expect.soft((await nav.boundingBox())!.x).toBe(0);
  await shot(page, 'inbox', browserName);

  await row.click();
  const allow = page.getByRole('button', { name: copy.decide.allow });
  await expect(allow).toBeEnabled();
  // The list stays, the chosen row marked, the request on its right; no « Retour » to a list that is already there.
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-current', 'page');
  expect.soft((await allow.boundingBox())!.x).toBeGreaterThan((await row.boundingBox())!.x + (await row.boundingBox())!.width);
  await expect(page.getByRole('link', { name: copy.nav.backTo.atoi! })).toBeHidden();
  await shot(page, 'request', browserName);

  await page.setViewportSize({ width: 834, height: 1194 });
  await expect(row).toBeVisible();
  await expect(allow).toBeVisible();
  await shot(page, 'request-portrait', browserName);

  // Split View: a phone's width, a phone's column.
  await page.setViewportSize({ width: 420, height: 1194 });
  await expect(row).toBeHidden();
  await expect(allow).toBeVisible();
  await shot(page, 'request-narrow', browserName);

  // The agents: nothing chosen, then a thread beside them.
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.getByRole('navigation', { name: copy.nav.label }).getByRole('link', { name: copy.nav.sessions }).click();
  await expect(page.getByRole('heading', { name: copy.split.agent.title })).toBeVisible();
  const agent = page.locator('.split-list main a[href^="#/thread/"]').first();
  await agent.click();
  await expect(agent).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.split-detail header')).toBeVisible();
  await shot(page, 'thread', browserName);
});

// A tablet on its side (docs/mockups/ledge-mobile-refonte/t-tablette.html, §5 and §6): a list with nothing to choose joins both
// panes, its head across and its state centred (Q94 B), while a Rigs list with no rig but its kernel row keeps both; a relay out of
// reach puts one banner over both panes, the list saying its last known state (Q95 A). SHOTS=<dir> saves a capture of each screen.
import { expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { forgeState } from '../test/model/forge-fixtures';
import { openrig } from '../test/model/openrig-fixtures';
import { startHarness, type FakeOpenRig, type Harness } from './harness';
import { hasWebkit } from './webkit';

test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false });

let h: Harness;
test.beforeEach(async () => { h = await startHarness(); });
test.afterEach(async () => { await h?.close(); });

const RAIL = 76;
const rigsOf = (state: FakeOpenRig['state']): FakeOpenRig => ({ state, graphs: {}, queues: {}, permissions: {}, snapshots: {}, routing: [], goals: [] });

async function shot(page: Page, name: string, theme: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/states-${name}-${theme}.png` });
}
async function pair(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(t => { try { localStorage.setItem('ledge.theme', t); localStorage.setItem('mobile.lang', 'fr'); } catch { /* ignore */ } }, theme);
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  await page.getByRole('button', { name: copy.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: copy.compare.seePending }).click();
}
const go = async (page: Page, hash: string) => { await page.evaluate(x => { location.hash = x; }, hash); };

/** One pane right of the rail: the detail hidden, the list (and its head) across the rest. */
async function joined(page: Page) {
  await expect(page.locator('.split-detail')).toBeHidden();
  expect.soft(Math.round((await page.locator('.split-list').boundingBox())!.width)).toBe(1180 - RAIL);
  expect.soft(Math.round((await page.locator('.split-list .pane-head').boundingBox())!.width)).toBe(1180 - RAIL);
}
/** Both panes: the list on the left, the right pane's « nothing chosen » beside it. */
async function apart(page: Page) {
  await expect(page.locator('.split-detail [data-split-empty]')).toBeVisible();
  expect.soft(Math.round((await page.locator('.split-list').boundingBox())!.width)).toBeLessThan(400);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`on a tablet on its side, ${theme}`, () => {
    test('lists with nothing to choose join both panes (Q94 B)', async ({ page }) => {
      h.daemon.sessions = [];
      h.daemon.forge = { state: forgeState({ prs: [] }), details: {}, logs: {} };
      h.daemon.openrig = rigsOf({ ...openrig(), rigs: [], daemon: { state: 'stopped' }, kernel: { state: 'stopped' } });
      await pair(page, theme);

      await go(page, '#/sessions');
      await expect(page.getByRole('heading', { name: copy.agents.empty })).toBeVisible();
      await joined(page);
      await shot(page, 'sessions-empty', theme);

      await go(page, '#/prs');
      await expect(page.getByRole('heading', { name: copy.prs.emptyTitle })).toBeVisible();
      await joined(page);
      await shot(page, 'prs-empty', theme);

      await go(page, '#/rigs');
      await expect(page.getByRole('heading', { name: copy.rigs.stopped.title })).toBeVisible();
      await joined(page);
      await shot(page, 'rigs-stopped', theme);
    });

    test('Rigs with no rig keeps both panes while its kernel row can be chosen (§5)', async ({ page }) => {
      h.daemon.openrig = rigsOf({ ...openrig(), rigs: [] });
      await pair(page, theme);
      await go(page, '#/rigs');
      await expect(page.getByRole('heading', { name: copy.rigs.empty.title })).toBeVisible();
      await apart(page);
      await shot(page, 'rigs-norig', theme);
    });

    test('a relay out of reach puts one banner over both panes (Q95 A)', async ({ page }) => {
      await pair(page, theme);
      const row = page.getByRole('link', { name: /pnpm test/ });
      await row.click();
      await expect(page.getByRole('button', { name: copy.decide.allow })).toBeEnabled();
      await h.stopRelay();
      const strip = page.locator('.split-banner > [data-strip="relay"]');
      await expect(strip).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-strip]')).toHaveCount(1);
      // The band runs right of the rail, over both panes.
      const box = (await strip.boundingBox())!;
      expect.soft(Math.round(box.x)).toBeGreaterThanOrEqual(RAIL);
      expect.soft(Math.round(box.x + box.width)).toBeGreaterThan(1100);
      await expect(page.locator('.split-list .pane-head')).toContainText(/Dernier état connu · \d\d:\d\d/);
      // À toi's head has no host pill (§6), its title on one line; the request keeps no card of its own under the banner.
      await expect(page.locator('.split-list .pane-head [data-host]')).toHaveCount(0);
      expect.soft(Math.round((await page.locator('.split-list .pane-head h1').boundingBox())!.height)).toBeLessThan(32);
      await expect(page.getByText(copy.link.lostTitle)).toHaveCount(0);
      await expect(row).toBeVisible();
      await shot(page, 'relay', theme);
      await h.startRelay();
      await expect(strip).toBeHidden({ timeout: 20_000 });
    });
  });
}

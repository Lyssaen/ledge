// The app's shell (docs/mockups/ledge-mobile-refonte/m0-socle.html): on a phone, the header and the five tabs, the tabs whose
// data the PC does not send yet, Réglages over the tab it was opened from, the banner of a relay out of reach; on an iPad,
// the rail and the two panes. Light and dark.
// SHOTS=<dir> saves a capture of each screen there; compare with captures/ledge-mobile-refonte-m0-s*.png.
import { devices, expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { PC_NAME, startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _phone, ...iPhone13 } = devices['iPhone 13'];
const { defaultBrowserType: _tablet, ...iPad } = devices['iPad Pro 11 landscape'];
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

let h: Harness;
test.beforeEach(async () => { h = await startHarness(); });
test.afterEach(async () => { await h?.close(); });

async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/shell-${name}.png` });
}
async function pair(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(t => { try { localStorage.setItem('ledge.theme', t); } catch { /* ignore */ } }, theme);
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  await h.pc.code();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: copy.compare.seePending }).click();
}
const nav = (page: Page) => page.getByRole('navigation', { name: copy.nav.label });
// A tab's name is its label, then its badge's count when it has one.
const tab = (page: Page, name: string) => nav(page).getByRole('link', { name: new RegExp(`^${name}( \\d+\\+?)?$`) });

for (const theme of ['dark', 'light'] as const) {
  test.describe(`on a phone, ${theme}`, () => {
    test.use(iPhone13);
    test('five tabs, the tabs without data, Réglages over the tab, a relay out of reach', async ({ page }) => {
      await pair(page, theme);
      // §1 · À toi first, its badge in red for the permission waiting; the host pill says the PC answers.
      await expect(page.getByRole('heading', { name: copy.inbox.title, level: 1 })).toBeVisible();
      await expect(nav(page).getByRole('link')).toHaveText([/^À toi/, 'Sessions', 'MR/PR', 'Rigs', 'Ledge']);
      await expect(tab(page, copy.nav.atoi)).toHaveAttribute('aria-current', 'page');
      await expect(tab(page, copy.nav.atoi).locator('[data-badge="red"]')).toHaveText('1');
      await expect(page.locator('[data-host="online"]')).toHaveText(PC_NAME);
      const bar = (await nav(page).boundingBox())!;
      expect.soft(bar.y + bar.height).toBeCloseTo(page.viewportSize()!.height, 0);
      await shot(page, `phone-atoi-${theme}`);

      // §3 · MR/PR and Rigs before the PC sends them.
      await tab(page, copy.nav.prs).click();
      await expect(page.getByRole('heading', { name: copy.prs.notSent(PC_NAME) })).toBeVisible();
      await shot(page, `phone-prs-${theme}`);
      await tab(page, copy.nav.rigs).click();
      await expect(page.getByRole('heading', { name: copy.rigs.notSent(PC_NAME) })).toBeVisible();
      await shot(page, `phone-rigs-${theme}`);
      // The Ledge tab of a PC that does not offer the chat.
      await tab(page, copy.nav.chat).click();
      await expect(page.getByRole('heading', { name: copy.chat.unavailable.title(PC_NAME) })).toBeVisible();
      await expect(page).toHaveURL(/#\/chat$/);
      await shot(page, `phone-chat-${theme}`);

      // §5 · Réglages from the gear, over Rigs: back, the tabs stay, Rigs lit.
      await tab(page, copy.nav.rigs).click();
      await page.getByRole('link', { name: copy.nav.settings, exact: true }).click();
      await expect(page.getByRole('heading', { name: copy.nav.settings, level: 1 })).toBeVisible();
      await expect(tab(page, copy.nav.rigs)).toHaveAttribute('aria-current', 'page');
      await shot(page, `phone-settings-${theme}`);

      // §4 · The relay out of reach: the pill turns amber, the banner opens the tab, the last known state stays.
      await tab(page, copy.nav.sessions).click();
      await h.stopRelay();
      const strip = page.locator('[data-strip="relay"]');
      await expect(strip).toBeVisible({ timeout: 20_000 });
      await expect(strip).toContainText(copy.compare.relayTitle);
      await expect(page.locator('[data-host="offline"]')).toHaveText(copy.host.offline(PC_NAME));
      await shot(page, `phone-relay-${theme}`);
      await h.startRelay();
      await expect(strip).toBeHidden({ timeout: 20_000 });
    });
  });

  test.describe(`on an iPad, ${theme}`, () => {
    test.use(iPad);
    test('the rail, the list and its pane', async ({ page }) => {
      await pair(page, theme);
      const rail = nav(page);
      await expect(rail.getByRole('link')).toHaveText([/^À toi/, 'Sessions', 'MR/PR', 'Rigs', 'Ledge', 'Réglages']);
      const box = (await rail.boundingBox())!;
      expect.soft(box.x).toBe(0);
      expect.soft(box.width).toBe(76);
      expect.soft(box.height).toBe(page.viewportSize()!.height);
      await expect(page.getByRole('heading', { name: copy.split.request.title })).toBeVisible();
      await shot(page, `tablet-atoi-${theme}`);

      // §2 · Rigs before B4: the list says so, the pane says what will open there.
      await rail.getByRole('link', { name: copy.nav.rigs, exact: true }).click();
      await expect(page.getByRole('heading', { name: copy.rigs.notSent(PC_NAME) })).toBeVisible();
      await expect(page.getByRole('heading', { name: copy.rigs.pane.title })).toBeVisible();
      const list = (await page.locator('.split-list').boundingBox())!;
      expect.soft(list.x).toBe(76);
      expect.soft(list.width).toBe(380);
      await shot(page, `tablet-rigs-${theme}`);

      // Réglages at the bottom of the rail: one column, centred.
      await rail.getByRole('link', { name: copy.nav.settings, exact: true }).click();
      await expect(rail.getByRole('link', { name: copy.nav.settings, exact: true })).toHaveAttribute('aria-current', 'page');
      await shot(page, `tablet-settings-${theme}`);
    });
  });
}

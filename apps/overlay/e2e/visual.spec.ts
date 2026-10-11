import { test, expect, layer, expectMode, ready, surface } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { overview, team, perm, openList, restInside } from './scenarios';
import type { Locator, Page } from '@playwright/test';

/* Layout sanity per mockup scenario (Plan 2): the key elements are visible and placed as in the approved mockup.
   French, as the mockup. Screens: 1600 x 1000 like the mockup's reference captures. */
test.use({ lang: 'fr', viewport: { width: 1600, height: 1000 } });
const box = async (l: Locator) => (await l.boundingBox())!;
const openSession = async (page: Page, row: string) => {
  await openList(page);
  await layer(page, 'list').getByRole('button', { name: row }).click();
  await expectMode(page, 'session');
  await restInside(page);
};

test('handle: one bot per session on the left edge, 28 px wide, vertically centered', async ({ page }) => {
  await fakeDaemon(page, overview());
  await ready(page, 4);
  await expect.poll(async () => (await box(surface(page))).width).toBe(28);
  const s = await box(surface(page));
  expect(s.x).toBe(0);
  expect(Math.abs(s.y + s.height / 2 - 500)).toBeLessThan(4);
});

test('overview: brand with its red period, subtitle, header icons, rows with tinted badges, footer', async ({ page }) => {
  await fakeDaemon(page, overview());
  await ready(page, 4);
  await openList(page);
  const list = layer(page, 'list');
  await expect.poll(async () => (await box(surface(page))).width).toBe(380);
  const s = await box(surface(page));
  const brand = list.locator('[data-brand]');
  await expect(brand).toHaveText('Ledge.');
  const rows = list.locator('[data-row]');
  // The period is the primary red, the same as the selected row's bar.
  await expect(brand.locator('span')).toHaveCSS('color', await rows.nth(0).evaluate(el => getComputedStyle(el).borderLeftColor));
  await expect(rows).toHaveCount(4);
  // Rows are 58 px and the badge sits at the row's right edge, a rounded rectangle without a dot.
  const r0 = await box(rows.nth(0)); expect(r0.height).toBe(58);
  const badge = rows.nth(0).locator('[data-badge]');
  const b0 = await box(badge);
  expect(s.x + s.width - (b0.x + b0.width)).toBeLessThan(24);
  await expect(badge).toHaveCSS('border-radius', '5px');
  expect(await badge.evaluate(el => el.children.length)).toBe(0);
  expect(await badge.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  // The oldest ask carries the red bar; the secondary line is "Name · Tool · age" only.
  await expect(rows.nth(0)).toHaveCSS('border-left-width', '2px');
  await expect(rows.nth(0)).toContainText('Otto · Claude Code · 18 min');
  await expect(rows.nth(0)).not.toContainText('pnpm');
  // Footer at the bottom: the do-not-disturb text toggle and the shortcut.
  const foot = list.locator('[data-dnd-footer]');
  await expect(foot).toHaveText('Ne pas déranger');
  expect((await box(foot)).y).toBeGreaterThan(r0.y + 3 * 58);
});

test('permission: eyebrow and caps badge, big title, "Exécution dans" card with the command and the actions, reply field', async ({ page }) => {
  await fakeDaemon(page, overview());
  await ready(page, 4);
  await openSession(page, 'harness-assistant, Otto, ouvrir');
  const view = layer(page, 'session');
  const eyebrow = view.locator('[data-eyebrow]'); const title = view.getByRole('heading', { level: 2 });
  await expect(eyebrow).toHaveText('À vous de jouer');
  await expect(eyebrow).toHaveCSS('text-transform', 'uppercase');
  const badge = view.locator('[data-badge]').first();
  await expect(badge).toHaveCSS('text-transform', 'uppercase');
  expect((await box(badge)).x).toBeGreaterThan((await box(eyebrow)).x + 150);
  expect((await box(title)).y).toBeGreaterThan((await box(eyebrow)).y);
  await expect(title).toHaveCSS('font-size', '18px');
  const card = view.locator('section');
  await expect(card).toContainText('Exécution dans harness-assistant');
  await expect(card).toContainText('pnpm test --filter overlay');
  const deny = card.getByRole('button', { name: 'Refuser' }); const allow = card.getByRole('button', { name: 'Autoriser' });
  expect((await box(allow)).x).toBeGreaterThan((await box(deny)).x);
  await expect(allow.locator('kbd')).toHaveText('Y');
  // The surface grows to the whole content: the reply field ends up under the card, nothing scrolled away.
  const reply = view.getByRole('textbox', { name: 'Répondre à Otto' });
  await expect.poll(async () => (await box(reply)).y - ((await box(card)).y + (await box(card)).height)).toBeGreaterThan(0);
  await expect.poll(() => view.locator('[data-scroll]').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
});

test('question: radio cards with the first chosen (red border), the disabled free field, the primary answer button', async ({ page }) => {
  await fakeDaemon(page, overview());
  await ready(page, 4);
  await openSession(page, 'design-system, Nova, ouvrir');
  const view = layer(page, 'session');
  const cards = view.locator('label.ledge-opt');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute('data-checked', 'true');
  const red = await cards.nth(0).evaluate(el => getComputedStyle(el).borderTopColor);
  expect(await cards.nth(1).evaluate(el => getComputedStyle(el).borderTopColor)).not.toBe(red);
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveAttribute('data-checked', 'true');
  const send = view.getByRole('button', { name: 'Envoyer la réponse →' });
  expect((await box(send)).y).toBeGreaterThan((await box(cards.nth(2))).y);
});

test('read only: "Visible, en lecture seule." with the dashed note and no reply field', async ({ page }) => {
  await fakeDaemon(page, [session('otto', { source: 'hook_only', tmuxSession: null })]);
  await ready(page, 1);
  await openSession(page, 'harness-assistant, Otto, ouvrir');
  const view = layer(page, 'session');
  await expect(view.getByRole('heading', { name: 'Visible, en lecture seule.' })).toBeVisible();
  await expect(view.locator('[data-badge]')).toHaveText('Lecture seule');
  await expect(view.locator('[data-readonly-note]')).toHaveCSS('border-top-style', 'dashed');
  await expect(view.locator('[data-readonly-note]')).toContainText('ledge claude');
  await expect(view.getByRole('textbox')).toHaveCount(0);
});

test.describe('team on a short screen', () => {
  test.use({ viewport: { width: 1600, height: 730 } });
  test('12 sessions: the list scrolls inside the surface with a thin scrollbar', async ({ page }) => {
    await fakeDaemon(page, team());
    await ready(page, 12);
    await openList(page);
    const scroller = layer(page, 'list').locator('[data-scroll]');
    await expect(layer(page, 'list').getByText('12 sessions · 3 demandes pour vous')).toBeVisible();
    const m = await scroller.evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight, w: getComputedStyle(el).scrollbarWidth, c: getComputedStyle(el).scrollbarColor }));
    expect(m.sh).toBeGreaterThan(m.ch);
    expect(m.w).toBe('thin');
    expect(m.c).not.toBe('auto');
    const s = await box(surface(page));
    expect(s.y).toBeGreaterThanOrEqual(40); expect(s.y + s.height).toBeLessThanOrEqual(690);
    await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(layer(page, 'list').getByRole('button', { name: 'landing-page, Tao, ouvrir' })).toBeInViewport();
  });
});

test('the session content and the terminal preview scroll with thin scrollbars too', async ({ page }) => {
  const d = await fakeDaemon(page, overview());
  await ready(page, 4);
  await openSession(page, 'landing-page, Pim, ouvrir');
  d.preview('pim', Array.from({ length: 30 }, (_, i) => `line ${i + 1}`));
  const view = layer(page, 'session');
  await expect(view.locator('pre')).toContainText('line 30');
  for (const sel of ['[data-scroll]', 'pre']) expect(await view.locator(sel).first().evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('thin');
  const pre = view.locator('pre');
  expect(await pre.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
});

test.describe('light theme', () => {
  test('the list follows the light tokens', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('ledge.theme', 'light'); } catch { /* ignore */ } });
    await fakeDaemon(page, overview());
    await ready(page, 4);
    await openList(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // The surface paints the light notch token (white), not the dark one; panel rows use sidebar tokens.
    const bg = await surface(page).evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(await page.evaluate(() => { const d = document.createElement('div'); d.style.background = 'var(--notch)'; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }));
    expect(bg).toBe('rgb(255, 255, 255)');
    await expect(layer(page, 'list').getByText('Votre accord')).toBeVisible();
  });
});

test('bubble: a new ask unfolds "Otto attend votre accord" with Refuser and Autoriser', async ({ page }) => {
  const d = await fakeDaemon(page, [session('pim', { name: 'Pim', tool: 'cursor', project: 'landing-page' })]);
  await ready(page, 1);
  d.upsert(session('otto', { name: 'Otto', ...perm }));
  await expectMode(page, 'bubble');
  const bubble = layer(page, 'bubble');
  await expect(bubble.getByText('Otto attend votre accord')).toBeVisible();
  await expect(bubble).toContainText('pnpm test --filter overlay');
  const deny = bubble.getByRole('button', { name: 'Refuser' }); const allow = bubble.getByRole('button', { name: 'Autoriser' });
  expect((await box(allow)).x).toBeGreaterThan((await box(deny)).x);
  await expect.poll(async () => (await box(surface(page))).width).toBe(336);
});

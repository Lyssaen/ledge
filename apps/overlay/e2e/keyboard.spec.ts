import { test, expect, layer, expectMode, received, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

const sessions = () => [
  session('a', { state: 'idle' }),
  session('b', { name: 'Pim', project: 'speos-api', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run pnpm test', source: 'hook' } }),
  session('c', { name: 'Ada', project: 'ledge-docs' })
];
const row = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-row-id="${id}"] [data-row]`);

test('Ctrl+Alt+L opens the list on the oldest ask; J/K move, Y approves, Enter opens', async ({ page }) => {
  const d = await fakeDaemon(page, sessions());
  await ready(page, 3);
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'list');
  // No row numbers any more: digits are kept for a question's options.
  for (const id of ['a', 'b', 'c']) await expect(row(page, id).locator('kbd')).toHaveCount(0);
  await expect(row(page, 'b')).toBeFocused(); // the oldest ask
  await expect(page.locator('[data-coachmark]')).toBeVisible();
  await page.keyboard.press('j');
  await expect(row(page, 'c')).toBeFocused();
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await expect(row(page, 'a')).toBeFocused();
  await page.keyboard.press('j');
  await page.keyboard.press('y');
  expect(await received(d.received, 'session.decide', m => m.id === 'b')).toEqual({ type: 'session.decide', id: 'b', decision: 'accept' });
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await expectMode(page, 'session');
  await expect(layer(page, 'session')).toContainText('Ada');
  await page.keyboard.press('Escape');
  await expectMode(page, 'list');
  await expect(row(page, 'c')).toBeFocused();
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'handle');
});

test('Alt+Arrow moves to the previous or next session, an ask or not; Ctrl+Alt+N opens the launch form', async ({ page }) => {
  await fakeDaemon(page, sessions());
  await ready(page, 3);
  await page.keyboard.press('Control+Alt+L');
  await expect(row(page, 'b')).toBeFocused();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(row(page, 'c')).toBeFocused();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(row(page, 'a')).toBeFocused();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(row(page, 'c')).toBeFocused();
  await page.keyboard.press('Enter');
  await expectMode(page, 'session');
  await expect(layer(page, 'session')).toContainText('Ada');
  await page.keyboard.press('Alt+ArrowLeft');
  await expectMode(page, 'session');
  await expect(layer(page, 'session')).toContainText('Pim');
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'handle');
  await page.keyboard.press('Control+Alt+N');
  await expectMode(page, 'launch');
  await page.keyboard.press('Control+Alt+N');
  await expectMode(page, 'handle');
});

test('Settings opens from the header and Help from ?; Escape returns to the list', async ({ page }) => {
  await fakeDaemon(page, sessions());
  await ready(page, 3);
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'list');
  await page.locator('[data-coachmark]').getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('[data-coachmark]')).toHaveAttribute('aria-hidden', 'true');
  await layer(page, 'list').getByRole('button', { name: 'Settings' }).click();
  await expectMode(page, 'settings');
  await expect(layer(page, 'settings').getByRole('group', { name: 'Island size' })).toBeVisible();
  await expect(layer(page, 'settings').getByRole('group', { name: 'Window size' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expectMode(page, 'list');
  await page.keyboard.press('?');
  await expectMode(page, 'help');
  await page.keyboard.press('?');
  await expectMode(page, 'list');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
});

test('the coachmark fits its card: one-line button, nothing overflowing, inside the viewport', async ({ page }) => {
  await fakeDaemon(page, sessions());
  await ready(page, 3);
  await page.keyboard.press('Control+Alt+L');
  const coach = page.locator('[data-coachmark]');
  await expect(coach).toBeVisible();
  const button = coach.getByRole('button', { name: 'Got it' });
  const b = (await button.boundingBox())!;
  expect(b.height).toBeLessThanOrEqual(32); // a single line
  const fits = await coach.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
  const c = (await coach.boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.height);
  expect(c.y + c.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('Ctrl+Alt+T switches the theme', async ({ page }) => {
  await fakeDaemon(page, sessions());
  await ready(page, 3);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Control+Alt+T');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Control+Alt+T');
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

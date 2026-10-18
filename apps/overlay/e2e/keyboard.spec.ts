import { test, expect, layer, surface, expectMode, received, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

const quiet = () => [
  session('a', { state: 'idle' }),
  session('b', { name: 'Pim', project: 'speos-api' }),
  session('c', { name: 'Ada', project: 'ledge-docs' })
];
const asking = () => [
  session('a', { state: 'idle' }),
  session('b', { name: 'Pim', project: 'speos-api', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run pnpm test', source: 'hook' } }),
  session('c', { name: 'Ada', project: 'ledge-docs' })
];

test('Ctrl+Alt+L opens the oldest ask; Y approves; a second press opens the chat', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ledge.dnd', '1'));
  const d = await fakeDaemon(page, asking());
  await ready(page, 3);
  await expectMode(page, 'handle');
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble')).toContainText('Pim needs your approval');
  await page.keyboard.press('y');
  expect(await received(d.received, 'session.decide', m => m.id === 'b')).toEqual({ type: 'session.decide', id: 'b', decision: 'accept' });
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'chat');
  await expect(layer(page, 'chat').getByRole('button', { name: 'Back to sessions' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
});

test('Ctrl+Alt+N notes a new session and leaves the island folded', async ({ page }) => {
  await fakeDaemon(page, quiet());
  await ready(page, 3);
  await page.keyboard.press('Control+Alt+N');
  await expectMode(page, 'handle');
  await expect(page.getByRole('status')).toContainText('Opening a new session in Ledge Desktop');
  await page.keyboard.press('Control+Alt+N');
  await expectMode(page, 'handle');
});

test('the chat menu sends settings to Ledge Desktop and toggles Do not disturb', async ({ page }) => {
  await fakeDaemon(page, quiet());
  await ready(page, 3);
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'chat');
  await layer(page, 'chat').getByRole('button', { name: 'Ledge menu' }).click();
  await layer(page, 'chat').getByRole('button', { name: /Settings in Ledge Desktop/ }).click();
  await expect(page.getByRole('status')).toContainText('Opening settings in Ledge Desktop');
  await expectMode(page, 'chat');
  await layer(page, 'chat').getByRole('button', { name: 'Ledge menu' }).click();
  const dnd = layer(page, 'chat').getByRole('switch', { name: /Do not disturb/ });
  await expect(dnd).toHaveAttribute('aria-checked', 'false');
  await dnd.click();
  await expect(dnd).toHaveAttribute('aria-checked', 'true');
});

test('Ctrl+Alt+T switches the theme', async ({ page }) => {
  await fakeDaemon(page, quiet());
  await ready(page, 3);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Control+Alt+T');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Control+Alt+T');
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('a keyboard open while the window is still handle-sized never scrolls the page', async ({ page }) => {
  // Under Tauri the native window grows after the first paint of the open: the bubble takes focus while the viewport is still the notch's 10 px.
  await page.setViewportSize({ width: 1920, height: 10 });
  await page.addInitScript(() => localStorage.setItem('ledge.dnd', '1'));
  await fakeDaemon(page, asking());
  await ready(page, 3);
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'bubble');
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
  expect(await surface(page).evaluate(el => el.getBoundingClientRect().top)).toBe(0);
});

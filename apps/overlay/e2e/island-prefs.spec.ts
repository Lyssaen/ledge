import { DEFAULT_ISLAND_PREFS, type IslandPrefs } from '@ledge/protocol';
import { test, expect, surface, layer, expectMode, received, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/* The island's settings live in Ledge Desktop and come through the local daemon (atelier spec §7). */
const prefs = (extra: Partial<IslandPrefs> = {}, shows: Partial<IslandPrefs['shows']> = {}): IslandPrefs => ({ ...DEFAULT_ISLAND_PREFS, ...extra, shows: { ...DEFAULT_ISLAND_PREFS.shows, ...shows } });
const ask = { state: 'waiting_permission' as const, pending: { kind: 'permission' as const, text: 'Run pnpm test', source: 'hook' as const } };

test('a daemon without settings gets the island’s own, once', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('ledge.islandPosition', 'right'); localStorage.setItem('ledge.discreet', '0'); localStorage.setItem('ledge.handleScale', '1.25'); });
  const d = await fakeDaemon(page, [session('a')], { island: null });
  await ready(page, 1);
  expect((await received(d.received, 'island.set')).prefs).toEqual(prefs({ position: 'right', discreet: false, islandScale: 1.25 }));
  await page.waitForTimeout(300);
  expect(d.received.filter(m => m.type === 'island.set')).toHaveLength(1);
});

test('position and discreet follow Desktop; nothing is sent back', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a')], { island: prefs() });
  await ready(page, 1);
  // The axis sits at the middle of the 1920 px edge, then at its first quarter.
  const axis = async () => { const b = (await surface(page).boundingBox())!; return Math.round((b.x + b.width / 2) / 10) * 10; };
  await expect.poll(axis).toBe(960);
  d.island(prefs({ position: 'left', discreet: false }));
  await expect.poll(axis).toBe(480);
  await expect.poll(() => page.evaluate(() => [localStorage.getItem('ledge.islandPosition'), localStorage.getItem('ledge.discreet')])).toEqual(['left', '0']);
  expect(d.received.some(m => m.type === 'island.set')).toBe(false);
});

test('say off: no speech bubble once an ask is set aside; on again, it speaks', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { name: 'Pim', ...ask })], { island: prefs({}, { say: false }) });
  await ready(page, 1);
  await expectMode(page, 'bubble');
  await layer(page, 'bubble').getByRole('button', { name: /^Later/ }).click();
  await expectMode(page, 'handle');
  const say = page.locator('[data-unread-say]');
  await page.waitForTimeout(800);
  await expect(say).toHaveCSS('opacity', '0');
  d.island(prefs());
  await expect(say).toHaveCSS('opacity', '1');
});

test('finished off: a finish unfolds no bubble; on again, it does', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { name: 'Pim' })], { island: prefs({}, { finished: false }) });
  await ready(page, 1);
  d.upsert(session('a', { name: 'Pim', state: 'idle' }));
  await page.waitForTimeout(1200);
  await expectMode(page, 'handle');
  d.island(prefs());
  d.upsert(session('a', { name: 'Pim', state: 'working' }));
  await page.waitForTimeout(100);
  d.upsert(session('a', { name: 'Pim', state: 'idle' }));
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble')).toHaveAttribute('data-kind', 'finished');
});

test('quick off: the ask card only opens in Ledge or waits; Y decides nothing', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { name: 'Pim', ...ask })], { island: prefs({}, { quick: false }) });
  await ready(page, 1);
  await expectMode(page, 'bubble');
  const bubble = layer(page, 'bubble');
  await expect(bubble.getByRole('button', { name: 'Open in Ledge' })).toBeVisible();
  await expect(bubble.getByRole('button', { name: 'Later' })).toBeVisible();
  await expect(bubble.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(bubble.getByRole('button', { name: 'Deny' })).toHaveCount(0);
  await page.keyboard.press('y');
  await page.waitForTimeout(300);
  expect(d.received.some(m => m.type === 'session.decide')).toBe(false);
  d.island(prefs());
  await expect(bubble.getByRole('button', { name: 'Approve' })).toBeVisible();
});

test('visible off: nothing is drawn, the ask waits; visible again, it shows', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { name: 'Pim' })], { island: prefs() });
  await ready(page, 1);
  d.island(prefs({ visible: false }));
  await expect(surface(page)).toHaveCount(0);
  await expect(page.locator('[data-unread-say]')).toHaveCount(0);
  d.upsert(session('a', { name: 'Pim', ...ask }));
  await page.waitForTimeout(900);
  await expect(surface(page)).toHaveCount(0);
  d.island(prefs());
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble')).toContainText('Run pnpm test');
});

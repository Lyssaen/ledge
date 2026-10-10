import { test, expect, surface, layer, expectMode, received, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

const ask = { kind: 'permission' as const, text: 'Run pnpm test', source: 'hook' as const };

test('the handle shows one bot per session', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', state: 'idle' }), session('c', { name: 'Ada' })]);
  await ready(page, 3);
  await expectMode(page, 'handle');
  await expect(layer(page, 'handle').getByRole('button', { name: 'Pim available, open' })).toBeVisible();
  d.upsert(session('d', { name: 'Zed' }));
  await expect(layer(page, 'handle').getByRole('button')).toHaveCount(4);
  d.remove('a');
  await expect(layer(page, 'handle').getByRole('button')).toHaveCount(3);
});

test('an ask unfolds the bubble after the unfold delay; Approve decides and the bubble folds once the daemon clears it', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a'), session('b', { name: 'Pim' })]);
  await ready(page, 2);
  const t0 = Date.now();
  d.upsert(session('b', { name: 'Pim', state: 'waiting_permission', pending: ask }));
  await expect(layer(page, 'handle').getByRole('button', { name: 'Pim needs your approval, open' })).toBeVisible();
  await expectMode(page, 'bubble');
  expect(Date.now() - t0).toBeGreaterThanOrEqual(500); // the bot grows first, the bubble follows ~540 ms later
  const bubble = layer(page, 'bubble');
  await expect(bubble).toContainText('Run pnpm test');
  await bubble.getByRole('button', { name: 'Approve' }).click();
  expect(await received(d.received, 'session.decide', m => m.id === 'b')).toEqual({ type: 'session.decide', id: 'b', decision: 'accept' });
  await expect(bubble).toHaveAttribute('data-ack', 'pending');
  // The 900 ms acknowledgement alone never folds it: only the daemon's confirmation does.
  await page.waitForTimeout(1200);
  await expectMode(page, 'bubble');
  d.upsert(session('b', { name: 'Pim', state: 'working' }));
  await expectMode(page, 'handle');
  await expect(surface(page)).toHaveCSS('width', '28px');
});

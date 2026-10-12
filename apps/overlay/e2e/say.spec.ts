import { test, expect, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/* The unread say hangs under its speaker: the tail's centre on the companion's, whatever the island size. */
for (const scale of [1, 1.5] as const) test(`the say's tail points at its speaker (island at ${scale * 100}%)`, async ({ page }) => {
  await page.addInitScript(s => { localStorage.setItem('ledge.handleScale', String(s)); localStorage.setItem('ledge.panelScale', '1'); }, scale);
  await fakeDaemon(page, [session('a', { state: 'idle' }), session('b', { name: 'Pim', state: 'idle' }), session('c', { name: 'Ada', state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })]);
  await ready(page, 3);
  const say = page.locator('[data-unread-say]');
  await expect(say).toHaveCSS('opacity', '1', { timeout: 10_000 });
  // Polled: the companions slide into their slots while the island grows, the balloon waits at the final place.
  const gap = async () => {
    const tail = (await say.locator('[data-tail]').boundingBox())!;
    const sprite = (await page.locator('[data-layer="handle"]').getByRole('button', { name: /^Ada/ }).locator('[data-sprite]').boundingBox())!;
    return Math.abs(tail.x + tail.width / 2 - (sprite.x + sprite.width / 2));
  };
  await expect.poll(gap).toBeLessThanOrEqual(0.5);
});

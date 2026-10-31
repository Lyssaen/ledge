import { test, expect, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/* The unread say hangs under Ledge (the notch has no bot row since lot 4): the tail's centre on Ledge's mark, whatever the island size. */
for (const scale of [1, 1.5] as const) test(`the say's tail points at Ledge (island at ${scale * 100}%)`, async ({ page }) => {
  await page.addInitScript(s => { localStorage.setItem('ledge.handleScale', String(s)); localStorage.setItem('ledge.panelScale', '1'); }, scale);
  await fakeDaemon(page, [session('a', { state: 'idle' }), session('b', { name: 'Pim', state: 'idle' }), session('c', { name: 'Ada', state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })]);
  await ready(page, 3);
  const say = page.locator('[data-unread-say]');
  await expect(say).toHaveCSS('opacity', '1', { timeout: 10_000 });
  // Polled: the notch widens by Ledge's line while the balloon waits at the final place.
  const gap = async () => {
    const tail = (await say.locator('[data-tail]').boundingBox())!;
    const dash = (await page.locator('[data-layer="handle"] [data-ledge-mark]').boundingBox())!;
    return Math.abs(tail.x + tail.width / 2 - (dash.x + dash.width / 2));
  };
  await expect.poll(gap).toBeLessThanOrEqual(0.5);
});

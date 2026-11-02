import { test, expect, layer, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/* The cover's controls (mockup « Comportements »): they open on hovering or focusing the cover and close once the pointer
   or the focus leaves it, after a short delay; opening never makes them blink under a still pointer. */
test('the cover’s controls: stable under a still pointer, closed on leaving the cover, kept on a quick out-and-back, by keyboard too', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a')]);
  await ready(page, 1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ledge:now-playing', { detail: { title: 'Lignes de fuite', artist: 'Atelier Nord', playing: true, can: { previous: true, playPause: true, next: true }, player: { id: 'Spotify.exe' } } })));
  // A long line: opening shortens it, which used to slide the cover from under the pointer.
  d.emit({ type: 'session.thread.item', id: 'a', item: { id: 'i1', at: new Date().toISOString(), turn: 1, kind: 'sent', to: 'nova', text: 'Relis la fiche de passation avant de commencer : la pochette ne doit jamais être coupée, c’est la ligne qui cède', status: 'delivered' } });
  const handle = layer(page, 'handle');
  await expect(handle.locator('[data-line]')).toBeVisible();
  await page.waitForTimeout(400);
  const open = () => page.evaluate(() => !!document.querySelector('.nt-music[data-open]'));
  const c = (await handle.locator('[data-cover]').boundingBox())!;
  await page.mouse.move(c.x + 12, c.y + 12, { steps: 3 });
  for (let i = 0; i < 8; i++) { expect(await open()).toBe(true); await page.waitForTimeout(100); }
  // To Ledge, still inside the notch: the controls close.
  const ledge = (await handle.locator('[data-resident]').boundingBox())!;
  await page.mouse.move(ledge.x + 10, ledge.y + 10, { steps: 4 });
  await expect.poll(open).toBe(false);
  // A quick out-and-back over the cover keeps them open.
  const c2 = (await handle.locator('[data-cover]').boundingBox())!;
  await page.mouse.move(c2.x + 12, c2.y + 12, { steps: 2 });
  await expect.poll(open).toBe(true);
  const cur = (await handle.locator('[data-cover]').boundingBox())!;
  await page.mouse.move(cur.x - 30, cur.y + 12);
  await page.mouse.move(cur.x + 12, cur.y + 12);
  await page.waitForTimeout(400);
  expect(await open()).toBe(true);
  // Keyboard: focus on the cover opens them, Tab reaches the three controls, leaving them closes.
  await page.mouse.move(200, 120);
  await expect.poll(open).toBe(false);
  await handle.locator('.nt-cover-btn').focus();
  await expect.poll(open).toBe(true);
  await page.keyboard.press('Tab');
  await expect(handle.getByRole('button', { name: 'Previous' })).toBeFocused();
  await handle.locator('[data-line]').focus();
  await expect.poll(open).toBe(false);
});

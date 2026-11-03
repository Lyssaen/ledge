import { test, expect, surface, layer, expectMode, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';

/* An open view is half the work area at most: a long ask card scrolls its choices, its actions stay in view and work. */
const options = Array.from({ length: 12 }, (_, i) => `Option ${i + 1}: migrate the ${['billing', 'search', 'auth', 'mail'][i % 4]} tables progressively, with a shadow copy kept for a week before the switch`);
for (const { height, panel } of [{ height: 1080, panel: '1' }, { height: 1080, panel: '2' }, { height: 1440, panel: '1.5' }]) {
  test(`a long question card fits half of a ${height} px work area at a ${panel} window size; its actions stay usable`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height });
    await page.addInitScript(v => { try { localStorage.setItem('ledge.panelScale', v); } catch { /* ignore */ } }, panel);
    const d = await fakeDaemon(page, [session('a', { name: 'Otto' })]);
    await ready(page, 1);
    d.upsert(session('a', { name: 'Otto', state: 'waiting_input', pending: { kind: 'question', text: 'Which migration strategy for the four databases?', options, source: 'hook' } }));
    await expectMode(page, 'bubble');
    const bubble = layer(page, 'bubble');
    await expect.poll(async () => (await surface(page).boundingBox())!.height).toBeLessThanOrEqual(height / 2 + 1);
    const s = (await surface(page).boundingBox())!;
    for (const name of [/^Reply/, /^Later/]) {
      const b = (await bubble.getByRole('button', { name }).boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(s.y + s.height + 0.5);
    }
    // Tall: the question's whole text joins the choices in the scrolling area; a hairline says more is below.
    await expect(bubble).toHaveAttribute('data-tall', 'true');
    await expect(bubble.locator('[data-scroll-area] [data-ask-text]')).toContainText('Which migration strategy for the four databases?');
    await expect(bubble.locator('[data-more-rule]')).toHaveAttribute('data-more-rule', 'true');
    // At the top, no hairline under the title; it comes once the area has scrolled.
    await expect(bubble.locator('[data-top-rule]')).toHaveAttribute('data-top-rule', 'false');
    // The choices scroll: the last one can be reached by keyboard and chosen, then Reply sends it; at the end the hairline goes.
    await bubble.getByRole('radio', { name: /Option 1:/ }).focus();
    for (let i = 0; i < 11; i++) await page.keyboard.press('Tab');
    await expect(bubble.getByRole('radio', { name: /Option 12/ })).toBeInViewport();
    const last = bubble.getByRole('radio', { name: /Option 12/ });
    await last.click();
    await bubble.locator('[data-scroll-area]').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(bubble.locator('[data-more-rule]')).not.toHaveAttribute('data-more-rule', 'true');
    await expect(bubble.locator('[data-top-rule]')).toHaveAttribute('data-top-rule', 'true');
    if (process.env.NOTCH_SHOTS) await page.screenshot({ path: `${process.env.NOTCH_SHOTS}/bubble-cap-${height}-${panel}.png`, clip: { x: s.x - 20, y: 0, width: s.width + 40, height: s.height + 20 } });
    await bubble.getByRole('button', { name: /^Reply/ }).click();
    expect(await received(d.received, 'session.reply')).toMatchObject({ id: 'a', text: options[11] });
  });
}

test('a short question card is unchanged: its text under the title, no scrolling area rule shown', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { name: 'Otto' })]);
  await ready(page, 1);
  d.upsert(session('a', { name: 'Otto', state: 'waiting_input', pending: { kind: 'question', text: 'Backfill or shadow?', options: ['Backfill', 'Shadow'], source: 'hook' } }));
  await expectMode(page, 'bubble');
  const bubble = layer(page, 'bubble');
  await expect(bubble).not.toHaveAttribute('data-tall', 'true');
  await expect(bubble.locator('[data-ask-text]')).toHaveCount(0);
  await expect(bubble).toContainText('Backfill or shadow?');
  await expect(bubble.locator('[data-more-rule]')).not.toHaveAttribute('data-more-rule', 'true');
});

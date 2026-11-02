import { test, expect, surface, layer, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openChat } from './scenarios';

/* An open view takes half the work area at most (user's rule, 2026-11-02): a long chat scrolls, its header and its
   composer stay in view. */
for (const height of [1080, 1440]) test(`a long chat stays within half of a ${height} px work area and scrolls`, async ({ page }) => {
  await page.setViewportSize({ width: 1920, height });
  const d = await fakeDaemon(page, [session('a')]);
  await ready(page, 1);
  await openChat(page);
  const at = new Date().toISOString();
  d.emit({ type: 'chat.history', turns: Array.from({ length: 14 }, (_, i) => ({ qid: `q${i}`, question: `Question ${i}: where do the agents stand?`, askedAt: at, answeredAt: at, steps: [], answer: `Answer ${i}.\n\n${'Otto edits the notch, Nova reviews it, Pim waits for your approval on the release. '.repeat(3)}` })) });
  await expect(layer(page, 'chat')).toContainText('Answer 13.');
  await expect.poll(async () => (await surface(page).boundingBox())!.height).toBeLessThanOrEqual(height / 2 + 1);
  await expect.poll(async () => (await surface(page).boundingBox())!.height).toBeGreaterThan(height / 2 - 4);
  // The composer is inside the drawn surface, and the thread scrolls.
  const s = (await surface(page).boundingBox())!;
  const input = (await layer(page, 'chat').getByRole('textbox', { name: 'Ask Ledge' }).boundingBox())!;
  expect(input.y + input.height).toBeLessThanOrEqual(s.y + s.height);
  expect(input.y).toBeGreaterThan(s.y);
  const scrolls = await layer(page, 'chat').evaluate(el => [...el.querySelectorAll<HTMLElement>('*')].some(e => e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)));
  expect(scrolls).toBe(true);
  if (process.env.NOTCH_SHOTS) await page.screenshot({ path: `${process.env.NOTCH_SHOTS}/chat-cap-${height}.png` });
});

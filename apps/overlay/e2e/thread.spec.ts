import { test, expect, expectMode, received, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

const at = (s: number) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
// Enough earlier messages for the session view to overflow, so there is a position to come back to.
const earlier = Array.from({ length: 24 }, (_, i) => ({ kind: 'message', id: `msg-${i}`, at: at(i / 100), turn: 1, text: `Earlier note ${i}, long enough to take a line or two of the session view.` }));
const thread = [
  ...earlier,
  { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Lance les tests du reducer' },
  { kind: 'helper', id: 'h1', at: at(1), turn: 1, task: 'find the reducer consumers', agentType: 'Explore', state: 'exited' },
  { kind: 'message', id: 'msg-a1', at: at(2), turn: 1, helperId: 'h1', text: 'Searching the callers of reduce().' },
  { kind: 'reply', id: 'report-h1', at: at(3), turn: 1, helperId: 'h1', text: 'Three consumers, all in the daemon.' },
  { kind: 'tool', id: 'toolu_1', at: at(4), turn: 1, tool: 'Bash', label: 'Bash · pnpm test', input: 'pnpm test', status: 'running', files: [] }
];

test('the session shows its thread, the live tool line marks its outcome and goes, a helper row opens its own view and comes back', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { state: 'working' })]);
  await ready(page, 1);
  await page.keyboard.press('Control+Alt+L');
  await page.keyboard.press('Enter');
  await expectMode(page, 'session');
  expect(await received(d.received, 'session.thread', m => m.id === 'a')).toEqual({ type: 'session.thread', id: 'a' });
  d.emit({ type: 'session.thread', id: 'a', items: thread });
  const live = page.locator('[data-layer="session"] [data-live-tool]');
  await expect(live).toContainText('Bash');
  await expect(live).toContainText('pnpm test');
  await expect(live.locator('[data-spinner]')).toHaveCount(1);
  await expect(page.locator('[data-layer="session"] [data-prompt]')).toContainText('Lance les tests du reducer');
  d.emit({ type: 'session.thread.item', id: 'a', item: { ...thread[thread.length - 1], status: 'success', output: '12 passed', durationMs: 812 } });
  // The spinner turns into the outcome mark, held a moment; then the line leaves and the call's output is not kept.
  await expect(live.locator('[data-mark]')).toHaveAttribute('data-mark', 'success');
  await expect(live).toHaveCount(0);
  await expect(page.locator('[data-layer="session"]')).not.toContainText('12 passed');
  // The browser clamps the offset to the content's height: read back what it kept.
  const scroll = page.locator('[data-layer="session"] [data-scroll]');
  const kept = await scroll.evaluate(el => { el.scrollTop = 40; return el.scrollTop; });
  expect(kept).toBeGreaterThan(0);
  await page.locator('[data-layer="session"] [data-helper]').click();
  await expectMode(page, 'helper');
  await expect(page.locator('[data-layer="helper"] [data-message]')).toContainText('Searching the callers');
  await expect(page.locator('[data-layer="helper"] [data-report]')).toContainText('Three consumers');
  await page.keyboard.press('Escape');
  await expectMode(page, 'session');
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(kept);
  await expect(page.locator('[data-layer="session"] [data-helper]')).toBeFocused();
});

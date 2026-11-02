import { test, expect, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/* The user's choice A: while a request waits (set aside with Later, or come in Do not disturb), a click on Ledge reopens
   the oldest one in the notch; without one, Ledge opens its chat. */
const permission = (name: string, text: string) => session(name.toLowerCase(), { name, state: 'waiting_permission', pending: { kind: 'permission', text, source: 'hook' } });
const question = (name: string, text: string) => session(name.toLowerCase(), { name, state: 'waiting_input', pending: { kind: 'question', text, source: 'hook' } });

test('Later, then a click on Ledge brings the card back; answered, Ledge opens the chat again', async ({ page }) => {
  const d = await fakeDaemon(page, [session('pim', { name: 'Pim' })]);
  await ready(page, 1);
  d.upsert(permission('Pim', 'Run pnpm test'));
  await expectMode(page, 'bubble');
  await layer(page, 'bubble').getByRole('button', { name: /^Later/ }).click();
  await expectMode(page, 'handle');
  const ledge = layer(page, 'handle').locator('[data-resident]');
  await expect(ledge).toHaveAttribute('aria-label', 'Ledge, a request is waiting: reopen Pim’s approval request');
  await ledge.click();
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble')).toContainText('Run pnpm test');
  await layer(page, 'bubble').getByRole('button', { name: 'Approve' }).click();
  d.upsert(session('pim', { name: 'Pim', state: 'working' }));
  await expectMode(page, 'handle');
  await expect(layer(page, 'handle').locator('[data-pending-dot]')).toHaveCount(0);
  await layer(page, 'handle').locator('[data-resident]').click();
  await expectMode(page, 'chat');
});

test('two requests set aside: the oldest comes back first, the dot is red while a permission waits', async ({ page }) => {
  const d = await fakeDaemon(page, [session('otto', { name: 'Otto' }), session('pim', { name: 'Pim' })]);
  await ready(page, 2);
  d.upsert(question('Otto', 'Backfill or shadow?'));
  await page.waitForTimeout(50);
  d.upsert(permission('Pim', 'Run pnpm test'));
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble')).toContainText('Backfill or shadow?');
  await layer(page, 'bubble').getByRole('button', { name: /^Later/ }).click();
  await expect(layer(page, 'bubble')).toContainText('Run pnpm test');
  await layer(page, 'bubble').getByRole('button', { name: /^Later/ }).click();
  await expectMode(page, 'handle');
  const ledge = layer(page, 'handle').locator('[data-resident]');
  await ledge.hover();
  await expect(layer(page, 'handle').locator('[data-pending-dot]')).toHaveAttribute('data-pending-dot', 'permission');
  await expect(ledge).toHaveAttribute('title', 'Otto has a question (+1 more). Click to reopen the request.');
  await ledge.click();
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble')).toContainText('Backfill or shadow?');
  await layer(page, 'bubble').getByRole('button', { name: /^Later/ }).click();
  d.upsert(session('otto', { name: 'Otto', state: 'working' }));
  await expectMode(page, 'handle');
  await layer(page, 'handle').locator('[data-resident]').click();
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble')).toContainText('Run pnpm test');
});

test('by keyboard: focus on Ledge and Enter reopen the waiting request', async ({ page }) => {
  const d = await fakeDaemon(page, [session('pim', { name: 'Pim' })]);
  await ready(page, 1);
  d.upsert(permission('Pim', 'Run pnpm test'));
  await expectMode(page, 'bubble');
  await layer(page, 'bubble').getByRole('button', { name: /^Later/ }).click();
  await expectMode(page, 'handle');
  await layer(page, 'handle').locator('[data-resident]').focus();
  await page.keyboard.press('Enter');
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble')).toContainText('Run pnpm test');
});

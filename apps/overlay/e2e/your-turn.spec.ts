import { test, expect, layer, expectMode, received, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { reply } from './scenarios';

test('an idle session shows its last reply read like a plan; a chip fills the field and Enter sends it', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a'), session('bix', { name: 'Bix', project: 'documentation', ...reply })]);
  await ready(page, 2);
  await layer(page, 'handle').getByRole('button', { name: /^Bix/ }).click();
  await expectMode(page, 'session');
  const view = layer(page, 'session');
  await expect(view.getByRole('heading', { level: 2 })).toHaveText('Three reducer findings fixed, transitions covered by a table test');
  await expect(view.locator('[data-kicker]')).toHaveText(['What I did', 'Verified', 'Open question', 'Left to do']);
  await expect(view.locator('[data-item="done"]')).toHaveCount(6);
  // The terminal preview folds under the reply.
  d.preview('bix', ['● Bash(pnpm test --filter ledge)', '  ⎿  112 passed']);
  await expect(view.locator('details.ledge-terminal')).toBeVisible();
  await expect(view.locator('details.ledge-terminal')).not.toHaveAttribute('open');
  const q = view.getByRole('group', { name: 'Question 1' });
  await q.getByRole('button', { name: 'Start clean' }).click();
  const field = view.getByRole('textbox', { name: 'Reply to Bix' });
  await expect(field).toHaveValue('Start clean');
  await expect(field).toBeFocused();
  await field.press('Enter');
  expect(await received(d.received, 'session.reply', m => m.id === 'bix')).toEqual({ type: 'session.reply', id: 'bix', text: 'Start clean' });
  await expect(field).toHaveValue('');
  // The next prompt clears the reply: the daemon sends the session without it, the view goes back to the preview.
  d.upsert(session('bix', { name: 'Bix', project: 'documentation', state: 'working' }));
  await expect(view.locator('[data-reply-card]')).toHaveCount(0);
});

test('the raw toggle shows the reply as written', async ({ page }) => {
  await fakeDaemon(page, [session('bix', { name: 'Bix', project: 'documentation', ...reply })]);
  await ready(page, 1);
  await layer(page, 'handle').getByRole('button', { name: /^Bix/ }).click();
  await expectMode(page, 'session');
  const view = layer(page, 'session');
  await view.getByRole('button', { name: 'Full reply as written' }).click();
  await expect(view.locator('[data-reply-raw]')).toContainText('### What I did');
  await view.getByRole('button', { name: 'Structured view' }).click();
  await expect(view.locator('[data-kicker]').first()).toBeVisible();
});

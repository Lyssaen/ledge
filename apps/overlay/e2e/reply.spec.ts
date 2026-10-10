import { test, expect, layer, expectMode, received, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

test('Enter in the reply field sends session.reply; an error for that id restores the draft', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api' })]);
  await ready(page, 2);
  await layer(page, 'handle').getByRole('button', { name: /^Pim/ }).click();
  await expectMode(page, 'session');
  const field = layer(page, 'session').getByRole('textbox', { name: 'Reply to Pim' });
  await field.click();
  await field.pressSequentially('also run the linter');
  await field.press('Enter');
  expect(await received(d.received, 'session.reply', m => m.id === 'b')).toEqual({ type: 'session.reply', id: 'b', text: 'also run the linter' });
  await expect(field).toHaveValue('');
  d.error('b', 'tmux pane is gone');
  await expect(field).toHaveValue('also run the linter');
  await expectMode(page, 'session');
});

import { test, expect, layer, expectMode, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openList, restInside } from './scenarios';

/* Removing a finished or read-only session from the list: session.dismiss, then the row leaves on session.removed. */
const sessions = () => [
  session('pim', { name: 'Pim', project: 'landing-page' }),
  session('lu', { name: 'Lu', project: 'documentation', state: 'exited', exitCode: 0, exitedAt: new Date().toISOString() }),
  session('bix', { name: 'Bix', project: 'speos-api', source: 'hook_only', tmuxSession: null, state: 'idle' })
];

test('a finished row is removed from the list; a running launcher row has no remove button', async ({ page }) => {
  const d = await fakeDaemon(page, sessions());
  await ready(page, 3);
  await openList(page);
  const list = layer(page, 'list');
  const row = list.locator('[data-row-id="lu"]');
  const remove = list.getByRole('button', { name: 'Remove from list: documentation, Lu' });
  // Hidden until the row is hovered (or focused), then a real button.
  await expect(remove).toHaveCSS('opacity', '0');
  await row.hover();
  await expect(remove).toHaveCSS('opacity', '1');
  await expect(list.locator('[data-row-id="pim"] [data-dismiss]')).toHaveCount(0);
  await expect(list.getByRole('button', { name: 'Remove from list: speos-api, Bix' })).toHaveCount(1);
  await remove.click();
  expect(await received(d.received, 'session.dismiss')).toEqual({ type: 'session.dismiss', id: 'lu' });
  // The click does not open the row.
  await expectMode(page, 'list');
  d.remove('lu');
  await expect(row).toHaveCount(0);
  await expect(list.locator('[data-row-id]')).toHaveCount(2);
});

test('the remove button is reachable with the keyboard', async ({ page }) => {
  const d = await fakeDaemon(page, sessions());
  await ready(page, 3);
  await openList(page);
  const list = layer(page, 'list');
  await list.getByRole('button', { name: 'speos-api, Bix, open' }).focus();
  await page.keyboard.press('Tab');
  const remove = list.getByRole('button', { name: 'Remove from list: speos-api, Bix' });
  await expect(remove).toBeFocused();
  await expect(remove).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  expect(await received(d.received, 'session.dismiss')).toEqual({ type: 'session.dismiss', id: 'bix' });
});

test('from the session view of a read-only session, then back to the list once removed', async ({ page }) => {
  const d = await fakeDaemon(page, sessions());
  await ready(page, 3);
  await openList(page);
  await layer(page, 'list').getByRole('button', { name: 'speos-api, Bix, open' }).click();
  await expectMode(page, 'session');
  await restInside(page);
  await layer(page, 'session').getByRole('button', { name: 'Remove from list' }).click();
  expect(await received(d.received, 'session.dismiss')).toEqual({ type: 'session.dismiss', id: 'bix' });
  d.remove('bix');
  await expectMode(page, 'list');
  await expect(layer(page, 'list').locator('[data-row-id="bix"]')).toHaveCount(0);
});

test('a session removed while open slides out with its content, never as an empty panel', async ({ page }) => {
  const d = await fakeDaemon(page, sessions());
  await ready(page, 3);
  d.preview('bix', ['● Reading the speos-api routes']);
  await openList(page);
  await layer(page, 'list').getByRole('button', { name: 'speos-api, Bix, open' }).click();
  await expectMode(page, 'session');
  const view = layer(page, 'session');
  await expect(view).toContainText('Reading the speos-api routes');
  d.remove('bix');
  await expectMode(page, 'list');
  // The view leaves the way a Back does: still drawn (inert) while it fades, preview included.
  await expect(view).toContainText('speos-api');
  await expect(view).toContainText('Reading the speos-api routes');
  await expect(view).toHaveAttribute('inert', '');
});

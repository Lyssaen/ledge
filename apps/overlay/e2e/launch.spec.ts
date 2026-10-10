import { test, expect, layer, expectMode, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openList, restInside } from './scenarios';

/* Starting a session from the list: the form, session.launch, the daemon's answer, the notice; the empty list's button. */
const recents = [
  { cwd: '/home/u/Workspace/api-gateway', project: 'api-gateway', lastAt: new Date(Date.now() - 3_600_000).toISOString() },
  { cwd: '/w/harness-assistant', project: 'harness-assistant', lastAt: new Date(Date.now() - 7_200_000).toISOString() }
];

test('the + opens the form on the most recent folder; Start sends session.launch; the answer returns to the list with a notice', async ({ page }) => {
  const d = await fakeDaemon(page, [session('otto')], { recents, launcher: ['/usr/bin/node', '/opt/ledge/cli.js'] });
  await ready(page, 1);
  await openList(page);
  await layer(page, 'list').getByRole('button', { name: 'New session' }).click();
  await expectMode(page, 'launch');
  await restInside(page);
  const form = layer(page, 'launch');
  await expect(form.getByLabel('Folder', { exact: true })).toHaveValue('/home/u/Workspace/api-gateway');
  // Otto works in harness-assistant: the recent says so.
  await expect(form.getByRole('listitem', { name: 'Choose harness-assistant (/w/harness-assistant)' })).toContainText('Otto works there');
  await form.getByLabel('Companion', { exact: true }).fill('Juno');
  await form.getByLabel(/First instruction/).fill('run the tests');
  await form.getByRole('button', { name: /^Start/ }).click();
  const launch = await received(d.received, 'session.launch');
  expect(launch).toEqual({ type: 'session.launch', tool: 'claude', cwd: '/home/u/Workspace/api-gateway', name: 'Juno', prompt: 'run the tests', continue: false });
  await expect(form.getByRole('button', { name: /Starting…/ })).toBeDisabled();
  d.launched(session('n1', { name: 'Juno', project: 'api-gateway', cwd: '/home/u/Workspace/api-gateway', title: 'Juno · api-gateway', state: 'starting' }));
  await expectMode(page, 'list');
  const list = layer(page, 'list');
  await expect(list.getByRole('status')).toHaveText(/Juno is starting in api-gateway\./);
  await expect(list.getByRole('button', { name: 'api-gateway, Juno, open' })).toBeVisible();
  await expect(list.locator('[data-row-id="n1"]')).toContainText('Starting');
});

test('a refused launch keeps the form open with the reason', async ({ page }) => {
  const d = await fakeDaemon(page, [session('otto')]);
  await ready(page, 1);
  await openList(page);
  await layer(page, 'list').getByRole('button', { name: 'New session' }).click();
  const form = layer(page, 'launch');
  await expect(form.getByRole('button', { name: /^Start/ })).toBeDisabled(); // no recents: no folder yet
  await form.getByLabel('Folder', { exact: true }).fill('~/nope');
  await form.getByLabel('Folder', { exact: true }).press('Enter');
  await received(d.received, 'session.launch', m => m.cwd === '~/nope');
  d.refuse('no such folder: /home/u/nope');
  await expectMode(page, 'launch');
  await expect(form.getByRole('status')).toHaveText('Could not start: no such folder: /home/u/nope');
  await page.keyboard.press('Escape');
  await expectMode(page, 'list');
});

test('an empty list shows the empty state, whose button opens the form', async ({ page }) => {
  await fakeDaemon(page, []);
  await ready(page, 0);
  await openList(page);
  const list = layer(page, 'list');
  await expect(list.getByText('No sessions')).toBeVisible();
  await expect(list.getByText('Nobody at work.')).toBeVisible();
  await list.locator('[data-launch-empty]').click();
  await expectMode(page, 'launch');
});

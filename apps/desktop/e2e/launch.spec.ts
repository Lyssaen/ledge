import { test, expect } from './fixtures';
import { fakeDaemon, fakeRemote, session } from './daemon';

const recents = [
  { cwd: '/w/website', project: 'website', lastAt: '2026-10-14T10:00:00.000Z' },
  { cwd: '/w/ledge', project: 'ledge', lastAt: '2026-10-15T09:00:00.000Z' }
];
const launches = (received: { type: string }[]) => received.filter(m => m.type === 'session.launch');
const card = (page: import('@playwright/test').Page, name: string) => page.locator('.seat, .session-card').filter({ has: page.locator('.person-name', { hasText: new RegExp(`^${name}$`) }) });
const machineField = (page: import('@playwright/test').Page) => page.getByLabel('Machine', { exact: true });

test('no session: a first one starts from the empty workspace', async ({ page }) => {
  const local = await fakeDaemon(page, [], { recents });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your team starts here' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a session' }).click();
  await expect(page.getByRole('form', { name: 'New session settings' })).toBeVisible();
  await expect(machineField(page)).toBeFocused();
  await expect(page.getByLabel('Project', { exact: true })).toHaveValue('/w/ledge');   // the most recent one
  await expect(page.getByLabel('Working folder')).toHaveValue('/w/ledge');
  await expect(page.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
  await page.getByLabel('First instruction').fill('Fix the flaky test');
  await page.getByRole('button', { name: 'Start the session' }).click();
  // Démarrage: the request as sent, the focus on its title.
  const starting = page.getByRole('region', { name: 'Starting the session' });
  await expect(starting.getByRole('status')).toHaveText('Preparing the session on Local · WSL…');
  await expect(page.getByRole('heading', { level: 3, name: 'Starting your agent' })).toBeFocused();
  await expect(starting.locator('.launch-prompt')).toHaveText('Fix the flaky test');
  await expect.poll(() => launches(local.received)).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the flaky test' }]);
  local.launched(session('ari', { name: 'Ari', cwd: '/w/ledge', project: 'ledge', state: 'working' }));
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'local:ari');
  await expect(page.locator('#conversation-reply')).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('desktop.launch'))).toBeNull();
});

test('New session: the default agent, a checked folder, a draft across a reload, a refusal', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.tool', JSON.stringify('codex')); } catch { /* ignore */ } });
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { recents });
  await page.goto('/');
  await expect(card(page, 'Otto')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByRole('radio', { name: 'Codex' })).toBeChecked();
  await page.getByLabel('Project', { exact: true }).selectOption({ label: 'Other folder…' });
  await expect(page.getByLabel('Working folder')).toBeFocused();
  await expect(page.getByLabel('Working folder')).toHaveValue('');
  await page.getByLabel('Working folder').fill('w/relative');
  await page.getByLabel('First instruction').fill('Write the docs');
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter an absolute folder (/…) or one starting with ~.');
  await expect(page.getByLabel('Working folder')).toBeFocused();
  expect(launches(local.received)).toEqual([]);
  await page.getByLabel('Working folder').fill('~/notes');
  // The form is kept in desktop.launch: a reload brings it back (the screen itself starts closed).
  await page.reload();
  await expect(card(page, 'Otto')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByLabel('Working folder')).toHaveValue('~/notes');
  await expect(page.getByLabel('First instruction')).toHaveValue('Write the docs');
  await expect(page.getByRole('radio', { name: 'Codex' })).toBeChecked();
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect.poll(() => launches(local.received)).toEqual([{ type: 'session.launch', tool: 'codex', cwd: '~/notes', prompt: 'Write the docs' }]);
  // Échec: why, then Edit settings keeps everything.
  local.refuse('folder not found: ~/notes');
  await expect(page.getByRole('alert')).toHaveText('The daemon refused: folder not found: ~/notes');
  await expect(page.getByRole('heading', { level: 3, name: 'The agent could not start' })).toBeFocused();
  await page.getByRole('button', { name: 'Edit settings' }).click();
  await expect(page.getByLabel('Working folder')).toHaveValue('~/notes');
  await expect(page.getByLabel('First instruction')).toHaveValue('Write the docs');
  expect(await page.evaluate(() => localStorage.getItem('desktop.tool'))).toBe('"codex"');   // the form never writes the default
});

test('a start that times out is retried; the first answer, late, is skipped', async ({ page }) => {
  await page.clock.install();
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { recents });
  await page.goto('/');
  await expect(card(page, 'Otto')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByLabel('First instruction').fill('Fix the flaky test');
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect.poll(() => launches(local.received).length).toBe(1);
  await page.clock.fastForward(14_000);
  await expect(page.getByRole('region', { name: 'Starting the session' })).toBeVisible();
  await page.clock.fastForward(1_000);
  await expect(page.getByRole('alert')).toHaveText('The daemon did not answer in time. No new session was confirmed.');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => launches(local.received).length).toBe(2);
  expect(launches(local.received)[1]).toEqual(launches(local.received)[0]);
  // The daemon answers in order: the first `launched` is the timed-out attempt's, the second this one's.
  local.launched(session('late', { name: 'Late' }));
  local.launched(session('ari', { name: 'Ari' }));
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'local:ari');
  await expect(card(page, 'Late')).toBeVisible();
});

test('Cancel closes the screen; the late session is listed but not selected', async ({ page }) => {
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { recents });
  await page.goto('/');
  await card(page, 'Otto').click();
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'local:otto');
  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByLabel('First instruction').fill('Fix the flaky test');
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect.poll(() => launches(local.received).length).toBe(1);
  await page.getByRole('button', { name: 'Cancel launch' }).click();
  await expect(page.getByRole('button', { name: 'New session' })).toBeFocused();
  local.launched(session('late', { name: 'Late' }));
  await expect(card(page, 'Late')).toBeVisible();
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'local:otto');
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByLabel('First instruction')).toHaveValue('Fix the flaky test');
});

test('a remote machine gets its own launch; a disconnected one cannot be chosen', async ({ page }) => {
  const machines = [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }];
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { machines, recents });
  const remote = await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova' })], { recents: [{ cwd: '/home/dev/api', project: 'api', lastAt: '2026-10-15T08:00:00.000Z' }] });
  await page.goto('/');
  await expect(page.locator('.seat, .session-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'New session' }).click();
  await machineField(page).selectOption('devbox');
  await expect(page.getByLabel('Working folder')).toHaveValue('/home/dev/api');
  await page.getByLabel('First instruction').fill('Run the tests');
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect(page.getByRole('region', { name: 'Starting the session' }).getByRole('status')).toHaveText('Preparing the session on Devbox · SSH…');
  await expect.poll(() => launches(remote.received)).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/home/dev/api', prompt: 'Run the tests' }]);
  expect(launches(local.received)).toEqual([]);
  remote.launched(session('ari', { name: 'Ari', cwd: '/home/dev/api', project: 'api' }));
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'devbox:ari');
  // Devbox falls: the launch screen keeps the connection notice and offers only Local.
  remote.close();
  await expect(page.getByText('Devbox is disconnected')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByText('Devbox is disconnected')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Devbox · SSH · disconnected' })).toBeDisabled();
  await expect(machineField(page)).toHaveValue('local');
  await expect(page.getByText('Devbox · SSH is disconnected. You can start a session on Local · WSL.')).toBeVisible();
});

test('the folder browser lists the chosen machine and fills the folder', async ({ page }) => {
  const local = await fakeDaemon(page, [], { recents });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a session' }).click();
  await page.getByRole('button', { name: 'Browse…' }).click();
  const browser = page.getByRole('region', { name: 'Folders on Local · WSL' });
  await expect(browser).toBeVisible();
  const lists = () => local.received.filter(m => m.type === 'folder.list');
  await expect.poll(lists).toEqual([{ type: 'folder.list', path: '/w/ledge' }]);
  local.listing('/w/ledge', '/w', ['apps', 'docs']);
  await browser.getByRole('button', { name: 'Open apps' }).click();
  await expect.poll(lists).toEqual([{ type: 'folder.list', path: '/w/ledge' }, { type: 'folder.list', path: '/w/ledge/apps' }]);
  local.listing('/w/ledge/apps', '/w/ledge', ['desktop']);
  await expect(browser.getByRole('button', { name: 'Open desktop' })).toBeVisible();
  await browser.getByRole('button', { name: 'Choose this folder' }).click();
  await expect(browser).toBeHidden();
  await expect(page.getByLabel('Working folder')).toHaveValue('/w/ledge/apps');
  await expect(page.getByLabel('Working folder')).toBeFocused();
});

test('read-only: New session is disabled while the local daemon is down', async ({ page }) => {
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { recents });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New session' })).toBeEnabled();
  local.close();
  await expect(page.getByRole('alert')).toContainText('Local daemon unreachable');
  await expect(page.getByRole('button', { name: 'New session' })).toBeDisabled();
});

for (const size of [{ width: 1920, height: 1080 }, { width: 1024, height: 700 }]) {
  test(`the launch screen fills a ${size.width}×${size.height} window and scrolls inside`, async ({ page }) => {
    await page.setViewportSize(size);
    await fakeDaemon(page, [], { recents });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start a session' }).click();
    await expect(page.getByRole('form', { name: 'New session settings' })).toBeVisible();
    expect(await page.locator('main.app').boundingBox()).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
    const bar = (await page.locator('.statusbar').boundingBox())!;
    expect(bar.y + bar.height).toBe(size.height);
    expect(await page.locator('.launch-scroll').evaluate(e => getComputedStyle(e).overflowY)).toBe('auto');
    await page.getByRole('button', { name: 'Start the session' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Start the session' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
  });
}

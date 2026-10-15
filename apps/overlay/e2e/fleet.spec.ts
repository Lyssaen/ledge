import type { WebSocketRoute } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';
import { islandWidth } from '../src/surface/geometry';
import { test, expect, layer, ready, received, surface } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openList, restInside } from './scenarios';

test('one project, common chat clarification, remote confirmation and disconnection', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ledge.machines', JSON.stringify([
    { id: 'local', label: 'Local', url: 'ws://127.0.0.1:47831' },
    { id: 'server', label: 'dev-server', url: 'ws://127.0.0.1:47832', ssh: 'dev-server' }
  ])));
  const local = await fakeDaemon(page, [session('same', { repo: 'ledge', repoId: 'github.com/org/ledge' })], { daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true } });
  let remoteSocket: WebSocketRoute | undefined;
  const remote: ClientMessage[] = [];
  await page.routeWebSocket(/127\.0\.0\.1:47831\/ssh\/dev-server/, ws => {
    remoteSocket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sshAlias: 'dev-server', sessions: [session('same', { name: 'Nova', repo: 'ledge', repoId: 'github.com/org/ledge' })] }));
    ws.onMessage(m => remote.push(JSON.parse(String(m))));
  });
  await ready(page, 2); await openList(page); await restInside(page);
  await expect(layer(page, 'list').locator('[data-row-id="server:same"]')).toContainText('dev-server');
  await expect(layer(page, 'list')).toContainText('2 machines');
  await layer(page, 'list').getByRole('textbox', { name: 'Ask Ledge' }).fill('Launch a session in ledge');
  await page.keyboard.press('Enter');
  const route = await received(local.received, 'chat.route');
  local.emit({ type: 'chat.routed', qid: route.qid, result: { machineId: null, text: 'Which machine?', choices: ['local', 'server'] } });
  await expect(layer(page, 'chat')).toContainText('Which machine?');
  await layer(page, 'chat').getByRole('button', { name: 'dev-server', exact: true }).click();
  const clarified = await received(local.received, 'chat.route', m => m.qid !== route.qid);
  expect(clarified.context.history).toEqual(expect.arrayContaining([expect.objectContaining({ question: 'Launch a session in ledge', answer: 'Which machine?' })]));
  local.emit({ type: 'chat.routed', qid: clarified.qid, result: { machineId: 'server', text: 'Launch a session in /w/ledge' } });
  const ask = await received(remote, 'chat.ask');
  remoteSocket!.send(JSON.stringify({ type: 'chat.done', qid: ask.qid, text: 'Ready to start.', at: new Date().toISOString(), proposal: { cwd: '/w/ledge', project: 'ledge', tool: 'claude' } }));
  const card = layer(page, 'chat').getByRole('region', { name: 'Proposed session' });
  expect(remote.some(m => m.type === 'session.launch')).toBe(false);
  await card.getByRole('button', { name: /Start the session/ }).click();
  expect(await received(remote, 'session.launch')).toMatchObject({ cwd: '/w/ledge', qid: ask.qid });
  expect(local.received.some(m => m.type === 'session.launch')).toBe(false);
  await remoteSocket!.close();
  await expect(card.getByRole('button', { name: /Start the session/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(layer(page, 'list').locator('[data-row-id="server:same"]')).toHaveCount(0);
  await expect(layer(page, 'list').locator('[data-row-id="local:same"]')).toBeVisible();
});

test('the folded island groups the companions by machine with a pipe between the machines', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ledge.machines', JSON.stringify([
    { id: 'local', label: 'Local', url: 'ws://127.0.0.1:47831' },
    { id: 'server', label: 'dev-server', url: 'ws://127.0.0.1:47832', ssh: 'dev-server' }
  ])));
  await fakeDaemon(page, [session('a', { name: 'Ida', state: 'idle' }), session('b', { name: 'Kai', state: 'idle' })]);
  await page.routeWebSocket(/127\.0\.0\.1:47831\/ssh\/dev-server/, ws => {
    ws.send(JSON.stringify({ type: 'snapshot', sshAlias: 'dev-server', sessions: [session('r', { name: 'Nova', state: 'idle' })] }));
  });
  await ready(page, 3);
  const handle = layer(page, 'handle');
  await expect(surface(page)).toHaveCSS('width', `${islandWidth(3, false, 1)}px`);
  await expect.poll(() => handle.evaluate(el => [...el.children].flatMap(c => c.hasAttribute('data-machine-separator') ? (getComputedStyle(c).opacity === '1' ? ['|'] : []) : c.hasAttribute('data-resident') ? ['ledge'] : c.tagName === 'BUTTON' ? [c.getAttribute('aria-label')!.split(' ')[0]!] : []))).toEqual(['ledge', 'Ida', 'Kai', '|', 'Nova']);
});

test('Machines tab: test an SSH alias, see the failure in plain words, then add the server', async ({ page }) => {
  await fakeDaemon(page, [session('here')], { daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true } });
  await page.routeWebSocket(/127\.0\.0\.1:47831\/ssh\/build-box/, ws => {
    ws.send(JSON.stringify({ type: 'snapshot', sshAlias: 'build-box', sessions: [session('a'), session('b')], daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true } }));
  });
  await page.routeWebSocket(/127\.0\.0\.1:47831\/ssh\/typo-box/, ws => {
    ws.send(JSON.stringify({ type: 'error', message: 'SSH connection closed (255). ssh: Could not resolve hostname typo-box: Name or service not known' }));
    void ws.close();
  });
  await ready(page, 1); await openList(page);
  await layer(page, 'list').getByRole('button', { name: 'Settings' }).click();
  const settings = layer(page, 'settings');
  await settings.getByRole('tab', { name: 'Machines' }).click();
  await expect(settings.getByText('This machine')).toBeVisible();
  await settings.getByRole('button', { name: 'Add a machine' }).click();
  await settings.getByLabel('Name').fill('Build');
  await settings.getByLabel('SSH alias').fill('typo-box');
  await settings.getByRole('button', { name: 'Test the connection' }).click();
  await expect(settings.getByRole('status')).toContainText('Alias not found');
  await settings.getByLabel('SSH alias').fill('build-box');
  await settings.getByRole('button', { name: 'Test the connection' }).click();
  await expect(settings.getByRole('status')).toContainText('Ledge 0.4.0 answers · 2 sessions');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings.getByText('SSH · build-box · Ledge 0.4.0 · 2 sessions')).toBeVisible();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('ledge.machines') ?? '[]'))).toEqual([
    expect.objectContaining({ id: 'local' }), expect.objectContaining({ label: 'Build', ssh: 'build-box' })
  ]);
});

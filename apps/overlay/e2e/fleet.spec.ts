import type { WebSocketRoute } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';
import { filetWidth } from '../src/surface/geometry';
import { test, expect, layer, ready, received, surface, expectMode } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openChat } from './scenarios';

test('across machines the notch writes to the local Ledge only (lot 4); a remote disconnection leaves the local sessions', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ledge.machines', JSON.stringify([
    { id: 'local', label: 'Local', url: 'ws://127.0.0.1:47831' },
    { id: 'server', label: 'dev-server', url: 'ws://127.0.0.1:47832', ssh: 'dev-server' }
  ])));
  const local = await fakeDaemon(page, [session('same', { repo: 'ledge', repoId: 'github.com/org/ledge' })], { daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true }, chat: { text: 'Nova works on ledge, on dev-server.' } });
  let remoteSocket: WebSocketRoute | undefined;
  const remote: ClientMessage[] = [];
  await page.routeWebSocket(/127\.0\.0\.1:47831\/ssh\/dev-server/, ws => {
    remoteSocket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sshAlias: 'dev-server', sessions: [session('same', { name: 'Nova', repo: 'ledge', repoId: 'github.com/org/ledge' })] }));
    ws.onMessage(m => remote.push(JSON.parse(String(m))));
  });
  await ready(page, 2); await openChat(page);
  await layer(page, 'chat').getByRole('textbox', { name: 'Ask Ledge' }).fill('Where is Nova at?');
  await page.keyboard.press('Enter');
  expect(await received(local.received, 'ledge.say')).toEqual({ type: 'ledge.say', rid: expect.any(String), text: 'Where is Nova at?' });
  await expect(layer(page, 'chat')).toContainText('Nova works on ledge, on dev-server.');
  // No routing from the notch any more: neither machine hears chat.route nor chat.ask, the remote one hears nothing of it.
  expect(local.received.some(m => m.type === 'chat.route' || m.type === 'chat.ask')).toBe(false);
  expect(remote.some(m => m.type === 'chat.route' || m.type === 'chat.ask' || m.type === 'ledge.say')).toBe(false);
  await remoteSocket!.close();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
  // The remote machine's session left with its link; Ledge watches the local one alone.
  await expect(layer(page, 'handle')).toHaveAttribute('data-sessions', '1');
});

test('the folded notch holds Ledge alone across machines: no hairline, no dash (lot 4)', async ({ page }) => {
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
  await expect(surface(page)).toHaveCSS('width', `${filetWidth([])}px`);
  await expect(handle.locator('[data-machine-separator]')).toHaveCount(0);
  await expect(handle.locator('[data-dot]')).toHaveCount(0);
  await expect(handle.locator('[data-resident] [data-ledge-mark]')).toBeVisible();
});

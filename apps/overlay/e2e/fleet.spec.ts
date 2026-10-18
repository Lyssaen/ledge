import type { WebSocketRoute } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';
import { filetWidth } from '../src/surface/geometry';
import { test, expect, layer, ready, received, surface, expectMode } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openChat } from './scenarios';

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
  await ready(page, 2); await openChat(page);
  await layer(page, 'chat').getByRole('textbox', { name: 'Ask Ledge' }).fill('Launch a session in ledge');
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
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
  await expect(layer(page, 'handle').getByRole('button', { name: /^Nova/ })).toHaveCount(0);
  await expect(layer(page, 'handle').getByRole('button', { name: /^Otto/ })).toBeVisible();
});

test('the folded notch puts a hairline before each machine', async ({ page }) => {
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
  await expect(surface(page)).toHaveCSS('width', `${filetWidth([2, 1])}px`);
  await expect.poll(() => handle.evaluate(el => {
    const out: string[] = [];
    const walk = (node: Element) => {
      if (node.hasAttribute('data-machine-separator')) { out.push('|'); return; }
      if (node.hasAttribute('data-resident')) { out.push('ledge'); return; }
      if (node.tagName === 'BUTTON' && !node.querySelector('[data-update-pip]')) { out.push(node.getAttribute('aria-label')!.split(' ')[0]!); return; }
      for (const child of node.children) walk(child);
    };
    for (const child of el.children) walk(child);
    return out;
  })).toEqual(['ledge', '|', 'Ida', 'Kai', '|', 'Nova']);
});

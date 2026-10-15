import { test, expect } from './fixtures';
import { fakeDaemon, session } from './daemon';

const at = (min: number) => new Date(Date.now() - (30 - min) * 60_000).toISOString();
const push = (cmd: string) => ({ kind: 'permission' as const, text: cmd, tool: 'Bash', source: 'hook' as const });

test('a decision from the thread', async ({ page }) => {
  const otto = session('otto', { name: 'Otto', state: 'waiting_permission', pending: push('git push origin main') });
  const d = await fakeDaemon(page, [otto]);
  await page.goto('/');
  const pane = page.locator('#conversation-pane');
  await expect(pane).toHaveAttribute('data-conversation', 'local:otto');
  await expect.poll(() => d.received.some(m => m.type === 'session.thread' && m.id === 'otto')).toBe(true);
  d.push({ type: 'session.thread', id: 'otto', items: [
    { kind: 'prompt', id: 'p1', at: at(0), turn: 1, text: 'Ship the release' },
    { kind: 'tool', id: 't1', at: at(1), turn: 1, tool: 'Bash', label: 'git status', status: 'success', files: [] },
    { kind: 'message', id: 'm1', at: at(2), turn: 1, text: 'Ready to push.' }
  ] });
  await expect(pane.locator('.thread-message.user')).toHaveText(/Ship the release/);
  await expect(pane.locator('.thread-actions summary')).toHaveText('1 action · Show details');
  d.push({ type: 'session.thread.item', id: 'otto', item: { kind: 'message', id: 'm2', at: at(3), turn: 1, text: 'Waiting for your approval.' } });
  await expect(pane.locator('.thread-message.agent')).toHaveCount(2);

  const request = pane.locator('.thread-request');
  await expect(request).toContainText('git push origin main');
  await request.getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => d.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept' }]);
  await expect(request.getByRole('status')).toHaveText('Sent…');
  await expect(request.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  d.upsert({ ...otto, state: 'working', pending: undefined });
  await expect(request).toHaveCount(0);

  d.upsert({ ...otto, pending: push('npm publish') });
  await request.getByRole('button', { name: 'Allow' }).click();
  await expect(request.getByRole('status')).toHaveText('Sent…');
  d.push({ type: 'error', id: 'otto', message: 'Request expired' });
  await expect(request.getByRole('status')).toHaveText('Not sent: Request expired');
  await expect(request.getByRole('button', { name: 'Allow' })).toBeEnabled();
});

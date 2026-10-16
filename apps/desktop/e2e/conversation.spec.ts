import { test, expect } from './fixtures';
import { eight, fakeDaemon, fakeRemote, session } from './daemon';

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

test('a reply from the composer', async ({ page }) => {
  const bix = session('bix', { name: 'Bix', state: 'idle' });
  const d = await fakeDaemon(page, [bix]);
  await page.goto('/');
  const box = page.getByRole('textbox', { name: 'Reply to Bix' });
  const hint = page.locator('#reply-hint');
  await box.fill('First line');
  await box.press('Enter');
  await box.pressSequentially('Second line');
  await expect(box).toHaveValue('First line\nSecond line');
  expect(d.received.filter(m => m.type === 'session.reply')).toEqual([]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('desktop.drafts') ?? '')).toContain('Second line');
  await page.reload();
  await expect(box).toHaveValue('First line\nSecond line');
  await box.press('Control+Enter');
  await expect.poll(() => d.received.filter(m => m.type === 'session.reply')).toEqual([{ type: 'session.reply', id: 'bix', text: 'First line\nSecond line' }]);
  await expect(box).toHaveValue('');
  await expect(hint).toHaveText('Sent…');
  d.upsert({ ...bix, state: 'working', lastActivityAt: new Date().toISOString() });
  await expect(hint).toHaveText('Ctrl / ⌘ + Enter to send · Enter for a new line');
});

test('a disconnected machine leaves its conversation read-only until it comes back', async ({ page }) => {
  await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'working' })], { machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova', state: 'waiting_permission', pending: push('rm -rf build') })]);
  await page.goto('/');
  await page.locator('[data-session="devbox:nova"]').click();
  const pane = page.locator('#conversation-pane');
  await expect(pane).toHaveAttribute('data-conversation', 'devbox:nova');
  const box = pane.getByRole('textbox', { name: 'Reply to Nova' });
  await box.fill('Half written');
  await expect(pane.getByRole('button', { name: 'Allow' })).toBeEnabled();

  remote.close();
  const banner = pane.locator('.conversation-offline');
  await expect(banner).toHaveText('Machine disconnected · history frozen. Your draft is kept until it reconnects.');
  await expect(banner).toHaveAttribute('role', 'status');
  await expect(box).toBeDisabled();
  await expect(box).toHaveValue('Half written');
  await expect(pane.locator('.thread-request')).toContainText('rm -rf build');
  await expect(pane.getByRole('button', { name: 'Allow' })).toBeDisabled();
  await expect(pane.getByRole('button', { name: 'Open terminal' })).toBeDisabled();

  remote.reopen([session('nova', { name: 'Nova', state: 'working' })]);
  await expect(banner).toHaveCount(0);
  await expect(box).toBeEnabled();
  await expect(box).toHaveValue('Half written');
  await expect(pane.locator('.thread-request')).toHaveCount(0);
});

test('a finished session dismissed: its draft goes and the first visible session takes the panel', async ({ page }) => {
  const d = await fakeDaemon(page, eight.map(s => (s.id === 'bix' ? { ...s, state: 'exited' as const } : s)));
  await page.goto('/');
  await page.locator('[data-session="local:bix"]').click();
  const pane = page.locator('#conversation-pane');
  await expect(pane).toHaveAttribute('data-conversation', 'local:bix');
  await pane.getByRole('textbox', { name: 'Reply to Bix' }).fill('Never sent');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('desktop.drafts') ?? '')).toContain('local:bix');
  await pane.getByRole('button', { name: 'Dismiss' }).click();
  await expect.poll(() => d.received.filter(m => m.type === 'session.dismiss')).toEqual([{ type: 'session.dismiss', id: 'bix' }]);
  d.remove('bix');
  await expect(page.locator('[data-session="local:bix"]')).toHaveCount(0);
  const first = await page.locator('.view-body > .central [data-session]').first().getAttribute('data-session');
  await expect(pane).toHaveAttribute('data-conversation', first!);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('desktop.drafts') ?? '')).not.toContain('local:bix');
});

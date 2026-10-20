import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, listSessions } from './helpers';

afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const thread = () => within(screen.getByRole('tabpanel', { name: 'Session thread' }));
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const nova = () => listSessions().find(s => s.id === 'nova')!;

/** Nova works (listSessions); its thread: a prompt two seconds ago, nothing since. */
async function openNova(items: ThreadItem[] = [{ kind: 'prompt', id: 'p1', at: ago(2), turn: 1, text: 'Paie en euros' }]) {
  const env = await boot({ sessions: listSessions(), list: true });
  env.d.thread('nova', items);
  await env.user.click(screen.getByRole('button', { name: /^Nova,/ }));
  await thread().findByText('Paie en euros');
  return env;
}

describe('the waiting line', () => {
  it('says what the agent last did while it works with no action running', async () => {
    const { d } = await openNova();
    expect(await thread().findByRole('status', { name: 'The agent is working' })).toHaveTextContent('Reading your message…');

    // An action starts: its own live line takes over.
    const t1: ThreadItem = { kind: 'tool', id: 't1', at: ago(1), turn: 1, tool: 'Bash', label: 'npm test', status: 'running', files: [] };
    d.threadItem('nova', t1);
    await thread().findByRole('status', { name: 'Action running' });
    expect(thread().queryByRole('status', { name: 'The agent is working' })).toBeNull();

    // It ends: the line comes back on its result.
    d.threadItem('nova', { ...t1, status: 'success', durationMs: 500 });
    const line = await thread().findByRole('status', { name: 'The agent is working' });
    expect(line).toHaveTextContent('Looking at the output of npm test…');
    expect(within(line).getByText('npm test').tagName).toBe('CODE');
  });

  it('goes once the agent stops working', async () => {
    const { d } = await openNova();
    await thread().findByRole('status', { name: 'The agent is working' });
    d.upsert({ ...nova(), state: 'idle' });
    await expect.poll(() => thread().queryByRole('status', { name: 'The agent is working' })).toBeNull();
  });

  it('after a long wait, says it takes its time and counts it', async () => {
    await openNova([{ kind: 'prompt', id: 'p1', at: ago(75), turn: 1, text: 'Paie en euros' }]);
    const line = await thread().findByRole('status', { name: 'The agent is working' });
    expect(line).toHaveTextContent(/Taking its time, thinking hard….*1 min 1\d s/);
  });

  it('is not there for a session that does not work', async () => {
    const env = await boot({ sessions: listSessions().map(s => (s.id === 'nova' ? { ...s, state: 'idle' as const } : s)), list: true });
    env.d.thread('nova', [{ kind: 'prompt', id: 'p1', at: ago(2), turn: 1, text: 'Paie en euros' }]);
    await env.user.click(screen.getByRole('button', { name: /^Nova,/ }));
    await thread().findByText('Paie en euros');
    expect(thread().queryByRole('status', { name: 'The agent is working' })).toBeNull();
  });
});

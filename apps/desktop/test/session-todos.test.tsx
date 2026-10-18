import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ThreadItem, ToolItem } from '@ledge/protocol';
import { T0 } from '@ledge/fleet/test/mockDaemon';
import { saveReduced } from '../src/motionPreferences';
import { boot, closeDaemons, listSessions, ottoThread } from './helpers';

afterEach(async () => { cleanup(); saveReduced(false); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await closeDaemons(); });

const todo = (id: string, todos: unknown, tool = 'TodoWrite'): ToolItem => ({ kind: 'tool', id, at: T0, turn: 1, tool, label: tool, input: JSON.stringify(todos, null, 2), status: 'success', files: [] });
const v1 = todo('d1', { todos: [{ content: 'Lire', status: 'completed', activeForm: 'Lecture' }, { content: 'Écrire', status: 'in_progress', activeForm: 'Écriture des tests' }, { content: 'Publier', status: 'pending', activeForm: 'Publication' }] });

it('the work plan sits on top of the thread and unfolds as a checklist; Escape folds it back first', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  d.thread('otto', [...ottoThread(), { ...v1, at: new Date().toISOString(), turn: 2 }]);
  await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  const head = await screen.findByRole('button', { name: /^Work plan/ });
  expect(head).toHaveTextContent('1/3');
  expect(head).toHaveTextContent('Écriture des tests');
  await user.click(head);
  expect([...document.querySelectorAll('.todo-list li')].map(li => [li.className, li.textContent])).toEqual([['completed', '✓Lire'], ['in_progress', expect.stringContaining('Écriture des tests')], ['pending', 'Publier']]);
  await user.keyboard('{Escape}');
  expect(head).toHaveAttribute('aria-expanded', 'false');
  expect(document.querySelector('.session-page')).not.toBeNull();
});
it('no list, no bar', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  d.thread('otto', ottoThread());
  await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('Câble la liste');
  expect(document.querySelector('.todo-bar')).toBeNull();
});

const v2 = todo('d2', { todos: [{ content: 'Lire', status: 'completed' }, { content: 'Écrire', status: 'completed' }] });
async function openOtto(extra: ThreadItem[]) {
  const env = await boot({ sessions: listSessions(), list: true });
  env.d.thread('otto', [...ottoThread(), ...extra]);
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('Câble la liste');
  return env;
}

it('Escape folds the work plan before it closes the pane tab, and only then leaves the page', async () => {
  const { user } = await openOtto([{ ...v1, at: new Date().toISOString(), turn: 2 }]);
  await user.click(screen.getByRole('button', { name: /^3 actions/ }));
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="t3"]')!).getByRole('button', { name: 'View the change' }));
  const head = screen.getByRole('button', { name: /^Work plan/ });
  await user.click(head);
  expect(head).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard('{Escape}');
  expect(head).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('complementary', { name: 'Reading pane' })).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('complementary', { name: 'Reading pane' })).toBeNull();
  expect(document.querySelector('.session-page')).not.toBeNull();
  await user.keyboard('{Escape}');
  expect(document.querySelector('.session-page')).toBeNull();
});
it('an update is no action: the summary says the plan was updated, unfolded it is a row of its own; alone, it is the summary', async () => {
  const now = new Date().toISOString();
  const { user } = await openOtto([{ ...v1, at: now, turn: 2 }, { ...v2, at: now, turn: 2 }, { kind: 'message', id: 'msg-2', at: now, turn: 2, text: 'Je continue.' }, { ...v2, id: 'd3', at: now, turn: 2 }]);
  // t5 still runs: its fold has a summary only because the updates are there to sum up.
  const fold = screen.getByRole('button', { name: /^1 action.*· work plan updated ×2/ });
  expect(fold).toHaveTextContent('running · ');
  await user.click(fold);
  expect([...fold.parentElement!.querySelectorAll('.todo-row')].map(r => r.textContent)).toEqual(['☰Work plan1/3 done · in progress: Écriture des tests', '☰Work plan2/2 done']);
  const alone = screen.getByRole('button', { name: 'Work plan updated' });
  expect(alone.querySelector('.mono')).toBeNull();                               // untimed
  await user.click(alone);
  expect(alone.parentElement!.querySelectorAll('.todo-row')).toHaveLength(1);
  expect(alone.parentElement!.querySelectorAll('[data-tool]')).toHaveLength(0);
  // The bar reads the latest list.
  const head = document.querySelector('.todo-head');
  expect(head).toHaveTextContent('2/2');
  expect(head).toHaveTextContent('All done');
});
it("a subagent's page shows its own list, not its parent's", async () => {
  const { user } = await openOtto([{ ...v1, at: new Date().toISOString(), turn: 2 }, { ...v2, at: new Date().toISOString(), helperId: 'h1' }]);
  expect(document.querySelector('.todo-head')).toHaveTextContent('1/3');
  await user.click(screen.getByRole('button', { name: 'Open Explore: Lire le code' }));
  await screen.findByText('Je lis.');
  const head = document.querySelector('.todo-head');
  expect(head).toHaveTextContent('2/2');
  expect(head).toHaveTextContent('All done');
  expect(head).toHaveAttribute('aria-expanded', 'false');
});

it("each box says what it is; an emptied list hides the bar, and a list that comes back is folded", async () => {
  const { d, user } = await openOtto([{ ...v1, at: new Date().toISOString(), turn: 2 }]);
  await user.click(document.querySelector<HTMLElement>('.todo-head')!);
  expect(within(document.querySelector<HTMLElement>('.todo-list')!).getAllByRole('img').map(e => e.getAttribute('aria-label'))).toEqual(['Done', 'In progress', 'To do']);
  d.threadItem('otto', { ...todo('e1', { todos: [] }), at: new Date().toISOString(), turn: 2 });
  await waitFor(() => expect(document.querySelector('.todo-bar')).toBeNull());
  d.threadItem('otto', { ...v1, id: 'd9', at: new Date().toISOString(), turn: 2 });
  await waitFor(() => expect(document.querySelector('.todo-head')).not.toBeNull());
  expect(document.querySelector('.todo-head')).toHaveAttribute('aria-expanded', 'false');
});
it('two tasks with the same text are both listed', async () => {
  const error = vi.spyOn(console, 'error');
  const { user } = await openOtto([{ ...todo('d4', { todos: [{ content: 'Relire', status: 'completed' }, { content: 'Relire', status: 'pending' }] }), at: new Date().toISOString(), turn: 2 }]);
  await user.click(document.querySelector<HTMLElement>('.todo-head')!);
  expect([...document.querySelectorAll('.todo-list li')].map(li => li.className)).toEqual(['completed', 'pending']);
  expect(error.mock.calls.filter(c => String(c[0]).includes('same key'))).toEqual([]);
});
it('the dot of the task in progress pulses only live, and stands still under reduced motion', async () => {
  vi.stubEnv('VITE_LEDGE_MOTION', '1'); // the suite runs with motion off
  await openOtto([{ ...v1, at: new Date().toISOString(), turn: 2 }]);
  const dot = document.querySelector('.todo-dot')!;
  expect(dot).not.toHaveClass('still');
  act(() => saveReduced(true));
  expect(document.querySelector('.todo-dot')).toHaveClass('still');
});
it('offline, the dot stands still', async () => {
  vi.stubEnv('VITE_LEDGE_MOTION', '1');
  const { d } = await openOtto([{ ...v1, at: new Date().toISOString(), turn: 2 }]);
  expect(document.querySelector('.todo-dot')).not.toHaveClass('still');
  d.upsert({ ...listSessions().find(x => x.id === 'otto')!, offline: true });
  await waitFor(() => expect(document.querySelector('.todo-dot')).toHaveClass('still'));
});

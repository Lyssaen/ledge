import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ChatTurn, ClientMessage } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';

// A task card in the IDE's right panel chat (ported from the old home view's, lot 12b): « Give » gives the task, the card follows it.
const T0 = new Date().toISOString();
const chat = () => within(screen.getByRole('complementary', { name: 'Chat Ledge' }));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

it('a task card gives its task and follows it', async () => {
  const { d, user } = await boot({ projects: PROJECTS, machines: [{ id: 'local', label: 'Local' }] });
  const field = await chat().findByRole('textbox', { name: 'Ask Ledge' });
  await waitFor(() => expect(field).toBeEnabled());
  await user.type(field, 'Confie les rôles à Otto{Enter}');
  await waitFor(() => expect(d.received.some(m => m.type === 'chat.ask')).toBe(true));
  const { qid } = d.received.find((m): m is Extract<ClientMessage, { type: 'chat.ask' }> => m.type === 'chat.ask')!;
  const proposed: ChatTurn = { qid, question: 'Confie les rôles à Otto', askedAt: T0, steps: [], answer: 'Une tâche.', answeredAt: T0,
    tasks: [{ to: 'otto', title: 'Implémenter les rôles' }] };
  d.push({ type: 'chat.history', turns: [proposed] });
  const tasks = await chat().findByRole('region', { name: 'Task to give' });
  await user.click(within(tasks).getByRole('button', { name: 'Give' }));
  await waitFor(() => expect(d.received).toContainEqual({ type: 'task.cmd', rid: expect.any(String), by: 'ledge', op: 'give', qid, row: 0 }));
  expect(within(tasks).getByRole('button', { name: 'Sending…' })).toBeDisabled();
  const rid = (d.received.find(m => m.type === 'task.cmd' && m.op === 'give') as { rid: string }).rid;
  d.push({ type: 'task.result', rid });
  d.push({ type: 'chat.history', turns: [{ ...proposed, tasks: [{ ...proposed.tasks![0]!, taskId: 't91b0d4', ownerName: 'Otto', state: 'taken', givenAt: T0 }] }] });
  expect(await within(tasks).findByText(/Given to Otto · t91b0d4 · taken/)).toBeVisible();
});

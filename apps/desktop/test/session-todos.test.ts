import { expect, it } from 'vitest';
import type { ToolItem } from '@ledge/protocol';
import { T0 } from '@ledge/fleet/test/mockDaemon';
import { exchanges, summarize } from '../src/session/thread';
import { latestTodos, todosOf } from '../src/session/todos';

const todo = (id: string, todos: unknown, tool = 'TodoWrite'): ToolItem => ({ kind: 'tool', id, at: T0, turn: 1, tool, label: tool, input: JSON.stringify(todos, null, 2), status: 'success', files: [] });
const v1 = todo('d1', { todos: [{ content: 'Lire', status: 'completed', activeForm: 'Lecture' }, { content: 'Écrire', status: 'in_progress', activeForm: 'Écriture des tests' }, { content: 'Publier', status: 'pending', activeForm: 'Publication' }] });

it('a Claude TodoWrite and a Codex update_plan read as the same list; anything else is no list', () => {
  expect(todosOf(v1)).toEqual([{ text: 'Lire', status: 'completed' }, { text: 'Écriture des tests', status: 'in_progress' }, { text: 'Publier', status: 'pending' }]);
  expect(todosOf(todo('u1', { plan: [{ step: 'Monter', status: 'completed' }, { step: 'Construire', status: 'weird' }] }, 'update_plan'))).toEqual([{ text: 'Monter', status: 'completed' }, { text: 'Construire', status: 'pending' }]);
  expect([todosOf({ ...v1, input: '{oops' }), todosOf(todo('e', { todos: [] })), todosOf({ ...v1, tool: 'Bash' })]).toEqual([null, null, null]);
});
it('the latest list wins; a subagent keeps its own; none without updates', () => {
  const v2 = todo('d2', { todos: [{ content: 'Lire', status: 'completed' }, { content: 'Écrire', status: 'completed' }] });
  expect(latestTodos([v1, v2])).toEqual([{ text: 'Lire', status: 'completed' }, { text: 'Écrire', status: 'completed' }]);
  expect(latestTodos([v1, { ...v2, helperId: 'h1' }])).toEqual(todosOf(v1));
  expect(latestTodos([v1, { ...v2, helperId: 'h1' }], 'h1')).toEqual(todosOf(v2));
  expect(latestTodos([])).toBeNull();
});
it('the latest update wins even when it empties the list; an unreadable one leaves the list before it', () => {
  expect(latestTodos([v1, todo('e', { todos: [] })])).toBeNull();
  expect(latestTodos([v1, todo('b', { todos: [{ content: ' ', status: 'pending' }] })])).toBeNull();
  expect(latestTodos([v1, { ...v1, id: 'x', input: '{oops' }])).toEqual(todosOf(v1));
  // Another agent's update does not stop the search.
  expect(latestTodos([v1, { ...todo('e', { todos: [] }), helperId: 'h1' }])).toEqual(todosOf(v1));
});
it('list updates are not actions: they fold into the summary', () => {
  const read: ToolItem = { kind: 'tool', id: 'r', at: T0, turn: 1, tool: 'Read', label: 'a', status: 'success', durationMs: 100, files: [] };
  const [x] = exchanges([v1, read, { ...v1, id: 'd2' }]);
  expect(x!.segments).toEqual([{ kind: 'tools', key: 'tools-d1', tools: [read], todos: [v1, { ...v1, id: 'd2' }] }]);
  expect(summarize([read], 0, true).count).toBe(1);
});

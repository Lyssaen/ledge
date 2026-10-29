import { describe, it, expect } from 'vitest';
import { doneCount, latestTodos, todosOf } from '../src/todos.js';
import type { ToolItem } from '../src/thread.js';

const tool = (id: string, name: string, input: unknown, extra: Partial<ToolItem> = {}): ToolItem => ({
  kind: 'tool', id, at: '2026-01-01T00:00:00.000Z', turn: 1, tool: name, label: name,
  input: typeof input === 'string' ? input : JSON.stringify(input), status: 'success', files: [], ...extra
});
const v1 = tool('d1', 'TodoWrite', { todos: [{ content: 'Read', status: 'completed', activeForm: 'Reading' }, { content: 'Write', status: 'in_progress', activeForm: 'Writing tests' }] });

describe('the shared todo parser', () => {
  it('reads a TodoWrite (in progress shows activeForm) and an update_plan', () => {
    expect(todosOf(v1)).toEqual([{ text: 'Read', status: 'completed' }, { text: 'Writing tests', status: 'in_progress' }]);
    expect(todosOf(tool('u', 'update_plan', { plan: [{ step: 'Mount', status: 'completed' }] }))).toEqual([{ text: 'Mount', status: 'completed' }]);
  });
  it('reads an OMP todo with two phases and a blocked task', () => {
    const phases = [{ name: 'Build', tasks: [{ content: 'a', status: 'completed' }] }, { name: 'Ship', tasks: [{ content: 'b', status: 'blocked', blocker: 'CI' }] }];
    expect(todosOf(tool('o', 'todo', { phases }))).toEqual([{ text: 'Build · a', status: 'completed' }, { text: 'Ship · b (blocked: CI)', status: 'pending' }]);
  });
  it('skips a subagent\'s update unless asked for it', () => {
    const h = { ...tool('d2', 'TodoWrite', { todos: [{ content: 'Other', status: 'pending' }] }), helperId: 'h1' };
    expect(latestTodos([v1, h])).toEqual(todosOf(v1));
    expect(latestTodos([v1, h], 'h1')).toEqual([{ text: 'Other', status: 'pending' }]);
  });
  it('an empty later update gives null; an unreadable one keeps the earlier list', () => {
    expect(latestTodos([v1, tool('e', 'TodoWrite', { todos: [] })])).toBeNull();
    expect(latestTodos([v1, tool('b', 'TodoWrite', '{')])).toEqual(todosOf(v1));
  });
  it('counts the completed ones', () => {
    expect(doneCount(todosOf(v1)!)).toBe(1);
  });
});

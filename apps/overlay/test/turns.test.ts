import { describe, it, expect } from 'vitest';
import type { ThreadItem } from '@ledge/protocol';
import { turns, helperThread, helperRows } from '../src/thread/turns';
import { fakeSession } from './mockDaemon';

const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, s)).toISOString();
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Lance les tests' },
  { kind: 'tool', id: 'toolu_1', at: at(2), turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'success', files: [] },
  { kind: 'message', id: 'msg-u1', at: at(1), turn: 1, text: 'Je lance les tests.' }, // synced after the row, said before it
  { kind: 'reply', id: 'reply-1', at: at(3), turn: 1, text: 'Tout passe.' },
  { kind: 'prompt', id: 'prompt-2', at: at(10), turn: 2, text: 'Revois le reducer' },
  { kind: 'helper', id: 'h1', at: at(11), turn: 2, task: 'find consumers', agentType: 'Explore', state: 'exited' },
  { kind: 'tool', id: 'toolu_5', at: at(12), turn: 2, helperId: 'h1', tool: 'Grep', label: 'Grep · reduce(', status: 'success', files: [] },
  { kind: 'message', id: 'msg-a1', at: at(11.5), turn: 2, helperId: 'h1', text: 'Je cherche.' },
  { kind: 'reply', id: 'report-h1', at: at(13), turn: 2, helperId: 'h1', text: '3 consumers.' },
  { kind: 'helper', id: 'h2', at: at(14), turn: 2, task: 'review task 1', agentType: 'general-purpose', state: 'working' }
];

describe('turns', () => {
  it('groups the main thread by turn, sorted by time, keeping helper items out', () => {
    const ts = turns(items);
    expect(ts.map(t => t.n)).toEqual([1, 2]);
    expect(ts[0]!.prompt?.text).toBe('Lance les tests');
    expect(ts[0]!.reply?.text).toBe('Tout passe.');
    expect(ts[0]!.items.map(i => i.id)).toEqual(['prompt-1', 'msg-u1', 'toolu_1', 'reply-1']);
    expect(ts[1]!.items.map(i => i.id)).toEqual(['prompt-2', 'h1', 'h2']);
    expect(turns([])).toEqual([]);
  });
  it('isolates a helper thread with its report', () => {
    const h = helperThread(items, 'h1');
    expect(h.helper?.task).toBe('find consumers');
    expect(h.items.map(i => i.id)).toEqual(['msg-a1', 'toolu_5']);
    expect(h.report?.text).toBe('3 consumers.');
    expect(helperThread(items, 'zz')).toEqual({ items: [] });
  });
  it('lists the current turn helpers, finished ones included, with the live state when the session knows it', () => {
    const s = fakeSession('a', { helpers: [{ id: 'h2', kind: 'general-purpose', task: 'review task 1', state: 'waiting_permission' }] });
    expect(helperRows(s, items)).toEqual([
      { id: 'h1', kind: 'Explore', task: 'find consumers', state: 'exited' },
      { id: 'h2', kind: 'general-purpose', task: 'review task 1', state: 'waiting_permission' }
    ]);
    // Without a thread: today's live helpers (exited and idle left out).
    const live = fakeSession('b', { helpers: [{ id: 'x', kind: 'Explore', task: 'a', state: 'exited' }, { id: 'y', kind: 'Explore', task: 'b', state: 'working' }] });
    expect(helperRows(live).map(r => r.id)).toEqual(['y']);
  });
});

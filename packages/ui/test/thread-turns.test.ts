import { describe, it, expect } from 'vitest';
import type { ThreadItem } from '@ledge/protocol';
import { turns, helperThread, helperRows } from '../src/thread/turns';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';

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
  it('does not repeat the final message under the reply, and keeps the messages that differ', () => {
    const turn: ThreadItem[] = [
      { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Fais le plan' },
      { kind: 'message', id: 'msg-u1', at: at(1), turn: 1, text: 'Je regarde.' },
      { kind: 'message', id: 'msg-u2', at: at(3), turn: 1, text: 'Le plan est prêt.\n' },
      { kind: 'reply', id: 'reply-1', at: at(3), turn: 1, text: '  Le plan est prêt.' }
    ];
    expect(turns(turn)[0]!.items.map(i => i.id)).toEqual(['prompt-1', 'msg-u1', 'reply-1']);
    // A final message that is not the reply stays.
    const other = turn.map(i => (i.id === 'msg-u2' ? { ...i, text: 'Encore un détail.' } : i));
    expect(turns(other)[0]!.items.map(i => i.id)).toEqual(['prompt-1', 'msg-u1', 'msg-u2', 'reply-1']);
    // Only the last message is the echo: an earlier one with the same text stays.
    const early = turn.map(i => (i.id === 'msg-u1' ? { ...i, text: 'Le plan est prêt.' } : i));
    expect(turns(early)[0]!.items.map(i => i.id)).toEqual(['prompt-1', 'msg-u1', 'reply-1']);
  });

  it('does not repeat a helper final message under its report', () => {
    const h: ThreadItem[] = [
      { kind: 'helper', id: 'h1', at: at(0), turn: 1, task: 'find consumers', state: 'exited' },
      { kind: 'message', id: 'msg-a1', at: at(1), turn: 1, helperId: 'h1', text: 'Je cherche.' },
      { kind: 'message', id: 'msg-a2', at: at(2), turn: 1, helperId: 'h1', text: '3 consumers.' },
      { kind: 'reply', id: 'report-h1', at: at(2), turn: 1, helperId: 'h1', text: '3 consumers.' }
    ];
    const v = helperThread(h, 'h1');
    expect(v.items.map(i => i.id)).toEqual(['msg-a1']);
    expect(v.report?.text).toBe('3 consumers.');
    expect(helperThread(h.filter(i => i.id !== 'report-h1'), 'h1').items.map(i => i.id)).toEqual(['msg-a1', 'msg-a2']); // no report yet: the message stays
  });

  it('lists the current turn helpers still at work, with the live state when the session knows it', () => {
    const s = fakeSession('a', { helpers: [{ id: 'h2', kind: 'general-purpose', task: 'review task 1', state: 'waiting_permission' }] });
    expect(helperRows(s, items)).toEqual([
      { id: 'h2', kind: 'general-purpose', task: 'review task 1', state: 'waiting_permission' }
    ]);
    // Without a thread: today's live helpers (exited and idle left out).
    const live = fakeSession('b', { helpers: [{ id: 'x', kind: 'Explore', task: 'a', state: 'exited' }, { id: 'y', kind: 'Explore', task: 'b', state: 'working' }] });
    expect(helperRows(live).map(r => r.id)).toEqual(['y']);
  });
  it('drops a helper from the list as soon as it ends, keeping the others in their order, one row each', () => {
    const turn: ThreadItem[] = [
      { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Audit' },
      { kind: 'helper', id: 'a', at: at(1), turn: 1, task: 'scan a', agentType: 'Explore', state: 'working' },
      { kind: 'helper', id: 'b', at: at(2), turn: 1, task: 'scan b', agentType: 'Explore', state: 'working' },
      { kind: 'helper', id: 'c', at: at(3), turn: 1, task: 'scan c', agentType: 'Explore', state: 'working' },
      { kind: 'helper', id: 'd', at: at(4), turn: 1, task: 'scan d', agentType: 'Explore', state: 'working' },
      { kind: 'tool', id: 't1', at: at(5), turn: 1, helperId: 'a', tool: 'Grep', label: 'Grep', status: 'running', files: [] },
      { kind: 'tool', id: 't2', at: at(6), turn: 1, helperId: 'b', tool: 'Grep', label: 'Grep', status: 'success', files: [] }
    ];
    const helpers = (state: Record<string, 'working' | 'exited' | 'error' | 'idle'>) =>
      Object.entries(state).map(([id, st]) => ({ id, kind: 'Explore', task: `scan ${id}`, state: st }));
    const s = fakeSession('a', { state: 'working', helpers: helpers({ a: 'working', b: 'working', c: 'working', d: 'working' }) });
    expect(helperRows(s, turn).map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
    // b ends (its row in the thread says so), c fails, d is interrupted: only a stays.
    const ended = turn.map(i => (i.id === 'b' ? { ...i, state: 'exited' as const } : i));
    const after = fakeSession('a', { state: 'working', helpers: helpers({ a: 'working', b: 'working', c: 'error', d: 'idle' }) });
    expect(helperRows(after, ended).map(r => r.id)).toEqual(['a']);
    // A session that is over has no helper at work, whatever the last word of each was.
    expect(helperRows(fakeSession('a', { state: 'exited', helpers: helpers({ a: 'working' }) }), turn)).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Session } from '@ledge/protocol';
import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { useConversations } from '../src/conversation/useConversations';
import { useThreadRequest } from '../src/conversation/useThreadRequest';

const machine = (id: string, ready: boolean, status: MachineState['status'] = ready ? 'open' : 'connecting') =>
  ({ id, label: id, status, ready, recents: [], sessions: [], launcher: null }) as MachineState;
const local = [machine('local', true)];
const otto = fakeSession('local:otto', { state: 'waiting_permission', pending: { kind: 'permission', text: 'Run git push?', tool: 'Bash', source: 'hook' } });
const bix = fakeSession('local:bix', { state: 'idle' });
let send: ReturnType<typeof vi.fn>;
let client: DaemonClient;

beforeEach(() => {
  localStorage.clear(); daemonStore.reset();
  send = vi.fn(); client = { send } as unknown as DaemonClient;
});
const mount = (sessions: Session[], machines = local, ready = true) =>
  renderHook(p => useConversations(client, p.sessions, p.machines, p.ready), { initialProps: { sessions, machines, ready } });

describe('useConversations: decisions', () => {
  it('a double click sends one decision; an error reopens it and a retry goes out (Review Focus 4)', () => {
    const { result } = mount([otto]);
    act(() => { result.current.decide(otto, 'accept'); result.current.decide(otto, 'accept'); result.current.answer(otto, 0); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'accept' });
    expect(result.current.sends.sent['local:otto']?.kind).toBe('decision');
    act(() => daemonStore.apply({ type: 'error', id: 'local:nova', message: 'Unknown session' }));
    expect(result.current.sends.failed['local:otto']).toBeUndefined();
    act(() => daemonStore.apply({ type: 'error', id: 'local:otto', message: 'Request expired' }));
    expect(result.current.sends.failed['local:otto']?.message).toBe('Request expired');
    act(() => result.current.decide(otto, 'accept'));
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('stays « sent » while the same request waits, clears when it changes', () => {
    const r = mount([otto]);
    act(() => r.result.current.decide(otto, 'deny'));
    r.rerender({ sessions: [{ ...otto, lastActivityAt: '2026-10-09T18:03:00.000Z' }], machines: local, ready: true });
    expect(r.result.current.sends.sent['local:otto']).toBeDefined();
    r.rerender({ sessions: [{ ...otto, state: 'working', pending: undefined }], machines: local, ready: true });
    expect(r.result.current.sends.sent['local:otto']).toBeUndefined();
  });
  it('an option goes out as its 1-based number', () => {
    const q = fakeSession('local:luna', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', options: ['A', 'B'], source: 'pane' } });
    const { result } = mount([q]);
    act(() => result.current.answer(q, 1));
    expect(send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:luna', text: '2' });
  });
});

describe('useConversations: replies and commands', () => {
  it('a reply is sent as text, never as a command; the draft is cleared, and restored after an error', () => {
    const { result } = mount([bix]);
    act(() => result.current.setDraft('local:bix', '  /kill everything  '));
    let ok = false;
    act(() => { ok = result.current.reply(bix, result.current.draft('local:bix')); });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:bix', text: '/kill everything' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.draft('local:bix')).toBe('');
    act(() => daemonStore.apply({ type: 'error', id: 'local:bix', message: 'tmux is gone' }));
    expect(result.current.draft('local:bix')).toBe('/kill everything');
    expect(result.current.sends.failed['local:bix']?.message).toBe('tmux is gone');
    act(() => result.current.setDraft('local:bix', '/kill everything!'));
    expect(result.current.sends.failed['local:bix']).toBeUndefined();
  });
  it('a reply is refused while a permission waits, or when empty', () => {
    const { result } = mount([otto, bix]);
    act(() => { result.current.reply(otto, 'oui'); result.current.reply(bix, '   '); });
    expect(send).not.toHaveBeenCalled();
  });
  it('commands and rename go out once; rename trims to 500 characters', () => {
    const { result } = mount([bix]);
    act(() => { result.current.command(bix, 'kill'); result.current.command(bix, 'kill'); });
    act(() => result.current.rename(bix, `  ${'x'.repeat(600)}  `));
    expect(send.mock.calls.map(c => c[0])).toEqual([
      { type: 'session.kill', id: 'local:bix' },
      { type: 'session.rename', id: 'local:bix', topic: 'x'.repeat(500) }
    ]);
  });
  it('a failed kill stays failed until forget() clears it', () => {
    const { result } = mount([bix]);
    act(() => result.current.command(bix, 'kill'));
    act(() => daemonStore.apply({ type: 'error', id: 'local:bix', message: 'tmux is gone' }));
    expect(result.current.sends.failed['local:bix']?.kind).toBe('kill');
    act(() => result.current.forget('local:bix'));
    expect(result.current.sends.failed['local:bix']).toBeUndefined();
  });
  it('a frozen session sends nothing at all (spec §14)', () => {
    const frozen = { ...otto, offline: true };
    const { result } = mount([frozen]);
    act(() => {
      result.current.decide(frozen, 'accept'); result.current.answer(frozen, 0); result.current.reply(frozen, 'hello');
      result.current.command(frozen, 'interrupt'); result.current.rename(frozen, 'New');
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('useConversations: drafts and thread preferences', () => {
  it('one draft per qualified id, persisted', () => {
    const { result } = mount([bix]);
    act(() => { result.current.setDraft('local:otto', 'Ici'); result.current.setDraft('devbox:otto', 'Là-bas'); });
    expect(result.current.draft('local:otto')).toBe('Ici');
    expect(result.current.draft('devbox:otto')).toBe('Là-bas');
    expect(JSON.parse(localStorage.getItem('desktop.drafts')!)).toEqual({ 'local:otto': 'Ici', 'devbox:otto': 'Là-bas' });
  });
  it('prunes drafts and preferences of removed sessions only once ready, and keeps unreachable machines and ledge (Review Focus 3)', () => {
    localStorage.setItem('desktop.drafts', JSON.stringify({ 'local:bix': 'a', 'local:gone': 'b', 'devbox:nova': 'c', ledge: 'd' }));
    localStorage.setItem('desktop.thread', JSON.stringify({ 'local:gone': { open: ['metadata'], scroll: 3 }, 'devbox:nova': { open: [], scroll: 9 } }));
    const machines = [machine('local', true), machine('devbox', false, 'unreachable')];
    const r = mount([bix], machines, false);
    expect(r.result.current.draft('local:gone')).toBe('b');
    r.rerender({ sessions: [bix], machines, ready: true });
    expect(JSON.parse(localStorage.getItem('desktop.drafts')!)).toEqual({ 'local:bix': 'a', 'devbox:nova': 'c', ledge: 'd' });
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)).toEqual({ 'devbox:nova': { open: [], scroll: 9 } });
  });
  it('never prunes before the first snapshot: empty sessions on a connected machine keep every draft and preference', () => {
    const drafts = { 'local:bix': 'a', 'devbox:nova': 'c', ledge: 'd' };
    const threads = { 'local:bix': { open: ['metadata'], scroll: 3 } };
    localStorage.setItem('desktop.drafts', JSON.stringify(drafts));
    localStorage.setItem('desktop.thread', JSON.stringify(threads));
    const before = [machine('local', true, 'open'), machine('devbox', false)];
    const r = mount([], before, false);
    r.rerender({ sessions: [], machines: before, ready: false });
    r.rerender({ sessions: [], machines: [machine('local', true, 'open'), machine('devbox', false, 'unreachable')], ready: false });
    expect(r.result.current.draft('local:bix')).toBe('a');
    expect(r.result.current.pref('local:bix').scroll).toBe(3);
    // Nothing was rewritten either (stored values untouched).
    expect(JSON.parse(localStorage.getItem('desktop.drafts')!)).toEqual(drafts);
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)).toEqual(threads);
  });
  it('folds and reading position per qualified id', () => {
    const { result } = mount([bix]);
    act(() => { result.current.setPref('local:bix', { open: ['metadata'] }); result.current.setPref('local:bix', { scroll: 120 }); });
    expect(result.current.pref('local:bix')).toEqual({ open: ['metadata'], scroll: 120 });
    expect(result.current.pref('local:otto')).toEqual({ open: [], scroll: null });
  });
});

describe('useThreadRequest', () => {
  const at = '2026-10-13T10:00:00.000Z';
  it('asks once per snapshot until the thread is loaded', () => {
    act(() => daemonStore.apply({ type: 'snapshot', sessions: [bix] }));
    const r = renderHook(() => useThreadRequest(client, bix));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'session.thread', id: 'local:bix' });
    r.rerender();
    expect(send).toHaveBeenCalledTimes(1);
    act(() => daemonStore.apply({ type: 'snapshot', sessions: [bix] }));
    expect(send).toHaveBeenCalledTimes(2);
    act(() => daemonStore.apply({ type: 'session.thread', id: 'local:bix', items: [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Go' }] }));
    expect(r.result.current?.map(i => i.id)).toEqual(['p1']);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('never asks for a frozen session, and returns its kept thread (R10)', () => {
    const frozen = { ...bix, offline: true };
    act(() => {
      daemonStore.apply({ type: 'snapshot', sessions: [bix] });
      daemonStore.apply({ type: 'session.thread', id: 'local:bix', items: [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Go' }] });
      daemonStore.apply({ type: 'snapshot', sessions: [frozen] });
    });
    const r = renderHook(() => useThreadRequest(client, frozen));
    expect(r.result.current?.map(i => i.id)).toEqual(['p1']);
    act(() => daemonStore.apply({ type: 'snapshot', sessions: [{ ...frozen, id: 'local:x' }] }));
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps the last items of the same session while a snapshot clears them and the re-request is in flight', () => {
    act(() => {
      daemonStore.apply({ type: 'snapshot', sessions: [bix] });
      daemonStore.apply({ type: 'session.thread', id: 'local:bix', items: [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Go' }] });
    });
    const r = renderHook(({ s }) => useThreadRequest(client, s), { initialProps: { s: bix } });
    expect(r.result.current?.map(i => i.id)).toEqual(['p1']);
    send.mockClear();
    act(() => daemonStore.apply({ type: 'snapshot', sessions: [bix] }));
    expect(r.result.current?.map(i => i.id)).toEqual(['p1']);
    expect(send).toHaveBeenCalledTimes(1);
    // Never another session's items.
    const nova = { ...bix, id: 'local:nova' };
    r.rerender({ s: nova });
    expect(r.result.current).toBeUndefined();
  });
});

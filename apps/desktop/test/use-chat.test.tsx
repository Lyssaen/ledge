import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { daemonStore, type MachineState } from '@ledge/fleet';
import type { ChatTurn } from '@ledge/protocol';
import { useChat } from '../src/chat/useChat';
import { fakeChatClient, fakeChatFleet, history, machinesUp, T, turn } from './chat-helpers';

beforeEach(() => { localStorage.clear(); daemonStore.reset(); });

function setup(opts: { refuse?: boolean } = {}) {
  const c = fakeChatClient(opts);
  const f = fakeChatFleet();
  const hook = renderHook(({ machines, localDown }: { machines: MachineState[]; localDown: boolean }) => useChat(c.client, f.fleet, machines, localDown),
    { initialProps: { machines: machinesUp(), localDown: false } });
  return { ...c, ...f, hook, api: () => hook.result.current };
}
const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the build' };
const relay = { id: 'local:otto', name: 'Otto', tool: 'claude' as const, text: 'Run the tests' };
const answered = (qid: string, extra: Partial<ChatTurn> = {}) => turn(qid, { answeredAt: T, answer: 'Done.', ...extra });

describe('useChat: questions', () => {
  it('asks with the stored harness and says whether the fleet took the question', () => {
    localStorage.setItem('desktop.tool', JSON.stringify('codex'));
    const s = setup();
    let ok = false;
    act(() => { ok = s.api().ask('  Who needs me?  '); });
    expect(ok).toBe(true);
    expect(s.sent).toEqual([{ type: 'chat.ask', qid: expect.stringMatching(/^q-/), text: 'Who needs me?', tool: 'codex' }]);
    expect(s.api().running?.question).toBe('Who needs me?');
    expect(s.api().canAsk).toBe(false);
  });
  it('two asks in the same event send one question (Review Focus 1)', () => {
    const s = setup();
    act(() => { s.api().ask('One'); s.api().ask('Two'); });
    expect(s.sent.filter(m => m.type === 'chat.ask')).toHaveLength(1);
  });
  it('a blank question, a down local daemon or a refused question are not taken', () => {
    const s = setup({ refuse: true });
    let ok = true;
    act(() => { ok = s.api().ask('   '); });
    expect(ok).toBe(false);
    expect(s.sent).toEqual([]);
    act(() => { ok = s.api().ask('Hello'); });
    expect(ok).toBe(false);                       // sent, but the fleet did not list it
    expect(s.sent).toHaveLength(1);
    s.hook.rerender({ machines: machinesUp(['local', 'devbox']), localDown: true });
    act(() => { ok = s.api().ask('Hello'); });
    expect(ok).toBe(false);
    expect(s.sent).toHaveLength(1);
    expect(s.api().canAsk).toBe(false);
  });
  it('cancel targets the running turn, and nothing when none runs', () => {
    const s = setup();
    act(() => { s.api().cancel(); });
    expect(s.sent).toEqual([]);
    act(() => { s.api().ask('Status?'); });
    const qid = s.api().running!.qid;
    expect(s.api().canCancel).toBe(true);
    act(() => { s.api().cancel(); });
    expect(s.sent.at(-1)).toEqual({ type: 'chat.cancel', qid });
  });
  it('cancel is off while the local daemon is down, like asking', () => {
    const s = setup();
    act(() => { s.api().ask('Status?'); });
    s.hook.rerender({ machines: machinesUp(['local']), localDown: true });
    expect(s.api().running).not.toBeNull();
    expect(s.api().canCancel).toBe(false);
    const before = s.sent.length;
    act(() => { s.api().cancel(); });
    expect(s.sent).toHaveLength(before);
  });
  it('reset only between questions, with something to forget, local daemon up', () => {
    const s = setup();
    act(() => { s.api().reset(); });
    expect(s.sent).toEqual([]);
    act(() => { s.api().ask('Status?'); });
    act(() => { s.api().reset(); });
    expect(s.sent.map(m => m.type)).toEqual(['chat.ask']);
    act(() => { history([answered('a')]); });
    act(() => { s.api().reset(); });
    expect(s.sent.at(-1)).toEqual({ type: 'chat.reset' });
    expect(s.api().turns).toEqual([]);
  });
});

describe('useChat: card actions', () => {
  it('launches the proposal once, with its tool, folder, prompt and qid (Review Focus 1)', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal }), answered('b', { proposal })]); });
    act(() => { s.api().launch('a'); s.api().launch('a'); s.api().launch('b'); s.api().relay('b'); });
    expect(s.sent).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the build', qid: 'a' }]);
    expect(s.api().card).toMatchObject({ qid: 'a', kind: 'launch', machine: 'local' });
  });
  it('no prompt key when the proposal has none; nothing for a running, launched or unknown turn', () => {
    const s = setup();
    act(() => { history([turn('run', { proposal }), answered('done', { proposal: { ...proposal, launchedId: 'local:ari' } }), answered('bare', { proposal: { cwd: '/w/x', project: 'x', tool: 'codex' } })]); });
    act(() => { s.api().launch('run'); s.api().launch('done'); s.api().launch('nope'); });
    expect(s.sent).toEqual([]);
    act(() => { s.api().launch('bare'); });
    expect(s.sent).toEqual([{ type: 'session.launch', tool: 'codex', cwd: '/w/x', qid: 'bare' }]);
  });
  it('frames that are not the outcome keep the card busy (Review Focus 2)', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal })]); });
    act(() => { s.api().launch('a'); });
    act(() => { history([answered('a', { proposal }), answered('b')]); });                         // another turn, same mark
    act(() => { s.machineMessage('devbox', { type: 'error', message: 'Devbox: no such folder' }); }); // another machine
    act(() => { s.machineMessage('local', { type: 'error', id: 'otto', message: 'pane gone' }); });   // an agent's answer (lot 4)
    expect(s.api().card?.qid).toBe('a');
    expect(s.api().note).toBeNull();
    act(() => { history([answered('a', { proposal: { ...proposal, launchedId: 'local:ari' } }), answered('b')]); });
    expect(s.api().card).toBeNull();
  });
  it('a proposal error frees the card and the next try can go', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal })]); });
    act(() => { s.api().launch('a'); });
    act(() => { history([answered('a', { proposal: { ...proposal, error: 'no such folder' } })]); });
    expect(s.api().card).toBeNull();
    act(() => { s.api().launch('a'); });
    expect(s.sent.filter(m => m.type === 'session.launch')).toHaveLength(2);
  });
  it('an id-less error from its own machine frees the card and is kept as a note', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal: { ...proposal, error: 'no such folder' } })]); });
    act(() => { s.api().launch('a'); });
    act(() => { s.machineMessage('local', { type: 'error', message: 'no such folder' }); });   // same error: the history did not change
    expect(s.api().card).toBeNull();
    expect(s.api().note).toEqual({ qid: 'a', message: 'no such folder' });
    act(() => { s.api().ask('Try /w/other'); });
    expect(s.api().note).toBeNull();
  });
  it('losing its machine or the local daemon frees the card and makes the turn unavailable (Review Focus 3)', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal, machineId: 'devbox', machineName: 'Devbox' })]); });
    expect(s.api().available('a')).toBe(true);
    act(() => { s.api().launch('a'); });
    expect(s.api().card?.machine).toBe('devbox');
    s.setMachines(machinesUp(['devbox']));
    s.hook.rerender({ machines: machinesUp(['devbox']), localDown: false });
    expect(s.api().card).toBeNull();
    expect(s.api().available('a')).toBe(false);
    act(() => { s.api().launch('a'); });
    expect(s.sent.filter(m => m.type === 'session.launch')).toHaveLength(1);

    s.setMachines(machinesUp());
    s.hook.rerender({ machines: machinesUp(), localDown: false });
    act(() => { s.api().launch('a'); });
    expect(s.api().card).not.toBeNull();
    s.hook.rerender({ machines: machinesUp(), localDown: true });
    expect(s.api().card).toBeNull();
    expect(s.api().available('a')).toBe(false);
  });
  it('relay: send while proposed or failed, cancel only while queued', () => {
    const s = setup();
    act(() => { history([answered('a', { relay })]); });
    act(() => { s.api().relayCancel('a'); });
    expect(s.sent).toEqual([]);
    act(() => { s.api().relay('a'); s.api().relay('a'); });
    expect(s.sent).toEqual([{ type: 'session.relay', qid: 'a' }]);
    expect(s.api().card?.kind).toBe('relay');
    act(() => { history([answered('a', { relay: { ...relay, status: 'queued' } })]); });
    expect(s.api().card).toBeNull();
    act(() => { s.api().relay('a'); });
    expect(s.sent).toHaveLength(1);
    act(() => { s.api().relayCancel('a'); });
    expect(s.sent.at(-1)).toEqual({ type: 'session.relay.cancel', qid: 'a' });
    act(() => { history([answered('a', { relay: { ...relay, error: 'cancelled' } })]); });
    act(() => { s.api().relay('a'); });
    expect(s.sent.at(-1)).toEqual({ type: 'session.relay', qid: 'a' });
  });
  it('reset waits for the card', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal })]); });
    act(() => { s.api().launch('a'); });
    act(() => { s.api().reset(); });
    expect(s.sent.map(m => m.type)).toEqual(['session.launch']);
  });
});

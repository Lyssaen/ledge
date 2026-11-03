import { describe, it, expect, beforeEach } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createOmpSeats, entryState, isOmpSeat } from '../src/daemon/omp/seats.js';

// Entries as OMP 18.13.1 writes them under OpenRig 0.7.7 (~/.openrig/state/omp/<seat>/sessions/*.jsonl), trimmed.
const at = (s: number) => `2026-11-03T09:00:${String(s).padStart(2, '0')}.000Z`;
const HEAD = [
  { type: 'title', v: 1, title: '', updatedAt: at(0), pad: '          ' },
  { type: 'session', version: 3, id: '01a1a045-609d-7000-82d6-49ec2bf6ac69', timestamp: at(0), cwd: '/w/dev-omp/work' },
  { type: 'model_change', id: 'm1', timestamp: at(1), model: 'anthropic/claude-sonnet-5-5' },
  { type: 'thinking_level_change', id: 't1', timestamp: at(1), thinkingLevel: 'high' }
];
const prompt = (id: string, s: number, text: string) => ({ type: 'message', id, timestamp: at(s), message: { role: 'user', attribution: 'user', content: [{ type: 'text', text }] } });
const said = (id: string, s: number, stopReason: string) => ({ type: 'message', id, timestamp: at(s), message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], stopReason } });
const toolStart = (id: string, s: number) => ({ type: 'custom', customType: 'tool_execution_start', id, timestamp: at(s), data: { toolCallId: `t-${id}`, toolName: 'bash', args: {} } });
const toolResult = (id: string, s: number, text = '') => ({ type: 'message', id, timestamp: at(s), message: { role: 'toolResult', toolCallId: 't', toolName: 'bash', content: text ? [{ type: 'text', text }] : [], isError: false } });
const lines = (entries: unknown[]) => entries.map(e => `${JSON.stringify(e)}\n`).join('');

describe('entryState: what an OMP journal entry says of the seat', () => {
  it('a prompt, a background result, a tool and a message calling one are work; the end of a turn, however it ends, is rest', () => {
    expect(entryState(prompt('u', 2, 'go'))).toEqual({ state: 'working', at: at(2) });
    expect(entryState({ type: 'custom_message', customType: 'async-result', content: 'done', timestamp: at(3) })).toEqual({ state: 'working', at: at(3) });
    expect(entryState(toolStart('c', 4))).toEqual({ state: 'working', at: at(4) });
    expect(entryState(toolResult('r', 5))).toEqual({ state: 'working', at: at(5) });
    expect(entryState(said('a', 6, 'toolUse'))).toEqual({ state: 'working', at: at(6) });
    for (const reason of ['stop', 'aborted', 'error', 'length']) expect(entryState(said('a', 7, reason))).toEqual({ state: 'idle', at: at(7) });
  });
  it('OMP\'s bookkeeping says nothing', () => {
    for (const e of [...HEAD, { type: 'custom', customType: 'system-prompt-digest', data: 'f6' }, { type: 'credential_pin', provider: 'anthropic' }, { type: 'ttsr_injection' },
      { type: 'message', message: { role: 'developer', attribution: 'agent', content: 'x' } }, { type: 'custom', customType: 'session_exit', data: {} }, 'text', null]) expect(entryState(e)).toBeNull();
  });
});

describe('createOmpSeats: the state of an OpenRig OMP seat, from its journal', () => {
  let dir: string, root: string, journal: string, store: Store;
  const SEAT = 'dev-agent@dev-omp', ID = 'rig-dev-agent-dev-omp';
  const session = (o: Partial<Session> = {}): Session => ({ id: ID, name: 'Pim', tool: 'omp', cwd: '/w/dev-omp/work', project: 'work', title: 'Pim · dev.agent',
    tmuxSession: SEAT, state: 'idle', helpers: [], startedAt: at(0), lastActivityAt: at(0), source: 'rig', rig: { seat: SEAT, name: 'dev-omp', role: 'dev.agent' }, ...o });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledge-omp-seats-')); root = join(dir, 'state', 'omp');
    mkdirSync(join(root, SEAT, 'sessions'), { recursive: true });
    journal = join(root, SEAT, 'sessions', '2026-11-03T07-17-43-709Z_01a1a045-609d-7000-82d6-49ec2bf6ac69.jsonl');
    writeFileSync(join(root, SEAT, 'runner-state.json'), JSON.stringify({ ready: true, launchId: 'l1', sessionFile: journal, sessionId: '01a1a045', updatedAt: at(0) }));
    store = new Store();
  });

  it('works while a turn runs and rests once it ends; a line still being written waits; nothing else of the session changes', async () => {
    store.upsert(session());
    const turn = lines([...HEAD, prompt('u1', 2, 'Implémente ST7-1'), said('a1', 3, 'toolUse'), toolStart('c1', 3)]);
    writeFileSync(journal, `${turn}{"type":"message","id":"r1","message":{"role":"assistant","stopRea`);
    const s = createOmpSeats({ store, root });
    await s.tick();
    expect(store.get(ID)).toMatchObject({ state: 'working', lastActivityAt: at(3) });
    writeFileSync(journal, `${turn}${lines([toolResult('r1', 4), said('a2', 5, 'stop')])}`);
    await s.tick();
    const after = store.get(ID)!;
    expect(after).toMatchObject({ state: 'idle', lastActivityAt: at(5) });
    // State only: no model, no reply, no conversation file, no topic read from the journal.
    for (const k of ['model', 'effort', 'lastReply', 'agentSessionFile', 'topic']) expect(after).not.toHaveProperty(k);
    appendFileSync(journal, lines([prompt('u2', 20, 'Et les tests ?')]));
    await s.tick();
    expect(store.get(ID)?.state).toBe('working');
  });

  it('a seat new to Ledge takes its state from the last entry that tells one, however long that line, and again after a restart', async () => {
    store.upsert(session());
    // A tool result of 600 KB is the last whole entry while OMP works on the next call; OMP's bookkeeping after it tells nothing.
    writeFileSync(journal, lines([...HEAD, prompt('u0', 1, 'go'), said('a0', 2, 'toolUse'), toolResult('r0', 9, 'x'.repeat(600 * 1024)), { type: 'ttsr_injection', timestamp: at(10) }]));
    await createOmpSeats({ store, root }).tick();
    expect(store.get(ID)).toMatchObject({ state: 'working', lastActivityAt: at(9) });
    // The daemon restarts: the seat is idle as discovery recorded it, until its journal says otherwise.
    store.upsert({ ...store.get(ID)!, state: 'idle' });
    const s = createOmpSeats({ store, root }); await s.tick();
    expect(store.get(ID)?.state).toBe('working');
    // Read on from there: the turn's end.
    appendFileSync(journal, lines([said('a1', 20, 'stop')]));
    await s.tick();
    expect(store.get(ID)).toMatchObject({ state: 'idle', lastActivityAt: at(20) });
  });

  it('follows a new entry larger than one read, whole or written in several goes', async () => {
    store.upsert(session());
    writeFileSync(journal, lines([...HEAD, prompt('u0', 1, 'go'), said('a0', 2, 'stop')]));
    const s = createOmpSeats({ store, root }); await s.tick();
    expect(store.get(ID)?.state).toBe('idle');
    // A 5 MB prompt, over the 4 MB of one read.
    appendFileSync(journal, lines([prompt('u1', 10, 'y'.repeat(5 * 1024 * 1024))]));
    await s.tick(); await s.tick();
    expect(store.get(ID)).toMatchObject({ state: 'working', lastActivityAt: at(10) });
    appendFileSync(journal, lines([said('a1', 11, 'stop')]));
    await s.tick();
    expect(store.get(ID)?.state).toBe('idle');
    // A 5 MB tool result written in two goes: nothing until it is whole, then read whole.
    const big = JSON.stringify(toolResult('r2', 12, 'z'.repeat(5 * 1024 * 1024)));
    appendFileSync(journal, big.slice(0, 3 * 1024 * 1024));
    await s.tick();
    expect(store.get(ID)?.state).toBe('idle');
    appendFileSync(journal, `${big.slice(3 * 1024 * 1024)}\n`);
    await s.tick();
    expect(store.get(ID)).toMatchObject({ state: 'working', lastActivityAt: at(12) });
  });

  it('a journal with no entry that tells a state, or only a line still being written, leaves the state as it is', async () => {
    store.upsert(session({ state: 'idle' }));
    writeFileSync(journal, lines(HEAD));
    const s = createOmpSeats({ store, root }); await s.tick();
    expect(store.get(ID)?.state).toBe('idle');
    appendFileSync(journal, '{"type":"message","message":{"role":"user"');
    await s.tick();
    expect(store.get(ID)?.state).toBe('idle');
    appendFileSync(journal, ',"content":[]},"timestamp":"2026-11-03T09:00:30.000Z"}\n');
    await s.tick();
    expect(store.get(ID)?.state).toBe('working');
  });

  it('a new conversation of the seat (another journal) is followed from then on', async () => {
    store.upsert(session());
    writeFileSync(journal, lines([...HEAD, prompt('u1', 2, 'go'), said('a1', 3, 'stop')]));
    const s = createOmpSeats({ store, root }); await s.tick();
    const next = join(root, SEAT, 'sessions', '2026-11-03T11-00-00-000Z_01a1b000-0000-7000-8000-00000000beef.jsonl');
    writeFileSync(next, lines([...HEAD, prompt('u1', 30, 'Nouvelle histoire')]));
    writeFileSync(join(root, SEAT, 'runner-state.json'), JSON.stringify({ ready: true, sessionFile: next, updatedAt: at(30) }));
    await s.tick();
    expect(store.get(ID)).toMatchObject({ state: 'working', lastActivityAt: at(30) });
  });

  it('leaves alone an OMP session Ledge launched, a seat that stopped, and a seat whose runner names no journal yet', async () => {
    writeFileSync(journal, lines([...HEAD, prompt('u1', 2, 'go')]));
    store.upsert(session({ id: 'own', backend: 'omp-rpc', tmuxSession: null, source: 'launcher' }));
    store.upsert(session({ id: 'gone', state: 'exited', exitedAt: at(0) }));
    store.upsert(session({ id: 'fresh', rig: { seat: 'review-reviewer@dev-omp', name: 'dev-omp' } }));
    await createOmpSeats({ store, root }).tick();
    expect(store.get('own')?.state).toBe('idle');
    expect(store.get('gone')?.state).toBe('exited');
    expect(store.get('fresh')?.state).toBe('idle');
    expect(isOmpSeat(store.get('own')!)).toBe(false);
  });
});

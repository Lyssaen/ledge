import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MachineConfig, MachineState } from '@ledge/fleet';
import { ALIAS, checkDraft, configsOf, MAX_MACHINES, newMachineId, sameMachines, withDraft, without } from '../src/settings/machineDrafts';
import { SAVE_TIMEOUT_MS, useMachineEditor, type SaveOutcome } from '../src/settings/useMachineEditor';
import { fakeMachineFleet, machine, statesOf, type FakeMachineFleet } from './fleet-helpers';

const info = { version: '0.5.2', install: 'npm' as const, systemd: true };
const local = machine('local', { daemon: info });
const devbox = machine('devbox', { label: 'Devbox', daemon: info });
const list: MachineConfig[] = [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }];
const nas: MachineConfig = { id: 'remote-0', label: 'Nas', ssh: 'nas' };

describe('the list rules', () => {
  it('a name of 1 to 80 characters, an SSH alias without spaces, at most once, 20 machines at most', () => {
    expect(MAX_MACHINES).toBe(20);
    expect(ALIAS.test('gpu-box.lan_2')).toBe(true);
    expect(checkDraft(list, { label: 'Nas', ssh: 'nas' }, null)).toBeNull();
    expect(checkDraft(list, { label: '   ', ssh: 'nas' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'x'.repeat(81), ssh: 'nas' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'x'.repeat(80), ssh: 'nas' }, null)).toBeNull();
    expect(checkDraft(list, { label: 'Nas', ssh: 'my box' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: '-nas' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: 'a'.repeat(65) }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: 'a'.repeat(64) }, null)).toBeNull();
    expect(checkDraft(list, { label: 'Other', ssh: 'devbox' }, null)).toBe('duplicate');
    expect(checkDraft(list, { label: 'Other', ssh: ' devbox ' }, null)).toBe('duplicate');
    expect(checkDraft(list, { label: 'Devbox 2', ssh: 'devbox' }, 'devbox')).toBeNull();
    const full = [list[0]!, ...Array.from({ length: 19 }, (_, i) => ({ id: `m${i}`, label: `M${i}`, ssh: `m${i}` }))];
    expect(checkDraft(full, { label: 'Nas', ssh: 'nas' }, null)).toBe('full');
    expect(checkDraft(full, { label: 'M0 bis', ssh: 'm0' }, 'm0')).toBeNull();
  });

  it('builds the next list without touching the local machine', () => {
    expect(newMachineId(list, () => 0)).toBe('remote-0');
    expect(newMachineId([...list, { id: 'remote-0', label: 'X', ssh: 'x' }], () => 0)).toBe('remote-0-2');
    expect(newMachineId(list)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(withDraft(list, { label: ' Nas ', ssh: ' nas ' }, null, () => 0)).toEqual([...list, nas]);
    expect(withDraft(list, { label: 'Dev', ssh: 'dev2' }, 'devbox')).toEqual([list[0], { id: 'devbox', label: 'Dev', ssh: 'dev2' }]);
    expect(without(list, 'devbox')).toEqual([list[0]]);
    expect(without(list, 'local')).toEqual(list);
    expect(configsOf([local, devbox])).toEqual(list);
  });

  it('two lists are the same with the same machines, names and aliases, in the same order', () => {
    expect(sameMachines(list, configsOf([local, devbox]))).toBe(true);
    expect(sameMachines(list, [list[1]!, list[0]!])).toBe(false);
    expect(sameMachines(list, [list[0]!, { ...list[1]!, label: 'Dev' }])).toBe(false);
    expect(sameMachines(list, [list[0]!, { ...list[1]!, ssh: 'dev' }])).toBe(false);
    expect(sameMachines(list, [list[0]!])).toBe(false);
  });
});

function editor(f: FakeMachineFleet = fakeMachineFleet(), machines: MachineState[] = [local, devbox], timeoutMs?: number) {
  const view = renderHook(({ ms }) => useMachineEditor(f, ms, timeoutMs), { initialProps: { ms: machines } });
  return { f, view, result: view.result, broadcast: (next: MachineState[]) => act(() => view.rerender({ ms: next })) };
}
/** The outcome of a promise, or 'pending' while it has none (after the microtasks already queued). */
async function outcome(p: Promise<SaveOutcome>): Promise<SaveOutcome | 'pending'> {
  let o: SaveOutcome | 'pending' = 'pending';
  void p.then(x => { o = x; });
  await act(async () => { await Promise.resolve(); });
  return o;
}

describe('saving a list (useMachineEditor)', () => {
  it('sends machines.set and is saved only once the fleet’s list equals the one sent', async () => {
    const { f, result, broadcast } = editor();
    let p!: Promise<SaveOutcome>;
    act(() => { p = result.current.save([...list, nas]); });
    expect(f.configured).toEqual([[...list, nas]]);
    expect(result.current.saving).toBe(true);
    expect(await outcome(p)).toBe('pending');
    broadcast([local, devbox, machine('other')]);            // another list: not this save's answer
    expect(await outcome(p)).toBe('pending');
    broadcast(statesOf([...list, nas]));
    expect(await p).toBe('saved');
    expect(result.current.saving).toBe(false);
  });

  it('a second call while one is saving gets the first one’s promise: one machines.set', () => {
    const { f, result } = editor();
    let a!: Promise<SaveOutcome>, b!: Promise<SaveOutcome>;
    act(() => { a = result.current.save([...list, nas]); b = result.current.save(list.slice(0, 1)); });
    expect(b).toBe(a);
    expect(f.configured).toHaveLength(1);
  });

  it('an unchanged list is saved at once', async () => {
    const { f, result } = editor();
    let p!: Promise<SaveOutcome>;
    act(() => { p = result.current.save(list); });
    expect(await p).toBe('saved');
    expect(f.configured).toEqual([list]);
  });

  it('the local daemon closed: offline, nothing applied, no longer saving', async () => {
    const f = fakeMachineFleet(); f.state.down = true;
    const { result } = editor(f);
    let p!: Promise<SaveOutcome>;
    act(() => { p = result.current.save([...list, nas]); });
    expect(await p).toBe('offline');
    expect(f.configured).toEqual([]);
    expect(result.current.saving).toBe(false);
    expect(f.listeners.size).toBe(0);
  });

  it('an error of the local daemon without id refuses the list; an error answering something else does not', async () => {
    const { f, result } = editor();
    let p!: Promise<SaveOutcome>;
    act(() => { p = result.current.save([...list, nas]); });
    act(() => f.emit('local', { type: 'error', message: 'Unknown session', id: 'q1' }));
    act(() => f.emit('devbox', { type: 'error', message: 'Busy' }));
    expect(await outcome(p)).toBe('pending');
    act(() => f.emit('local', { type: 'error', message: 'Invalid machines' }));
    expect(await p).toBe('refused');
    expect(result.current.saving).toBe(false);
  });

  it('a silent daemon: the save gives up after its timeout (10 s by default)', async () => {
    expect(SAVE_TIMEOUT_MS).toBe(10_000);
    const { result } = editor(undefined, undefined, 30);
    let p!: Promise<SaveOutcome>;
    act(() => { p = result.current.save([...list, nas]); });
    let o: SaveOutcome | undefined;
    await act(async () => { o = await p; });   // the timer's state update lands inside act
    expect(o).toBe('timeout');
    expect(result.current.saving).toBe(false);
  });
});

describe('testing an alias (useMachineEditor.probe)', () => {
  it('shows the probe under its key while it runs, then its result', async () => {
    const { f, result } = editor();
    act(() => result.current.probe('devbox', 'devbox'));
    expect(f.probes.map(p => p.ssh)).toEqual(['devbox']);
    expect(result.current.probing).toEqual({ key: 'devbox', alias: 'devbox', result: null });
    await act(async () => f.probes[0]!.answer({ ok: true, version: '0.5.2', sessions: 2 }));
    expect(result.current.probing).toEqual({ key: 'devbox', alias: 'devbox', result: { ok: true, version: '0.5.2', sessions: 2 } });
  });

  it('a newer probe replaces the older one, whose late answer is dropped', async () => {
    const { f, result } = editor();
    act(() => result.current.probe('devbox', 'devbox'));
    act(() => result.current.probe('draft:nas', 'nas'));
    await act(async () => f.probes[0]!.answer({ ok: true, sessions: 1 }));
    expect(result.current.probing).toEqual({ key: 'draft:nas', alias: 'nas', result: null });
    await act(async () => f.probes[1]!.answer({ ok: false, error: 'ssh: Could not resolve hostname nas' }));
    expect(result.current.probing?.result).toEqual({ ok: false, error: 'ssh: Could not resolve hostname nas' });
  });

  it('clearProbe forgets the result and drops the answer still on its way', async () => {
    const { f, result } = editor();
    act(() => result.current.probe('devbox', 'devbox'));
    act(() => result.current.clearProbe());
    expect(result.current.probing).toBeNull();
    await act(async () => f.probes[0]!.answer({ ok: true, sessions: 0 }));
    expect(result.current.probing).toBeNull();
  });

  it('a probe that throws reads as a failure with its message', async () => {
    const { f, result } = editor();
    act(() => result.current.probe('devbox', 'devbox'));
    await act(async () => f.probes[0]!.fail(new Error('socket closed')));
    expect(result.current.probing?.result).toEqual({ ok: false, error: 'socket closed' });
  });
});

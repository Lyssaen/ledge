import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneServerMessage } from '@ledge/protocol';
import { createRigs, READ_MS, RIGS_STATE_KEY, type RigsStore } from '../../src/state/rigs';
import { UNCERTAIN_MS } from '../../src/state/operations';
import { createStore, type MobileStore } from '../../src/state/store';
import { openrig, routing } from '../model/openrig-fixtures';
import { fakeLink, MemoryStorage, snapshot } from './helpers';

const open: { rigs: RigsStore; store: MobileStore }[] = [];
afterEach(() => { for (const o of open.splice(0)) { o.rigs.close(); o.store.close(); } vi.useRealTimers(); });

/** A ready link to a PC that sends its rigs (`daemon.rigs`), unless `offered` is false. */
function setup(offered = true, device?: { confirm: boolean }) {
  const f = fakeLink('ready');
  const storage = new MemoryStorage();
  const store = createStore(f.link, storage);
  const rigs = createRigs(f.link, store, storage);
  open.push({ rigs, store });
  const snap = snapshot([], 'WSL', undefined, device) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  f.deliver(offered ? { ...snap, daemon: { ...snap.daemon, rigs: true } } : snap);
  return { ...f, store, rigs, storage };
}

describe('the rigs store', () => {
  it('asks rigs.state once while the PC offers it, and keeps the answer for an offline start', () => {
    const t = setup();
    t.rigs.follow();
    t.rigs.follow();
    expect(t.of('rigs.state')).toHaveLength(1);
    t.deliver({ type: 'rigs.state', state: openrig() });
    expect(t.rigs.getState().state?.rigs.map(r => r.name)).toEqual(['kernel', 'ledge-dev', 'synapse-review']);
    expect(JSON.parse(t.storage.getItem(RIGS_STATE_KEY)!).state.version).toBe('0.7.10');
    const again = createRigs(fakeLink('pc_offline').link, t.store, t.storage);
    open.push({ rigs: again, store: t.store });
    expect(again.getState().state?.version).toBe('0.7.10');
  });

  it('asks nothing of a PC that does not send its rigs', () => {
    const t = setup(false);
    t.rigs.follow();
    expect(t.of('rigs.state')).toHaveLength(0);
  });

  it('turns a read the PC never answers into « unavailable »', () => {
    vi.useFakeTimers();
    const t = setup();
    t.rigs.readRouting();
    expect(t.rigs.getState().routing?.loading).toBe(true);
    vi.advanceTimersByTime(READ_MS + 1);
    expect(t.rigs.getState().routing).toMatchObject({ loading: false, error: 'unavailable' });
  });

  it('keeps the routing as OpenRig gives it (oldest first)', () => {
    const t = setup();
    t.rigs.readRouting();
    t.deliver(routing());
    expect(t.rigs.getState().routing?.data?.map(e => e.qitem)).toEqual(['qitem-1', 'qitem-2', 'qitem-3']);
  });

  it('sends an action that needs no check at once, and ends its run on rigs.done', async () => {
    const t = setup();
    const ended = t.rigs.act({ kind: 'rig.start', rig: 'ledge-dev' });
    await vi.waitFor(() => expect(t.of('rigs.act')).toHaveLength(1));
    const sent = t.of('rigs.act')[0]!;
    expect(sent.action).toEqual({ kind: 'rig.start', rig: 'ledge-dev' });
    expect(sent.assertion).toBeUndefined();
    t.deliver({ type: 'operation.result', op: sent.op, status: 'received' } as PhoneServerMessage);
    expect(t.rigs.getState().runs[0]!.phase).toBe('received');
    t.deliver({ type: 'rigs.done', op: sent.op, ok: true, commands: ['rig up ledge-dev --existing'] });
    expect((await ended).phase).toBe('done');
  });

  it('refuses a stop without a passkey on this phone, and sends nothing', async () => {
    const t = setup(true, { confirm: false });
    const run = await t.rigs.act({ kind: 'kernel.stop' });
    expect(run).toMatchObject({ phase: 'rejected', reason: 'confirm_required' });
    expect(t.of('rigs.act')).toHaveLength(0);
  });

  it('sends a goal to Max with its own id, and the same id again on « Renvoyer »', async () => {
    const t = setup();
    const first = t.rigs.sendGoal('Une équipe pour relire la MR', 'goal-retry-0001');
    await vi.waitFor(() => expect(t.of('rigs.goal.send')).toHaveLength(1));
    const m = t.of('rigs.goal.send')[0]!;
    expect(m).toMatchObject({ goalId: 'goal-retry-0001', text: 'Une équipe pour relire la MR' });
    t.deliver({ type: 'rigs.goal.sent', op: m.op, goalId: 'goal-retry-0001', ok: false, error: 'uncertain' });
    expect(await first).toMatchObject({ phase: 'done', reason: 'uncertain' });
    void t.rigs.sendGoal('Une équipe pour relire la MR', 'goal-retry-0001');
    await vi.waitFor(() => expect(t.of('rigs.goal.send')).toHaveLength(2));
    const again = t.of('rigs.goal.send')[1]!;
    expect(again.goalId).toBe('goal-retry-0001');
    expect(again.op).not.toBe(m.op);
  });

  it('ends a run the link could not send as « unsent », and does not send it again on the next link', async () => {
    const t = setup();
    vi.spyOn(t.link, 'send').mockResolvedValueOnce(false);
    expect(await t.rigs.sendGoal('Une équipe', 'goal-unsent-0001')).toMatchObject({ phase: 'unsent' });
    t.set('pc_offline');
    t.set('ready');
    expect(t.of('rigs.goal.send')).toHaveLength(0);
  });

  it('ends a run whose send threw as « unsent »', async () => {
    const t = setup();
    vi.spyOn(t.link, 'send').mockRejectedValueOnce(new Error('closed'));
    expect(await t.rigs.act({ kind: 'rig.start', rig: 'ledge-dev' })).toMatchObject({ phase: 'unsent' });
  });

  it('stops waiting for a PC that never says it has the action (« uncertain »), and still takes its late answer', async () => {
    vi.useFakeTimers();
    const t = setup();
    const ended = t.rigs.act({ kind: 'rig.start', rig: 'ledge-dev' });
    await vi.waitFor(() => expect(t.of('rigs.act')).toHaveLength(1));
    const sent = t.of('rigs.act')[0]!;
    vi.advanceTimersByTime(UNCERTAIN_MS + 1);
    expect(await ended).toMatchObject({ phase: 'uncertain' });
    t.deliver({ type: 'rigs.done', op: sent.op, ok: true, commands: ['rig up ledge-dev --existing'] });
    expect(t.rigs.getState().runs[0]).toMatchObject({ phase: 'done', done: { ok: true } });
  });

  it('keeps waiting once the PC said it has the action', async () => {
    vi.useFakeTimers();
    const t = setup();
    void t.rigs.act({ kind: 'rig.start', rig: 'ledge-dev' });
    await vi.waitFor(() => expect(t.of('rigs.act')).toHaveLength(1));
    t.deliver({ type: 'operation.result', op: t.of('rigs.act')[0]!.op, status: 'received' } as PhoneServerMessage);
    vi.advanceTimersByTime(UNCERTAIN_MS * 3);
    expect(t.rigs.getState().runs[0]!.phase).toBe('received');
  });

  it('turns a run the link dropped before the PC had it « uncertain », and sends it again with its own op on the next link', async () => {
    const t = setup();
    const ended = t.rigs.sendGoal('Une équipe', 'goal-drop-0001');
    await vi.waitFor(() => expect(t.of('rigs.goal.send')).toHaveLength(1));
    const first = t.of('rigs.goal.send')[0]!;
    t.set('pc_offline');
    expect(await ended).toMatchObject({ phase: 'uncertain' });
    t.set('ready');
    expect(t.of('rigs.goal.send')).toHaveLength(2);
    expect(t.of('rigs.goal.send')[1]!.op).toBe(first.op);
    t.deliver({ type: 'rigs.goal.sent', op: first.op, goalId: 'goal-drop-0001', ok: true });
    expect(t.rigs.getState().runs[0]!.phase).toBe('done');
  });

  it('no longer sends an uncertain run whose receipt was closed, and ignores its late answer', async () => {
    const t = setup();
    const ended = t.rigs.act({ kind: 'rig.start', rig: 'ledge-dev' });
    await vi.waitFor(() => expect(t.of('rigs.act')).toHaveLength(1));
    const op = t.of('rigs.act')[0]!.op;
    t.set('pc_offline');
    const run = await ended;
    expect(run.phase).toBe('uncertain');
    t.rigs.dismiss(run.id);
    t.set('ready');
    t.set('pc_offline');
    t.set('ready');
    expect(t.of('rigs.act')).toHaveLength(1);
    t.deliver({ type: 'rigs.done', op, ok: true, commands: [] });
    expect(t.rigs.getState().runs).toHaveLength(0);
  });

  it('forgets the old PC’s OpenRig when the phone is unpaired', () => {
    const t = setup();
    t.rigs.follow();
    t.deliver({ type: 'rigs.state', state: openrig() });
    t.set('unpaired');
    expect(t.rigs.getState().state).toBeNull();
    expect(t.storage.getItem(RIGS_STATE_KEY)).toBeNull();
  });
});

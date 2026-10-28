import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneServerMessage } from '@ledge/protocol';
import { createStore, type MobileStore } from '../../src/state/store';
import { PC_STALL_MS, olderThan, pcFailed, pcProgress, pcSnapshot, type PcRun } from '../../src/state/pc';
import { getAssertion } from '../../src/link/webauthn';
import { fakeLink, MemoryStorage, snapshot } from './helpers';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

const stores: MobileStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  vi.mocked(getAssertion).mockReset();
  vi.useRealTimers();
});

const BOOT = '11111111-1111-4111-8111-111111111111';
const NEW_BOOT = '22222222-2222-4222-8222-222222222222';
/** A snapshot of a PC at `version` and `boot`, which can update and restart. */
const pcAt = (version: string, boot = BOOT, confirm = true): PhoneServerMessage => {
  const s = snapshot([], 'Atelier', boot, { confirm, chat: true });
  return s.type === 'snapshot' ? { ...s, daemon: { ...s.daemon, version, update: true, restart: true } } : s;
};

function setup(confirm = true) {
  const f = fakeLink('ready');
  const store = createStore(f.link, new MemoryStorage());
  stores.push(store);
  f.deliver(pcAt('0.9.0', BOOT, confirm));
  return { ...f, store };
}

const flush = () => new Promise(r => setTimeout(r, 0));
const ASSERTION = { id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' };
const challenge = { type: 'confirm.challenge' as const, purpose: 'pc' as const, challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 };

/** Runs `pcAction` to its applied answer; returns the operation sent. */
async function applied(t: ReturnType<typeof setup>, action: 'update' | 'restart', version?: string) {
  vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
  const done = t.store.pcAction(action, version);
  await vi.waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
  t.deliver(challenge);
  await flush();
  const sent = t.of(action === 'update' ? 'daemon.update' : 'daemon.restart')[0]!;
  t.deliver({ type: 'operation.result', op: sent.op, status: 'applied' });
  await expect(done).resolves.toEqual({ status: 'applied' });
  return sent;
}

describe('the run, as pure steps', () => {
  const run: PcRun = { action: 'update', version: '0.10.0', boot: BOOT, step: 'asked' };
  it('moves with the daemon\'s steps, ends on a snapshot of the version, fails on a refusal', () => {
    const installing = pcProgress(run, { type: 'daemon.progress', version: '0.10.0', step: 'installing' }, BOOT);
    expect(installing.step).toBe('installing');
    expect(pcSnapshot(installing, { version: '0.9.0', boot: NEW_BOOT })?.step).toBe('installing');
    expect(pcSnapshot(installing, { version: '0.10.0', boot: NEW_BOOT })?.step).toBe('done');
    expect(pcFailed(installing, { type: 'daemon.failed', version: '0.10.0', reason: 'npm-failed' })).toMatchObject({ step: 'failed', reason: 'npm-failed' });
  });
  it('a restart ends once another boot answers', () => {
    const restart: PcRun = { action: 'restart', version: '0.9.0', boot: BOOT, step: 'restarting' };
    expect(pcSnapshot(restart, { version: '0.9.0', boot: BOOT })?.step).toBe('restarting');
    expect(pcSnapshot(restart, { version: '0.9.0', boot: NEW_BOOT })?.step).toBe('done');
  });
  it('follows a run another phone started, and ignores a refusal of a run it does not follow', () => {
    expect(pcProgress(null, { type: 'daemon.progress', version: '0.10.0', step: 'installing' }, BOOT)).toEqual({ action: 'update', version: '0.10.0', boot: BOOT, step: 'installing' });
    expect(pcFailed(null, { type: 'daemon.failed', version: '0.10.0', reason: 'busy' })).toBeNull();
  });
  it('compares plain versions only', () => {
    expect(olderThan('0.9.0', '0.10.0')).toBe(true);
    expect(olderThan('0.10.0', '0.10.0')).toBe(false);
    expect(olderThan('0.9.0', '0.10.0-dev')).toBe(false);
  });
});

describe('pcAction in the store', () => {
  it('prepares a pc challenge for the version, sends daemon.update with the assertion, then follows the run to the PC\'s return', async () => {
    const t = setup();
    const sent = await applied(t, 'update', '0.10.0');
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'pc', action: 'update', version: '0.10.0' }]);
    expect(sent).toMatchObject({ type: 'daemon.update', version: '0.10.0', assertion: ASSERTION });
    expect(t.store.getState().pc).toMatchObject({ action: 'update', version: '0.10.0', step: 'asked' });
    t.deliver({ type: 'daemon.progress', version: '0.10.0', step: 'installing' });
    t.deliver({ type: 'daemon.progress', version: '0.10.0', step: 'restarting' });
    expect(t.store.getState().pc?.step).toBe('restarting');
    t.set('pc_offline');
    t.set('ready');
    t.deliver(pcAt('0.10.0', NEW_BOOT));
    expect(t.store.getState().pc).toMatchObject({ step: 'done', version: '0.10.0' });
    t.store.dismissPc();
    expect(t.store.getState().pc).toBeNull();
  });

  it('a restart prepares its own challenge, without a version, and ends on another boot', async () => {
    const t = setup();
    const sent = await applied(t, 'restart');
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'pc', action: 'restart' }]);
    expect(sent).not.toHaveProperty('version');
    t.deliver(pcAt('0.9.0', BOOT));
    expect(t.store.getState().pc?.step).toBe('asked');
    t.deliver(pcAt('0.9.0', NEW_BOOT));
    expect(t.store.getState().pc?.step).toBe('done');
  });

  it('a refusal ends the run with its reason; dismissing a running one does nothing', async () => {
    const t = setup();
    await applied(t, 'update', '0.10.0');
    t.store.dismissPc();
    expect(t.store.getState().pc?.step).toBe('asked');
    t.deliver({ type: 'daemon.failed', version: '0.10.0', reason: 'sessions-at-risk' });
    expect(t.store.getState().pc).toMatchObject({ step: 'failed', reason: 'sessions-at-risk' });
  });

  it('fails with timeout when the PC does not come back within PC_STALL_MS', async () => {
    // From the start: the wait is armed once the PC accepts. Real time still runs, for the passkey's round trip.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = setup();
    await applied(t, 'update', '0.10.0');
    t.deliver({ type: 'daemon.progress', version: '0.10.0', step: 'installing' });
    vi.advanceTimersByTime(PC_STALL_MS - 1_000);
    expect(t.store.getState().pc?.step).toBe('installing');
    vi.advanceTimersByTime(1_000);
    expect(t.store.getState().pc).toMatchObject({ step: 'failed', reason: 'timeout' });
  });

  it('asks nothing without a passkey on this phone', async () => {
    const t = setup(false);
    await expect(t.store.pcAction('restart')).resolves.toEqual({ status: 'rejected', reason: 'confirm_required' });
    expect(t.of('confirm.prepare')).toEqual([]);
  });
});

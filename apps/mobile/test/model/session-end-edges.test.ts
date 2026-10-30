// Edge cases of closeHeld / endingOf added by the tester (task tf59002): several closes in a row, reconnections, a resume from the PC.
// An op keeps the session's `startedAt` (the PC's) at its send; a resume gives the session a new one (t8cba5e).
import { describe, expect, it } from 'vitest';
import { closeHeld, closedHere, endingOf, SETTLE_MS } from '../../src/model/sessionEnd';
import type { Op } from '../../src/state/operations';
import { session } from './fixtures';

const ASSERTION = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };
const T0 = Date.parse('2026-10-29T18:00:00.000Z');
const iso = (ms: number) => new Date(T0 + ms).toISOString();
let n = 0;
const mk = (type: 'session.close' | 'session.resume', at: number, phase: Op['phase'], extra: Partial<Op> = {}): Op => {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  return { op: id, message: { type, op: id, id: 'a', assertion: ASSERTION }, phase, at: iso(at), startedAt: S0, ...extra };
};
const book = (...o: Op[]) => Object.fromEntries(o.map(x => [x.op, x]));
const nova = (extra: Parameters<typeof session>[1] = {}) => session('a', { name: 'Nova', ...extra });
const E1 = iso(5_000), E2 = iso(600_000);
/** The session's first run (the fixture's `startedAt`), then the run a resume from the PC started. */
const S0 = '2026-10-14T10:00:00.000Z', S1 = iso(200_000);

describe('several closes in a row', () => {
  it('each close owns its own end; the first one’s « de force » does not follow the second', () => {
    const c1 = mk('session.close', 0, 'applied', { how: 'killed' });
    let ops = book(c1);
    expect(endingOf(nova({ state: 'exited', exitedAt: E1 }), ops, T0 + 6_000)).toMatchObject({ kind: 'ended', killed: true });
    // Resumed from the PC; closed again from the phone, by its exit command this time.
    expect(endingOf(nova({ state: 'idle', startedAt: S1 }), ops, T0 + 210_000)).toEqual({ kind: 'open', error: null });
    const c2 = mk('session.close', 300_000, 'applied', { how: 'exit', startedAt: S1 });
    ops = { ...ops, [c2.op]: c2 };
    expect(endingOf(nova({ startedAt: S1 }), ops, T0 + 301_000).kind).toBe('closing');
    const ended = nova({ state: 'exited', exitedAt: E2, startedAt: S1 });
    expect(endingOf(ended, ops, T0 + 601_000)).toEqual({ kind: 'ended', killed: false, error: null });
    expect(closedHere(ended, ops)).toBe(true);
  });

  it('a close owns the end of the run it was sent for, whatever time the PC gives it, and no end of a later run', () => {
    const c1 = mk('session.close', 0, 'applied');
    // An exitedAt before the phone's `at` (a PC behind) is still its own: only the run counts.
    expect(closedHere(nova({ state: 'exited', exitedAt: iso(-30_000) }), book(c1))).toBe(true);
    expect(closedHere(nova({ state: 'exited', exitedAt: E2, startedAt: S1 }), book(c1))).toBe(false);
  });
});

describe('a close left uncertain by a lost link', () => {
  it('the snapshot after the reconnection says the session ended: not held, ended card, and its own end once the PC replays « applied »', () => {
    const c = mk('session.close', 0, 'uncertain', { received: true, boot: 'b1' });
    const ended = nova({ state: 'exited', exitedAt: E1 });
    const ops = book(c);
    expect(closeHeld(ended, ops, 'b1', T0 + 20_000)).toBe(false);
    expect(endingOf(ended, ops, T0 + 20_000).kind).toBe('ended');
    const replayed = { ...ops, [c.op]: { ...ops[c.op]!, phase: 'applied' as const, how: 'exit' as const } };
    expect(closedHere(ended, replayed)).toBe(true);
  });

  it('is held while it may go again by itself, not once the PC restarted or five minutes passed', () => {
    const c = mk('session.close', 0, 'uncertain', { received: true, boot: 'b1' });
    expect(closeHeld(nova(), book(c), 'b1', T0 + 20_000)).toBe(true);
    expect(closeHeld(nova(), book(c), 'b2', T0 + 20_000)).toBe(false);
    expect(closeHeld(nova(), book(c), 'b1', T0 + 300_000)).toBe(false);
  });

  // The phone never saw the session end: it was closed, then resumed on the PC while the phone was offline. A resume starts
  // the agent again, which gives the session a new `startedAt` (its `exitedAt` is dropped): that is what tells it (D6, fixed by td6c54f).
  it('D6 — the PC resumed the session during the outage: the replayed « applied » does not hold the page on « Fermeture… »', () => {
    const c = mk('session.close', 0, 'applied', { how: 'exit' });
    expect(SETTLE_MS).toBeGreaterThan(31_000);
    expect(endingOf(nova({ state: 'idle', startedAt: iso(20_000) }), book(c), T0 + 31_000).kind).toBe('open');
    // The run the close was sent for: nothing says it ended, its update may still be on its way.
    expect(endingOf(nova({ state: 'idle' }), book(c), T0 + 31_000).kind).toBe('closing');
  });
});

// The PC's clock and the phone's differ: `exitedAt` and `startedAt` are the PC's, an op's `at` the phone's (tf59002 → t1665ad).
describe('a clock skew between the PC and the phone', () => {
  // D7 and D8 were defects of comparing the PC's times to the phone's (fixed by t8cba5e: only the PC's `startedAt` is compared).
  it('D7 — PC clock 2 min ahead: a session started a minute ago still reads « Fermeture… » while its close is on its way', () => {
    // PC time = phone time + 120 s. Started 60 s before the close, in the phone's time: startedAt = T0 - 60 s + 120 s = T0 + 60 s, after `at`.
    const young = nova({ startedAt: iso(60_000) });
    const c = mk('session.close', 0, 'sending', { startedAt: iso(60_000) });
    expect(endingOf(young, book(c), T0 + 1_000).kind).toBe('closing');
  });

  it('D8 — phone clock 10 s ahead: the exit this close caused is its own, and a later exit is not read as « fermée depuis le téléphone »', () => {
    const c = mk('session.close', 0, 'applied', { how: 'killed' });
    // The PC exits the agent 3 s after the close, on its own clock: that is 7 s before `at` on the phone's.
    const own = nova({ state: 'exited', exitedAt: iso(-7_000) });
    expect(closedHere(own, book(c))).toBe(true);
    expect(endingOf(own, book(c), T0 + 4_000)).toMatchObject({ kind: 'ended', killed: true });
    // Resumed from the PC, then hours later the agent quits by itself.
    const later = nova({ state: 'exited', exitedAt: iso(7_200_000), startedAt: iso(60_000) });
    expect(closedHere(later, book(c))).toBe(false);
    expect(endingOf(later, book(c), T0 + 7_200_001)).toMatchObject({ kind: 'ended', killed: false });
  });

  for (const skew of [5_000, -5_000]) {
    it(`a phone ${skew > 0 ? 'ahead of' : 'behind'} the PC by 5 s reads the whole close and a resume from the PC the same way`, () => {
      // The PC's times are the phone's minus the skew: the close goes at phone time 0, the PC ends the agent 2 s later.
      const pc = (ms: number) => iso(ms - skew);
      const c = mk('session.close', 0, 'sending', { startedAt: pc(-3_600_000) });
      const running = nova({ state: 'working', startedAt: pc(-3_600_000) });
      expect(endingOf(running, book(c), T0 + 1_000).kind).toBe('closing');
      expect(closeHeld(running, book(c), null, T0 + 1_000)).toBe(true);
      const applied = { ...c, phase: 'applied' as const, how: 'exit' as const };
      // The answer before the session's update: still closing. Then the end, its own.
      expect(endingOf(running, book(applied), T0 + 2_500).kind).toBe('closing');
      const ended = nova({ state: 'exited', exitedAt: pc(2_000), startedAt: pc(-3_600_000) });
      expect(endingOf(ended, book(applied), T0 + 3_000)).toEqual({ kind: 'ended', killed: false, error: null });
      expect(closedHere(ended, book(applied))).toBe(true);
      // Resumed from the PC a second later: open at once, and its next end is not this close's.
      const resumed = nova({ state: 'idle', startedAt: pc(3_000) });
      expect(endingOf(resumed, book(applied), T0 + 4_000)).toEqual({ kind: 'open', error: null });
      expect(closedHere(nova({ state: 'exited', exitedAt: pc(9_000), startedAt: pc(3_000) }), book(applied))).toBe(false);
    });
  }
});

// The rule is `session.startedAt !== op.startedAt` (t8cba5e): what a restart that is not a resume, or a missing value, does to it (t764b72).
describe('what the startedAt rule does at the edges', () => {
  const S2 = iso(30_000);
  it('a resume the PC could not spawn puts the old record back (same startedAt): the failure shows, not « Reprise… » nor a silent ended card', () => {
    const r = mk('session.resume', 0, 'rejected', { startedAt: S0, reason: 'busy' });
    const failed = mk('session.resume', 0, 'failed', { startedAt: S0 });
    expect(endingOf(nova({ state: 'starting', startedAt: S0 }), book(failed), T0 + 1_000).kind).toBe('open');
    expect(endingOf(nova({ state: 'exited', exitedAt: E1, startedAt: S0 }), book(failed), T0 + 2_000)).toMatchObject({ kind: 'ended', error: { retry: true } });
    expect(endingOf(nova({ state: 'exited', exitedAt: E1, startedAt: S0 }), book(r), T0 + 2_000).kind).toBe('ended');
  });

  it('a resume that starts and crashes: starting (old startedAt), then exited on the new one: the ended card with its resume', () => {
    const r = mk('session.resume', 0, 'applied', { startedAt: S0 });
    expect(endingOf(nova({ state: 'starting', startedAt: S0 }), book(r), T0 + 1_000).kind).toBe('open');
    expect(endingOf(nova({ state: 'exited', exitedAt: E1, startedAt: S2 }), book(r), T0 + 2_000)).toEqual({ kind: 'ended', killed: false, error: null });
  });

  it('an op that kept no startedAt (made before the field) never reads as restarted; a session without one, against an op with one, does', () => {
    const old = mk('session.close', 0, 'applied', { how: 'killed' });
    delete old.startedAt;
    const ended = nova({ state: 'exited', exitedAt: E1, startedAt: S2 });
    expect(closedHere(ended, book(old))).toBe(true);
    const bare = { ...ended } as { startedAt?: string };
    delete bare.startedAt;
    expect(closedHere(bare as never, book(mk('session.close', 0, 'applied')))).toBe(false);
  });

  // The Fermer button stays on a session that is `starting` (a resume under way). A close sent then keeps the interim startedAt;
  // the spawn gives the session its new one a moment later: the close reads as over, though it is the one that will end this run.
  it.fails('D9 — a close sent while the session is still « starting » (resume under way) still owns the end it causes', () => {
    const c = mk('session.close', 0, 'applied', { how: 'killed', startedAt: S0 });
    expect(endingOf(nova({ state: 'idle', startedAt: S2 }), book(c), T0 + 5_000).kind).toBe('closing');
    const ended = nova({ state: 'exited', exitedAt: E1, startedAt: S2 });
    expect(closedHere(ended, book(c))).toBe(true);
    expect(endingOf(ended, book(c), T0 + 6_000)).toMatchObject({ kind: 'ended', killed: true });
  });
});

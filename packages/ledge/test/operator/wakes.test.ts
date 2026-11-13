import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openJournal, type Journal, type JournalEvent } from '../../src/operator/journal.js';
import { createWakes } from '../../src/operator/wakes.js';

vi.mock('../../src/log.js', () => ({ log: () => {} }));

const iso = () => new Date(Date.now()).toISOString();
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

function setup(o: { chatIdle?: () => Promise<void>; run?: (events: JournalEvent[]) => Promise<void> } = {}) {
  const journal = openJournal(':memory:');
  const runs: JournalEvent[][] = [];
  const wakes = createWakes({
    journal, now: () => Date.now(),
    setTimer: (f, ms) => { const t = setTimeout(f, ms); return () => clearTimeout(t); },
    chatIdle: o.chatIdle ?? (() => Promise.resolve()),
    run: async events => { runs.push(events); await o.run?.(events); }
  });
  let n = 0;
  const rec = (urgency: JournalEvent['urgency'] = 'grouped', j: Journal = journal): JournalEvent => {
    n++;
    return j.record({ at: iso(), machine: 'm', kind: 'session.finished', subjectKind: 'session', subjectId: `s${n}`, subjectName: `S${n}`, urgency, payload: {} });
  };
  const emit = (urgency: JournalEvent['urgency'] = 'grouped') => { const e = rec(urgency); wakes.onEvent(e); return e; };
  return { journal, wakes, runs, rec, emit };
}

describe('createWakes', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('three grouped events within 60 s make one run covering all three', async () => {
    const { runs, emit, wakes } = setup();
    const a = emit(); await vi.advanceTimersByTimeAsync(20_000);
    const b = emit(); await vi.advanceTimersByTimeAsync(20_000);
    const c = emit(); await vi.advanceTimersByTimeAsync(19_000);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.map(e => e.id)).toEqual([a.id, b.id, c.id]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(runs).toHaveLength(1);
    wakes.stop();
  });

  it('an immediate event runs at once', async () => {
    const { runs, emit, wakes } = setup();
    const e = emit('immediate');
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.map(r => r.map(x => x.id))).toEqual([[e.id]]);
    wakes.stop();
  });

  it('an event during a run arms exactly one more run', async () => {
    const gate = deferred();
    let first = true;
    const { runs, emit, wakes } = setup({ run: async () => { if (first) { first = false; await gate.promise; } } });
    emit('immediate');
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(1);
    const b = emit('immediate'); const c = emit();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runs).toHaveLength(1);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    // The gap since the first run's start has passed: the second covers what came during the first.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.map(e => e.id)).toEqual([b.id, c.id]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(runs).toHaveLength(2);
    wakes.stop();
  });

  it('a grouped event during a run waits 60 s from its own time, not from the end of the run', async () => {
    const gate = deferred();
    let first = true;
    const { runs, emit, wakes } = setup({ run: async () => { if (first) { first = false; await gate.promise; } } });
    emit('immediate');
    await vi.advanceTimersByTimeAsync(0);
    emit();
    await vi.advanceTimersByTimeAsync(50_000);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runs).toHaveLength(2);
    wakes.stop();
  });

  it('start keeps 60 s after the last wake the journal holds', async () => {
    const { journal, runs, rec, wakes } = setup();
    const a = rec(); const w = journal.startWake(a.id, a.id, iso()); journal.endWake(w.id, 'posted', [], iso());
    rec('immediate');
    wakes.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toHaveLength(1);
    wakes.stop();
  });

  it('keeps 60 s between two wakes, even for an immediate event', async () => {
    const { runs, emit, wakes } = setup();
    emit('immediate');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    emit('immediate');
    await vi.advanceTimersByTimeAsync(49_000);
    expect(runs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toHaveLength(2);
    wakes.stop();
  });

  it('the 31st wake within an hour waits', async () => {
    const { journal, runs, emit, wakes } = setup();
    for (let i = 0; i < 30; i++) { const w = journal.startWake(0, 0, iso()); journal.endWake(w.id, 'empty', [], iso()); }
    emit('immediate');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(32 * 60_000);
    expect(runs).toHaveLength(1);
    wakes.stop();
  });

  it('start recovers an unfinished wake and re-covers its events', async () => {
    const { journal, runs, rec, wakes } = setup();
    const done1 = rec(); const w0 = journal.startWake(done1.id, done1.id, iso()); journal.endWake(w0.id, 'posted', ['q'], iso());
    const a = rec(); const b = rec();
    journal.startWake(a.id, b.id, iso());
    wakes.start();
    expect(journal.lastWake()!.outcome).toBe('failed');
    // The unfinished wake started just now: the 60 s gap holds after a restart too.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs.map(r => r.map(e => e.id))).toEqual([[a.id, b.id]]);
    wakes.stop();
  });

  it('a run waits for the chat to be idle', async () => {
    const idle = deferred();
    const { runs, emit, wakes } = setup({ chatIdle: () => idle.promise });
    emit('immediate');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toHaveLength(0);
    idle.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(1);
    wakes.stop();
  });

  it('stop cancels an armed wake', async () => {
    const { runs, emit, wakes } = setup();
    emit();
    wakes.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runs).toHaveLength(0);
  });
});

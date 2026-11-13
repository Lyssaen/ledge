import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openJournal, type JournalEvent } from '../../src/operator/journal.js';

const base: Omit<JournalEvent, 'id' | 'settledAt'> = {
  at: '2026-11-13T10:00:00.000Z', machine: 'm1', kind: 'session.request', subjectKind: 'session.request', subjectId: 's1',
  subjectName: 'Iris', urgency: 'immediate', payload: { a: 1 }
};

describe('journal', () => {
  it('record assigns increasing ids and since(id) returns only later events', () => {
    const j = openJournal(':memory:');
    const a = j.record(base);
    const b = j.record({ ...base, subjectId: 's2' });
    expect(b.id).toBeGreaterThan(a.id);
    expect(a.settledAt).toBeNull();
    expect(a.payload).toEqual({ a: 1 });
    expect(j.since(a.id).map((e) => e.id)).toEqual([b.id]);
    expect(j.since(0, 1).map((e) => e.id)).toEqual([a.id]);
  });

  it('settle marks every open event of the subject and returns them', () => {
    const j = openJournal(':memory:');
    const a = j.record(base);
    const b = j.record({ ...base, kind: 'session.question' });
    const other = j.record({ ...base, subjectId: 's2' });
    const settled = j.settle('session.request', 's1', '2026-11-13T10:05:00.000Z', { by: 'user' });
    expect(settled.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(settled[0]!.settledAt).toBe('2026-11-13T10:05:00.000Z');
    expect(settled[0]!.payload).toEqual({ a: 1, by: 'user' });
    expect(j.open().map((e) => e.id)).toEqual([other.id]);
    expect(j.settle('session.request', 's1', '2026-11-13T10:06:00.000Z')).toEqual([]);
  });

  it('open() excludes settled and urgency none', () => {
    const j = openJournal(':memory:');
    j.record({ ...base, urgency: 'none', subjectId: 'n' });
    const g = j.record({ ...base, urgency: 'grouped', subjectId: 'g' });
    const s = j.record({ ...base, subjectId: 'x' });
    j.settle('session.request', 'x', base.at);
    expect(j.open().map((e) => e.id)).toEqual([g.id]);
    expect(s.id).toBeGreaterThan(0);
  });

  it('setCursor never moves a cursor back', () => {
    const j = openJournal(':memory:');
    expect(j.cursor('desktop')).toBe(0);
    j.setCursor('desktop', 5, base.at);
    j.setCursor('desktop', 3, base.at);
    expect(j.cursor('desktop')).toBe(5);
    j.setCursor('desktop', 9, base.at);
    expect(j.cursor('desktop')).toBe(9);
    expect(j.cursor('device:abc')).toBe(0);
  });

  it('recover marks unfinished wakes failed and returns them', () => {
    const j = openJournal(':memory:');
    const w = j.startWake(1, 4, '2026-11-13T10:00:00.000Z');
    expect(j.lastWake()!.id).toBe(w.id);
    const ended = j.startWake(5, 6, '2026-11-13T10:01:00.000Z');
    j.endWake(ended.id, 'posted', ['q1', 'q2'], '2026-11-13T10:02:00.000Z');
    expect(j.lastWake()!.qids).toEqual(['q1', 'q2']);
    const rec = j.recover('2026-11-13T11:00:00.000Z');
    expect(rec.map((r) => r.id)).toEqual([w.id]);
    expect(rec[0]!.outcome).toBe('failed');
    expect(j.recover('2026-11-13T11:00:01.000Z')).toEqual([]);
    expect(j.lastWake()!.endedAt).not.toBeNull();
  });

  it('wakesSince counts wakes started at or after the time', () => {
    const j = openJournal(':memory:');
    j.startWake(1, 1, '2026-11-13T09:00:00.000Z');
    j.startWake(2, 2, '2026-11-13T10:30:00.000Z');
    expect(j.wakesSince('2026-11-13T10:00:00.000Z')).toBe(1);
  });

  it('prune drops events older than 30 days only', () => {
    const j = openJournal(':memory:');
    j.record({ ...base, at: '2026-10-01T00:00:00.000Z', subjectId: 'old' });
    const fresh = j.record({ ...base, at: '2026-11-01T00:00:00.000Z', subjectId: 'fresh' });
    expect(j.prune('2026-11-13T00:00:00.000Z')).toBe(1);
    expect(j.since(0).map((e) => e.id)).toEqual([fresh.id]);
  });

  it('schema is versioned and reopening the same file keeps the data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-journal-'));
    const file = join(dir, 'ledge.sqlite');
    try {
      const j = openJournal(file);
      const e = j.record(base);
      j.setCursor('desktop', e.id, base.at);
      j.close();
      const raw = new DatabaseSync(file);
      expect((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
      raw.close();
      const again = openJournal(file);
      expect(again.since(0).map((x) => x.id)).toEqual([e.id]);
      expect(again.cursor('desktop')).toBe(e.id);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

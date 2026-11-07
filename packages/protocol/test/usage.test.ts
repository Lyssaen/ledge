import { describe, it, expect } from 'vitest';
import { UsageWindowSchema, usageAlertId, parseServerMessage, PhoneServerMessageSchema } from '../src/index.js';

const R = '2026-12-01T00:00:00.000Z';
const prefs = { alert: 0.8 };
const claude = { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: R, windows: [{ kind: 'five_hour', pct: 10, resetsAt: R }] };

describe('usage windows', () => {
  it('accepts month and pool windows, refuses an unknown pool', () => {
    expect(UsageWindowSchema.safeParse({ kind: 'month', pct: 12, resetsAt: R }).success).toBe(true);
    expect(UsageWindowSchema.safeParse({ kind: 'pool', pool: 'other', pct: 56, resetsAt: R }).success).toBe(true);
    expect(UsageWindowSchema.safeParse({ kind: 'pool', pool: 'x', pct: 56, resetsAt: R }).success).toBe(false);
  });
  it('requires pool on a pool window and refuses it elsewhere', () => {
    expect(UsageWindowSchema.safeParse({ kind: 'pool', pct: 5, resetsAt: R }).success).toBe(false);
    expect(UsageWindowSchema.safeParse({ kind: 'month', pool: 'other', pct: 5, resetsAt: R }).success).toBe(false);
  });
  it('builds alert ids, unchanged for models', () => {
    expect(usageAlertId('cursor', 'a1b2c3d4e5f6', { kind: 'pool', pool: 'other', resetsAt: R }, 'full')).toBe('cursor|a1b2c3d4e5f6|pool|other|full|' + R);
    expect(usageAlertId('claude', 'a1b2c3d4e5f6', { kind: 'model', model: 'Opus', resetsAt: R }, 'threshold')).toBe('claude|a1b2c3d4e5f6|model|Opus|threshold|' + R);
  });
});

describe('usage.state tolerance', () => {
  it('drops an unknown harness and an unknown window, keeps the rest', () => {
    const raw = {
      type: 'usage.state',
      harnesses: [
        { ...claude, windows: [...claude.windows, { kind: 'day', pct: 1, resetsAt: R }] },
        { harness: 'gemini', account: null, status: 'ok', readAt: R, windows: [{ kind: 'day', pct: 1, resetsAt: R }] }
      ],
      alerts: [], prefs
    };
    const m = parseServerMessage(raw);
    expect(m.type).toBe('usage.state');
    if (m.type !== 'usage.state') return;
    expect(m.harnesses).toHaveLength(1);
    expect(m.harnesses[0]!.harness).toBe('claude');
    expect(m.harnesses[0]!.windows.map((w) => w.kind)).toEqual(['five_hour']);
  });
  it('drops a window whose pool does not match its kind, keeps the message', () => {
    const bad = [{ kind: 'pool', pct: 5, resetsAt: R }, { kind: 'month', pool: 'other', pct: 5, resetsAt: R }, { kind: 'month', pct: 5, resetsAt: R }];
    const alert = (id: string, window: unknown) => ({ id, harness: 'cursor', account: null, window, level: 'threshold', at: R });
    const m = parseServerMessage({
      type: 'usage.state', prefs,
      harnesses: [{ harness: 'cursor', account: null, status: 'ok', readAt: R, windows: bad }],
      alerts: [alert('a', bad[0]), alert('b', bad[2])]
    });
    if (m.type !== 'usage.state') throw new Error('type');
    expect(m.harnesses[0]!.windows).toEqual([bad[2]]);
    expect(m.alerts.map((a) => a.id)).toEqual(['b']);
  });
  it('drops a pool window of an unknown pool, keeps the message', () => {
    const x = { kind: 'pool', pool: 'x', pct: 5, resetsAt: R };
    const m = parseServerMessage({
      type: 'usage.state', prefs,
      harnesses: [{ harness: 'cursor', account: null, status: 'ok', readAt: R, windows: [x, { kind: 'month', pct: 5, resetsAt: R }] }],
      alerts: [{ id: 'a', harness: 'cursor', account: null, window: x, level: 'threshold', at: R }]
    });
    if (m.type !== 'usage.state') throw new Error('type');
    expect(m.harnesses[0]!.windows.map((w) => w.kind)).toEqual(['month']);
    expect(m.alerts).toEqual([]);
  });
  it('drops an alert of an unknown harness or window kind', () => {
    const ok = { id: 'x', harness: 'cursor', account: null, window: { kind: 'month', pct: 90, resetsAt: R }, level: 'threshold', at: R };
    const m = parseServerMessage({
      type: 'usage.state', harnesses: [claude], prefs,
      alerts: [ok, { ...ok, id: 'y', harness: 'gemini' }, { ...ok, id: 'z', window: { kind: 'day', pct: 90, resetsAt: R } }]
    });
    if (m.type !== 'usage.state') throw new Error('type');
    expect(m.alerts.map((a) => a.id)).toEqual(['x']);
  });
  it('applies to the phone usage.state too', () => {
    const r = PhoneServerMessageSchema.safeParse({
      type: 'usage.state', prefs,
      harnesses: [{ harness: 'gemini', status: 'ok', readAt: R, windows: [] }, { harness: 'cursor', status: 'ok', readAt: R, windows: [{ kind: 'pool', pool: 'cursor', pct: 3, resetsAt: R }, { kind: 'day', pct: 1, resetsAt: R }] }]
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'usage.state') {
      expect(r.data.harnesses).toHaveLength(1);
      expect(r.data.harnesses[0]!.windows).toHaveLength(1);
    }
  });
});

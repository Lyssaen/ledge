import { describe, it, expect } from 'vitest';
import type { OpenRigState, Rig } from '@ledge/protocol';
import { busyRemovals, canReseat, changedCounts, chips, countsOf, planOf, previewCommands, seatRows, withCount } from '../src/tui/model/rigSeats.js';
import { startTui } from './tui-fixture.js';
import { until } from './helpers.js';

const seat = (logicalId: string, o: Partial<Rig['nodes'][number]> = {}) => ({ logicalId, session: `${logicalId}@starter`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...o });
const STARTER: Rig = { id: 'id-starter', name: 'starter', status: 'running', lifecycleState: 'running', seats: 4, running: 4, attention: 0, uptime: '1h', snapshot: null,
  nodes: [seat('dev.build', { model: 'opus' }), seat('dev.review-2', { runtime: 'codex', work: 1 }), seat('dev.review', { runtime: 'codex', model: 'gpt-6-astra' }), seat('dev.build-2', { activity: 'running' })] };

describe('rig seats model', () => {
  it('a role per line, its seats in copy order, the first one’s harness', () => {
    const rows = seatRows(STARTER);
    expect(rows.map(r => [r.role, r.seats, r.first.runtime])).toEqual([['dev.build', ['dev.build', 'dev.build-2'], 'claude-code'], ['dev.review', ['dev.review', 'dev.review-2'], 'codex']]);
    expect(countsOf(rows)).toEqual({ 'dev.build': 2, 'dev.review': 2 });
    expect(canReseat(STARTER)).toBe(true);
    expect(canReseat({ ...STARTER, status: 'stopped', running: 0 })).toBe(false);
    expect(canReseat(undefined)).toBe(false);
  });
  it('3 builds and 1 review: one build added, the last review removed; only the changed roles are sent', () => {
    const rows = seatRows(STARTER);
    const counts = withCount(withCount(countsOf(rows), 'dev.build', 1), 'dev.review', -1);
    expect(changedCounts(rows, counts)).toEqual({ 'dev.build': 3, 'dev.review': 1 });
    const plan = planOf(STARTER, rows, counts);
    expect(plan).toEqual({ add: [{ role: 'dev.build', pod: 'dev', id: 'build-3', from: 'dev.build' }], remove: ['dev.review-2'] });
    expect(chips(rows[0]!, plan)).toEqual([{ id: 'dev.build', kind: 'kept' }, { id: 'dev.build-2', kind: 'kept' }, { id: 'build-3', kind: 'added' }]);
    expect(chips(rows[1]!, plan)).toEqual([{ id: 'dev.review', kind: 'kept' }, { id: 'dev.review-2', kind: 'removed' }]);
    // dev.review-2 has work assigned: its removal says so.
    expect(busyRemovals(STARTER, plan)).toEqual(['dev.review-2']);
    expect(previewCommands('starter', plan, 'liens ajoutés par paires')).toEqual(['rig add starter dev build-3', 'rig remove starter dev.review-2', 'rig edge add … (liens ajoutés par paires)', 'rig snapshot starter']);
    expect(previewCommands('starter', planOf(STARTER, rows, countsOf(rows)), 'x')).toEqual([]);
    expect(withCount(countsOf(rows), 'dev.build', 20)['dev.build']).toBe(9);
    expect(withCount(countsOf(rows), 'dev.build', -5)['dev.build']).toBe(0);
  });
});

const STATE: OpenRigState = { installed: true, version: '0.7.7', daemon: { state: 'running', port: 7433 }, kernel: { state: 'ready' }, rigs: [STARTER], at: '' };

describe('ledge tui: a rig’s seats (± on the OpenRig screen)', () => {
  it('± opens the seats, + adds one in green, - on the other role strikes the last one and says it works, ↵ applies and says what changed', async () => {
    const tui = await startTui();
    try {
      const sent: unknown[] = [];
      tui.daemon.onMessage(m => {
        if (m.type === 'openrig.status') tui.daemon.push({ type: 'openrig.state', requestId: m.requestId, state: STATE });
        if (m.type === 'openrig.seats') {
          sent.push({ rig: m.rig, seats: m.seats, delegation: m.delegation });
          tui.daemon.push({ type: 'openrig.reseated', requestId: m.requestId, ok: true, commands: [], added: ['dev.build-3'], removed: ['dev.review-2'], links: 1 });
        }
      });
      await tui.press('6'); await until(() => tui.frame().includes('starter'));
      await tui.press('±');
      await until(() => tui.frame().includes('SIÈGES · STARTER'));
      await tui.press('+');
      await until(() => tui.frame().includes('+build-3'));
      await tui.press('j'); await tui.press('-');
      await until(() => tui.frame().includes('dev.review-2 travaille'));
      const f = tui.frame();
      expect(f).toContain('rig add starter dev build-3');
      expect(f).toContain('rig remove starter dev.review-2');
      expect(f).toContain('délégation par paires');
      await tui.press('\u001b[C'); // → each added → all
      await tui.press('\r');
      await until(() => sent.length === 1);
      expect(sent[0]).toEqual({ rig: 'starter', seats: { 'dev.build': 3, 'dev.review': 1 }, delegation: 'all' });
      await until(() => tui.frame().includes('+1 −1 sièges, 1 lien'));
      expect(tui.frame()).not.toContain('SIÈGES · STARTER');
    } finally { await tui.cleanup(); }
  });
  it('an OpenRig before 0.7 says it could not link; an error keeps the window and says why; esc closes it', async () => {
    const tui = await startTui();
    try {
      let answer: 'old' | 'error' = 'error';
      tui.daemon.onMessage(m => {
        if (m.type === 'openrig.status') tui.daemon.push({ type: 'openrig.state', requestId: m.requestId, state: STATE });
        if (m.type === 'openrig.seats') tui.daemon.push(answer === 'error'
          ? { type: 'openrig.reseated', requestId: m.requestId, ok: false, commands: [], added: [], removed: [], error: 'rig_root_unknown' }
          : { type: 'openrig.reseated', requestId: m.requestId, ok: true, commands: [], added: ['dev.build-3'], removed: [], linksUnsupported: true });
      });
      await tui.press('6'); await until(() => tui.frame().includes('starter'));
      await tui.press('='); await until(() => tui.frame().includes('SIÈGES · STARTER'));
      await tui.press('+'); await tui.press('\r');
      await until(() => tui.frame().includes('les agents du rig sont introuvables'));
      expect(tui.frame()).toContain('SIÈGES · STARTER');
      answer = 'old'; await tui.press('\r');
      await until(() => tui.frame().includes('avant 0.7'));
      await tui.press('='); await until(() => tui.frame().includes('SIÈGES · STARTER'));
      await tui.press('\u001b');
      await until(() => !tui.frame().includes('SIÈGES · STARTER'));
    } finally { await tui.cleanup(); }
  });
});

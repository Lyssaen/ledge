import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessUsage, UsageStateMessage } from '@ledge/protocol';
import { until } from './helpers.js';
import { mockupSessions, startTui } from './tui-fixture.js';

// The harnesses' limits in the TUI (docs/mockups/ledge-harness-usage.html, « TUI »). LEDGE_TUI_SHOTS=<dir> also writes the
// frames, to compare with the mockup's TUI captures.
const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const monday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d.toISOString(); };
const claude = (o: Partial<HarnessUsage> = {}): HarnessUsage => ({
  harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: at(-1),
  windows: [{ kind: 'five_hour', pct: 84, resetsAt: at(65) }, { kind: 'seven_day', pct: 58, resetsAt: monday() }, { kind: 'model', model: 'Opus', pct: 100, resetsAt: monday() }, { kind: 'model', model: 'Fable', pct: 20, resetsAt: monday() }],
  ...o
});
const state = (harnesses: HarnessUsage[], alerts: UsageStateMessage['alerts'] = []): UsageStateMessage => ({ type: 'usage.state', harnesses, alerts, prefs: { alert: 0.8 } });
const alerts = (): UsageStateMessage['alerts'] => [
  { id: 'a5', harness: 'claude', account: 'a1b2c3d4e5f6', window: { kind: 'five_hour', pct: 84, resetsAt: at(65) }, level: 'threshold', at: at(0) },
  { id: 'aopus', harness: 'claude', account: 'a1b2c3d4e5f6', window: { kind: 'model', model: 'Opus', pct: 100, resetsAt: monday() }, level: 'full', at: at(-12) }
];
const shot = (name: string, frame: string) => { if (process.env.LEDGE_TUI_SHOTS) writeFileSync(`${process.env.LEDGE_TUI_SHOTS}/${name}.txt`, frame); };
// Otto as Ledge launched it: Opus 5.5, high, 46 % of its context, open 1 h 12 ago; Nova past « Contexte max ».
const sessions = () => mockupSessions().map(s => (s.id === 'otto' ? { ...s, model: 'claude-opus-5-5', effort: 'high', context: { used: 92_000, window: 200_000, at: at(0) }, startedAt: at(-72) }
  : s.name === 'Nova' ? { ...s, context: { used: 176_000, window: 200_000, at: at(0) } } : s));

describe('ledge tui: usage limits', () => {
  // Midday, whatever the hour the suite runs: a reset 65 minutes away stays today, so it reads `HH:MM` (review of 889e72f3).
  // Only the date is fixed; the timers stay real, for the daemon, the fleet and the frames.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 5, 12, 0)); });
  afterEach(() => { vi.useRealTimers(); });

  it('a foot line above the keys on every screen, the alerts in « À toi », the card and the thread say model · effort · ctx · duration', async () => {
    const tui = await startTui({ sessions: sessions() });
    try {
      await tui.resize(120, 34);
      tui.daemon.push(state([claude()], alerts()));
      await until(() => tui.frame().includes('✻'));
      const f = tui.frame();
      shot('tui-overview-120', f);
      expect(f).toMatch(/✻ 5 h █+░* 84% ↺\d\d:\d\d +Semaine █+░* 58% ↺\S+ +Opus █+ 100%/);
      expect(f).toContain('Claude Code · 5 h à 84 % · remise');
      expect(f).toContain('Claude Code · Opus semaine atteinte');
      expect(f).toMatch(/Claude Code · Opus 5\.5 élevé · ctx 46 % · 1 h 1\d/);
      expect(f).toMatch(/Nova .*◔88%/);
      // 80 columns: no gauges, « sem » without its reset.
      await tui.resize(80, 34);
      const n = tui.frame();
      shot('tui-overview-80', n);
      expect(n).toMatch(/✻ 5 h 84% ↺\d\d:\d\d +sem 58% +Opus 100%/);
      // The session's thread: its title carries them, the topic first to go at 80 columns.
      await tui.resize(120, 34);
      await tui.press('\r');
      await until(() => tui.frame().includes('ÉCRIRE'));
      shot('tui-session-120', tui.frame());
      expect(tui.frame()).toMatch(/OTTO · CÂBLER LA LISTE DES SESSIONS · CLAUDE CODE · OPUS 5\.5 ÉLEVÉ · CTX 46 % · 1 H 1\d/);
      expect(tui.frame()).toContain('✻ 5 h');
      await tui.resize(80, 34);
      shot('tui-session-80', tui.frame());
      expect(tui.frame()).toMatch(/OTTO · CLAUDE CODE · OPUS 5\.5 ÉLEVÉ · CTX 46 % · 1 H 1\d/);
    } finally { await tui.cleanup(); }
  });

  it('old, unreachable, expired and loading say so; nothing at all without limits', async () => {
    const tui = await startTui();
    try {
      await tui.resize(120, 34);
      expect(tui.frame()).not.toContain('✻');
      tui.daemon.push(state([claude({ status: 'stale', readAt: at(-12) })]));
      await until(() => /il y a 1[12] min/.test(tui.frame()));
      tui.daemon.push(state([claude({ status: 'unreachable', readAt: at(-25) })]));
      await until(() => tui.frame().includes('injoignable'));
      tui.daemon.push(state([claude({ status: 'expired', windows: [] })]));
      await until(() => tui.frame().includes('session expirée : reconnectez-vous dans Claude Code'));
      tui.daemon.push(state([claude({ status: 'loading', readAt: null, windows: [] })]));
      await until(() => tui.frame().includes('✻ lecture…'));
      // Codex: one group per machine, named (N2).
      tui.daemon.push(state([claude(), { harness: 'codex', account: null, status: 'ok', readAt: at(-2), windows: [{ kind: 'five_hour', pct: 18, resetsAt: at(170) }, { kind: 'seven_day', pct: 41, resetsAt: monday() }] }]));
      await until(() => tui.frame().includes('>_ Local'));
    } finally { await tui.cleanup(); }
  });

  it('Settings: « Alerte de limite » sent to every machine, and every window in full (M10)', async () => {
    const tui = await startTui();
    try {
      await tui.resize(80, 34);
      await tui.press('5');
      await until(() => tui.frame().includes('Contexte max'));
      expect(tui.frame()).toContain('aucune machine ne donne ses limites');
      tui.daemon.push(state([claude()]));
      await until(() => tui.frame().includes('LIMITES'));
      const f = tui.frame();
      shot('tui-settings-80', f);
      expect(f).toMatch(/Alerte de limite +◂ 80 % ▸ +au-delà : À toi prévient/);
      expect(f).toMatch(/Claude Code · Local +lu il y a \d+ (s|min)/);
      expect(f).toMatch(/Fable +██░+ +20 %/);
      await tui.press('j'); await tui.press('j'); await tui.press('j');
      await tui.press('\x1b[C');
      await until(() => tui.daemon.received.some(m => m.type === 'usage.set'));
      expect(tui.daemon.received.find(m => m.type === 'usage.set')).toEqual({ type: 'usage.set', prefs: { alert: 0.85 } });
    } finally { await tui.cleanup(); }
  });

  describe('Cursor Agent', () => {
    const DEC1 = () => new Date(2026, 11, 1, 13, 43).toISOString();
    const cursor = (o: Partial<HarnessUsage> = {}): HarnessUsage => ({
      harness: 'cursor', account: 'c1d2e3f4a5b6', status: 'ok', readAt: at(-1),
      windows: [{ kind: 'month', pct: 81, resetsAt: DEC1() }, { kind: 'pool', pool: 'cursor', pct: 41, resetsAt: DEC1() }, { kind: 'pool', pool: 'other', pct: 100, resetsAt: DEC1() }],
      ...o
    });
    const segs = async (cols: number, h: HarnessUsage[], ascii = false) => {
      const { usageSegments } = await import('../src/tui/ui/UsageLine.js');
      const { glyphsFor } = await import('../src/tui/glyphs.js');
      const { fr } = await import('../src/tui/i18n/fr.js');
      const { usageGroups } = await import('@ledge/fleet');
      const groups = usageGroups(new Map([['local', state(h)]]), () => true, Date.now());
      return usageSegments(groups, { wide: cols >= 120, threshold: 0.8, now: Date.now(), lang: 'fr', label: () => 'Local', t: fr as never, g: glyphsFor(ascii ? { LEDGE_TUI_ASCII: '1' } : {}) }).map(x => x[0]).join('');
    };
    it('foot line: ◇ Mois, % and reset at 120 columns, the pool past the threshold, nothing below', async () => {
      const w = await segs(120, [cursor()]);
      expect(w).toContain('◇ Mois');
      expect(w).toContain('81%');
      expect(w).toContain('↺1 déc.');
      expect(w).toContain('Autres');
      expect(w).toContain('100%');
      expect(w).not.toContain('Cursor');
      const n = await segs(80, [cursor()]);
      expect(n).toContain('mois 81%');
      expect(n).not.toContain('↺');
    });
    it('foot line: weekly plan, unread, expired, ASCII mark', async () => {
      expect(await segs(80, [cursor({ windows: [{ kind: 'seven_day', pct: 30, resetsAt: at(60 * 24 * 5) }] })])).toContain('sem 30%');
      expect(await segs(120, [cursor({ windows: [] })])).toContain('◇ limite non lue');
      expect(await segs(120, [cursor({ status: 'expired', windows: [] })])).toContain('session expirée : reconnectez-vous dans Cursor Agent');
      expect(await segs(80, [cursor({ status: 'expired', windows: [] })])).toContain('reconnectez-vous');
      expect(await segs(120, [cursor()], true)).toContain('<> Mois');
    });
    it('the screens: « À toi » alert lines and every window in Settings', async () => {
      const tui = await startTui({ sessions: sessions() });
      try {
        await tui.resize(200, 34);
        tui.daemon.push(state([cursor()], [
          { id: 'cm', harness: 'cursor', account: 'c1d2e3f4a5b6', window: { kind: 'month', pct: 81, resetsAt: DEC1() }, level: 'threshold', at: at(0) },
          { id: 'co', harness: 'cursor', account: 'c1d2e3f4a5b6', window: { kind: 'pool', pool: 'other', pct: 100, resetsAt: DEC1() }, level: 'full', at: at(-12) }
        ]));
        await until(() => tui.frame().includes('◇'));
        const f = tui.frame();
        expect(f).toContain('Cursor Agent · total du mois à 81 % · remise 1 déc.');
        expect(f).toContain('Cursor Agent · Autres modèles atteinte · reprend le 1 déc.');
        await tui.press('5');
        await until(() => tui.frame().includes('LIMITES'));
        const s = tui.frame();
        expect(s).toMatch(/Total · mois +█+░* +81 %/);
        expect(s).toMatch(/Cursor +█+░* +41 %/);
        expect(s).toMatch(/Autres +█+ +100 %/);
      } finally { await tui.cleanup(); }
    });

    it('in English: Month, ↺1 Dec, Others on the foot line and « resumes on 1 Dec » in « For you »', async () => {
      const tui = await startTui({ sessions: sessions(), lang: 'en' });
      try {
        await tui.resize(200, 34);
        tui.daemon.push(state([cursor()], [
          { id: 'co', harness: 'cursor', account: 'c1d2e3f4a5b6', window: { kind: 'pool', pool: 'other', pct: 100, resetsAt: DEC1() }, level: 'full', at: at(-12) }
        ]));
        await until(() => tui.frame().includes('◇'));
        const f = tui.frame();
        expect(f).toMatch(/◇ Month █+░* 81% ↺1 Dec +Others █+ 100%/);
        expect(f).toContain('Cursor Agent · Other models reached · resumes on 1 Dec');
      } finally { await tui.cleanup(); }
    });
  });
});

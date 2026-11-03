import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';
import { attachCommand } from '../src/tui/attach.js';
import { formatWho } from '../src/cli/who.js';
import { overview } from '../src/tui/model/overview.js';
import { startTui } from './tui-fixture.js';
import { until } from './helpers.js';

/** docs/mockups/ledge-openrig-omp.html, views 2 and 3: OMP seats of OpenRig in ledge tui and ledge who. */
const omp = (id: string, name: string, rig: string, role: string, extra: Partial<Session> = {}): Session =>
  fakeSession(id, { name, tool: 'omp', cwd: `/w/${rig}`, project: rig, title: `${name} · ${role}`, state: 'idle', source: 'rig', tmuxSession: `${role.replace('.', '-')}@${rig}`,
    rig: { seat: `${role.replace('.', '-')}@${rig}`, name: rig, role }, ...extra });
const OTTO = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', repo: 'ledge', repoPath: '/w/ledge', branch: 'main', topic: 'Câbler', state: 'idle' });
const IVO = omp('rig-ivo', 'Ivo', 'dev-omp', 'dev.agent', { state: 'working' });
const PIA = omp('rig-pia', 'Pia', 'dev-omp', 'review.reviewer');
const LU = fakeSession('rig-lu', { name: 'Lu', cwd: '/w/ledge', state: 'idle', source: 'rig', tmuxSession: 'pilot-lead@ledge-dev', rig: { seat: 'pilot-lead@ledge-dev', name: 'ledge-dev', role: 'pilot.lead' } });
const ANA = omp('rig-ana', 'Ana', 'split-omp', 'analysis.analyst');
const TOM = omp('rig-tom', 'Tom', 'split-omp', 'split.splitter', { state: 'exited', exitedAt: '2026-11-03T09:00:00.000Z' });
const GONE = fakeSession('rig-max', { name: 'Max', cwd: '/w/ledge', state: 'exited', source: 'rig', rig: { seat: 'dev-back@ledge-dev', name: 'ledge-dev', role: 'dev.back' } });

describe('OMP seats in the overview model', () => {
  it('a stopped OMP seat stays under its rig, after its live seats, out of its count; a stopped Claude seat leaves', () => {
    const v = overview([OTTO, ANA, TOM, LU, GONE, { ...PIA, id: 'rig-old', name: 'Old', state: 'exited', archivedAt: '2026-11-03T09:30:00.000Z' }], null);
    const split = v.tree.find(n => n.label === 'split-omp')!;
    expect(split.branches[0]!.sessions.map(s => s.name)).toEqual(['Ana', 'Tom']);
    expect([split.count, split.shown]).toEqual([1, 2]);
    const ledge = v.tree.find(n => n.label === 'ledge-dev')!;
    expect(ledge.branches[0]!.sessions.map(s => s.name)).toEqual(['Lu']);
    expect(ledge.shown).toBeUndefined();
    expect(v.order).toContain('rig-tom');
    expect(v.order).not.toContain('rig-old');
  });
});

describe('ledge tui: OMP seats in the RIGS box', () => {
  it('each seat says its role then its harness; a stopped OMP seat greyed « Arrêté », its rig « 1 session sur 2 »', async () => {
    const tui = await startTui({ sessions: [OTTO, IVO, PIA, LU, ANA, TOM], projects: { projects: [], rules: [] } });
    try {
      await tui.resize(150, 34);
      await until(() => tui.frame().includes('Tom'));
      const f = tui.frame();
      if (process.env.LEDGE_TUI_CAPTURE) writeFileSync(process.env.LEDGE_TUI_CAPTURE, f);
      const line = (name: string) => f.split('\n').find(l => new RegExp(`\\b${name}\\b`).test(l) && !l.includes('·  ')) ?? '';
      expect(line('Ivo')).toMatch(/Ivo\s+dev\.agent\s+omp\s+Au travail/);
      expect(line('Pia')).toMatch(/Pia\s+review\.reviewer\s+omp\s+Disponible/);
      expect(line('Lu')).toMatch(/Lu\s+pilot\.lead\s+claude\s+Disponible/);
      expect(line('Tom')).toMatch(/· Tom\s+split\.splitter\s+omp\s+Arrêté/);
      // The harness sits at one column in the box.
      expect(line('Ivo').indexOf('omp')).toBe(line('Lu').indexOf('claude'));
      expect(f).toMatch(/split-omp.*1 session sur 2/);
      expect(f).toMatch(/dev-omp.*2 sessions/);
    } finally { await tui.cleanup(); }
  });

  it('↵ on a running OMP seat attaches its terminal, the key bar says so; on a stopped one nothing attaches, a toast says why', async () => {
    const runs: string[][] = [];
    const tui = await startTui({ sessions: [OTTO, IVO, ANA, TOM], projects: { projects: [], rules: [] }, run: async argv => { runs.push(argv); return 0; } });
    try {
      await tui.resize(150, 34);
      // Otto, then the rigs in order: dev-omp (Ivo), split-omp (Ana, Tom).
      await tui.press('j');
      await until(() => tui.frame().includes('attacher son terminal'));
      await tui.press('\r');
      await until(() => runs.length === 1);
      expect(runs[0]).toEqual(['node', '/opt/ledge/cli.js', 'attach', 'rig-ivo']);
      await tui.press('j'); await tui.press('j');
      await until(() => !tui.frame().includes('attacher son terminal') && !tui.frame().includes('attacher (tmux)'));
      await tui.press('\r');
      await until(() => tui.frame().includes('Tom est arrêté : son terminal n’existe plus. 6 ouvre OpenRig, où est son rig.'));
      await tui.press('a');
      expect(runs).toHaveLength(1);
      // Still the overview: ↵ did not open a session screen.
      expect(tui.frame()).toContain('RIGS');
    } finally { await tui.cleanup(); }
  });

  it('in English', async () => {
    const tui = await startTui({ sessions: [OTTO, IVO, ANA, TOM], projects: { projects: [], rules: [] }, lang: 'en' });
    try {
      await tui.resize(150, 34);
      await until(() => tui.frame().includes('Tom'));
      expect(tui.frame()).toMatch(/split-omp.*1 session of 2/);
      expect(tui.frame()).toMatch(/Tom\s+split\.splitter\s+omp\s+Stopped/);
      await tui.press('j');
      await until(() => tui.frame().includes('attach its terminal'));
    } finally { await tui.cleanup(); }
  });
});

describe('attaching to an OMP seat', () => {
  it('a running one attaches as any seat; a stopped one has nothing to attach', () => {
    const fleet = { terminal: (id: string) => ['ledge', 'attach', id] };
    expect(attachCommand(fleet, IVO)).toEqual({ argv: ['ledge', 'attach', 'rig-ivo'] });
    expect(attachCommand(fleet, TOM)).toEqual({ why: 'stopped' });
  });
});

describe('ledge who with OMP seats', () => {
  it('lists the OMP seats, a stopped one as exited; other ended sessions stay out', () => {
    const out = formatWho([IVO, TOM, GONE, { ...PIA, state: 'exited', archivedAt: '2026-11-03T09:30:00.000Z' }]);
    const lines = out.split('\n');
    expect(lines[1]).toMatch(/^ {2}Ivo\s+omp\s+working\s+dev-omp\s+-\s+-$/);
    expect(lines[2]).toMatch(/^ {2}Tom\s+omp\s+exited\s+split-omp\s+-\s+-$/);
    expect(out).not.toContain('Max');
    expect(out).not.toContain('Pia');
  });
});

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { rigRole, rigTag, seatSecond } from '../src/tui/model/rigSeat.js';
import { startTui } from './tui-fixture.js';
import { until } from './helpers.js';

const rig = (role?: string) => ({ seat: `${(role ?? 'dev.x').replace('.', '-')}@first-factory`, name: 'first-factory', ...(role ? { role } : {}) });

describe('a rig seat among the sessions (model)', () => {
  it('a seat: its rig in brackets, its role before the rest; no rig: nothing changes', () => {
    expect(rigTag({ rig: rig('dev.build') })).toBe('[first-factory] ');
    expect(seatSecond({ rig: rig('dev.build') }, 'Câbler la liste')).toBe('dev.build · Câbler la liste');
    expect(seatSecond({ rig: rig('dev.build') }, '')).toBe('dev.build');
    // Before OpenRig names the role: the seat's session name.
    expect(rigRole({ rig: rig() })).toBe('dev-x@first-factory');
    expect(rigTag({})).toBe('');
    expect(seatSecond({}, 'Câbler la liste')).toBe('Câbler la liste');
  });
});

describe('ledge tui: rig seats in the overview and the session card', () => {
  it('two seats tagged [first-factory] with their role, in « À TOI » and the projects; the card says rig · role; a plain session unchanged', async () => {
    const at = (i: number) => new Date(Date.parse('2026-11-02T10:00:00.000Z') + i * 60_000).toISOString();
    const sessions = [
      fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', repo: 'ledge', repoPath: '/w/ledge', project: 'ledge', branch: 'feat/openrig', topic: 'Câbler OpenRig', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' }, rig: rig('dev.build'), startedAt: at(0) }),
      fakeSession('nova', { name: 'Nova', tool: 'codex', cwd: '/w/ledge', repo: 'ledge', repoPath: '/w/ledge', project: 'ledge', branch: 'feat/openrig', topic: 'Relire', state: 'working', rig: rig('dev.review'), startedAt: at(1) }),
      fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', repo: 'ledge', repoPath: '/w/ledge', project: 'ledge', branch: 'feat/openrig', topic: 'Supprimer la branche', state: 'idle', startedAt: at(2) })
    ];
    const tui = await startTui({ sessions });
    try {
      await tui.resize(160, 30);
      await until(() => tui.frame().includes('[first-factory]'));
      const f = tui.frame();
      if (process.env.LEDGE_TUI_CAPTURE) writeFileSync(process.env.LEDGE_TUI_CAPTURE, f);
      const line = (name: string) => f.split('\n').filter(l => l.includes(name));
      // « À TOI »: Bix waits, tagged; the RIGS box: the two seats by their role, the box saying the rig.
      expect(line('Bix')[0]).toMatch(/Bix.*\[first-factory\] dev\.build/);
      expect(line('Nova').some(l => /Nova\s+dev\.review/.test(l))).toBe(true);
      expect(line('Otto').some(l => l.includes('Supprimer la branche') && !l.includes('['))).toBe(true);
      // The selected session's card: Bix, a seat.
      expect(f).toContain('rig first-factory · dev.build');
      // Narrower: the RIGS box keeps the role (no tag to make room for), the plain session keeps its topic.
      await tui.resize(120, 30);
      const n = tui.frame().split('\n');
      expect(n.find(l => l.includes('Nova'))).toContain('dev.review');
      expect(n.find(l => l.includes('Otto'))).toContain('Supprimer la br');
    } finally { await tui.cleanup(); }
  });
});

describe('OpenRig groups in the overview', () => {
  it('rig seats leave the projects for their rig\'s group; the kernel\'s group comes last', async () => {
    const { overview } = await import('../src/tui/model/overview.js');
    const T = '2026-11-02T10:00:00.000Z';
    const s = (id: string, cwd: string, rig?: { seat: string; name: string; role: string }) => ({ id, name: id, tool: 'claude' as const, cwd, project: 'ledge', title: id, tmuxSession: null, state: 'idle' as const, helpers: [], startedAt: T, lastActivityAt: T, source: rig ? 'rig' as const : 'launcher' as const, ...(rig ? { rig } : {}) });
    const v = overview([s('otto', '/w/ledge'), s('lu', '/w/rigdev', { seat: 'operator-agent@kernel', name: 'kernel', role: 'operator.agent' }), s('bix', '/w/ledge', { seat: 'dev-build@ff', name: 'ff', role: 'dev.build' })], null);
    expect(v.tree.map(n => [n.label, n.kind ?? 'project', n.branches.flatMap(b => b.sessions.map(x => x.id))])).toEqual([
      ['ledge', 'project', ['otto']], ['ff', 'rig', ['bix']], ['Kernel', 'kernel', ['lu']]
    ]);
    expect(v.order).toEqual(['otto', 'bix', 'lu']);
  });
});

describe('the overview\'s RIGS and KERNEL boxes', () => {
  it('each group in its own bordered box under the projects', async () => {
    const { startTui, mockupSessions } = await import('./tui-fixture.js');
    const T = '2026-11-02T10:00:00.000Z';
    const seat = (id: string, name: string, tool: 'claude' | 'codex', cwd: string, rig: { seat: string; name: string; role: string }, state: 'idle' | 'working' | 'waiting_permission' = 'idle') =>
      ({ id, name, tool, cwd, project: 'x', title: name, tmuxSession: rig.seat, state, helpers: [], startedAt: T, lastActivityAt: T, source: 'rig' as const, rig, ...(state === 'waiting_permission' ? { pending: { kind: 'permission' as const, text: 'npm test', tool: 'Bash', source: 'hook' as const } } : {}) });
    const tui = await startTui({ sessions: [...mockupSessions().slice(0, 2),
      seat('b', 'Bix', 'claude', '/w/ledge', { seat: 'dev-build@first-factory', name: 'first-factory', role: 'dev.build' }, 'waiting_permission'),
      seat('n', 'Nova', 'claude', '/w/ledge', { seat: 'dev-review@first-factory', name: 'first-factory', role: 'dev.review' }, 'working'),
      seat('l', 'Lu', 'codex', '/w/rigdev', { seat: 'operator-agent@kernel', name: 'kernel', role: 'operator.agent' }),
      seat('a', 'Ada', 'claude', '/w/rigdev', { seat: 'advisor-lead@kernel', name: 'kernel', role: 'advisor.lead' }, 'working'),
      seat('s', 'Sol', 'codex', '/w/rigdev', { seat: 'queue-worker@kernel', name: 'kernel', role: 'queue.worker' })] });
    try {
      await tui.resize(130, 40);
      const f = tui.frame();
      if (process.env.LEDGE_SHOW_FRAME) (await import('node:fs')).writeFileSync(process.env.LEDGE_SHOW_FRAME, f);
      expect(f).toMatch(/╭─ RIGS ─/);
      expect(f).toMatch(/╭─ KERNEL ─/);
      expect(f).toMatch(/⬡ first-factory\s+ledge/);
      expect(f).toMatch(/Lu\s+operator\s+codex/);
      expect(f.split('\n').filter(l => l.includes('◆ Bix')).length).toBe(2); // « À TOI » and RIGS, never PROJETS
    } finally { await tui.cleanup(); }
  });
});

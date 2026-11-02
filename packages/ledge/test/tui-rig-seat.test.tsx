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
      // « À TOI »: Bix waits; the projects: the three.
      expect(line('Bix')[0]).toMatch(/Bix.*\[first-factory\] dev\.build/);
      expect(line('Nova').some(l => /\[first-factory\] dev\.review/.test(l))).toBe(true);
      expect(line('Otto').some(l => l.includes('Supprimer la branche') && !l.includes('['))).toBe(true);
      // The selected session's card: Bix, a seat.
      expect(f).toContain('rig first-factory · dev.build');
      // Narrower, the tree has no room for the role: the tag stays whole, the plain session keeps its topic.
      await tui.resize(120, 30);
      await until(() => !(tui.frame().split('\n').find(l => l.includes('Nova')) ?? '').includes('dev.review'));
      const n = tui.frame().split('\n');
      expect(n.find(l => l.includes('Nova'))).toContain('[first-factory]');
      expect(n.find(l => l.includes('Otto'))).toContain('Supprimer la br');
    } finally { await tui.cleanup(); }
  });
});

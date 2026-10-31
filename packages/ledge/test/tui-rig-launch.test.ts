import { describe, it, expect } from 'vitest';
import type { Rig, RigPlan, RigSeat } from '@ledge/protocol';
import { primaryAction, rigFormDefaults } from '@ledge/ui/launch/rigModel';
import { launchedRig, startingLines, trustSeat } from '../src/tui/model/rigLaunch.js';
import { en } from '../src/tui/i18n/en.js';
import { PROJECTS } from './tui-fixture.js';

const plan = (extra: Partial<RigPlan> = {}): RigPlan => ({
  id: 'plan-1', machine: 'local', spec: 'factory', goal: 'Reprendre après un reboot de WSL',
  where: { kind: 'project', projectId: 'ledge', repo: '/w/ledge', branch: 'feat/reboot', copy: true },
  cwd: '/w/ledge/.worktrees/rig-factory', writes: ['CLAUDE.md', '.mcp.json', '.openrig/'], command: 'rig up factory', required: false,
  seats: ['@lead', '@build', '@review-a', '@review-b', '@qa', '@design'].map(address => ({ address, runtime: 'claude-code', model: 'opus', autonomy: 'auto' })),
  ...extra
});
const seat = (name: string, state: RigSeat['state']): RigSeat => ({ ref: `${name}@reboot`, address: `@${name}`, name, runtime: 'claude-code', state });
const rig = (seats: RigSeat[], extra: Partial<Rig> = {}): Rig => ({
  id: 'reboot', name: 'reboot', machine: 'local', cwd: '/w/ledge/.worktrees/rig-factory', projectId: 'ledge', offProject: false, lifecycle: 'launching', kernel: false,
  seats, repos: [], launch: { planId: 'plan-1', goal: 'Reprendre', lead: 'lead@reboot', startedAt: '2026-10-31T10:00:00.000Z' }, ...extra
});

describe('ledge tui: launching a rig (model)', () => {
  it('a copy in .worktrees launches straight away, a real repo asks for the plan first', () => {
    const form = rigFormDefaults({ projects: PROJECTS.projects, machines: [], wanted: { project: 'ledge', spec: 'factory', goal: 'Reprendre' } });
    expect(form.place).toMatchObject({ kind: 'project', copy: true });
    expect(primaryAction(form)).toBe('launch');
    expect(primaryAction({ ...form, place: { ...form.place, copy: false } as typeof form.place })).toBe('plan');
    expect(primaryAction({ ...form, place: { kind: 'off', name: 'reboot', nameTouched: false } })).toBe('launch');
  });

  it('startingLines follows the rig as its seats come up', () => {
    // Before the daemon names the rig, OpenRig works and the rest waits.
    const before = startingLines(undefined, plan());
    expect(before.map(l => l.glyph)).toEqual(['running', 'held', 'held', 'held', 'held', 'held']);
    expect(before.map(l => l.label)).toEqual(['OpenRig', 'Copie', 'Ledge, humain du rig', 'rig up factory', 'Sièges', 'Premières tâches']);
    expect(before[1]!.detail).toBe('/w/ledge/.worktrees/rig-factory · ⎇ feat/reboot');
    expect(before[4]!.detail).toBe('0/6 prêt');

    const up = rig([seat('lead', 'working'), seat('build', 'starting'), seat('review-a', 'idle'), seat('review-b', 'starting'), seat('qa', 'ready'), seat('design', 'trust')]);
    const lines = startingLines(up, plan());
    expect(lines.slice(0, 4).map(l => l.glyph)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(lines[3]!.label).toBe('rig up reboot');
    expect(lines[3]!.detail).toBe('spec factory · 6 sièges');
    expect(lines[4]).toEqual({ glyph: 'running', label: 'Sièges', detail: '3/6 prêts · build, review-b et design démarrent…' });
    expect(lines[5]).toMatchObject({ glyph: 'held', label: 'Premières tâches' });

    const four = rig([seat('lead', 'working'), seat('build', 'idle'), seat('review-a', 'idle'), seat('review-b', 'starting'), seat('qa', 'ready'), seat('design', 'starting')]);
    const l4 = startingLines(four, plan())[4]!;
    expect(`${l4.glyph === 'running' ? '◐' : '?'} ${l4.label} ${l4.detail}`).toMatch(/^◐ Sièges 4\/6 prêts/);

    const all = rig(up.seats.map(s => ({ ...s, state: 'idle' as const })), { lifecycle: 'running', launch: { ...up.launch!, goalSentAt: '2026-10-31T10:01:00.000Z' } });
    const done = startingLines(all, plan());
    expect(done.every(l => l.glyph === 'ok')).toBe(true);
    expect(done[5]!.detail).toBe('but donné à lead@reboot');
  });

  it('names the folder for a real repository and the space off any project, in English too', () => {
    expect(startingLines(undefined, plan({ where: { kind: 'project', projectId: 'ledge', repo: '/w/ledge', branch: 'feat/x', copy: false }, cwd: '/w/ledge' }))[1])
      .toEqual({ glyph: 'held', label: 'Dossier', detail: '/w/ledge · ⎇ feat/x' });
    expect(startingLines(undefined, plan({ where: { kind: 'off-project', name: 'atlas' }, cwd: '/home/u/.openrig/workspace/atlas' }), en.rigLaunch)[1])
      .toEqual({ glyph: 'held', label: 'Space', detail: '/home/u/.openrig/workspace/atlas' });
  });

  it('finds the rig the launch made by its plan, and the seat waiting for trust', () => {
    const r = rig([seat('lead', 'working'), seat('design', 'trust')]);
    expect(launchedRig([r], 'local', 'plan-1')).toBe(r);
    expect(launchedRig([r], 'aws', 'plan-1')).toBeUndefined();
    expect(launchedRig([r], 'local', 'plan-2')).toBeUndefined();
    expect(trustSeat(r)?.name).toBe('design');
    expect(trustSeat(undefined)).toBeUndefined();
  });
});

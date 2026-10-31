import { describe, it, expect } from 'vitest';
import type { OpenRigStatus, Project, RigSpecInfo } from '@ledge/protocol';
import type { MachineState } from '@ledge/fleet';
import { launchability, missingOf, planRequired, primaryAction, providers, recommendSpec, rigFormDefaults, slugOfGoal, whereOf, withGoal, type RigForm } from '../src/launch/rigModel';

const P = { kind: 'project' as const, projectId: 'p', repo: '/r', branch: 'feat/starter', copy: true };
const F: RigForm = { goal: 'Faire un truc', spec: 'starter', machine: 'local', place: P };
const spec = (name: string): RigSpecInfo => ({ id: name, name, source: 'builtin', seats: [] });
const proj = { id: 'p', name: 'P', color: '#fff', description: '', repos: [{ machine: 'local', path: '/r' }], rigs: [] } as unknown as Project;
const mach = (id: string, status: 'open' | 'unreachable' = 'open') => ({ id, label: id, status }) as unknown as MachineState;
const st = (state: OpenRigStatus['state'], install?: string): OpenRigStatus => ({ machine: 'm', state, ...(install ? { install } : {}) });

describe('rig launch model', () => {
  it('slugOfGoal', () => {
    expect(slugOfGoal('Prototyper la reprise des rigs après un reboot de WSL')).toBe('reboot-wsl');
    expect(slugOfGoal('Prototyper la reprise … WSL')).toBe('reprise-wsl');
    expect(slugOfGoal('Éléphant')).toBe('elephant');
    expect(slugOfGoal('le la')).toBe('rig');
    expect(slugOfGoal('a'.repeat(30) + ' ' + 'b'.repeat(30)).length).toBeLessThanOrEqual(40);
  });
  it('recommendation', () => {
    const specs = [spec('starter'), spec('factory')];
    expect(recommendSpec('corriger un bug', specs)).toEqual({ spec: 'starter', why: 'bounded' });
    expect(recommendSpec('un produit dans la durée', specs)).toEqual({ spec: 'factory', why: 'long' });
    expect(recommendSpec('x'.repeat(161), specs)?.why).toBe('long');
    expect(recommendSpec('court', [spec('factory')])).toBeNull();
  });
  it('real repo → plan imposed', () => {
    expect(primaryAction({ ...F, place: { ...P, copy: false } })).toBe('plan');
    expect(planRequired({ ...F, place: { ...P, copy: false } })).toBe(true);
    expect(primaryAction(F)).toBe('launch');
  });
  it('off-project: plan optional, invalid name missing', () => {
    const off: RigForm = { ...F, place: { kind: 'off', name: 'ok', nameTouched: true } };
    expect(planRequired(off)).toBe(false);
    expect(missingOf(off)).toEqual([]);
    expect(whereOf(off)).toEqual({ kind: 'off-project', name: 'ok' });
    const bad = { ...off, place: { kind: 'off' as const, name: 'Bad Name', nameTouched: true } };
    expect(missingOf(bad)).toEqual(['name']);
    expect(whereOf(bad)).toBeNull();
  });
  it('missingOf and whereOf for projects', () => {
    expect(missingOf({ ...F, goal: ' ', spec: null })).toEqual(['goal', 'spec']);
    expect(missingOf({ ...F, place: { ...P, repo: null, branch: '-x' } })).toEqual(['repo', 'branch']);
    expect(whereOf({ ...F, place: { ...P, branch: '-x' } })).toBeNull();
    expect(whereOf(F)).toEqual({ kind: 'project', projectId: 'p', repo: '/r', branch: 'feat/starter', copy: true });
  });
  it('defaults', () => {
    const d = rigFormDefaults({ projects: [proj], machines: [mach('local')], wanted: { project: 'p', spec: 'starter' } });
    expect(d.place).toEqual({ kind: 'project', projectId: 'p', repo: '/r', branch: 'feat/starter', copy: true });
    const o = rigFormDefaults({ projects: [proj], machines: [mach('local')], wanted: { goal: 'Réparer le cache' } });
    expect(o.place).toEqual({ kind: 'off', name: 'reparer-cache', nameTouched: false });
    expect(rigFormDefaults({ projects: [], machines: [mach('local'), mach('b')], wanted: { machine: 'b' } }).machine).toBe('b');
  });
  it('the name follows the goal until touched', () => {
    const o = rigFormDefaults({ projects: [], machines: [mach('local')], wanted: {} });
    expect((withGoal(o, 'Réparer le cache').place as { name: string }).name).toBe('reparer-cache');
    const t = { ...o, place: { kind: 'off' as const, name: 'mine', nameTouched: true } };
    expect((withGoal(t, 'Réparer le cache').place as { name: string }).name).toBe('mine');
  });
  it('providers', () => {
    const s = (runtime: string) => ({ address: '@a', member: 'a', pod: 'p', runtime });
    expect(providers([...Array(5).fill(0).map(() => s('claude-code')), s('codex'), s('codex')])).toEqual([{ runtime: 'claude-code', count: 5 }, { runtime: 'codex', count: 2 }]);
  });
  it('launchability', () => {
    expect(launchability(mach('local'), st('stopped'))).toEqual({ ok: true });
    expect(launchability(mach('local'), st('starting'))).toEqual({ ok: true });
    expect(launchability(mach('b'), st('absent', 'npm i -g openrig'))).toEqual({ ok: false, why: 'absent', install: 'npm i -g openrig' });
    expect(launchability(mach('b', 'unreachable'), st('running'))).toEqual({ ok: false, why: 'offline' });
    expect(launchability(mach('b'), st('unsupported'))).toEqual({ ok: false, why: 'unsupported' });
    expect(launchability(mach('b'), st('unreachable'))).toEqual({ ok: false, why: 'unreachable' });
    expect(launchability(mach('b'), undefined)).toEqual({ ok: false, why: 'unreachable' });
  });
});

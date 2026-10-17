import { describe, expect, it } from 'vitest';
import type { Project, RepoInfo } from '@ledge/protocol';
import { machine } from './fleet-helpers';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { launchDefaults, launchMessage, missingOf, previewOf, toggleRepo, withMachine, withProject, withTool } from '../src/launch/model';

const projects: Project[] = [
  { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge/app' }, { machine: 'local', path: '/w/ledge/docs' }, { machine: 'nas', path: '/srv/ledge' }] },
  { id: 'payment', name: 'Payment', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/payment/api' }] }
];
const local = machine('local'), nas = machine('nas');
const machines = [local, nas];
// As the fleet publishes them: a machine down is not ready; one reconnecting is open but not ready until its snapshot.
const down = (m: typeof local) => ({ ...m, status: 'unreachable' as const, ready: false });
const reconnecting = (m: typeof local) => ({ ...m, ready: false });

describe('launch model', () => {
  it('defaults: the asked project, local when online, its first repo there, no harness', () => {
    expect(launchDefaults(projects, machines, { project: 'payment' })).toEqual({ tool: null, prompt: '', project: 'payment', machine: 'local', repos: ['/w/payment/api'] });
    expect(launchDefaults(projects, [down(local), nas], {}).machine).toBe('nas');
    expect(launchDefaults(projects, machines, { filter: 'ledge' }).project).toBe('ledge');
    expect(launchDefaults(projects, machines, { project: 'nope', filter: 'payment' }).project).toBe('payment');
    expect(launchDefaults(projects, machines, {}).project).toBe('ledge');
    expect(launchDefaults([], machines, {}).project).toBeNull();
    expect(launchDefaults(projects, machines.map(down), {}).machine).toBeNull();
    expect(launchDefaults(projects, [reconnecting(local), nas], {}).machine).toBe('nas');
  });
  it('the first missing field is named in order', () => {
    const f = launchDefaults(projects, machines, {});
    expect(missingOf(f, machines)).toBe('tool');
    expect(missingOf({ ...f, tool: 'codex' }, machines)).toBe('prompt');
    expect(missingOf({ ...f, tool: 'codex', prompt: 'x' }, machines.map(down))).toBe('machine');
    expect(missingOf({ ...f, tool: 'codex', prompt: 'x' }, machines.map(reconnecting))).toBe('machine');
    expect(missingOf({ ...f, tool: 'codex', prompt: 'x', repos: [] }, machines)).toBe('repos');
    expect(missingOf({ ...f, tool: 'codex', prompt: ' x ' }, machines)).toBeNull();
    expect(missingOf({ ...f, tool: 'codex', prompt: '  ' }, machines)).toBe('prompt');
  });
  it('one repository for Codex and Cursor, several for Claude', () => {
    let f = withTool({ ...launchDefaults(projects, machines, { project: 'ledge' }) }, 'claude');
    f = toggleRepo(f, '/w/ledge/docs');
    expect(f.repos).toEqual(['/w/ledge/app', '/w/ledge/docs']);
    expect(toggleRepo(f, '/w/ledge/app').repos).toEqual(['/w/ledge/docs']);
    expect(withTool(f, 'codex').repos).toEqual(['/w/ledge/app']);
    expect(toggleRepo(withTool(f, 'codex'), '/w/ledge/docs').repos).toEqual(['/w/ledge/docs']);
  });
  it('changing machine keeps only repositories there; a missing folder is never picked', () => {
    const infos = new Map<string, RepoInfo>([['/w/ledge/app', { path: '/w/ledge/app', exists: false, branch: null }]]);
    expect(withMachine(launchDefaults(projects, machines, { project: 'ledge' }), projects, 'nas').repos).toEqual(['/srv/ledge']);
    expect(launchDefaults(projects, machines, { project: 'ledge' }, infos).repos).toEqual(['/w/ledge/docs']);
    expect(withProject(launchDefaults(projects, machines, { project: 'ledge' }), projects, 'payment').repos).toEqual(['/w/payment/api']);
  });
  it('the preview: the free name on that machine, the next seat at the table', () => {
    const sessions = [
      fakeSession('local:otto', { name: 'Otto', cwd: '/w/ledge/app' }),
      fakeSession('local:pim', { name: 'Pim', cwd: '/w/ledge/app', state: 'exited' }),
      fakeSession('nas:nova', { name: 'Nova', cwd: '/srv/ledge' }),
      fakeSession('local:zoe', { name: 'Zoe', cwd: '/w/payment/api' })
    ];
    const idOf = (s: { cwd: string }) => (s.cwd.includes('ledge') ? 'ledge' : s.cwd.includes('payment') ? 'payment' : null);
    const f = launchDefaults(projects, machines, { project: 'ledge' });
    expect(previewOf(f, sessions, idOf)).toEqual({ name: 'Pim', seat: 4 });
    expect(previewOf({ ...f, machine: 'nas' }, sessions, idOf)).toEqual({ name: 'Otto', seat: 4 });
    expect(previewOf({ ...f, project: 'payment' }, sessions, idOf)).toEqual({ name: 'Pim', seat: 2 });
  });
  it('the message: first repo as cwd, the others as dirs for Claude only, the prompt trimmed', () => {
    expect(launchMessage({ tool: 'claude', prompt: ' Relis ', project: 'ledge', machine: 'local', repos: ['/w/ledge/app', '/w/ledge/docs'] }, 'Pim'))
      .toEqual({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge/app', dirs: ['/w/ledge/docs'], name: 'Pim', prompt: 'Relis', machineId: 'local' });
    expect(launchMessage({ tool: 'codex', prompt: 'x', project: 'ledge', machine: 'local', repos: ['/w/ledge/app', '/w/ledge/docs'] }, 'Pim')).not.toHaveProperty('dirs');
    expect(launchMessage({ tool: 'claude', prompt: 'x', project: 'ledge', machine: 'local', repos: ['/w/ledge/app'] }, 'Pim')).not.toHaveProperty('dirs');
  });
});

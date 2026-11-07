import { beforeEach, describe, expect, it } from 'vitest';
import type { MachineState } from '@ledge/fleet';
import { fr } from '../src/i18n/fr';
import { defaultShell, loadLastShell, saveLastShell, shellLaunch, shellMenu, type ShellsAvailable } from '../src/term/shells';
import { shellsAvailable } from '../src/tauri/bridge';

const machine = (o: Partial<MachineState>) => ({ id: 'local', label: 'Local', status: 'open', ready: true, recents: [], sessions: [], launcher: ['node', '/ledge.js'], ...o }) as MachineState;
const local = machine({});
const srv = machine({ id: 'srv', label: 'srv-build', ssh: 'srv', launcher: ['node'] });
const all: ShellsAvailable = { wsl: 'Ubuntu', powershell: true, cmd: true, gitBash: true };

describe('shellMenu', () => {
  it('lists everything in order, in the right sections', () => {
    const rows = shellMenu(all, [local, srv], 'wsl', fr);
    expect(rows.map(r => r.label)).toEqual(['WSL · Ubuntu', 'PowerShell', 'Invite de commandes', 'Git Bash', 'Ledge', 'SSH · srv-build']);
    expect(rows.map(r => r.section)).toEqual(['local', 'local', 'local', 'local', 'ledge', 'machines']);
    expect(rows.find(r => r.kind === 'ssh:srv')?.hint).toBe('srv');
    expect(rows.find(r => r.kind === 'ledge')?.hint).toBe('ledge, rig');
  });
  it('marks only the last one as default', () => {
    const rows = shellMenu(all, [local, srv], 'gitbash', fr);
    expect(rows.filter(r => r.isDefault).map(r => r.kind)).toEqual(['gitbash']);
    expect(rows.find(r => r.kind === 'gitbash')?.hint).toBe('par défaut');
  });
  it('drops what is missing and falls back to WSL', () => {
    const rows = shellMenu({ ...all, gitBash: false }, [local], 'gitbash', fr);
    expect(rows.some(r => r.kind === 'gitbash')).toBe(false);
    expect(defaultShell(rows, 'gitbash')).toBe('wsl');
    expect(defaultShell(rows, 'cmd')).toBe('cmd');
    expect(defaultShell(shellMenu({ ...all, wsl: null }, [local], 'wsl', fr), 'wsl')).toBe('powershell');
  });
  it('no local launcher: no Ledge row; no SSH machine: no machines section; WSL without a distro name is plain', () => {
    const rows = shellMenu({ ...all, wsl: '' }, [machine({ launcher: null })], 'wsl', fr);
    expect(rows.some(r => r.kind === 'ledge')).toBe(false);
    expect(rows.some(r => r.section === 'machines')).toBe(false);
    expect(rows[0]?.label).toBe('WSL');
  });
});

describe('shellLaunch', () => {
  it('native shells', () => expect(shellLaunch('powershell', { dir: '', machines: [] })).toEqual({ native: 'powershell' }));
  it('unknown machine', () => expect(shellLaunch('ssh:inconnue', { dir: '', machines: [local, srv] })).toBeNull());
  it('wsl starts in the folder', () => {
    const r = shellLaunch('wsl', { dir: '/home/u/w', machines: [local] }) as { argv: string[] };
    expect(r.argv.slice(0, 2)).toEqual(['sh', '-c']);
    expect(r.argv[2]).toContain("cd '/home/u/w'");
  });
  it('an empty folder means home; a quote in it means no shell', () => {
    expect((shellLaunch('wsl', { dir: '', machines: [local] }) as { argv: string[] }).argv[2]).toContain("cd '~'");
    expect(shellLaunch('wsl', { dir: 'a"b', machines: [local] })).toBeNull();
  });
  it('ssh never launches for the local machine or an empty id', () => {
    const lo = machine({ ssh: 'me' });
    expect(shellLaunch('ssh:local', { dir: '', machines: [lo] })).toBeNull();
    expect(shellLaunch('ssh:', { dir: '', machines: [machine({ id: '', ssh: 'x' })] })).toBeNull();
  });
  it('ssh runs over the machine alias', () => {
    const r = shellLaunch('ssh:srv', { dir: '', machines: [local, srv] }) as { argv: string[] };
    expect(r.argv.slice(0, 2)).toEqual(['ssh', '-t']);
    expect(r.argv).toContain('srv');
  });
  it('ledge', () => expect((shellLaunch('ledge', { dir: '', machines: [local] }) as { argv: string[] }).argv[2]).toContain('ledge who'));
});

describe('last shell and availability', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips, defaults to wsl on garbage', () => {
    expect(loadLastShell()).toBe('wsl');
    saveLastShell('ssh:srv'); expect(loadLastShell()).toBe('ssh:srv');
    localStorage.setItem('ledge.ide.lastShell', 'nope'); expect(loadLastShell()).toBe('wsl');
  });
  it('outside Tauri: nothing, or the e2e stand-in', async () => {
    expect(await shellsAvailable()).toEqual({ wsl: null, powershell: false, cmd: false, gitBash: false });
    (window as unknown as { __ledgeShells?: ShellsAvailable }).__ledgeShells = all;
    expect(await shellsAvailable()).toEqual(all);
    delete (window as unknown as { __ledgeShells?: ShellsAvailable }).__ledgeShells;
  });
});

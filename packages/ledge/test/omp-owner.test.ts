import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reapOwner, writeOwner } from '../src/daemon/omp/owner.js';

const kids: ChildProcess[] = [];
afterEach(() => { for (const k of kids.splice(0)) k.kill('SIGKILL'); });
const sleeper = (args: string[]) => { const k = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', ...args], { stdio: 'ignore' }); kids.push(k); return k; };
const gone = (k: ChildProcess) => new Promise<boolean>(res => { if (k.exitCode !== null || k.signalCode !== null) return res(true); k.once('exit', () => res(true)); setTimeout(() => res(false), 4000); });
const dirWith = async (pid: number) => { const d = mkdtempSync(join(tmpdir(), 'ledge-owner-')); await writeOwner(d, pid); return d; };

describe('reapOwner: one writer per conversation', () => {
  it('ends an OMP a previous daemon left running in this session directory', async () => {
    const d = mkdtempSync(join(tmpdir(), 'ledge-owner-'));
    const k = sleeper(['--session-dir', d]); await writeOwner(d, k.pid);
    expect(await reapOwner(d, { graceMs: 1000 })).toBe(true);
    expect(await gone(k)).toBe(true);
  });
  it('never touches a process that is not an OMP of this directory (a reused pid), nor a missing or dead owner', async () => {
    const other = sleeper(['--session-dir', '/somewhere/else']);
    expect(await reapOwner(await dirWith(other.pid!))).toBe(false);
    expect(other.exitCode).toBeNull(); expect(other.signalCode).toBeNull();
    const plain = sleeper([]);
    expect(await reapOwner(await dirWith(plain.pid!))).toBe(false);
    expect(plain.signalCode).toBeNull();
    expect(await reapOwner(mkdtempSync(join(tmpdir(), 'ledge-owner-')))).toBe(false);
    const bad = mkdtempSync(join(tmpdir(), 'ledge-owner-')); writeFileSync(join(bad, 'owner.json'), '{oops');
    expect(await reapOwner(bad)).toBe(false);
    const dead = sleeper(['--session-dir', 'x']); dead.kill('SIGKILL'); await gone(dead);
    expect(await reapOwner(await dirWith(dead.pid!))).toBe(false);
  });
  it('escalates to SIGKILL when the process ignores SIGTERM', async () => {
    const d = mkdtempSync(join(tmpdir(), 'ledge-owner-'));
    const k = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", '--', '--session-dir', d], { stdio: 'ignore' }); kids.push(k);
    await new Promise(r => setTimeout(r, 300));
    await writeOwner(d, k.pid);
    expect(await reapOwner(d, { graceMs: 300 })).toBe(true);
    expect(await gone(k)).toBe(true);
  });
});

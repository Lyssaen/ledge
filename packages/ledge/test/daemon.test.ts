import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startDaemon } from '../src/daemon/index.js';
import { realTmux, type Tmux } from '../src/tmux.js';
import { killTestServer } from './helpers.js';
import { connect } from '../src/client.js';
import { ensureLedgeDir, paths } from '../src/paths.js';
import { History } from '../src/daemon/history.js';

const noTmux: Tmux = {
  async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return null; }, async hasSession() { return false; },
  async listSessions() { return []; }, async setOption() {}, async killSession() {}, attachArgs: n => ['attach', n]
};

const T0 = '2026-10-09T18:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: `ledge-${id}`,
  state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

describe('startDaemon', () => {
  it('restores live sessions, drops dead ones, keeps hook-only ones and serves a snapshot', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
    const socket = `ledge-test-${process.pid}-${Date.now()}`;
    const tmux = realTmux(socket, { scope: async () => false });
    await ensureLedgeDir();
    await tmux.newSession({ name: 'ledge-live', cwd: '/tmp', env: {}, command: ['sleep', '60'] });
    try {
      const seed = new Store();
      seed.upsert(mk('live')); seed.upsert(mk('dead')); seed.upsert(mk('hook', { tmuxSession: null, source: 'hook_only' }));
      await seed.save();

      const d1 = await startDaemon({ port: 0, tmux });
      await d1.stop();
      const d2 = await startDaemon({ port: 0, tmux });
      try {
        const c = await connect({ port: d2.port });
        const snap = (await c.next('snapshot')).sessions;
        c.close();
        expect(snap.map(s => s.id).sort()).toEqual(['hook', 'live']);
      } finally { await d2.stop(); }
    } finally { await killTestServer(socket); }
  });

  it('removes the history journals of the sessions it prunes at startup, and keeps the others', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
    await ensureLedgeDir();
    const seed = new Store();
    seed.upsert(mk('live', { tmuxSession: 'ledge-live' })); seed.upsert(mk('dead'));
    await seed.save();
    const dir = paths().history; mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ kind: 'prompt', id: 'prompt-1', at: T0, turn: 1, text: 'x' }) + '\n';
    for (const id of ['live', 'dead', 'orphan']) writeFileSync(join(dir, `${id}.jsonl`), line);
    const tmux: Tmux = {
      async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
      async hasSession(n) { return n === 'ledge-live'; }, async listSessions() { return ['ledge-live']; },
      async killSession() {}, async setOption() {}, attachArgs: n => ['attach', n]
    };
    const d = await startDaemon({ port: 0, tmux });
    await d.stop(); // flushes the history writes
    expect(['live', 'dead', 'orphan'].filter(id => existsSync(join(dir, `${id}.jsonl`)))).toEqual(['live']);
  });
});

describe('startDaemon: the history prune', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const home = () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
    const dir = join(process.env.LEDGE_HOME, 'history');
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    return dir;
  };
  const logText = () => readFileSync(join(process.env.LEDGE_HOME!, 'daemon.log'), 'utf8');

  it('a thread that cannot be read never keeps the daemon from starting; the folder is closed to its owner', async () => {
    const dir = home();
    // A folder named like a journal: read as nothing, never removed.
    mkdirSync(join(dir, 'gone.jsonl')); writeFileSync(join(dir, 'gone.jsonl', 'x'), '');
    writeFileSync(join(dir, 'old.jsonl'), '');
    const d = await startDaemon({ port: 0, tmux: noTmux });
    await d.stop();
    expect([existsSync(join(dir, 'gone.jsonl', 'x')), existsSync(join(dir, 'old.jsonl'))]).toEqual([true, false]);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('a history that fails to load never rejects startDaemon', async () => {
    home();
    vi.spyOn(History.prototype, 'load').mockRejectedValue(new Error('EACCES: permission denied'));
    const d = await startDaemon({ port: 0, tmux: noTmux });
    await d.stop();
    expect(logText()).toContain('history not loaded: EACCES: permission denied');
  });

  it('a journal that could not be read prunes nothing', async () => {
    const dir = home();
    writeFileSync(join(process.env.LEDGE_HOME!, 'sessions.json'), '{ not json');
    writeFileSync(join(dir, 'a.jsonl'), '');
    const d = await startDaemon({ port: 0, tmux: noTmux });
    await d.stop();
    expect(existsSync(join(dir, 'a.jsonl'))).toBe(true);
    expect(logText()).toContain('history prune skipped');
  });
});

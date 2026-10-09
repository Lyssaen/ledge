import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startDaemon } from '../src/daemon/index.js';
import { realTmux, run } from '../src/tmux.js';
import { connect } from '../src/client.js';
import { ensureLedgeDir } from '../src/paths.js';

const T0 = '2026-10-09T18:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: `ledge-${id}`,
  state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

describe('startDaemon', () => {
  it('restores live sessions, drops dead ones, keeps hook-only ones and serves a snapshot', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
    const socket = `ledge-test-${process.pid}-${Date.now()}`;
    const tmux = realTmux(socket);
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
    } finally { await run(['-L', socket, 'kill-server']); }
  });
});

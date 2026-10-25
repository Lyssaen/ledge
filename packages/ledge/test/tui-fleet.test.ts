import { describe, it, expect } from 'vitest';
import type { Session } from '@ledge/protocol';
import type { ServerMessage } from '@ledge/protocol';
import { startDaemon } from '../src/daemon/index.js';
import { Store } from '../src/daemon/store.js';
import { ensureLedgeDir } from '../src/paths.js';
import type { Tmux } from '../src/tmux.js';
import { createTuiFleet } from '../src/tui/fleet.js';
import { until } from './helpers.js';

const T0 = '2026-10-09T18:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: null,
  state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'hook_only', ...extra
});

describe('createTuiFleet', () => {
  it('opens the local daemon with its token and receives its snapshot', async () => {
    await ensureLedgeDir();
    const seed = new Store(); seed.upsert(mk('s1', { source: 'launcher', state: 'exited', exitCode: 0, exitedAt: T0 })); await seed.save();
    const tmux = { async listSessions() { return []; } } as unknown as Tmux;
    const d = await startDaemon({ port: 0, tmux });
    const client = createTuiFleet({ port: d.port, minBackoffMs: 50, maxBackoffMs: 100 });
    const seen: ServerMessage[] = [];
    client.onMessage(m => seen.push(m));
    try {
      client.connect();
      await until(() => seen.some(m => m.type === 'snapshot' && m.sessions.length > 0));
      const snap = seen.findLast(m => m.type === 'snapshot') as Extract<ServerMessage, { type: 'snapshot' }>;
      await until(() => client.status() === 'open');
      // The fleet qualifies ids with the machine.
      expect(snap.sessions.map(s => s.id)).toEqual(['local:s1']);
    } finally { client.close(); await d.stop(); }
  });
});

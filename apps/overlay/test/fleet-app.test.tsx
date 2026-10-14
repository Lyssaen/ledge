// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMockDaemon } from './mockDaemon';
import { createFleetClient } from '../src/daemon/fleet';
import { loadMachines } from '../src/daemon/machines';
import { createDaemonClient } from '../src/daemon/client';
import { fleetOptions } from '../src/surface/fleetOptions';

const until = (p: () => boolean, ms = 4000) => new Promise<void>((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (p()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')); } }, 25); });

describe('the island and the daemon machines list', () => {
  let d: Awaited<ReturnType<typeof createMockDaemon>>;
  beforeEach(async () => { localStorage.clear(); d = await createMockDaemon(); });
  afterEach(() => d.close());
  it('migrates its local list once the daemon speaks, then follows the daemon', async () => {
    localStorage.setItem('ledge.machines', JSON.stringify([{ id: 'local', label: 'Local', url: 'ws://127.0.0.1:47831' }, { id: 'dev', label: 'Devbox', ssh: 'dev-server' }]));
    const api = createFleetClient(loadMachines(), () => createDaemonClient({ url: d.url, WebSocketImpl: WebSocket as never }), fleetOptions);
    api.connect();
    await until(() => d.clientCount === 1);
    d.machines([{ id: 'local', label: 'Local' }]);
    await until(() => d.received.some(m => m.type === 'machines.set'));
    expect(d.received.find(m => m.type === 'machines.set')).toEqual({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Devbox', ssh: 'dev-server' }] });
    expect(localStorage.getItem('ledge.machines')).not.toBeNull(); // kept until the daemon confirms
    expect(api.fleet!.machinesSource()).toBe('daemon');
    d.machines([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Devbox', ssh: 'dev-server' }]);
    await until(() => localStorage.getItem('ledge.machines') === null);
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local', 'dev']);
    api.close();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { daemonStore } from '../src/daemon/store';

describe('daemon store: update state', () => {
  beforeEach(() => daemonStore.reset());
  it('keeps the daemon info of each snapshot and counts snapshots', () => {
    daemonStore.apply({ type: 'snapshot', sessions: [], daemon: { version: '0.2.2', install: 'npm', systemd: true } });
    expect(daemonStore.getState().daemon).toMatchObject({ version: '0.2.2' });
    daemonStore.apply({ type: 'snapshot', sessions: [] });
    const s = daemonStore.getState();
    expect(s.snapshotSeq).toBe(2);
    expect(s.daemon).toBeNull();
  });
  it('keeps the last update message with a sequence number', () => {
    daemonStore.apply({ type: 'update.progress', version: '0.3.0', step: 'installing' });
    daemonStore.apply({ type: 'update.progress', version: '0.3.0', step: 'installing' });
    expect(daemonStore.getState().lastUpdate).toMatchObject({ seq: 2, msg: { step: 'installing' } });
  });
});

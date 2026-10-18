import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { readPeers, peerFor } from '../src/daemon/peers.js';

const ID = 'de4ebbac-117e-4827-9eba-e0db4bb23687';
const sock = '/run/user/1000/cc-socks/304399.sock';
const file = { pid: 304399, sessionId: ID, name: 'harness-assistant-bf', messagingSocketPath: sock, status: 'idle' };
const fake = (o: Partial<Session>) => ({ id: 's1', ...o }) as Session;

describe('peers: which Ledge session a Claude peer is', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledge-peers-'));
    writeFileSync(join(dir, '304399.json'), JSON.stringify(file));
    writeFileSync(join(dir, '304399.abc.key'), 'secret');
    writeFileSync(join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: 'other', name: 'other', messagingSocketPath: '/x/1.sock' }));
  });

  it('resolves a name, a name with its ref, and an address to the Ledge session', () => {
    const peers = readPeers(dir);
    const s = fake({ agentSessionId: ID });
    for (const t of ['harness-assistant-bf', 'harness-assistant-bf [7e2ea7]', `uds:${sock}`]) expect(peerFor(t, peers, [fake({ id: 'x', agentSessionId: 'nope' }), s])).toBe(s);
  });
  it('falls back to the transcript path', () => {
    const s = fake({ transcriptPath: `/x/${ID}.jsonl` });
    expect(peerFor('harness-assistant-bf', readPeers(dir), [s])).toBe(s);
  });
  it('an address without a name match reads <pid>.json directly', () => {
    const s = fake({ agentSessionId: ID });
    expect(peerFor(`uds:/elsewhere/cc-socks/304399.sock`, [], [s], dir)).toBe(s);
  });
  it('an unknown name, a broken file, a missing directory: no peer, no throw', () => {
    writeFileSync(join(dir, '2.json'), '{nope');
    writeFileSync(join(dir, '3.json'), '{"pid":3}');
    expect(readPeers(dir).map(p => p.pid).sort()).toEqual([1, 304399]);
    expect(peerFor('ghost', readPeers(dir), [fake({ agentSessionId: ID })])).toBeUndefined();
    expect(readPeers(join(dir, 'missing'))).toEqual([]);
  });
  it('two files with the same name: the live one wins whatever the directory order', () => {
    writeFileSync(join(dir, '100.json'), JSON.stringify({ ...file, pid: 100, sessionId: 'stale-id', messagingSocketPath: '/x/100.sock' }));
    const s = fake({ agentSessionId: ID });
    const peers = readPeers(dir);
    expect(peers.filter(p => p.name === 'harness-assistant-bf').length).toBe(2);
    expect(peerFor('harness-assistant-bf', peers, [s])).toBe(s);
    expect(peerFor('harness-assistant-bf', [...peers].reverse(), [s])).toBe(s);
  });
  it('strips a ref from an address, and a non-numeric pid address gives nothing', () => {
    const s = fake({ agentSessionId: ID });
    expect(peerFor(`uds:${sock} [7e2ea7]`, readPeers(dir), [s])).toBe(s);
    expect(peerFor('uds:/x/abc.sock', [], [s], dir)).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { readPeers, peerFor, ledgePeer, bareName, addressOf, pidAlive, resolveTarget } from '../src/daemon/peers.js';

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
    const peers = readPeers(dir, () => true);
    const s = fake({ agentSessionId: ID });
    for (const t of ['harness-assistant-bf', 'harness-assistant-bf [7e2ea7]', `uds:${sock}`]) expect(peerFor(t, peers, [fake({ id: 'x', agentSessionId: 'nope' }), s])).toBe(s);
  });
  it('falls back to the transcript path', () => {
    const s = fake({ transcriptPath: `/x/${ID}.jsonl` });
    expect(peerFor('harness-assistant-bf', readPeers(dir, () => true), [s])).toBe(s);
  });
  it('an address without a name match reads <pid>.json directly', () => {
    const s = fake({ agentSessionId: ID });
    expect(peerFor(`uds:/elsewhere/cc-socks/304399.sock`, [], [s], dir, () => true)).toBe(s);
    expect(peerFor(`uds:/elsewhere/cc-socks/304399.sock`, [], [s], dir, () => false)).toBeUndefined();
  });
  it('an unknown name, a broken file, a missing directory: no peer, no throw', () => {
    writeFileSync(join(dir, '2.json'), '{nope');
    writeFileSync(join(dir, '3.json'), '{"pid":3}');
    expect(readPeers(dir, () => true).map(p => p.pid).sort()).toEqual([1, 304399]);
    expect(peerFor('ghost', readPeers(dir, () => true), [fake({ agentSessionId: ID })])).toBeUndefined();
    expect(readPeers(join(dir, 'missing'))).toEqual([]);
  });
  it('two files with the same name: the live one wins whatever the directory order', () => {
    writeFileSync(join(dir, '100.json'), JSON.stringify({ ...file, pid: 100, sessionId: 'stale-id', messagingSocketPath: '/x/100.sock' }));
    const s = fake({ agentSessionId: ID });
    const peers = readPeers(dir, () => true);
    expect(peers.filter(p => p.name === 'harness-assistant-bf').length).toBe(2);
    expect(peerFor('harness-assistant-bf', peers, [s])).toBe(s);
    expect(peerFor('harness-assistant-bf', [...peers].reverse(), [s])).toBe(s);
  });
  it('skips the file of a dead process', () => {
    writeFileSync(join(dir, '42.json'), JSON.stringify({ ...file, pid: 42, messagingSocketPath: '/x/42.sock' }));
    expect(readPeers(dir, pid => pid !== 42).map(p => p.pid).sort()).toEqual([1, 304399]);
  });
  it('the address of a session: its live peer, by session id, else by transcript', () => {
    const peers = readPeers(dir, () => true);
    expect(addressOf({ agentSessionId: ID }, peers)).toBe(`uds:${sock}`);
    expect(addressOf({ transcriptPath: `/p/${ID}.jsonl` }, peers)).toBe(`uds:${sock}`);
    expect(addressOf({ agentSessionId: 'old', transcriptPath: `/p/${ID}.jsonl` }, peers)).toBe(`uds:${sock}`);
    expect(addressOf({ agentSessionId: ID }, readPeers(dir, pid => pid !== 304399))).toBeUndefined();
    expect(addressOf({}, peers)).toBeUndefined();
  });
  it('pidAlive: this process is alive, a free pid is not', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 22 + 1)).toBe(false);
  });
  it('strips a ref from an address, and a non-numeric pid address gives nothing', () => {
    const s = fake({ agentSessionId: ID });
    expect(peerFor(`uds:${sock} [7e2ea7]`, readPeers(dir, () => true), [s])).toBe(s);
    expect(peerFor('uds:/x/abc.sock', [], [s], dir)).toBeUndefined();
  });
});

describe('ledgePeer: a peer by its Ledge name', () => {
  it('peerFor first, else the live session of that name, never an exited one', () => {
    const viaPeer = fake({ id: 'p', agentSessionId: ID });
    const peers = [{ pid: 1, sessionId: ID, name: 'Nova', address: 'uds:/x/1.sock' }];
    expect(ledgePeer('Nova', peers, [viaPeer, fake({ id: 'n', name: 'Nova', state: 'idle' })])).toBe(viaPeer);
    const codex = fake({ id: 'c', name: 'Pim', state: 'idle' });
    expect(ledgePeer('Pim [ab12]', [], [codex])).toBe(codex);
    expect(ledgePeer('Pim', [], [fake({ id: 'c', name: 'Pim', state: 'exited' })])).toBeUndefined();
    expect(ledgePeer('Ghost', [], [codex])).toBeUndefined();
  });
});

describe('bareName', () => {
  it('drops a trailing ` [ref]` only', () => {
    expect(bareName('Pim [ab12]')).toBe('Pim');
    expect(bareName('Pim')).toBe('Pim');
    expect(bareName('a [b] c')).toBe('a [b] c');
    expect(bareName('uds:/x/1.sock [7e2ea7]')).toBe('uds:/x/1.sock');
  });
});

describe('resolveTarget', () => {
  const pim = fake({ id: 'p', name: 'Pim', tool: 'claude', source: 'launcher', state: 'idle', agentSessionId: ID });
  const nova = fake({ id: 'n', name: 'Nova', tool: 'codex', source: 'launcher', state: 'idle' });
  const bix = fake({ id: 'b', name: 'Bix', tool: 'claude', source: 'hook_only', state: 'idle', agentSessionId: 'bix-id' });
  const peer = { pid: 1, sessionId: ID, name: 'ledge-88', address: `uds:${sock}` };
  const native = { outcome: 'native', target: pim, address: `uds:${sock}` };

  it('a Ledge name, with its ref, an address and a Claude name all reach the native address', () => {
    for (const t of ['Pim', 'Pim [ab12]', `uds:${sock}`, 'ledge-88']) expect(resolveTarget(t, [pim, nova], [peer])).toEqual(native);
  });
  it('a Ledge name wins over a Claude peer of the same name belonging to another session', () => {
    const other = fake({ id: 'o', name: 'Zed', tool: 'claude', source: 'launcher', state: 'idle', agentSessionId: 'z' });
    const zpeer = { pid: 2, sessionId: 'z', name: 'Pim', address: 'uds:/x/2.sock' };
    expect(resolveTarget('Pim', [pim, other], [peer, zpeer])).toEqual(native);
  });
  it('two Claude peers of one name are refused', () => {
    expect(resolveTarget('ledge-88', [pim], [peer, { ...peer, pid: 2 }])).toEqual({ outcome: 'refused', reason: "plusieurs sessions s'appellent ledge-88" });
  });
  it('a non-Claude session is delivered by the mailbox', () => {
    expect(resolveTarget('Nova', [pim, nova], [peer])).toEqual({ outcome: 'ledge', target: nova });
  });
  it('a hook_only Claude is refused', () => {
    expect(resolveTarget('Bix', [bix], [])).toEqual({ outcome: 'refused', reason: "Bix n'a pas été lancée par Ledge : impossible de lui écrire" });
  });
  it('a launched Claude without a live peer is refused', () => {
    expect(resolveTarget('Pim', [pim], [])).toEqual({ outcome: 'refused', reason: "Pim n'est pas joignable" });
  });
  it('an exited or archived session, an unknown name: not ours', () => {
    expect(resolveTarget('Pim', [{ ...pim, state: 'exited' }], [])).toEqual({ outcome: 'unknown' });
    expect(resolveTarget('Pim', [{ ...pim, archivedAt: '2026-01-01T00:00:00Z' } as Session], [])).toEqual({ outcome: 'unknown' });
    expect(resolveTarget('ghost', [pim], [peer])).toEqual({ outcome: 'unknown' });
  });
});

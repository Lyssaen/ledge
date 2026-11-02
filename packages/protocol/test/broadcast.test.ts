import { describe, it, expect } from 'vitest';
import { parseBroadcastAddress, broadcastLabel, broadcastRecipient, BROADCAST_LABEL_MAX, DaemonInfoSchema, BROADCAST_LIST_MAX, BROADCAST_SESSIONS_MAX, ClientMessageSchema, ServerMessageSchema, PhoneClientMessageSchema, PhoneServerMessageSchema, MESSAGE_MAX } from '../src/index.js';

const OP = '123e4567-e89b-42d3-a456-426614174000';

describe('parseBroadcastAddress', () => {
  it('reads a project', () => {
    expect(parseBroadcastAddress('@projet:Billing')).toEqual({ project: 'Billing' });
    expect(parseBroadcastAddress('@projet: ')).toBeNull();
  });
  it('reads a list of names', () => {
    expect(parseBroadcastAddress('Pim,Nova')).toEqual({ names: ['Pim', 'Nova'] });
    expect(parseBroadcastAddress('Pim, nova ,Pim')).toEqual({ names: ['Pim', 'nova'] });
    expect(parseBroadcastAddress('Pim,,Nova')).toEqual({ names: ['Pim', 'Nova'] });
  });
  it('refuses the rest', () => {
    expect(parseBroadcastAddress('Pim')).toBeNull();
    expect(parseBroadcastAddress('Pim,pim')).toBeNull();
    expect(parseBroadcastAddress('')).toBeNull();
    const nine = Array.from({ length: BROADCAST_LIST_MAX + 1 }, (_, i) => `n${i}`).join(',');
    expect(parseBroadcastAddress(nine)).toBeNull();
    expect(parseBroadcastAddress(nine.split(',').slice(0, BROADCAST_LIST_MAX).join(','))).not.toBeNull();
  });
  it('labels', () => {
    expect(broadcastLabel({ project: 'Billing' })).toBe('tout le projet Billing');
    expect(broadcastLabel({ names: ['Pim', 'Nova'] })).toBe('Pim, Nova');
  });
});

describe('broadcast messages', () => {
  it('accepts session.broadcast', () => {
    expect(ClientMessageSchema.safeParse({ type: 'session.broadcast', rid: 'r', to: { project: 'P' }, text: 'hi' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'session.broadcast', rid: 'r', to: { sessions: ['a', 'b'] }, text: ' hi ', summary: 's' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'session.broadcast', rid: 'r', to: { sessions: [] }, text: 'hi' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'session.broadcast', rid: 'r', to: { sessions: Array(BROADCAST_SESSIONS_MAX + 1).fill('a') }, text: 'hi' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'session.broadcast', rid: 'r', to: { project: 'P' }, text: '   ' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'session.broadcast', rid: 'r', to: { project: 'P' }, text: 'x'.repeat(MESSAGE_MAX + 1) }).success).toBe(false);
  });
  it('accepts its result', () => {
    expect(ServerMessageSchema.safeParse({ type: 'session.broadcast.result', rid: 'r', sent: [{ id: 's1', name: 'Pim' }], refused: [{ name: 'Nova', reason: 'ended' }] }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ type: 'session.broadcast.result', rid: 'r', sent: [], refused: [], reason: 'pas encore' }).success).toBe(true);
  });
  it('keeps message.ack as it was, with optional recipients', () => {
    const ack = { type: 'message.ack', rid: 'r', outcome: 'accepted' };
    expect(ServerMessageSchema.parse(ack)).toEqual(ack);
    expect(ServerMessageSchema.safeParse({ ...ack, recipients: { sent: ['Pim'], refused: [{ name: 'Nova', reason: 'x' }] } }).success).toBe(true);
  });
  it('phone op is strict and its result carries names', () => {
    expect(PhoneClientMessageSchema.safeParse({ type: 'session.broadcast', op: OP, sessions: ['a'], text: 'hi' }).success).toBe(true);
    expect(PhoneClientMessageSchema.safeParse({ type: 'session.broadcast', op: OP, sessions: ['a'], text: 'hi', extra: 1 }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ type: 'session.broadcast', op: OP, sessions: [], text: 'hi' }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ type: 'session.broadcast', op: OP, sessions: ['a'], text: '' }).success).toBe(false);
    expect(PhoneServerMessageSchema.safeParse({ type: 'operation.result', op: OP, status: 'applied', sent: ['Pim'], refused: [{ name: 'Nova', reason: 'x' }] }).success).toBe(true);
  });
});

describe('broadcast capability and label', () => {
  it('DaemonInfo may announce broadcast, older ones do not', () => {
    const info = { version: '0.35.0', install: 'npm', systemd: true };
    expect(DaemonInfoSchema.parse(info).broadcast).toBeUndefined();
    expect(DaemonInfoSchema.parse({ ...info, broadcast: true }).broadcast).toBe(true);
  });
  it('session.broadcast takes an optional bounded label', () => {
    const m = { type: 'session.broadcast', rid: 'r', to: { sessions: ['a'] }, text: 'hi' };
    expect(ClientMessageSchema.safeParse({ ...m, label: 'tout le projet Billing' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...m, label: 'x'.repeat(BROADCAST_LABEL_MAX + 1) }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ ...m, label: '' }).success).toBe(false);
  });
  it('the phone snapshot may announce broadcast', () => {
    const caps = { freeTextAnswer: true };
    const snap = { type: 'snapshot', protocol: 1, sessions: [], capabilities: { claude: caps, codex: caps, cursor: caps, omp: caps }, daemon: { version: '1', name: 'pc', broadcast: true } };
    const r = PhoneServerMessageSchema.safeParse(snap);
    expect(r.success && r.data.type === 'snapshot' && r.data.daemon.broadcast).toBe(true);
  });
});

describe('broadcastRecipient', () => {
  const live = { source: 'launcher' as const, state: 'idle' as const, tmuxSession: 'ledge-1' };
  it('is a live Ledge-launched session with a terminal or OMP, not a seat', () => {
    expect(broadcastRecipient(live)).toBe(true);
    expect(broadcastRecipient({ ...live, tmuxSession: null, backend: 'omp-rpc' })).toBe(true);
    expect(broadcastRecipient({ ...live, state: 'exited' })).toBe(false);
    expect(broadcastRecipient({ ...live, source: 'hook_only' })).toBe(false);
    expect(broadcastRecipient({ ...live, source: 'rig' })).toBe(false);
    expect(broadcastRecipient({ ...live, rig: { seat: 'a@r', name: 'r' } })).toBe(false);
    expect(broadcastRecipient({ ...live, tmuxSession: null })).toBe(false);
    expect(broadcastRecipient({ ...live, archivedAt: '2026-11-01T00:00:00Z' })).toBe(false);
  });
});

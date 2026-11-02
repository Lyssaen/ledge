import { describe, it, expect } from 'vitest';
import { parseBroadcastAddress, broadcastLabel, BROADCAST_LIST_MAX, BROADCAST_SESSIONS_MAX, ClientMessageSchema, ServerMessageSchema, PhoneClientMessageSchema, PhoneServerMessageSchema, MESSAGE_MAX } from '../src/index.js';

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

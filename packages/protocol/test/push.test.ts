import { describe, it, expect } from 'vitest';
import { PushSubscriptionSchema, PushPayloadSchema, parseClientMessage, parseServerMessage } from '../src/index.js';

const sub = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'a', auth: 'b' } };
const ok = { v: 1, kind: 'request', title: 'Otto', body: 'Run ls?', url: '/m/#/agent/a', badge: 1, tag: 'a' };

describe('push protocol', () => {
  it('refuses a non-https endpoint', () => expect(() => PushSubscriptionSchema.parse({ endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } })).toThrow());
  it('accepts a subscription with or without expirationTime, refuses empty keys', () => {
    expect(PushSubscriptionSchema.parse(sub).endpoint).toBe(sub.endpoint);
    expect(PushSubscriptionSchema.parse({ ...sub, expirationTime: null }).expirationTime).toBeNull();
    expect(() => PushSubscriptionSchema.parse({ ...sub, keys: { p256dh: '', auth: 'b' } })).toThrow();
  });
  it('a payload url stays inside the app', () => expect(() => PushPayloadSchema.parse({ ...ok, url: 'https://evil/' })).toThrow());
  it('parses a payload and bounds its texts and badge', () => {
    expect(PushPayloadSchema.parse(ok).kind).toBe('request');
    expect(() => PushPayloadSchema.parse({ ...ok, title: 'x'.repeat(81) })).toThrow();
    expect(() => PushPayloadSchema.parse({ ...ok, body: 'x'.repeat(121) })).toThrow();
    expect(() => PushPayloadSchema.parse({ ...ok, badge: -1 })).toThrow();
    expect(() => PushPayloadSchema.parse({ ...ok, kind: 'other' })).toThrow();
  });
  it('push.subscribe carries a subscription, push.unsubscribe nothing', () => {
    expect(parseClientMessage({ type: 'push.subscribe', subscription: sub }).type).toBe('push.subscribe');
    expect(() => parseClientMessage({ type: 'push.subscribe', subscription: { ...sub, endpoint: 'http://x' } })).toThrow();
    expect(parseClientMessage({ type: 'push.unsubscribe' }).type).toBe('push.unsubscribe');
  });
  it('auth.ok may carry the VAPID public key', () => {
    const base = { type: 'auth.ok', deviceId: 'd', deviceName: 'iPhone', pcName: 'pc' };
    expect(parseServerMessage(base).type).toBe('auth.ok');
    expect(parseServerMessage({ ...base, vapidPublicKey: 'BKey' })).toMatchObject({ vapidPublicKey: 'BKey' });
  });
});

import { describe, expect, it } from 'vitest';
import { PUSH_HOSTS, PushPayloadSchema, PushSendResultSchema, PushSendSchema, PushSubscriptionSchema, pushEndpointAllowed } from '../src/index.js';

describe('pushEndpointAllowed', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QZ',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
    'https://fcm.googleapis.com:443/x'
  ])('accepts %s', (u) => expect(pushEndpointAllowed(u)).toBe(true));

  it.each([
    'http://fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://evil.example/x',
    'https://u:p@web.push.apple.com/x',
    'https://push.apple.com/x',
    'https://evilpush.apple.com/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://x.fcm.googleapis.com/x',
    'not a url',
    ''
  ])('refuses %s', (u) => expect(pushEndpointAllowed(u)).toBe(false));

  it('lists the four hosts', () => {
    expect(PUSH_HOSTS).toEqual(['*.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', '*.notify.windows.com']);
  });
});

describe('PushSendSchema', () => {
  const ok = { endpoint: 'https://fcm.googleapis.com/x', body: 'AAAA', ttl: 3600, urgency: 'high', topic: 'abc_DEF-1' };
  it('accepts a message', () => expect(PushSendSchema.parse(ok)).toEqual(ok));
  it('bounds every field', () => {
    expect(PushSendSchema.safeParse({ ...ok, body: 'A'.repeat(5_462) }).success).toBe(true);
    expect(PushSendSchema.safeParse({ ...ok, body: 'A'.repeat(5_463) }).success).toBe(false);
    expect(PushSendSchema.safeParse({ ...ok, body: 'a+b' }).success).toBe(false);
    expect(PushSendSchema.safeParse({ ...ok, ttl: 86_401 }).success).toBe(false);
    expect(PushSendSchema.safeParse({ ...ok, ttl: -1 }).success).toBe(false);
    expect(PushSendSchema.safeParse({ ...ok, urgency: 'low' }).success).toBe(false);
    expect(PushSendSchema.safeParse({ ...ok, topic: 'a'.repeat(33) }).success).toBe(false);
    expect(PushSendSchema.safeParse({ ...ok, topic: '' }).success).toBe(false);
    expect(PushSendSchema.safeParse({ ...ok, endpoint: 'x' }).success).toBe(false);
  });
});

describe('PushSendResultSchema', () => {
  it('takes a result and an optional status', () => {
    expect(PushSendResultSchema.parse({ result: 'gone', status: 410 })).toEqual({ result: 'gone', status: 410 });
    expect(PushSendResultSchema.parse({ result: 'failed' })).toEqual({ result: 'failed' });
    expect(PushSendResultSchema.safeParse({ result: 'refused' }).success).toBe(false);
  });
});

describe('PushSubscriptionSchema', () => {
  const ok = { endpoint: 'https://web.push.apple.com/QZ', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };
  it('accepts a typical Apple subscription', () => expect(PushSubscriptionSchema.parse(ok)).toEqual(ok));
  it('refuses an endpoint off PUSH_HOSTS', () => {
    expect(PushSubscriptionSchema.safeParse({ ...ok, endpoint: 'https://evil.example/x' }).success).toBe(false);
    expect(PushSubscriptionSchema.safeParse({ ...ok, endpoint: 'http://web.push.apple.com/x' }).success).toBe(false);
  });
  it('bounds the keys to their exact length', () => {
    expect(PushSubscriptionSchema.safeParse({ ...ok, keys: { ...ok.keys, p256dh: 'A'.repeat(86) } }).success).toBe(false);
    expect(PushSubscriptionSchema.safeParse({ ...ok, keys: { ...ok.keys, auth: 'B'.repeat(23) } }).success).toBe(false);
    expect(PushSubscriptionSchema.safeParse({ ...ok, keys: { ...ok.keys, auth: 'B'.repeat(21) + '+' } }).success).toBe(false);
  });
});

describe('PushPayloadSchema', () => {
  const ok = { v: 1, kind: 'request', title: 'Claude attend votre accord', body: 'Lancer ls ?', url: '/#/s/abc', badge: 2, tag: 'abc_1' };
  it('accepts a payload', () => expect(PushPayloadSchema.parse(ok)).toEqual(ok));
  it('refuses a url that leaves the app or breaks out of an attribute', () => {
    expect(PushPayloadSchema.safeParse({ ...ok, url: 'https://evil.example' }).success).toBe(false);
    expect(PushPayloadSchema.safeParse({ ...ok, url: '/#/x"><script' }).success).toBe(false);
  });
  it('bounds the texts, the badge and the tag', () => {
    expect(PushPayloadSchema.safeParse({ ...ok, title: 'a'.repeat(81) }).success).toBe(false);
    expect(PushPayloadSchema.safeParse({ ...ok, body: 'a'.repeat(121) }).success).toBe(false);
    expect(PushPayloadSchema.safeParse({ ...ok, badge: 1_000 }).success).toBe(false);
    expect(PushPayloadSchema.safeParse({ ...ok, badge: -1 }).success).toBe(false);
    expect(PushPayloadSchema.safeParse({ ...ok, tag: 'a b' }).success).toBe(false);
    expect(PushPayloadSchema.safeParse({ ...ok, tag: 'a'.repeat(33) }).success).toBe(false);
  });
  it('takes the three kinds and version 1 only', () => {
    for (const kind of ['request', 'question', 'finished']) expect(PushPayloadSchema.safeParse({ ...ok, kind }).success).toBe(true);
    expect(PushPayloadSchema.safeParse({ ...ok, kind: 'other' }).success).toBe(false);
    expect(PushPayloadSchema.safeParse({ ...ok, v: 2 }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { PUSH_HOSTS, PushSendResultSchema, PushSendSchema, pushEndpointAllowed } from '../src/index.js';

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

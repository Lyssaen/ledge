import { describe, it, expect } from 'vitest';
import {
  DevicePollResponseSchema,
  DeviceStartResponseSchema,
  MeResponseSchema,
  RELAY_CLOSE_SIGNED_OUT,
  RELAY_SESSION_COOKIE
} from '../src/index.js';

const DEV = 'd_' + 'a'.repeat(16);

describe('relay auth', () => {
  it('names the session cookie and the signed-out close code', () => {
    expect(RELAY_SESSION_COOKIE).toBe('ledge_session');
    expect(RELAY_CLOSE_SIGNED_OUT).toBe(4001);
  });

  it('accepts a device start answer and refuses an incomplete one', () => {
    const start = { deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 };
    expect(DeviceStartResponseSchema.parse(start)).toEqual(start);
    expect(DeviceStartResponseSchema.safeParse({ ...start, interval: 0 }).success).toBe(false);
    expect(DeviceStartResponseSchema.safeParse({ ...start, status: 'nope', deviceCode: undefined }).success).toBe(false);
  });

  it('accepts every poll status and refuses an unknown one', () => {
    for (const p of [
      { status: 'pending' },
      { status: 'slow_down', interval: 10 },
      { status: 'ok', token: 't', accountId: '1', login: 'alice' },
      { status: 'expired' },
      { status: 'denied' },
      { status: 'not_allowed' }
    ]) expect(DevicePollResponseSchema.parse(p)).toEqual(p);
    expect(DevicePollResponseSchema.safeParse({ status: 'nope' }).success).toBe(false);
    expect(DevicePollResponseSchema.safeParse({ status: 'slow_down' }).success).toBe(false);
    expect(DevicePollResponseSchema.safeParse({ status: 'ok', token: 't' }).success).toBe(false);
  });

  it('accepts a me answer for a pc and a device, and refuses an unknown kind or peer', () => {
    const me = { accountId: '1', login: 'alice', peer: 'pc', kind: 'pc' };
    expect(MeResponseSchema.parse(me)).toEqual(me);
    expect(MeResponseSchema.parse({ ...me, peer: DEV, kind: 'device' }).peer).toBe(DEV);
    expect(MeResponseSchema.safeParse({ ...me, kind: 'admin' }).success).toBe(false);
    expect(MeResponseSchema.safeParse({ ...me, peer: 'admin' }).success).toBe(false);
  });
});

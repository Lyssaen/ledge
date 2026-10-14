import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerMessage, PendingSchema } from '../src/index.js';

const T = '2026-10-14T10:00:00.000Z';

describe('remote protocol', () => {
  it('parses auth and refuses a short token', () => {
    expect(parseClientMessage({ type: 'auth', token: 'a'.repeat(43) }).type).toBe('auth');
    expect(() => parseClientMessage({ type: 'auth', token: 'short' })).toThrow();
  });
  it('pair.code carries exactly six digits', () => {
    expect(parseServerMessage({ type: 'pair.code', code: '481200', expiresAt: T, url: 'https://pc.t.ts.net/m/#/pair' }).type).toBe('pair.code');
    expect(() => parseServerMessage({ type: 'pair.code', code: '48120', expiresAt: T, url: 'https://pc.t.ts.net/m/#/pair' })).toThrow();
  });
  it('mobile.configure accepts https or null, never http', () => {
    expect(parseClientMessage({ type: 'mobile.configure', origin: null }).type).toBe('mobile.configure');
    expect(parseClientMessage({ type: 'mobile.configure', origin: 'https://pc.t.ts.net' }).type).toBe('mobile.configure');
    expect(() => parseClientMessage({ type: 'mobile.configure', origin: 'http://pc.t.ts.net' })).toThrow();
  });
  it('a journal pending without id, version or since still parses', () => {
    expect(PendingSchema.parse({ kind: 'permission', text: 'ls', source: 'hook' }).id).toBeUndefined();
  });
});

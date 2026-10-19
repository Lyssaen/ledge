import { RelayPeerSchema } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { hashToken, newDevicePeer, newOpaque, newSessionToken } from '../src/tokens.js';

describe('tokens', () => {
  it('newSessionToken is 43 base64url characters and differs each time', () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(a);
  });

  it('newDevicePeer passes RelayPeerSchema and is d_ + 22 characters', () => {
    const peer = newDevicePeer();
    expect(RelayPeerSchema.safeParse(peer).success).toBe(true);
    expect(peer).toMatch(/^d_[A-Za-z0-9_-]{22}$/);
  });

  it('newOpaque is 43 base64url characters', () => {
    expect(newOpaque()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashToken is the sha256 hex of the token', () => {
    expect(hashToken('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });
});

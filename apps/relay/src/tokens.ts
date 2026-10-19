import { b64u } from '@ledge/seal';
import type { RelayPeer } from '@ledge/protocol';
import { createHash } from 'node:crypto';

function random(bytes: number): string {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** 32 random bytes, 43 base64url characters (a valid RFC 7230 token, usable as a websocket subprotocol). */
export function newSessionToken(): string {
  return random(32);
}

/** The relay stores only this hash, never the token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** `d_` + 16 random bytes (22 base64url characters). */
export function newDevicePeer(): RelayPeer {
  return `d_${random(16)}`;
}

/** 32 random bytes, for the OAuth `state`. */
export function newOpaque(): string {
  return random(32);
}

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Who } from './hub.js';

/** A browser cannot set `Authorization` on a websocket: it offers the token as the subprotocol `ledge-relay.<token>`. */
export const RELAY_PROTOCOL_PREFIX = 'ledge-relay.';

export interface Authenticator {
  authenticate(req: IncomingMessage): Promise<Who | null>;
}

export function presentedProtocols(req: IncomingMessage): string[] {
  const raw = req.headers['sec-websocket-protocol'];
  const value = Array.isArray(raw) ? raw.join(',') : raw ?? '';
  return value.split(',').map((p) => p.trim()).filter(Boolean);
}

function presentedToken(req: IncomingMessage): string | null {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (m) return m[1]!;
  const proto = presentedProtocols(req).find((p) => p.startsWith(RELAY_PROTOCOL_PREFIX));
  return proto ? proto.slice(RELAY_PROTOCOL_PREFIX.length) : null;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Static tokens for development; accounts arrive with GitHub sign-in. Compares SHA-256 digests in constant time. */
export function devTokens(map: Record<string, Who>): Authenticator {
  const entries = Object.entries(map).map(([token, who]) => ({ hash: digest(token), who }));
  return {
    async authenticate(req) {
      const token = presentedToken(req);
      if (!token) return null;
      const h = digest(token);
      let found: Who | null = null;
      for (const e of entries) if (timingSafeEqual(h, e.hash)) found = e.who;
      return found;
    }
  };
}

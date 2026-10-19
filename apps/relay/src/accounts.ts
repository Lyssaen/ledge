import type { IncomingMessage } from 'node:http';
import { RELAY_SESSION_COOKIE } from '@ledge/protocol';
import { presentedToken, type Authenticator } from './auth.js';
import { parseCookies } from './cookies.js';
import type { RelayLog } from './log.js';
import type { Session, Store } from './store.js';
import { hashToken } from './tokens.js';

export interface AccountsDeps {
  store: Store;
  /** GitHub numeric ids, in decimal. Checked at every authentication, not only at sign-in. */
  allowed: ReadonlySet<string>;
  /** The relay's public origin, e.g. `https://relay.example`. A cookie is accepted only from this `Origin`. */
  publicUrl: string;
  log: RelayLog;
}

/**
 * The live session a request presents: a bearer or subprotocol token first, otherwise the `ledge_session` cookie.
 * A browser sends the cookie on a cross-site websocket too, so with `checkOrigin` a cookie counts only from the
 * relay's own `Origin`. The account must still be on the allow-list.
 */
export async function sessionOf(
  req: IncomingMessage,
  deps: AccountsDeps,
  opts: { checkOrigin: boolean }
): Promise<{ session: Session; tokenHash: string; viaCookie: boolean } | null> {
  let token = presentedToken(req);
  let viaCookie = false;
  if (!token) {
    token = parseCookies(req.headers.cookie).get(RELAY_SESSION_COOKIE) || null;
    viaCookie = true;
  }
  if (!token) return null;
  if (viaCookie && opts.checkOrigin && req.headers.origin !== new URL(deps.publicUrl).origin) return null;
  const tokenHash = hashToken(token);
  const session = await deps.store.findSession(tokenHash);
  if (!session || !deps.allowed.has(session.accountId)) return null;
  return { session, tokenHash, viaCookie };
}

export function accountsAuthenticator(deps: AccountsDeps): Authenticator {
  return {
    async authenticate(req) {
      const found = await sessionOf(req, deps, { checkOrigin: true });
      return found ? { accountId: found.session.accountId, peer: found.session.peer } : null;
    }
  };
}

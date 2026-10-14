import type { ClientMessage } from '@ledge/protocol';

/** What a remote socket may send before it is authenticated (handled by the remote entry, not by `handle`). */
export const PRE_AUTH: ReadonlySet<ClientMessage['type']> = new Set<ClientMessage['type']>(['auth', 'pair.options', 'pair.complete']);

/**
 * The closed list of commands an authenticated phone may run (decision D2); lots 3 and 4 extend it. Anything else is
 * refused by the server before it reaches `handle`. Lot 2 adds the decisions, whose own checks (identity, request
 * version, risk, assertion) live in decisions.ts.
 */
export const MOBILE_COMMANDS: ReadonlySet<ClientMessage['type']> = new Set<ClientMessage['type']>([
  'snapshot.request', 'session.decide', 'decide.prepare', 'operation.status', 'session.reply'
]);

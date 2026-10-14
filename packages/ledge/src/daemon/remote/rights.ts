import type { ClientMessage } from '@ledge/protocol';

/** What a remote socket may send before it is authenticated (handled by the remote entry, not by `handle`). */
export const PRE_AUTH: ReadonlySet<ClientMessage['type']> = new Set<ClientMessage['type']>(['auth', 'pair.options', 'pair.complete']);

/** The closed list of commands an authenticated phone may run (decision D2); lots 2, 3 and 4 extend it. */
export const MOBILE_COMMANDS: ReadonlySet<ClientMessage['type']> = new Set<ClientMessage['type']>(['snapshot.request']);

export function remoteMayRun(msg: ClientMessage): boolean {
  return MOBILE_COMMANDS.has(msg.type);
}

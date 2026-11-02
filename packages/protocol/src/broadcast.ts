/** Broadcast: one message to several sessions. Pure helpers; the message schemas live in `messages.ts` and `phone.ts`. */

/** The most names a comma list may hold, and the most sessions a `session.broadcast` may name. */
export const BROADCAST_LIST_MAX = 8;
export const BROADCAST_SESSIONS_MAX = 32;

export type BroadcastAddress = { project: string } | { names: string[] };

const PROJECT_PREFIX = '@projet:';

/** `@projet:<nom>` or `a,b[,…]` (2 to `BROADCAST_LIST_MAX` distinct names, case-insensitive); anything else, a single name included, is `null`. */
export function parseBroadcastAddress(to: string): BroadcastAddress | null {
  const t = to.trim();
  if (t.toLowerCase().startsWith(PROJECT_PREFIX)) {
    const project = t.slice(PROJECT_PREFIX.length).trim();
    return project ? { project } : null;
  }
  if (!t.includes(',')) return null;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of t.split(',')) {
    const n = raw.trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    names.push(n);
  }
  return names.length >= 2 && names.length <= BROADCAST_LIST_MAX ? { names } : null;
}

export function broadcastLabel(a: BroadcastAddress): string {
  return 'project' in a ? `tout le projet ${a.project}` : a.names.join(', ');
}

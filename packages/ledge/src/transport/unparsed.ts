import { hostname } from 'node:os';
import type { ServerMessage } from '@ledge/protocol';
import { LEDGE_VERSION } from '../version.js';

/** The `type` a frame that did not parse carried, or `?` when it has no readable one (not JSON, not an object, too long). */
export function frameType(raw: unknown): string {
  const type = (raw as { type?: unknown } | null | undefined)?.type;
  return typeof type === 'string' && type.length > 0 && type.length <= 64 ? type : '?';
}

/** Logs a dropped frame once per type for the life of one link, so that a newer peer's stream does not flood the log. */
export function dropLogger(log: (line: string) => void, where: string): (type: string, e?: unknown) => void {
  const seen = new Set<string>();
  return (type, e) => {
    if (seen.has(type)) return; seen.add(type);
    const why = e instanceof Error ? `: ${e.message.replace(/\s+/g, ' ').slice(0, 200)}` : '';
    log(`${where}: dropped a frame of type "${type}" this Ledge does not read (logged once per link)${why}`);
  };
}

/** What a front is told when this side drops its message: as the daemon answers it, so that the fleet reads « version trop ancienne ». */
export function unknownRequest(raw: unknown): Extract<ServerMessage, { type: 'error' }> {
  const type = frameType(raw), id = (raw as { id?: unknown } | null | undefined)?.id;
  return {
    type: 'error', message: `${type} : inconnu de Ledge ${LEDGE_VERSION} sur ${hostname()}`,
    // Only a session's id: a mobile.* id names a pairing or a device, never a session a front would fail (as the daemon does).
    ...(type.startsWith('session.') && typeof id === 'string' && id.length <= 200 ? { id } : {}),
    ...(type !== '?' ? { request: type } : {}), code: 'invalid'
  };
}

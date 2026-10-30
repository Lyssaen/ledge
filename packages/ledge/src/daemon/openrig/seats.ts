import type { RigSeat, SeatState } from '@ledge/protocol';
import type { NodeEntry } from './wire.js';

/** "{pod}-{member}@{rig}", split at the first '-' of the left part. */
export function parseSessionName(name: string): { pod: string; member: string; rig: string } | null {
  const at = name.lastIndexOf('@'); if (at < 1 || at === name.length - 1) return null;
  const left = name.slice(0, at); const dash = left.indexOf('-'); if (dash < 1 || dash === left.length - 1) return null;
  return { pod: left.slice(0, dash), member: left.slice(dash + 1), rig: name.slice(at + 1) };
}

/** Seat state from a node (facts D10); `activity` overrides the node's own activityState. */
export function seatState(n: NodeEntry, activity?: string): SeatState {
  const startup = n.startupStatus as string | undefined; const session = n.sessionStatus ?? undefined;
  if (startup === 'pending') return 'starting';
  if (startup === 'challenged') return 'trust';
  if (session === 'stopped' || session === 'detached') return 'stopped';
  if (session === 'exited' || session === 'crashed' || session === 'failed') return 'crashed';
  return (activity ?? n.activityState?.activity) === 'working' ? 'working' : 'ready';
}

export function toSeat(n: NodeEntry, activity?: string): RigSeat {
  const ref = n.canonicalSessionName ?? n.logicalId;
  const member = (ref && parseSessionName(ref)?.member) || n.logicalId;
  const model = typeof n.model === 'string' ? n.model : undefined;
  return { ref, address: '@' + member, name: member, runtime: typeof n.runtime === 'string' ? n.runtime : 'unknown', ...(model ? { model } : {}), state: seatState(n, activity) };
}

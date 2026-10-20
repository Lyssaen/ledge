import { backendOf, isArchived, type Session } from '@ledge/protocol';

/** What the agent tab can be. */
export type AgentMode =
  | { kind: 'live' } | { kind: 'parent'; parentId: string }        // a subagent: its parent, read-only
  | { kind: 'offline' } | { kind: 'preview'; why: 'outside' | 'ended' } | { kind: 'browser' }
  /** OMP: driven over its protocol, there is no agent screen to attach or to preview (spec 2026-10-20 §3.5): the pane holds shells only. */
  | { kind: 'native' };

/** A session whose agent Ledge drives itself, with no terminal of the agent's own. */
export const isNative = (s: Pick<Session, 'backend'>): boolean => backendOf(s) === 'omp-rpc';

/** On a subagent's page `s` is already its parent, so the parent's screen is `s`'s own. */
export function agentMode(s: Session, helper: { id: string } | null, hasBackend: boolean): AgentMode {
  if (!hasBackend) return { kind: 'browser' };
  if (isNative(s)) return { kind: 'native' };
  if (s.offline) return { kind: 'offline' };
  if (isArchived(s) || s.state === 'exited') return { kind: 'preview', why: 'ended' };
  if (s.tmuxSession === null) return { kind: 'preview', why: 'outside' };
  if (helper) return { kind: 'parent', parentId: s.id };
  return { kind: 'live' };
}

const DELAYS = [1000, 2000, 4000, 8000];

/** How long the agent tab waits before its `attempt`-th reconnection (from 1). */
export function reconnectDelay(attempt: number): number {
  return DELAYS[attempt - 1] ?? 15000;
}

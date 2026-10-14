import { isPending } from '@ledge/fleet/changes';
import type { Session } from '@ledge/protocol';
/** What the "needs you" filter keeps: a live session waiting on a person (spec §9.1). */
export const needsAttention = (s: Session): boolean => isPending(s) && !s.offline;
export const visibleSessions = (sessions: Session[], attentionOnly: boolean): Session[] => attentionOnly ? sessions.filter(needsAttention) : sessions;

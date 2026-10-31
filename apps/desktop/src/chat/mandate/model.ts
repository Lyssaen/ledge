import type { LedgeDecision } from '@ledge/protocol';
import { localDay } from '@ledge/ui/chat/ledge/threadModel';

/** The decisions of the local day `today` (`YYYY-MM-DD`), in the order given; `by` keeps only Ledge's or only the user's. */
export function decisionsToday(decisions: readonly LedgeDecision[], today: string, by?: 'ledge' | 'user'): LedgeDecision[] {
  return decisions.filter(d => localDay(d.at) === today && (by === undefined || d.by === by));
}

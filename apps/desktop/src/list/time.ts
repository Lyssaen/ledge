import type { Session } from '@ledge/protocol';
import { requestKey } from '../fleet/decisions';
import type { Messages } from '../i18n/messages';
import { bucketOf } from './model';

export type Span = 'now' | { n: number; unit: 'min' | 'h' | 'd' };

/** Rounds down: < 1 min is 'now', < 60 min minutes, < 24 h hours, else days; a negative duration is 'now'. */
export function spanOf(ms: number): Span {
  const min = Math.floor(ms / 60_000);
  if (!(min >= 1)) return 'now';
  if (min < 60) return { n: min, unit: 'min' };
  const h = Math.floor(min / 60);
  if (h < 24) return { n: h, unit: 'h' };
  return { n: Math.floor(h / 24), unit: 'd' };
}

export interface When { text: string; title: string; waiting: boolean }

const ms = (iso: string | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/** « depuis 12 min » for a wait (since `since`, else lastActivityAt), « il y a 3 min » otherwise (lastActivityAt). */
export function whenOf(s: Session, since: string | undefined, now: number, t: Messages['list']['when']): When {
  const waiting = bucketOf(s) === 'decide';
  const span = spanOf(now - ms(waiting ? since ?? s.lastActivityAt : s.lastActivityAt));
  const d = span === 'now' ? '' : `${span.n} ${t.units[span.unit]}`;
  if (waiting) return span === 'now' ? { text: t.now, title: t.requestNow, waiting } : { text: t.wait(d), title: t.waitTitle(d), waiting };
  if (span === 'now') return { text: t.now, title: t.activityNow, waiting };
  return { text: t.ago(d), title: s.offline ? t.seenAgo(d) : t.activityAgo(d), waiting };
}

export interface Wait { key: string; since: string }

/** The start of each wait: the oldest lastActivityAt seen for the same request (state + requestKey). PaneChanged refreshes
 *  lastActivityAt during a wait: without this, « depuis » would restart from zero. Only sessions in the 'decide' bucket are tracked. */
export function trackWaits(prev: ReadonlyMap<string, Wait>, sessions: readonly Session[]): Map<string, Wait> {
  const next = new Map<string, Wait>();
  for (const s of sessions) {
    if (bucketOf(s) !== 'decide') continue;
    const key = `${s.state}\n${requestKey(s) ?? ''}`;
    const old = prev.get(s.id);
    next.set(s.id, old && old.key === key && ms(old.since) <= ms(s.lastActivityAt) ? old : { key, since: s.lastActivityAt });
  }
  return next;
}

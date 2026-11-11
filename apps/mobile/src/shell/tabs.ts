import type { HumanAsk } from '@ledge/protocol';
import type { InboxItem } from '../model/requests';
import { href, type Route } from '../router';

/**
 * The app's tabs (docs/mockups/ledge-mobile-refonte/m0-socle.html, §1 and §2): five on the phone, always shown, in this order;
 * the tablet's rail adds the Atelier after Rigs.
 */
export type Tab = 'atoi' | 'sessions' | 'prs' | 'rigs' | 'chat' | 'atelier';
export const PHONE_TABS = ['atoi', 'sessions', 'prs', 'rigs', 'chat'] as const satisfies readonly Tab[];

/** The tab a screen belongs to: a request to À toi, a thread or a terminal to Sessions; none for Réglages. */
export function tabOf(r: Route): Tab | null {
  switch (r.name) {
    case 'atoi': case 'request': case 'ask': return 'atoi';
    case 'sessions': case 'thread': case 'terminal': return 'sessions';
    case 'prs': case 'rigs': case 'chat': return r.name;
    // A rig, the kernel and Max belong to the Rigs tab, even opened from Sessions (m4-rigs.html, §11, Q48).
    case 'rig': case 'kernel': case 'max': return 'rigs';
    case 'atelier': return 'atelier';
    case 'connection': return null;
  }
}

export const rootOf = (t: Tab): Route => ({ name: t });

/** The screen is its tab's first one, nothing opened over or beside it. */
export const isRoot = (r: Route): boolean => tabOf(r) === r.name && !(r.name === 'atelier' && r.sessionId);

/** Where each tab was left, since the page loaded: a tap on a tab goes back there. */
const left = new Map<Tab, string>();

/** The Atelier is not remembered: a session's panel opened over its floor closes once left, and the tab finds the floor. */
export function remember(r: Route): void {
  const t = tabOf(r);
  if (t && t !== 'atelier') left.set(t, href(r));
}

/** The address a tab's button leads to: the screen the tab was left on, or its root. */
export const tabHref = (t: Tab): string => left.get(t) ?? href(rootOf(t));

/** For the tests: forgets where the tabs were left. */
export const forgetTabs = (): void => left.clear();

/**
 * À toi's badge (m0-socle.html, §1, Desktop's rule): the permissions in red; without one, the questions and what OpenRig asks
 * the person (its decisions and the rows parked on them; a piece of news is no ask) in amber; past 99, « 99+ ».
 */
export function atoiBadge(items: readonly InboxItem[], asks: readonly Pick<HumanAsk, 'kind'>[] = []): { text: string; tone: 'red' | 'amber' } | null {
  const perm = items.filter(i => i.filter === 'permission').length;
  const ask = items.length - perm + asks.filter(a => a.kind !== 'update').length;
  const n = perm || ask;
  if (!n) return null;
  return { text: n > 99 ? '99+' : String(n), tone: perm ? 'red' : 'amber' };
}

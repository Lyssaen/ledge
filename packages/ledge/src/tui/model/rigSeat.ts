import type { Session } from '@ledge/protocol';

/**
 * An OpenRig seat among the sessions (`session.rig`, recognised by Ledge's hooks), as Desktop tags it: its rig in brackets,
 * then its role. A session that is no seat has neither.
 */

/** `[first-factory] ` before the role; empty for a session that is no seat. */
export const rigTag = (s: Pick<Session, 'rig'>): string => (s.rig ? `[${s.rig.name}] ` : '');
/** The seat's role (`dev.build`), else its OpenRig session name until OpenRig names the role. */
export const rigRole = (s: Pick<Session, 'rig'>): string => (s.rig ? s.rig.role ?? s.rig.seat : '');
/** What the second column says for a seat: its role first, then `rest` (the topic, the repository). */
export const seatSecond = (s: Pick<Session, 'rig'>, rest: string): string => (s.rig ? [rigRole(s), rest].filter(Boolean).join(' · ') : rest);

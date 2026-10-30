import type { PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import { resendable, type Op } from '../state/operations';

const C = copy.sessionEnd;

type EndOp = Op & { message: Extract<Op['message'], { type: 'session.close' | 'session.resume' }> };

/**
 * How long after it was sent a close the PC applied (or refused as `busy`: another close is under way) keeps the page on
 * « Fermeture… » while the session does not show it ended yet; a resume likewise on « Reprise… ». The PC's own close gives
 * up after 25 s, with a kill.
 */
export const SETTLE_MS = 60_000;

/** This phone's latest close or resume of the session: the one the page follows. */
export function lastEndOp(sessionId: string, ops: Record<string, Op>): EndOp | undefined {
  return Object.values(ops)
    .filter((o): o is EndOp => (o.message.type === 'session.close' || o.message.type === 'session.resume') && o.message.id === sessionId)
    .sort((a, b) => a.at.localeCompare(b.at))
    .at(-1);
}

/** Why a close or a resume did not happen, in words; `retry` reopens the sheet, `reconnect` brings the link back. */
export interface EndError { title: string; body: string; retry?: true; reconnect?: true }

/**
 * What the page shows of the session's end: a close of this phone under way, a resume under way, the session ended
 * (fermée d'ici ou non, `killed` when this phone's close had to force it), or the session open. An error stays with the
 * op it is about: the page drops it at the next gesture or when the session changes state.
 */
export type Ending =
  | { kind: 'closing' }
  | { kind: 'resuming' }
  | { kind: 'ended'; killed: boolean; error: (EndError & { op: string }) | null }
  | { kind: 'open'; error: (EndError & { op: string }) | null };

/** What the page knows of the link: an op of unknown outcome that will not go again, once the PC is back, simply failed. */
export interface LinkView { fresh: boolean; boot: string | null }

/** The PC refused the device's check, not the close or the resume: nothing was tried, a new check is the way. */
function checkError(o: EndOp): string | null {
  if (o.reason === 'assertion_expired') return copy.confirm.expired;
  if (o.reason === 'assertion_invalid' || o.reason === 'confirm_required') return copy.confirm.failed;
  return null;
}

/** An op of unknown outcome that the link being back will not send again: it is a failure, not a wait. */
const lostForGood = (o: EndOp, link: LinkView | undefined, now: number) => o.phase === 'uncertain' && !!link?.fresh && !resendable(o, link.boot, now);

function closeError(o: EndOp, name: string, lost: boolean): EndError {
  if (o.phase === 'uncertain' && !lost) return { title: C.uncertainTitle, body: C.uncertain(name), reconnect: true };
  const check = checkError(o);
  if (check) return { title: C.notClosed(name), body: check, retry: true };
  if (o.reason === 'read_only') return { title: C.notClosed(name), body: C.readOnly };
  return { title: C.notClosed(name), body: C.closeFailed, retry: true };
}

function resumeError(o: EndOp, name: string, lost: boolean): EndError {
  if (o.phase === 'uncertain' && !lost) return { title: C.resumeUncertainTitle, body: C.resumeUncertain(name), reconnect: true };
  const check = checkError(o);
  if (check) return { title: C.notResumed(name), body: check, retry: true };
  if (o.reason === 'no_conversation') return { title: C.notResumed(name), body: C.noConversation };
  return { title: C.notResumed(name), body: C.resumeFailed, retry: true };
}

/**
 * Whether the session was started again since this phone's close or resume was sent. A resume (from here or from the PC)
 * gives the session a new `startedAt`, an end leaves it as it was, and both values come from the PC: no clock of this
 * phone is compared to the PC's. An op made before it kept the session's `startedAt` is taken as not restarted.
 */
const restarted = (o: EndOp, session: PhoneSession) => o.startedAt !== undefined && session.startedAt !== o.startedAt;

/** Whether the session's current end is the one this close produced: ended, and not started again since the close was sent. */
const ownEnd = (o: EndOp, session: PhoneSession) => session.state === 'exited' && !restarted(o, session);

/**
 * `link` tells an op of unknown outcome that will go again (a wait, said so) from one that will not (a failure, retried by
 * hand); without it, every such op is taken to go again.
 */
export function endingOf(session: PhoneSession, ops: Record<string, Op>, now: number = Date.now(), link?: LinkView): Ending {
  const exited = session.state === 'exited';
  const o = lastEndOp(session.id, ops);
  const recent = !!o && now - Date.parse(o.at) < SETTLE_MS;
  const lost = !!o && lostForGood(o, link, now);
  if (!o) return exited ? { kind: 'ended', killed: false, error: null } : { kind: 'open', error: null };
  if (o.message.type === 'session.close') {
    if (exited) return { kind: 'ended', killed: o.phase === 'applied' && o.how === 'killed' && ownEnd(o, session), error: null };
    // Started again since it was sent (closed, then resumed from the PC, whether this phone saw the end or not): over.
    if (restarted(o, session)) return { kind: 'open', error: null };
    if (o.phase === 'sending') return { kind: 'closing' };
    // Applied, or under way from elsewhere (another phone, a chat card): the session's own update is about to say it ended.
    if ((o.phase === 'applied' || (o.phase === 'rejected' && o.reason === 'busy')) && recent) return { kind: 'closing' };
    // Already ended for the PC, before this phone heard of it: the ended card, the update that says so is on its way.
    if (o.phase === 'rejected' && o.reason === 'ended' && recent) return { kind: 'ended', killed: false, error: null };
    // Already ended for the PC: the snapshot that says so is on its way, nothing went wrong.
    if (o.phase === 'applied' || (o.phase === 'rejected' && (o.reason === 'busy' || o.reason === 'ended'))) return { kind: 'open', error: null };
    return { kind: 'open', error: { ...closeError(o, session.name, lost), op: o.op } };
  }
  if (!exited) return { kind: 'open', error: null };
  // Taken, then ended again (the agent quit on start): the ended card, with its resume.
  if (restarted(o, session)) return { kind: 'ended', killed: false, error: null };
  // A resume of unknown outcome is not shown as under way: it may never be, and the card keeps its button.
  if (o.phase === 'sending' || (o.phase === 'applied' && recent)) return { kind: 'resuming' };
  if (o.phase === 'applied') return { kind: 'ended', killed: false, error: null };
  return { kind: 'ended', killed: false, error: { ...resumeError(o, session.name, lost), op: o.op } };
}

/** Whether this phone is closing the session now: the page's « Fermeture… », and the list's. */
export const closingHere = (session: PhoneSession, ops: Record<string, Op>, now: number = Date.now()): boolean => endingOf(session, ops, now).kind === 'closing';

/**
 * Whether « Fermer » waits: a close of this phone is under way, or its outcome is unknown while it may still go again by
 * itself (`resendable`); a second close would only be refused as a repeat. `boot`: the PC's, as its snapshot said.
 */
export function closeHeld(session: PhoneSession, ops: Record<string, Op>, boot: string | null, now: number = Date.now()): boolean {
  if (endingOf(session, ops, now).kind === 'closing') return true;
  const o = lastEndOp(session.id, ops);
  return o?.message.type === 'session.close' && o.phase === 'uncertain' && session.state !== 'exited' && !restarted(o, session) && resendable(o, boot, now);
}

/** Whether « Reprendre » waits: a resume of unknown outcome that goes again by itself once the link is back. */
export function resumeHeld(session: PhoneSession, ops: Record<string, Op>, boot: string | null, now: number = Date.now()): boolean {
  const o = lastEndOp(session.id, ops);
  return o?.message.type === 'session.resume' && o.phase === 'uncertain' && !restarted(o, session) && resendable(o, boot, now);
}

/** Whether this phone's close ended the session, this end and not a later one: the thread says « Session fermée depuis le téléphone ». */
export function closedHere(session: PhoneSession, ops: Record<string, Op>): boolean {
  const o = lastEndOp(session.id, ops);
  return o?.message.type === 'session.close' && o.phase === 'applied' && ownEnd(o, session);
}

const hhmm = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** When a session ended, next to « Terminée »: « à 18:42 » today, « hier », else « le 27 oct. ». */
export function endedAtLabel(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  const days = Math.round((dayOf(new Date(now)) - dayOf(at)) / 86_400_000);
  if (days <= 0) return C.at(hhmm(at));
  if (days === 1) return C.yesterday;
  return C.on(at.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
}

/** The time of an ended session, as the thread's event line says it. */
export const endedClock = (iso: string): string => hhmm(new Date(iso));

/**
 * What the close would cut, line by line, in the sheet's order: none for a session at rest. A turn waiting on a request is a
 * turn under way too: the PC interrupts it as it would a working one.
 */
export function closeCuts(session: PhoneSession): string[] {
  const cuts: string[] = [];
  if (session.state === 'working') cuts.push(C.working(session.name));
  else if (session.state === 'waiting_permission' || session.state === 'waiting_input') cuts.push(C.turn(session.name));
  const p = session.pending;
  if (p) cuts.push(p.kind === 'question' ? C.question : C.request);
  else if (session.state === 'waiting_permission') cuts.push(C.request);
  else if (session.state === 'waiting_input') cuts.push(C.question);
  const helpers = session.helpers.filter(h => h.state !== 'exited').length;
  if (helpers > 0) cuts.push(C.helpers(helpers));
  return cuts;
}

import { useEffect, useRef, useState } from 'react';
import type { DaemonClient, DaemonError } from '@ledge/fleet';
import { NOTE_MAX, offers, type Decision, type Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

/** What a pending request is, whatever refreshes around it: its kind, its text and the helper it comes from; null without a request. */
export function requestKey(s: Pick<Session, 'pending'>): string | null {
  const p = s.pending;
  return p ? `${p.kind}\n${p.text}\n${p.helperId ?? ''}` : null;
}

/** A decision sent and not seen land yet would come back after this (like the filing's UNCONFIRMED_MS). */
export const UNCONFIRMED_MS = 8000;
/** How long a row flashes once its decision landed (list.css `.lrow.flash`). */
export const FLASH_MS = 1800;

/** Ce que le daemon change après avoir pris un message (sends.ts de feat/desktop) : état, activité, dernière réponse, demande. */
export function markOf(s: Session): string {
  return JSON.stringify([s.state, s.lastActivityAt, s.lastReply ?? null, requestKey(s)]);
}

export interface Decisions {
  /** Un envoi (décision ou réponse) est en vol pour cette session. */
  busy(id: string): boolean;
  /** La session dont l'envoi vient d'aboutir, pendant 1,8 s (classe `flash` de la ligne). */
  landed: string | null;
  /** false sans envoi : hors ligne, lecture seule, sans demande, question, déjà en vol, `always` ou note que offers() refuse, note sans deny.
   *  `onRefused` rend la note quand le daemon refuse. */
  decide(s: Session, decision: Decision, note?: string, onRefused?: (text: string) => void): boolean;
  /** false sans envoi : hors ligne, lecture seule, texte vide, déjà en vol, demande autre qu'une question. `onRefused` rend le texte. */
  reply(s: Session, text: string, onRefused?: (text: string) => void): boolean;
}

/** What is in flight: the message, the request and the mark it started from, the last error seen then (only a later one
 *  can refuse it), the name a notice gives, and what a refused reply (or note) gives back. */
interface Sent {
  message: 'session.decide' | 'session.reply'; pending: string | null; mark: string; errorSeq: number; name: string;
  text?: string; onRefused?: (text: string) => void; timer: ReturnType<typeof setTimeout>;
}

/** Allow / Deny / Always / a note, and free replies, shared by the List and the session: one send per session, settled
 *  when it lands (the request changes for a decision, the session moves for a reply), the session goes (forgotten), the
 *  daemon refuses that very message type for it (said in the toast), or nothing happens for 8 s (given up, with a notice).
 *  A landed reply still hears its refusal for 8 s (see `settled`). */
export function useDecisions(o: { client: Pick<DaemonClient, 'send'>; sessions: readonly Session[]; errors: readonly DaemonError[]; notify(text: string): void }): Decisions {
  const { t } = useI18n();
  const { sessions, errors } = o;
  // A synchronous mirror of what is in flight: two clicks in the same frame see the first send before React renders again.
  const live = useRef(new Map<string, Sent>());
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  // An object per landing, so the same session landing twice restarts the flash.
  const [landed, setLanded] = useState<{ id: string } | null>(null);
  // The timers and the effects speak with the current props and language.
  const latest = useRef({ o, t });
  latest.current = { o, t };
  // The newest error already looked at: each error is judged once, in order.
  const seen = useRef(errors.at(-1)?.seq ?? 0);

  const forget = (id: string) => {
    const x = live.current.get(id);
    if (!x) return null;
    clearTimeout(x.timer);
    live.current.delete(id);
    setInFlight(new Set(live.current.keys()));
    return x;
  };

  // A reply that landed, still answerable by its refusal for UNCONFIRMED_MS: a working session moves at once (its
  // lastActivityAt), and the daemon's InjectFailed reaches the store before the refusal, so the mark alone cannot wait for it.
  const settled = useRef(new Map<string, Sent>());
  const unsettle = (id: string) => {
    const x = settled.current.get(id);
    if (x) { clearTimeout(x.timer); settled.current.delete(id); }
    return x;
  };

  useEffect(() => {
    const byId = new Map(sessions.map(s => [s.id, s]));
    for (const [id, x] of [...live.current]) {
      const s = byId.get(id);
      if (!s) forget(id);
      else if (!s.offline && (x.message === 'session.decide' ? requestKey(s) !== x.pending : markOf(s) !== x.mark)) {
        forget(id); setLanded({ id });
        if (x.message === 'session.reply') settled.current.set(id, { ...x, timer: setTimeout(() => settled.current.delete(id), UNCONFIRMED_MS) });
      }
    }
    for (const id of [...settled.current.keys()]) if (!byId.has(id)) unsettle(id);
  }, [sessions]);

  useEffect(() => {
    const last = errors.at(-1)?.seq ?? 0;
    if (last < seen.current) seen.current = 0; // the store started over
    for (const e of errors) {
      if (e.seq <= seen.current) continue;
      seen.current = e.seq;
      if (e.id === undefined || !e.request) continue;
      const matches = (x: Sent | undefined): x is Sent => !!x && e.request === x.message && e.seq > x.errorSeq;
      const inFlightNow = live.current.get(e.id);
      const x = matches(inFlightNow) ? forget(e.id) : matches(settled.current.get(e.id)) ? unsettle(e.id) : null;
      if (!x) continue;
      const { o: cur, t: tr } = latest.current;
      cur.notify(x.message === 'session.decide' ? tr.decisions.failed(x.name, e.message) : tr.decisions.replyFailed(x.name, e.message));
      if (x.text !== undefined) x.onRefused?.(x.text);
    }
  }, [errors]);

  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [landed]);

  useEffect(() => () => {
    for (const x of [...live.current.values(), ...settled.current.values()]) clearTimeout(x.timer);
    live.current.clear(); settled.current.clear();
  }, []);

  /** Records the send and the 8 s watch, then sends. */
  const send = (s: Session, message: Sent['message'], payload: Parameters<Pick<DaemonClient, 'send'>['send']>[0], extra: Pick<Sent, 'text' | 'onRefused'> = {}) => {
    const { name, id } = s;
    // A new reply takes over the landed one's window; a decision does not (the reply's late refusal still reaches it).
    if (message === 'session.reply') unsettle(id);
    const timer = setTimeout(() => {
      const x = forget(id);
      if (!x) return;
      const { o: cur, t: tr } = latest.current;
      cur.notify(message === 'session.decide' ? tr.decisions.unconfirmed(name) : tr.decisions.replyUnconfirmed(name));
    }, UNCONFIRMED_MS);
    // `errorSeq` comes from the last render's errors, so whether this is recorded before or after `client.send` does not matter for it.
    live.current.set(id, { message, pending: requestKey(s), mark: markOf(s), errorSeq: latest.current.o.errors.at(-1)?.seq ?? 0, name, timer, ...extra });
    setInFlight(new Set(live.current.keys()));
    latest.current.o.client.send(payload);
    return true;
  };

  return {
    busy: id => inFlight.has(id),
    landed: landed?.id ?? null,
    decide(s, decision, note, onRefused) {
      const p = s.pending;
      if (s.offline || s.source === 'hook_only' || !p || p.kind === 'question' || live.current.has(s.id)) return false;
      if (decision === 'always' && !offers(s.tool, p.kind, 'always')) return false;
      if (note) {
        if (decision !== 'deny' || note.length > NOTE_MAX || !offers(s.tool, p.kind, 'note')) return false;
      }
      // The request the user saw goes with it: the daemon refuses the decision if another one is pending by then.
      const payload = { type: 'session.decide' as const, id: s.id, decision, ...(note ? { note } : {}), expect: { kind: p.kind, text: p.text } };
      return send(s, 'session.decide', payload, note ? { text: note, onRefused } : {});
    },
    reply(s, text, onRefused) {
      if (s.offline || s.source === 'hook_only' || !text.trim() || live.current.has(s.id) || (s.pending && s.pending.kind !== 'question')) return false;
      return send(s, 'session.reply', { type: 'session.reply', id: s.id, text }, { text, onRefused });
    }
  };
}

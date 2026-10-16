import { useEffect, useRef, useState } from 'react';
import type { DaemonClient, DaemonError } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
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

export interface Decisions {
  /** Une décision est partie pour la demande en cours de cette session. */
  busy(id: string): boolean;
  /** La session dont la décision vient d'aboutir, pendant 1,8 s (classe `flash` de la ligne). */
  landed: string | null;
  /** false sans envoi : hors ligne, lecture seule (`hook_only`), sans demande, demande de type question, ou déjà partie. */
  decide(s: Session, decision: 'accept' | 'deny'): boolean;
}

/** The request the decision answers, the daemon's last error when it left (only a later one can refuse it), the name a notice gives. */
interface Sent { request: string | null; errorSeq: number; name: string; timer: ReturnType<typeof setTimeout> }

/** Allow / Deny, shared by the List and (lot 6) the session (the lot-3 `sends.ts`, reduced to decisions): one send per
 *  request, settled when the request changes (landed), the session goes (forgotten), the daemon answers an error for it
 *  (refused, said in the toast), or nothing happens for 8 s (given up, with a notice). */
export function useDecisions(o: { client: Pick<DaemonClient, 'send'>; sessions: readonly Session[]; lastError: DaemonError | null; notify(text: string): void }): Decisions {
  const { t } = useI18n();
  const { sessions, lastError } = o;
  // A synchronous mirror of what is in flight: two clicks in the same frame see the first send before React renders again.
  const live = useRef(new Map<string, Sent>());
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  // An object per landing, so the same session landing twice restarts the flash.
  const [landed, setLanded] = useState<{ id: string } | null>(null);
  // The timers and the effects speak with the current props and language.
  const latest = useRef({ o, t });
  latest.current = { o, t };

  const forget = (id: string) => {
    const x = live.current.get(id);
    if (!x) return null;
    clearTimeout(x.timer);
    live.current.delete(id);
    setInFlight(new Set(live.current.keys()));
    return x;
  };

  useEffect(() => {
    const byId = new Map(sessions.map(s => [s.id, s]));
    for (const [id, x] of [...live.current]) {
      const s = byId.get(id);
      if (!s) forget(id);
      else if (!s.offline && requestKey(s) !== x.request) { forget(id); setLanded({ id }); }
    }
  }, [sessions]);

  useEffect(() => {
    const id = lastError?.id;
    const x = id === undefined ? undefined : live.current.get(id);
    if (!lastError || !id || !x || lastError.seq <= x.errorSeq) return;
    forget(id);
    latest.current.o.notify(latest.current.t.decisions.failed(x.name, lastError.message));
  }, [lastError]);

  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [landed]);

  useEffect(() => () => { for (const x of live.current.values()) clearTimeout(x.timer); live.current.clear(); }, []);

  return {
    busy: id => inFlight.has(id),
    landed: landed?.id ?? null,
    decide(s, decision) {
      if (s.offline || s.source === 'hook_only' || !s.pending || s.pending.kind === 'question' || live.current.has(s.id)) return false;
      const { name, id } = s;
      const timer = setTimeout(() => {
        if (!forget(id)) return;
        latest.current.o.notify(latest.current.t.decisions.unconfirmed(name));
      }, UNCONFIRMED_MS);
      // `errorSeq` comes from the last render's `lastError`, so whether this is recorded before or after `client.send` does not matter for it.
      live.current.set(id, { request: requestKey(s), errorSeq: latest.current.o.lastError?.seq ?? 0, name, timer });
      setInFlight(new Set(live.current.keys()));
      latest.current.o.client.send({ type: 'session.decide', id, decision });
      return true;
    }
  };
}

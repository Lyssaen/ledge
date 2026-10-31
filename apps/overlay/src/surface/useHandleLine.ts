import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useEscalations, useRigs, type DaemonClient } from '@ledge/fleet';
import type { Escalation, Exchange, Session } from '@ledge/protocol';
import { answerLabel } from '@ledge/ui/chat/ledge/EscalationCard';
import { seatName } from '@ledge/ui/chat/ledge/threadModel';
import type { Messages } from '../i18n/messages';
import { handleLine, LINE_LINGER_MS, waitingOf, type HandleLine } from './handleLine';

/** An exchange or a decision older than this when the notch first sees it is history (a reload, a replay), never news. */
const STALE_MS = 60_000;
const noop = () => () => {};

/**
 * The closed notch's line, live: the waiting decisions and standalone sessions, Ledge's last decision (an escalation it answered
 * itself) and the last exchange between agents from the live feed, each news for `LINE_LINGER_MS` after the notch first sees it.
 * Re-renders once when the news expires.
 */
export function useHandleLine(client: DaemonClient, sessions: readonly Session[], t: Messages): HandleLine {
  const escalations = useEscalations(client);
  const rigs = useRigs(client);
  const fleet = client.fleet;

  // The newest exchange of every rig, as a stable key between changes (the fleet keeps each rig's list, the live feed appends).
  const exchangeKey = useSyncExternalStore(fleet?.subscribe ?? noop, () => {
    if (!fleet) return '';
    let best: Exchange | undefined;
    for (const r of rigs) { const x = fleet.exchanges(r.machine, r.id)?.at(-1); if (x && (!best || x.at > best.at)) best = x; }
    return best ? `${best.machine}\u0000${best.rigId}\u0000${best.id}` : '';
  }, () => '');
  const exchange = useMemo(() => {
    if (!fleet || !exchangeKey) return undefined;
    const [machine, rigId, id] = exchangeKey.split('\u0000') as [string, string, string];
    const x = fleet.exchanges(machine, rigId)?.find(e => e.id === id);
    return x ? { x, rigName: rigs.find(r => r.machine === machine && r.id === rigId)?.name ?? rigId } : undefined;
  }, [fleet, exchangeKey, rigs]);

  // Ledge's last decision: the latest escalation it answered itself.
  const decided = useMemo(() => {
    let last: Escalation | undefined;
    for (const e of escalations) if (e.state === 'answered' && e.answer?.by === 'ledge' && (!last || e.answer.at > last.answer!.at)) last = e;
    return last?.answer ? { key: `${last.machine}/${last.id}/${last.answer.at}`, at: last.answer.at, text: t.ledgeThread.decided.line(seatName(last.from), answerLabel(last, last.answer.answers)) } : undefined;
  }, [escalations, t]);

  // When the notch first saw each piece of news (stale ones never count).
  const seen = useRef(new Map<string, number>());
  const seenAt = (key: string, at: string): number => {
    let s = seen.current.get(key);
    if (s === undefined) {
      const now = Date.now();
      s = now - Date.parse(at) > STALE_MS ? -Infinity : now;
      seen.current.set(key, s);
    }
    return s;
  };
  const lastExchange = exchange ? { ...exchange, seenAt: seenAt(`x:${exchangeKey}`, exchange.x.at) } : undefined;
  const lastDecided = decided ? { text: decided.text, seenAt: seenAt(`d:${decided.key}`, decided.at) } : undefined;

  const [, tick] = useState(0);
  const now = Date.now();
  const line = handleLine({ escalations, ...waitingOf(sessions, rigs), lastExchange, lastDecided, now, summary: t.notchLine.summary });
  // Wake up when the newest piece of news stops being news.
  const expiry = Math.max(lastExchange?.seenAt ?? -Infinity, lastDecided?.seenAt ?? -Infinity) + LINE_LINGER_MS;
  useEffect(() => {
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return;
    const timer = setTimeout(() => tick(n => n + 1), expiry - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [expiry]);
  return line;
}

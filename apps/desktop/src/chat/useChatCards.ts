import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonError } from '@ledge/fleet';
import { proposalRows, type ChatProposal, type ChatTurn, type ClientMessage, type Session } from '@ledge/protocol';
import { answers } from '../launch/useLaunch';
import { NO_PICK, type ModelPick } from '../launch/model';

export interface ChatCardsOptions {
  send(m: ClientMessage): void;
  chat: ChatTurn[];
  lastLaunched: { id: string; seq: number } | null;
  errors: readonly DaemonError[];
  /** The listed sessions: a `session.launched` answers the card only if its session (once listed) has the card's harness and folder. */
  sessions: readonly Session[];
  /** Whether the machine that answered this turn is online (`MachineState.ready`). */
  turnReady(qid: string): boolean;
  /** The machine that answered this turn: a card's session starts there. */
  turnMachine(qid: string): string | undefined;
  /** The card's session started (its qualified id): called once per launch. */
  onLaunched(id: string): void;
}
export interface ChatCards {
  launchingQid: string | null; relayingQid: string | null;
  /** The rows of `launchingQid`'s card in flight (#24). */
  launchingRows: readonly number[] | null;
  /** Launches the card's rows (#24; its first row without `rows`): the launched ones are left out, all in one message. */
  launch(qid: string, rows?: number[]): void; relay(qid: string): void; cancelRelay(qid: string): void;
  /** The rows of `closingQid`'s close card in flight. */
  closingQid: string | null; closingRows: readonly number[] | null;
  /** Closes the card's open rows (`rows`, or all of them), in one message. */
  close(qid: string, rows?: number[]): void;
  /** The model and effort chosen on the card (#58), sent with its launch; the agent's default until one is chosen. */
  pick(qid: string): ModelPick; setPick(qid: string, pick: ModelPick): void;
}

/** A launch in flight: its rows and each row as sent (its error tells a new failure from the old one), what was seen at the send, the rows announced. */
interface Launching { qid: string; rows: number[]; from: ChatProposal[]; machineId: string | undefined; launchedSeq: number; errorSeq: number; announced: Set<number> }
/** A close in flight: its rows and each row's error as sent (a new error tells a failure from the old one). */
interface Closing { qid: string; rows: number[]; from: Array<string | undefined>; errorSeq: number }
interface Relaying { qid: string; from: string; errorSeq: number }

const relayState = (chat: readonly ChatTurn[], qid: string): string => {
  const r = chat.find(x => x.qid === qid)?.relay;
  return r ? `${r.status ?? ''}|${r.sentAt ?? ''}|${r.error ?? ''}` : 'gone';
};

/** The chat cards' launches and relays (the island's Surface.tsx, spec 2026-10-12 §6), for Desktop: one at a time, nothing optimistic.
 *  A launch sends `session.launch { tool, cwd, prompt?, qid }`; the next `session.launched` is announced (`onLaunched`), and the card
 *  is freed once its turn says so (the history's `launchedId` or a new `error`), by a refusal of the launch (an error without id),
 *  or when its machine goes away. A relay sends `session.relay` / `session.relay.cancel { qid }` and is freed when its turn's relay
 *  changes, by an error without id, or when its machine goes away. A close sends `session.close { qid, rows? }` and is freed when every
 *  sent row is marked (`closedAt`, or a new `error`), by a `session.close` refusal, or when its machine goes away. A card of a machine
 *  that is not ready does nothing. */
export function useChatCards(o: ChatCardsOptions): ChatCards {
  const latest = useRef(o);
  latest.current = o;
  // Synchronous mirrors of what is in flight: two clicks in the same frame see the first send before React renders again.
  const launching = useRef<Launching | null>(null);
  const relaying = useRef<Relaying | null>(null);
  const closing = useRef<Closing | null>(null);
  const [launchingQid, setLaunchingQid] = useState<string | null>(null);
  const [launchingRows, setLaunchingRows] = useState<readonly number[] | null>(null);
  const [closingQid, setClosingQid] = useState<string | null>(null);
  const [closingRows, setClosingRows] = useState<readonly number[] | null>(null);
  const [relayingQid, setRelayingQid] = useState<string | null>(null);
  const [picks, setPicks] = useState<ReadonlyMap<string, ModelPick>>(new Map());
  const picksNow = useRef(picks);
  picksNow.current = picks;
  const freeLaunch = () => { launching.current = null; setLaunchingQid(null); setLaunchingRows(null); };
  const freeClose = () => { closing.current = null; setClosingQid(null); setClosingRows(null); };
  const freeRelay = () => { relaying.current = null; setRelayingQid(null); };

  const launch = useCallback((qid: string, asked?: number[]) => {
    const { chat, send, turnReady, turnMachine, lastLaunched, errors } = latest.current;
    if (launching.current || relaying.current || closing.current || !turnReady(qid)) return;
    const all = proposalRows(chat.find(x => x.qid === qid));
    const rows = (asked ?? [0]).filter(r => all[r] && !all[r]!.launchedId);
    const p = all[rows[0] ?? -1];
    if (!p) return;
    launching.current = { qid, rows, from: rows.map(r => all[r]!), machineId: turnMachine(qid), launchedSeq: lastLaunched?.seq ?? 0, errorSeq: errors.at(-1)?.seq ?? 0, announced: new Set() };
    setLaunchingQid(qid); setLaunchingRows(rows);
    // The daemon reads the rows' own fields; tool and cwd stay for the schema and an older daemon (the first row).
    const { model, effort } = picksNow.current.get(qid) ?? NO_PICK;
    send({ type: 'session.launch', tool: p.tool, cwd: p.cwd, ...(p.prompt ? { prompt: p.prompt } : {}), qid, ...(asked ? { rows } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
  }, []);
  const pick = useCallback((qid: string) => picks.get(qid) ?? NO_PICK, [picks]);
  const setPick = useCallback((qid: string, next: ModelPick) => setPicks(m => new Map(m).set(qid, next)), []);

  const close = useCallback((qid: string, asked?: number[]) => {
    const { chat, send, turnReady, errors } = latest.current;
    if (launching.current || relaying.current || closing.current || !turnReady(qid)) return;
    const all = chat.find(x => x.qid === qid)?.closes ?? [];
    const open = (asked ?? all.map((_, i) => i)).filter(r => all[r] && !all[r]!.closedAt);
    if (open.length === 0) return;
    closing.current = { qid, rows: open, from: open.map(r => all[r]!.error), errorSeq: errors.at(-1)?.seq ?? 0 };
    setClosingQid(qid); setClosingRows(open);
    send({ type: 'session.close', qid, ...(asked ? { rows: open } : {}) });
  }, []);

  const relayCard = useCallback((type: 'session.relay' | 'session.relay.cancel', qid: string) => {
    const { chat, send, turnReady, errors } = latest.current;
    if (launching.current || relaying.current || closing.current || !turnReady(qid) || !chat.find(x => x.qid === qid)?.relay) return;
    relaying.current = { qid, from: relayState(chat, qid), errorSeq: errors.at(-1)?.seq ?? 0 };
    setRelayingQid(qid);
    send({ type, qid });
  }, []);
  const relay = useCallback((qid: string) => relayCard('session.relay', qid), [relayCard]);
  const cancelRelay = useCallback((qid: string) => relayCard('session.relay.cancel', qid), [relayCard]);

  const { chat, lastLaunched, errors, sessions } = o;
  const ready = launchingQid ? o.turnReady(launchingQid) : closingQid ? o.turnReady(closingQid) : relayingQid ? o.turnReady(relayingQid) : true;
  useEffect(() => {
    const l = launching.current;
    if (l) {
      // The daemon answers the launch, then marks the turn: the answer is announced at once, the card waits for its turn. Another
      // launch's answer (the New session form's: another machine, harness or folder, as useLaunch tells them apart) is passed over.
      // A row is announced once, by its answer or by its mark, whichever comes first.
      const all = proposalRows(chat.find(x => x.qid === l.qid));
      if (lastLaunched && lastLaunched.seq > l.launchedSeq) {
        const i = l.rows.findIndex((r, k) => !l.announced.has(r) && !all[r]?.launchedId && answers({ type: 'session.launch', tool: l.from[k]!.tool, cwd: l.from[k]!.cwd, ...(l.machineId ? { machineId: l.machineId } : {}) }, lastLaunched.id, sessions));
        if (i >= 0) { l.announced.add(l.rows[i]!); latest.current.onLaunched(lastLaunched.id); }
        l.launchedSeq = lastLaunched.seq;
      }
      for (const r of l.rows) { const id = all[r]?.launchedId; if (id && !l.announced.has(r)) { l.announced.add(r); latest.current.onLaunched(id); } }
      const settled = l.rows.every((r, k) => !all[r] || all[r]!.launchedId || all[r]!.error !== l.from[k]!.error);
      const refused = errors.some(e => e.seq > l.errorSeq && e.id === undefined && (e.request === 'session.launch' || l.rows.some(r => e.message === all[r]?.error)));
      if (all.length === 0 || settled || refused || !ready) freeLaunch();
    }
    const c = closing.current;
    if (c) {
      // The daemon marks each row of the turn as it closes it (`closedAt`) or fails it (a new `error`); a refusal comes without id.
      const rows = chat.find(x => x.qid === c.qid)?.closes ?? [];
      const settled = c.rows.every((r, k) => !rows[r] || rows[r]!.closedAt || rows[r]!.error !== c.from[k]);
      const refused = errors.some(e => e.seq > c.errorSeq && e.id === undefined && e.request === 'session.close');
      if (rows.length === 0 || settled || refused || !ready) freeClose();
    }
    const r = relaying.current;
    if (r && (relayState(chat, r.qid) !== r.from || errors.some(e => e.seq > r.errorSeq && e.id === undefined) || !ready)) freeRelay();
  }, [chat, lastLaunched, errors, sessions, ready]);

  return { launchingQid, launchingRows, closingQid, closingRows, close, relayingQid, launch, relay, cancelRelay, pick, setPick };
}

export interface PointActsOptions {
  send(m: ClientMessage): void;
  chat: readonly ChatTurn[];
  errors: readonly DaemonError[];
  /** Whether the machine that wrote this point is online: a row of one that is not does nothing. */
  turnReady(qid: string): boolean;
}
type PointAnswer = { id: string } | { text: string };
/** A row of a point being acted on: the answer (or the suggestion, without one), what the row was when it went, the last error then. */
interface PointActing { qid: string; item: string; answer?: PointAnswer; from: string; errorSeq: number }
export interface PointActs {
  /** The row on its way, and the row the daemon asked to confirm (its answer, or the suggestion without one). */
  busy: { qid: string; item: string } | null;
  confirm: { qid: string; item: string; answer?: PointAnswer } | null;
  answer(qid: string, item: string, a: PointAnswer): void;
  suggest(qid: string, item: string): void;
  /** Sends the row asked to confirm again with `confirmed`, or drops it. */
  settle(go: boolean): void;
}

/** How a row looks now, to tell its change (settled, an error, its suggestion's state) from the row as it was sent. */
const rowState = (chat: readonly ChatTurn[], qid: string, item: string): string => {
  const i = chat.find(x => x.qid === qid)?.point?.items.find(x => x.id === item);
  return i ? JSON.stringify([i.settled, i.error, i.suggestion?.state, i.suggestion?.code]) : 'gone';
};

/** The operator point's rows (Task 11, spec §4), one at a time, nothing optimistic: `point.act { qid, item, answer | suggest }` is
 *  freed once the row changes in the history or the daemon refuses it. A refusal coded `confirm_required` (an accepted request, a
 *  decision, a destructive suggestion) asks the row again, as the generic card does, then goes with `confirmed`. */
export function usePointActs(o: PointActsOptions): PointActs {
  const latest = useRef(o);
  latest.current = o;
  const acting = useRef<PointActing | null>(null);
  const [busy, setBusy] = useState<PointActs['busy']>(null);
  const [confirm, setConfirm] = useState<PointActs['confirm']>(null);
  const free = () => { acting.current = null; setBusy(null); };

  const go = useCallback((qid: string, item: string, answer: PointAnswer | undefined, confirmed: boolean) => {
    const { send, chat, errors, turnReady } = latest.current;
    if (acting.current || !turnReady(qid)) return;
    acting.current = { qid, item, ...(answer ? { answer } : {}), from: rowState(chat, qid, item), errorSeq: errors.at(-1)?.seq ?? 0 };
    setBusy({ qid, item }); setConfirm(null);
    send({ type: 'point.act', qid, item, ...(answer ? { answer } : { suggest: true as const }), ...(confirmed ? { confirmed: true as const } : {}) });
  }, []);
  const answer = useCallback((qid: string, item: string, a: PointAnswer) => go(qid, item, a, false), [go]);
  const suggest = useCallback((qid: string, item: string) => go(qid, item, undefined, false), [go]);
  const asked = useRef(confirm);
  asked.current = confirm;
  const settle = useCallback((yes: boolean) => {
    const c = asked.current;
    setConfirm(null);
    if (c && yes) go(c.qid, c.item, c.answer, true);
  }, [go]);

  const { chat, errors } = o;
  const ready = busy ? o.turnReady(busy.qid) : true;
  useEffect(() => {
    const a = acting.current;
    if (!a) return;
    const refusal = errors.find(e => e.seq > a.errorSeq && e.request === 'point.act');
    if (refusal?.code === 'confirm_required') { free(); setConfirm({ qid: a.qid, item: a.item, ...(a.answer ? { answer: a.answer } : {}) }); return; }
    // A suggestion stays running while its card applies: the row is freed once it is no longer running.
    const now = rowState(chat, a.qid, a.item);
    const running = chat.find(x => x.qid === a.qid)?.point?.items.find(x => x.id === a.item)?.suggestion?.state === 'running';
    if (refusal || !ready || (now !== a.from && !running)) free();
  }, [chat, errors, ready]);

  return { busy, confirm, answer, suggest, settle };
}

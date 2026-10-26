import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonError } from '@ledge/fleet';
import type { ChatTurn, ClientMessage, ServerMessage } from '@ledge/protocol';

export interface ActionCardsOptions {
  send(m: ClientMessage): void;
  chat: readonly ChatTurn[];
  errors: readonly DaemonError[];
  /** Whether the machine that answered this turn is online: a card of one that is not does nothing. */
  turnReady(qid: string): boolean;
  /** The daemon's messages: its `chat.acted` frees the card it answers. */
  onMessage?(fn: (m: ServerMessage) => void): () => void;
}
export interface ActionCards {
  /** The turn whose generic card is being applied, and its rows sent. */
  actingQid: string | null; actingRows: readonly number[] | null;
  /** Applies the card's rows in order (`chat.act`), `confirmed` once the card asked again. */
  act(qid: string, rows: number[], confirmed: boolean): void;
  /** « Deny » a session.decide row: its session's request answered with deny (chat.act's `deny`), never confirmed. */
  deny(qid: string, row: number): void;
  /** « Ignore » the turn's cards on every device, or `undo` (« Review »). */
  ignore(qid: string, undo: boolean): void;
}

interface Acting { rid: string; qid: string; rows: number[]; errorSeq: number }
/** Whether the rows sent are over: the turn gone or set aside, one of them stopped (failed or refused), or all of them settled.
 *  A plan's first row running, the next ones still to come: not over. */
const over = (chat: readonly ChatTurn[], a: Acting): boolean => {
  const t = chat.find(x => x.qid === a.qid);
  if (!t?.actions || t.ignoredAt) return true;
  const states = a.rows.map(r => t.actions![r]?.state);
  return states.some(s => s === 'failed' || s === 'refused') || states.every(s => s === 'done' || s === 'denied');
};

/** The chat's generic card (#94) for the Desktop and the island, one at a time, nothing optimistic: `chat.act { rid, qid, rows,
 *  confirmed? | deny? }` is freed once no row sent runs or is still to come (chat.history), by its `chat.acted`, by a refusal
 *  of it, or when its machine goes away.
 *  `chat.ignore` waits for nothing: every device gets the turn's `ignoredAt` through chat.history. */
export function useActionCards(o: ActionCardsOptions): ActionCards {
  const latest = useRef(o);
  latest.current = o;
  // A synchronous mirror: two clicks in the same frame see the first send.
  const acting = useRef<Acting | null>(null);
  const [actingQid, setActingQid] = useState<string | null>(null);
  const [actingRows, setActingRows] = useState<readonly number[] | null>(null);
  const free = () => { acting.current = null; setActingQid(null); setActingRows(null); };

  const actOn = useCallback((qid: string, rows: number[], how: { confirmed: true } | { deny: true } | Record<string, never>) => {
    const { chat, send, turnReady, errors } = latest.current;
    if (acting.current || !turnReady(qid) || rows.length === 0) return;
    const rid = `act-${crypto.randomUUID()}`;
    acting.current = { rid, qid, rows, errorSeq: errors.at(-1)?.seq ?? 0 };
    setActingQid(qid); setActingRows(rows);
    send({ type: 'chat.act', rid, qid, rows, ...how });
  }, []);
  const act = useCallback((qid: string, rows: number[], confirmed: boolean) => actOn(qid, rows, confirmed ? { confirmed: true } : {}), [actOn]);
  const deny = useCallback((qid: string, row: number) => actOn(qid, [row], { deny: true }), [actOn]);
  const ignore = useCallback((qid: string, undo: boolean) => {
    const { send, turnReady } = latest.current;
    if (!turnReady(qid)) return;
    send({ type: 'chat.ignore', qid, ...(undo ? { undo: true as const } : {}) });
  }, []);

  const { chat, errors } = o;
  const ready = actingQid ? o.turnReady(actingQid) : true;
  useEffect(() => {
    const a = acting.current;
    if (a && (over(chat, a) || errors.some(e => e.seq > a.errorSeq && e.request === 'chat.act') || !ready)) free();
  }, [chat, errors, ready]);
  // The daemon's answer to the send, whatever the history says (rows already done, nothing changed).
  const { onMessage } = o;
  useEffect(() => onMessage?.(m => { if (m.type === 'chat.acted' && m.rid === acting.current?.rid) free(); }), [onMessage]);

  return { actingQid, actingRows, act, deny, ignore };
}

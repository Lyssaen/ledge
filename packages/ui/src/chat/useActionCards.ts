import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonError } from '@ledge/fleet';
import type { ChatTurn, ClientMessage } from '@ledge/protocol';

export interface ActionCardsOptions {
  send(m: ClientMessage): void;
  chat: readonly ChatTurn[];
  errors: readonly DaemonError[];
  /** Whether the machine that answered this turn is online: a card of one that is not does nothing. */
  turnReady(qid: string): boolean;
}
export interface ActionCards {
  /** The turn whose generic card is being applied, and its rows sent. */
  actingQid: string | null; actingRows: readonly number[] | null;
  /** Applies the card's rows in order (`chat.act`), `confirmed` once the card asked again. */
  act(qid: string, rows: number[], confirmed: boolean): void;
  /** « Ignore » the turn's cards on every device, or `undo` (« Review »). */
  ignore(qid: string, undo: boolean): void;
}

interface Acting { qid: string; rows: number[]; from: string; errorSeq: number }
/** What the daemon says of a turn's card: each row's state and code, and whether it was set aside. */
const cardState = (chat: readonly ChatTurn[], qid: string): string => {
  const t = chat.find(x => x.qid === qid);
  return t?.actions ? `${t.ignoredAt ?? ''}|${t.actions.map(a => `${a.state ?? ''}:${a.code ?? ''}`).join()}` : 'gone';
};

/** The chat's generic card (#94) for the Desktop and the island, one at a time, nothing optimistic: `chat.act { rid, qid, rows,
 *  confirmed? }` is freed once the turn's rows change (chat.history), by a refusal of it, or when its machine goes away.
 *  `chat.ignore` waits for nothing: every device gets the turn's `ignoredAt` through chat.history. */
export function useActionCards(o: ActionCardsOptions): ActionCards {
  const latest = useRef(o);
  latest.current = o;
  // A synchronous mirror: two clicks in the same frame see the first send.
  const acting = useRef<Acting | null>(null);
  const [actingQid, setActingQid] = useState<string | null>(null);
  const [actingRows, setActingRows] = useState<readonly number[] | null>(null);
  const free = () => { acting.current = null; setActingQid(null); setActingRows(null); };

  const act = useCallback((qid: string, rows: number[], confirmed: boolean) => {
    const { chat, send, turnReady, errors } = latest.current;
    if (acting.current || !turnReady(qid) || rows.length === 0) return;
    acting.current = { qid, rows, from: cardState(chat, qid), errorSeq: errors.at(-1)?.seq ?? 0 };
    setActingQid(qid); setActingRows(rows);
    send({ type: 'chat.act', rid: `act-${crypto.randomUUID()}`, qid, rows, ...(confirmed ? { confirmed: true as const } : {}) });
  }, []);
  const ignore = useCallback((qid: string, undo: boolean) => {
    const { send, turnReady } = latest.current;
    if (!turnReady(qid)) return;
    send({ type: 'chat.ignore', qid, ...(undo ? { undo: true as const } : {}) });
  }, []);

  const { chat, errors } = o;
  const ready = actingQid ? o.turnReady(actingQid) : true;
  useEffect(() => {
    const a = acting.current;
    if (a && (cardState(chat, a.qid) !== a.from || errors.some(e => e.seq > a.errorSeq && e.request === 'chat.act') || !ready)) free();
  }, [chat, errors, ready]);

  return { actingQid, actingRows, act, ignore };
}

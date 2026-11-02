import { useCallback, useEffect, useRef, useState } from 'react';
import { LEDGE_GIVER, type ClientMessage, type ServerMessage } from '@ledge/protocol';

export interface TaskCards {
  /** The task row being given. */
  taskBusy: { qid: string; row: number } | null;
  giveTask(qid: string, row: number): void;
}

/** A card waits this long for the daemon's answer, then is freed (the card's own state, from the history, says the rest). */
const ANSWER_MS = 60_000;
let seq = 0;

/** The chat's task cards (roles spec §3.8), one row at a time: « Confier » sends `task.cmd { by: ledge, op: give, qid, row }`.
 *  A row is freed by its answer (`task.result`); its outcome comes back on the turn, through the history. */
export function useTaskCards(o: { send(m: ClientMessage): void; onMessage(fn: (m: ServerMessage) => void): () => void }): TaskCards {
  const [taskBusy, setTaskBusy] = useState<{ qid: string; row: number } | null>(null);
  const waiting = useRef<{ rid: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const { send, onMessage } = o;
  useEffect(() => onMessage(m => {
    const w = waiting.current;
    if (!w || m.type !== 'task.result' || m.rid !== w.rid) return;
    clearTimeout(w.timer); waiting.current = null; setTaskBusy(null);
  }), [onMessage]);
  useEffect(() => () => { if (waiting.current) clearTimeout(waiting.current.timer); }, []);
  const giveTask = useCallback((qid: string, row: number) => {
    if (waiting.current) return;
    const rid = `card-${Date.now()}-${++seq}`;
    waiting.current = { rid, timer: setTimeout(() => { waiting.current = null; setTaskBusy(null); }, ANSWER_MS) };
    setTaskBusy({ qid, row });
    send({ type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'give', qid, row });
  }, [send]);
  return { taskBusy, giveTask };
}

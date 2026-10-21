// Closes the sessions of a chat card (spec 2026-10-21 close §4), for the PC's overlays and, in lot 2, for a phone alike.
import { MAX_PROPOSALS, type CloseHow } from '@ledge/protocol';
import type { Chat, ChatMessage } from './service.js';
import type { ChatThreadId } from './threads.js';
import { log } from '../log.js';

export interface CloseDeps {
  chat: Pick<Chat, 'close' | 'markClosed' | 'markCloseFailed'>;
  /** Closes the session named `id` and says how it ended; throws (or rejects with) the reason. */
  close: (id: string) => Promise<{ how: CloseHow }>;
  emit: (m: ChatMessage) => void;
  /** The `qid#row` closes under way, shared by every caller: a second click is passed over until the first one has answered. */
  inFlight: Set<string>;
  /** Told of each row closed, once its card row is marked. */
  onClosed?: (row: number, id: string, how: CloseHow) => void;
}

/** Thrown when no row can be closed at all: every one is already closed or closing, or the card has no such row. */
export class CloseRefused extends Error {}

/**
 * A chat card's rows close in parallel (each close waits up to its delays on its own session); a closed row, or one in
 * flight, is passed over. The session's `id` is the card row's, which the store named, never the request's.
 */
export async function closeFromChat(deps: CloseDeps, qid: string, rows?: number[]): Promise<{ closed: Array<{ row: number; id: string; how: CloseHow }>; failed: Array<{ row: number; message: string }> }> {
  const { chat, inFlight } = deps;
  const safe = (m: ChatMessage) => { try { deps.emit(m); } catch (e) { log(`close: emit failed: ${(e as Error).message}`); } };
  const known = [...new Set(rows ?? [...Array(MAX_PROPOSALS).keys()])].filter(r => chat.close(qid, r));
  if (known.length === 0) throw new CloseRefused('unknown close');
  const todo = known.filter(r => !chat.close(qid, r)!.closedAt && !inFlight.has(`${qid}#${r}`));
  if (todo.length === 0) throw new CloseRefused('already closed');
  for (const r of todo) inFlight.add(`${qid}#${r}`);
  const closed: Array<{ row: number; id: string; how: CloseHow }> = [];
  const failed: Array<{ row: number; message: string }> = [];
  try {
    await Promise.all(todo.map(async r => {
      const { id } = chat.close(qid, r)!;
      let how: CloseHow;
      try { ({ how } = await deps.close(id)); }
      catch (e) { failed.push({ row: r, message: (e as Error).message }); chat.markCloseFailed(qid, r, (e as Error).message, safe); return; }
      finally { inFlight.delete(`${qid}#${r}`); }
      closed.push({ row: r, id, how });
      // A throwing emitter or listener must neither reject the row nor free the other rows' keys early (as relay.ts emitTo).
      try { chat.markClosed(qid, r, how, safe); } catch (e) { log(`close of ${id}: marking row ${r} failed: ${(e as Error).message}`); }
      try { deps.onClosed?.(r, id, how); } catch (e) { log(`close of ${id}: onClosed failed: ${(e as Error).message}`); }
    }));
  } finally { for (const r of todo) inFlight.delete(`${qid}#${r}`); }
  const byRow = (a: { row: number }, b: { row: number }) => a.row - b.row;
  return { closed: closed.sort(byRow), failed: failed.sort(byRow) };
}

/**
 * The thread that holds the turn `qid`, its chat and its emitter, as the relay finds a card's. The emitter is looked up when
 * it is called: a device thread dropped meanwhile has none, and a mark is then told to no one.
 */
export function cardOf<C>(threads: { all(): Array<[ChatThreadId, C]>; owner(qid: string): ChatThreadId | undefined; emitterOf(thread: ChatThreadId): ((m: ChatMessage) => void) | undefined }, qid: string): { thread: ChatThreadId; chat: C; emit: (m: ChatMessage) => void } | undefined {
  const thread = threads.owner(qid);
  const chat = thread && threads.all().find(([id]) => id === thread)?.[1];
  if (!thread || !chat) return undefined;
  return { thread, chat, emit: m => { try { threads.emitterOf(thread)?.(m); } catch (e) { log(`close: emit to ${thread} failed: ${(e as Error).message}`); } } };
}

import { useCallback, useSyncExternalStore } from 'react';
import type { LedgeThreadItem } from '@ledge/protocol';
import type { DaemonClient } from './client';
import { daemonStore, mergeThread, type AnswerAttempt } from './store';

export { mergeThread };
/** An answer with no `rig.result` after this long is refused (code `failed`). OpenRig can be slower than an ask. */
const ANSWER_MS = 20_000;
let next = 0;
const rid = (kind: string) => `${kind}-${Date.now().toString(36)}-${++next}`;
const get = () => daemonStore.getState();

/** The Ledge thread of the local daemon, oldest first; `loadOlder` asks the older page (one request at a time). */
export function useLedgeThread(client: DaemonClient): { items: LedgeThreadItem[]; hasOlder: boolean; loadOlder(): void } {
  const items = useSyncExternalStore(daemonStore.subscribe, () => get().ledgeThread, () => get().ledgeThread);
  const before = useSyncExternalStore(daemonStore.subscribe, () => get().threadBefore, () => get().threadBefore);
  const loadOlder = useCallback(() => {
    const { threadBefore, threadLoading } = get();
    if (threadBefore === undefined || threadLoading) return;
    daemonStore.beginThreadLoad();
    client.send({ type: 'ledge.thread.request', before: threadBefore });
  }, [client]);
  return { items, hasOlder: before !== undefined, loadOlder };
}

/** Sends the answer to an escalation (to the local daemon) and notes the attempt; returns its rid. */
export function answerEscalation(client: DaemonClient, id: string, answers: Record<string, string>): string {
  const r = rid('answer');
  daemonStore.beginAnswer(r, id);
  client.send({ type: 'escalation.answer', rid: r, id, answers, by: 'user' });
  setTimeout(() => daemonStore.settleAnswer(r, { ok: false, code: 'failed', reason: 'pas de réponse du daemon' }), ANSWER_MS);
  return r;
}

export type AnswerState = { state: 'idle' | 'sending' | 'done' | 'refused'; code?: string; reason?: string };
const IDLE: AnswerState = { state: 'idle' };
const latest = (answering: Map<string, AnswerAttempt>, id: string): AnswerAttempt | undefined => { let found: AnswerAttempt | undefined; for (const a of answering.values()) if (a.id === id) found = a; return found; };
/** The state of the latest answer attempt of escalation `id`. */
export function useAnswerState(id: string): AnswerState {
  const a = useSyncExternalStore(daemonStore.subscribe, () => latest(get().answering, id), () => undefined);
  if (!a) return IDLE;
  if (!a.result) return { state: 'sending' };
  if (a.result.ok) return { state: 'done' };
  return { state: 'refused', ...(a.result.code ? { code: a.result.code } : {}), ...(a.result.reason ? { reason: a.result.reason } : {}) };
}

/** Writes to Ledge (`about` = the escalation talked about). The reply comes in the thread; `rig.result` is not tracked. */
export function sayToLedge(client: DaemonClient, text: string, about?: string): void {
  client.send({ type: 'ledge.say', rid: rid('say'), text, ...(about ? { about } : {}) });
}

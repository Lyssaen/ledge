import type { Session } from '@ledge/protocol';
import type { DaemonError } from '@ledge/fleet';

/** What the conversation has sent and not seen land yet (spec §9.1: « Envoyé… », an error reopens the action). */
export type SendKind = 'decision' | 'reply' | 'interrupt' | 'kill' | 'dismiss' | 'rename';
export interface Sent { kind: SendKind; text?: string; request: string | null; mark: string; errorSeq: number }
export interface Failure { kind: SendKind; message: string; text?: string; request: string | null }
export interface SendsState { sent: Readonly<Record<string, Sent>>; failed: Readonly<Record<string, Failure>> }
export type SendsAction =
  | { type: 'sent'; session: Session; kind: SendKind; text?: string; errorSeq: number }
  | { type: 'sessions'; sessions: readonly Session[] }
  | { type: 'error'; error: DaemonError }
  | { type: 'forget'; id: string };
export const NO_SENDS: SendsState = { sent: {}, failed: {} };

/** The request a decision answers: it is settled once this changes. */
export function requestKey(s: Session): string | null {
  return s.pending ? `${s.pending.kind}\n${s.pending.text}\n${s.pending.helperId ?? ''}` : null;
}
/** Anything the daemon changes after it took a message or a command. */
export function markOf(s: Session): string {
  return [s.state, s.lastActivityAt, s.lastReply?.at ?? '', requestKey(s) ?? '', s.topic ?? ''].join('|');
}
const without = <T>(map: Readonly<Record<string, T>>, id: string): Record<string, T> => { const out = { ...map }; delete out[id]; return out; };

export function reduceSends(state: SendsState, a: SendsAction): SendsState {
  switch (a.type) {
    case 'sent': {
      const s = a.session;
      const sent: Sent = { kind: a.kind, ...(a.text !== undefined ? { text: a.text } : {}), request: a.kind === 'decision' ? requestKey(s) : null, mark: markOf(s), errorSeq: a.errorSeq };
      return { sent: { ...state.sent, [s.id]: sent }, failed: state.failed[s.id] ? without(state.failed, s.id) : state.failed };
    }
    case 'error': {
      const id = a.error.id;
      const cur = id ? state.sent[id] : undefined;
      if (!id || !cur || a.error.seq <= cur.errorSeq) return state;
      const failure: Failure = { kind: cur.kind, message: a.error.message, ...(cur.text !== undefined ? { text: cur.text } : {}), request: cur.request };
      return { sent: without(state.sent, id), failed: { ...state.failed, [id]: failure } };
    }
    case 'sessions': {
      const byId = new Map(a.sessions.map(s => [s.id, s]));
      let sent = state.sent, failed = state.failed;
      for (const [id, x] of Object.entries(state.sent)) {
        const s = byId.get(id);
        const landed = s && !s.offline && (x.request !== null ? requestKey(s) !== x.request : markOf(s) !== x.mark);
        if (!s || landed) sent = without(sent, id);
      }
      for (const [id, f] of Object.entries(state.failed)) {
        const s = byId.get(id);
        if (!s || (f.request !== null && !s.offline && requestKey(s) !== f.request)) failed = without(failed, id);
      }
      return sent === state.sent && failed === state.failed ? state : { sent, failed };
    }
    case 'forget': return state.failed[a.id] ? { ...state, failed: without(state.failed, a.id) } : state;
  }
}

/** Why nothing can be sent to this session at all: its machine is disconnected (spec §6), or it is a hook-only session. */
export type Blocked = 'offline' | 'readonly';
export function blocked(s: Session): Blocked | null {
  if (s.offline) return 'offline';
  if (s.source === 'hook_only') return 'readonly';
  return null;
}
/** Why the composer cannot send free text now: a permission, plan or diff waits for its buttons, or a question's
 *  options cannot take free text outside Claude (island parity). */
export type ReplyBlock = Blocked | 'request' | 'options';
export function replyBlock(s: Session): ReplyBlock | null {
  const b = blocked(s); if (b) return b;
  if (s.pending && s.pending.kind !== 'question') return 'request';
  if (s.pending?.kind === 'question' && (s.pending.options?.length ?? 0) > 0 && s.tool !== 'claude') return 'options';
  return null;
}

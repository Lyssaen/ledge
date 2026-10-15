import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ClientMessage, Session } from '@ledge/protocol';
import { daemonStore, useDaemon, type DaemonClient, type MachineState } from '@ledge/fleet';
import { NO_SENDS, blocked, reduceSends, replyBlock, type SendKind, type SendsAction, type SendsState } from './sends';
import { useStored } from '../state/useStored';
import { loadDrafts, saveDrafts, setDraft } from '../state/drafts';
import { NO_PREF, loadThreadPrefs, saveThreadPrefs, setThreadPref, type ThreadPref } from '../state/threadPrefs';
import { pruneGone } from '../state/prune';

export type SessionCommand = 'interrupt' | 'kill' | 'dismiss';
export interface Conversations {
  sends: SendsState;
  decide(s: Session, decision: 'accept' | 'deny'): void;
  answer(s: Session, option: number): void;
  reply(s: Session, text: string): boolean;
  command(s: Session, kind: SessionCommand): void;
  rename(s: Session, topic: string): void;
  forget(id: string): void;
  draft(id: string): string;
  setDraft(id: string, text: string): void;
  pref(id: string): ThreadPref;
  setPref(id: string, patch: Partial<ThreadPref>): void;
}
const TOPIC_MAX = 500;
const errorSeq = () => daemonStore.getState().lastError?.seq ?? 0;

/** Everything the conversation sends (spec §9.1), with the drafts and thread preferences it keeps (spec §7). Every path checks
 *  `offline` (spec §14); free text is never read as a command. `ready` must mean the Shell has received the daemon's first
 *  snapshot (`opened`): pruning earlier would wipe every saved draft against an empty sessions list. */
export function useConversations(client: DaemonClient, sessions: readonly Session[], machines: readonly MachineState[], ready: boolean): Conversations {
  const { lastError } = useDaemon();
  const [sends, dispatch] = useReducer(reduceSends, NO_SENDS);
  // A synchronous mirror of `sends`: two clicks in the same frame see the first send before React renders again.
  const live = useRef<SendsState>(NO_SENDS);
  const apply = useCallback((a: SendsAction) => { live.current = reduceSends(live.current, a); dispatch(a); }, []);
  // Module-level savers: `useStored` has `save` in an effect's deps.
  const [drafts, setDrafts] = useStored(loadDrafts, saveDrafts);
  const [prefs, setPrefs] = useStored(loadThreadPrefs, saveThreadPrefs);

  useEffect(() => { apply({ type: 'sessions', sessions }); }, [sessions, apply]);
  useEffect(() => { if (lastError) apply({ type: 'error', error: lastError }); }, [lastError, apply]);
  // A message that failed comes back into an empty composer, so nothing typed is lost.
  useEffect(() => {
    for (const [id, f] of Object.entries(sends.failed)) {
      const text = f.kind === 'reply' ? f.text : undefined;
      if (text) setDrafts(d => (d[id] ? d : setDraft(d, id, text)));
    }
  }, [sends.failed, setDrafts]);
  useEffect(() => {
    if (!ready) return;
    setDrafts(d => pruneGone(d, sessions, machines));
    setPrefs(p => pruneGone(p, sessions, machines));
  }, [ready, sessions, machines, setDrafts, setPrefs]);

  const inFlight = (s: Session) => live.current.sent[s.id];
  const canDecide = (s: Session) => !blocked(s) && !!s.pending && inFlight(s)?.kind !== 'decision';
  const out = (s: Session, msg: ClientMessage, kind: SendKind, text?: string) => {
    client.send(msg);
    apply({ type: 'sent', session: s, kind, ...(text !== undefined ? { text } : {}), errorSeq: errorSeq() });
  };
  return {
    sends,
    decide(s, decision) { if (canDecide(s)) out(s, { type: 'session.decide', id: s.id, decision }, 'decision'); },
    answer(s, option) {
      if (!canDecide(s) || s.pending?.kind !== 'question' || !Number.isInteger(option) || option < 0) return;
      out(s, { type: 'session.reply', id: s.id, text: String(option + 1) }, 'decision');
    },
    reply(s, text) {
      const body = text.trim();
      const cur = inFlight(s);
      if (!body || replyBlock(s) || (cur?.kind === 'reply' && cur.text === body)) return false;
      out(s, { type: 'session.reply', id: s.id, text: body }, 'reply', body);
      setDrafts(d => setDraft(d, s.id, ''));
      return true;
    },
    command(s, kind) {
      if (s.offline || inFlight(s)?.kind === kind) return;
      const msg: ClientMessage = kind === 'interrupt' ? { type: 'session.interrupt', id: s.id } : kind === 'kill' ? { type: 'session.kill', id: s.id } : { type: 'session.dismiss', id: s.id };
      out(s, msg, kind);
    },
    rename(s, topic) {
      const next = topic.trim().slice(0, TOPIC_MAX);
      if (s.offline || next === (s.topic ?? '')) return;
      out(s, { type: 'session.rename', id: s.id, topic: next }, 'rename');
    },
    forget(id) { apply({ type: 'forget', id }); },
    draft(id) { return drafts[id] ?? ''; },
    setDraft(id, text) {
      setDrafts(d => setDraft(d, id, text));
      if (live.current.failed[id]?.kind === 'reply') apply({ type: 'forget', id });
    },
    pref(id) { return prefs[id] ?? NO_PREF; },
    setPref(id, patch) { setPrefs(p => setThreadPref(p, id, patch)); }
  };
}

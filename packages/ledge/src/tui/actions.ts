import { useEffect, useMemo, useRef } from 'react';
import type { DaemonClient, DaemonError } from '@ledge/fleet';
import { useDecisions } from '@ledge/fleet/decisions';
import type { Session } from '@ledge/protocol';
import type { Messages } from './i18n/lang.js';
import { answerFor } from './model/pending.js';

export type Toast = { text: string; tone: 'ok' | 'info' | 'error' };

export interface Actions {
  /** A key on the session's request (y, n, A, 1…9): sent, or the reason it was not in a toast. False when the key means nothing here. */
  key(s: Session, key: string): boolean;
  /** Deny with a note the agent reads. */
  denyWithNote(s: Session, note: string, onRefused: (text: string) => void): void;
  /** `how.attachments`: the stored ids of the images that go with the reply. */
  reply(s: Session, text: string, onRefused: (text: string) => void, how?: { attachments?: string[] }): boolean;
  interrupt(s: Session): void;
  busy(id: string): boolean;
}

/** The TUI's sends to sessions, over the shared decisions (one in flight per session, settled when it lands, refused or timed out).
 *  A send says « ✓ … » once it has landed; a refusal or a timeout comes from the decisions' own notices. */
export function useActions(o: { client: DaemonClient; sessions: readonly Session[]; errors: readonly DaemonError[]; t: Messages; toast(t: Toast): void }): Actions {
  const { t, toast } = o;
  const decisions = useDecisions({ client: o.client, sessions: o.sessions, errors: o.errors, notify: text => toast({ text, tone: 'error' }), copy: t.decisions });
  // The « ✓ » to say once the send lands, by session.
  const onLand = useRef(new Map<string, string>());
  useEffect(() => {
    const id = decisions.landed;
    if (!id) return;
    const text = onLand.current.get(id);
    if (text) { onLand.current.delete(id); toast({ text, tone: 'ok' }); }
  }, [decisions.landed]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo<Actions>(() => ({
    key(s, key) {
      const a = answerFor(s, key);
      if (!a) return false;
      if (a.kind === 'refused') { toast({ text: t.toast[a.why](s.name), tone: 'info' }); return true; }
      if (decisions.busy(s.id)) { toast({ text: t.toast.busy(s.name), tone: 'info' }); return true; }
      const sent = a.kind === 'decide' ? decisions.decide(s, a.decision)
        : a.kind === 'option' ? decisions.reply(s, String(a.n))
        : decisions.answer(s, [{ id: a.questionId, selected: [a.label] }]);
      if (sent) onLand.current.set(s.id, a.kind === 'decide' ? t.toast[a.decision](s.name) : t.toast.option(s.name, a.n));
      else toast({ text: t.toast.notNow(s.name), tone: 'info' });
      return true;
    },
    denyWithNote(s, note, onRefused) {
      if (decisions.decide(s, 'deny', note, onRefused)) onLand.current.set(s.id, t.toast.deny(s.name));
      else { onRefused(note); toast({ text: t.toast.noNote(s.name), tone: 'info' }); }
    },
    reply(s, text, onRefused, how) {
      const sent = decisions.reply(s, text, onRefused, how);
      if (sent) onLand.current.set(s.id, t.toast.reply(s.name));
      else toast({ text: s.offline ? t.toast.offline(s.name) : s.source === 'hook_only' ? t.toast.readOnly(s.name) : t.toast.busy(s.name), tone: 'info' });
      return sent;
    },
    interrupt(s) {
      if (s.offline) { toast({ text: t.toast.offline(s.name), tone: 'info' }); return; }
      if (s.source === 'hook_only') { toast({ text: t.toast.readOnly(s.name), tone: 'info' }); return; }
      o.client.send({ type: 'session.interrupt', id: s.id });
      toast({ text: t.toast.interrupted(s.name), tone: 'info' });
    },
    busy: id => decisions.busy(id)
  }), [decisions, t, toast, o.client]);
}

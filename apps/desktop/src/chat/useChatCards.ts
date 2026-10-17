import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonError } from '@ledge/fleet';
import type { ChatProposal, ChatTurn, ClientMessage, Session } from '@ledge/protocol';
import { answers } from '../launch/useLaunch';

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
  /** The card's session started (its qualified id) from this proposal: called once per launch. */
  onLaunched(id: string, proposal: ChatProposal): void;
}
export interface ChatCards {
  launchingQid: string | null; relayingQid: string | null;
  launch(qid: string): void; relay(qid: string): void; cancelRelay(qid: string): void;
}

/** A launch in flight: the proposal as sent (its error tells a new failure from the old one), what was seen at the send, whether announced. */
interface Launching { qid: string; from: ChatProposal; machineId: string | undefined; launchedSeq: number; errorSeq: number; announced: boolean }
interface Relaying { qid: string; from: string; errorSeq: number }

const relayState = (chat: readonly ChatTurn[], qid: string): string => {
  const r = chat.find(x => x.qid === qid)?.relay;
  return r ? `${r.status ?? ''}|${r.sentAt ?? ''}|${r.error ?? ''}` : 'gone';
};

/** The chat cards' launches and relays (the island's Surface.tsx, spec 2026-10-12 §6), for Desktop: one at a time, nothing optimistic.
 *  A launch sends `session.launch { tool, cwd, prompt?, qid }`; the next `session.launched` is announced (`onLaunched`), and the card
 *  is freed once its turn says so (the history's `launchedId` or a new `error`), by a refusal of the launch (an error without id),
 *  or when its machine goes away. A relay sends `session.relay` / `session.relay.cancel { qid }` and is freed when its turn's relay
 *  changes, by an error without id, or when its machine goes away. A card of a machine that is not ready does nothing. */
export function useChatCards(o: ChatCardsOptions): ChatCards {
  const latest = useRef(o);
  latest.current = o;
  // Synchronous mirrors of what is in flight: two clicks in the same frame see the first send before React renders again.
  const launching = useRef<Launching | null>(null);
  const relaying = useRef<Relaying | null>(null);
  const [launchingQid, setLaunchingQid] = useState<string | null>(null);
  const [relayingQid, setRelayingQid] = useState<string | null>(null);
  const freeLaunch = () => { launching.current = null; setLaunchingQid(null); };
  const freeRelay = () => { relaying.current = null; setRelayingQid(null); };

  const launch = useCallback((qid: string) => {
    const { chat, send, turnReady, turnMachine, lastLaunched, errors } = latest.current;
    if (launching.current || relaying.current || !turnReady(qid)) return;
    const p = chat.find(x => x.qid === qid)?.proposal;
    if (!p || p.launchedId) return;
    launching.current = { qid, from: p, machineId: turnMachine(qid), launchedSeq: lastLaunched?.seq ?? 0, errorSeq: errors.at(-1)?.seq ?? 0, announced: false };
    setLaunchingQid(qid);
    send({ type: 'session.launch', tool: p.tool, cwd: p.cwd, ...(p.prompt ? { prompt: p.prompt } : {}), qid });
  }, []);

  const relayCard = useCallback((type: 'session.relay' | 'session.relay.cancel', qid: string) => {
    const { chat, send, turnReady, errors } = latest.current;
    if (launching.current || relaying.current || !turnReady(qid) || !chat.find(x => x.qid === qid)?.relay) return;
    relaying.current = { qid, from: relayState(chat, qid), errorSeq: errors.at(-1)?.seq ?? 0 };
    setRelayingQid(qid);
    send({ type, qid });
  }, []);
  const relay = useCallback((qid: string) => relayCard('session.relay', qid), [relayCard]);
  const cancelRelay = useCallback((qid: string) => relayCard('session.relay.cancel', qid), [relayCard]);

  const { chat, lastLaunched, errors, sessions } = o;
  const ready = launchingQid ? o.turnReady(launchingQid) : relayingQid ? o.turnReady(relayingQid) : true;
  useEffect(() => {
    const l = launching.current;
    if (l) {
      // The daemon answers the launch, then marks the turn: the answer is announced at once, the card waits for its turn. Another
      // launch's answer (the New session form's: another machine, harness or folder, as useLaunch tells them apart) is passed over.
      if (!l.announced && lastLaunched && lastLaunched.seq > l.launchedSeq) {
        if (answers({ type: 'session.launch', tool: l.from.tool, cwd: l.from.cwd, ...(l.machineId ? { machineId: l.machineId } : {}) }, lastLaunched.id, sessions)) { l.announced = true; latest.current.onLaunched(lastLaunched.id, l.from); }
        else l.launchedSeq = lastLaunched.seq;
      }
      const p = chat.find(x => x.qid === l.qid)?.proposal;
      if (p?.launchedId && !l.announced) { l.announced = true; latest.current.onLaunched(p.launchedId, l.from); }
      const refused = errors.some(e => e.seq > l.errorSeq && e.id === undefined && (e.request === 'session.launch' || e.message === p?.error));
      if (!p || p.launchedId || p.error !== l.from.error || refused || !ready) freeLaunch();
    }
    const r = relaying.current;
    if (r && (relayState(chat, r.qid) !== r.from || errors.some(e => e.seq > r.errorSeq && e.id === undefined) || !ready)) freeRelay();
  }, [chat, lastLaunched, errors, sessions, ready]);

  return { launchingQid, relayingQid, launch, relay, cancelRelay };
}

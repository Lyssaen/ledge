import { useCallback, useEffect, useRef, useState } from 'react';
import { daemonStore, useDaemon, type DaemonClient, type Fleet, type MachineState } from '@ledge/fleet';
import type { ChatTurn, ClientMessage } from '@ledge/protocol';
import { loadTool } from '../launch/form';
import { cardMark, newQid, runningTurn } from './turns';

export type ChatFleet = Pick<Fleet, 'turnMachine' | 'onMachineMessage'>;
export type CardAction = 'launch' | 'relay' | 'relay.cancel';
/** The one card action waiting for its outcome: its turn, the machine it went to, the card as it was when clicked. */
export interface ChatInFlight { qid: string; kind: CardAction; machine: string; mark: string }
/** An id-less daemon error that answered a card action (shown under the card when it says something the card does not). It lasts
 *  as long as the card it answered: gone once that card changes (its outcome arrived) or its turn left the history. */
export interface ChatNote { qid: string; message: string }

export interface ChatApi {
  turns: ChatTurn[];
  live: { qid: string; text: string } | null;
  running: ChatTurn | null;
  /** A question can be sent now: local daemon up, no turn running. */
  canAsk: boolean;
  /** The running turn can be cancelled now: local daemon up (read-only otherwise, spec §6), a turn running. */
  canCancel: boolean;
  card: ChatInFlight | null;
  note: ChatNote | null;
  /** True when the fleet listed the question (the draft can go); false when it was not sent or not taken. */
  ask(text: string): boolean;
  cancel(): void;
  reset(): void;
  launch(qid: string): void;
  relay(qid: string): void;
  relayCancel(qid: string): void;
  /** The turn's machine is reachable (its card can act). */
  available(qid: string): boolean;
}

const stored = () => daemonStore.getState().chat;

/** The chat with Ledge (spec §9.3). The fleet owns the protocol (routing, bindings, the day's history); this hook adds the one rule
 *  of Desktop's own: one card action at a time, freed by its outcome, by an id-less error from its machine, or by losing that
 *  machine or the local daemon. Guards read the store and a ref, so a double click sends one message. */
export function useChat(client: DaemonClient, fleet: ChatFleet, machines: readonly MachineState[], localDown: boolean): ChatApi {
  const { chat: turns, chatLive: live } = useDaemon();
  const [card, setCard] = useState<ChatInFlight | null>(null);
  const [noted, setNoted] = useState<{ note: ChatNote; mark: string } | null>(null);
  const flight = useRef<ChatInFlight | null>(null);
  const down = useRef(localDown);
  down.current = localDown;
  const release = useCallback(() => { flight.current = null; setCard(null); }, []);

  useEffect(() => {
    const f = flight.current;
    if (!f) return;
    const turn = turns.find(t => t.qid === f.qid);
    const machine = machines.find(m => m.id === f.machine);
    if (!turn || cardMark(turn) !== f.mark || localDown || !machine?.ready) release();
  }, [turns, machines, localDown, release]);
  useEffect(() => {
    if (!noted) return;
    const turn = turns.find(t => t.qid === noted.note.qid);
    if (!turn || cardMark(turn) !== noted.mark) setNoted(null);
  }, [turns, noted]);

  useEffect(() => fleet.onMachineMessage((machine, m) => {
    const f = flight.current;
    if (!f || m.type !== 'error' || m.id !== undefined || machine !== f.machine) return;
    release();
    setNoted({ note: { qid: f.qid, message: m.message }, mark: f.mark });
  }), [fleet, release]);

  const ask = (text: string): boolean => {
    const q = text.trim();
    if (!q || down.current || runningTurn(stored())) return false;
    const qid = newQid();
    setNoted(null);
    client.send({ type: 'chat.ask', qid, text: q, tool: loadTool() });
    return stored().some(t => t.qid === qid);
  };
  const cancel = () => {
    const r = runningTurn(stored());
    if (r && !down.current) client.send({ type: 'chat.cancel', qid: r.qid });
  };
  const reset = () => {
    const all = stored();
    if (down.current || flight.current || runningTurn(all) || all.length === 0) return;
    setNoted(null);
    client.send({ type: 'chat.reset' });
  };
  const begin = (qid: string, kind: CardAction, build: (t: ChatTurn) => ClientMessage | null) => {
    if (flight.current || down.current) return;
    const turn = stored().find(t => t.qid === qid);
    const machine = fleet.turnMachine(qid);
    if (!turn || turn.answeredAt === undefined || !machine?.ready) return;
    const msg = build(turn);
    if (!msg) return;
    const f: ChatInFlight = { qid, kind, machine: machine.id, mark: cardMark(turn) };
    flight.current = f;
    setCard(f);
    setNoted(null);
    client.send(msg);
  };

  return {
    turns, live, card, note: noted?.note ?? null,
    running: runningTurn(turns),
    canAsk: !localDown && !runningTurn(turns),
    canCancel: !localDown && !!runningTurn(turns),
    ask, cancel, reset,
    launch: qid => begin(qid, 'launch', t => {
      const p = t.proposal;
      return p && !t.relay && p.launchedId === undefined ? { type: 'session.launch', tool: p.tool, cwd: p.cwd, ...(p.prompt ? { prompt: p.prompt } : {}), qid } : null;
    }),
    relay: qid => begin(qid, 'relay', t => (t.relay && t.relay.status === undefined ? { type: 'session.relay', qid } : null)),
    relayCancel: qid => begin(qid, 'relay.cancel', t => (t.relay?.status === 'queued' ? { type: 'session.relay.cancel', qid } : null)),
    available: qid => !localDown && !!fleet.turnMachine(qid)?.ready
  };
}

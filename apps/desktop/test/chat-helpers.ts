import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import type { ChatTurn, ClientMessage, ServerMessage } from '@ledge/protocol';
import type { ChatFleet } from '../src/chat/useChat';

export const T = '2026-10-15T09:00:00.000Z';
export function turn(qid: string, extra: Partial<ChatTurn> = {}): ChatTurn {
  return { qid, question: `Question ${qid}`, askedAt: T, steps: [], machineId: 'local', machineName: 'Local', ...extra };
}
/** What the fleet broadcasts after every change of the day's turns. */
export const history = (turns: ChatTurn[]) => daemonStore.apply({ type: 'chat.history', turns });

/** Local and Devbox, `down` ones unreachable. */
export function machinesUp(down: string[] = []): MachineState[] {
  return [['local', 'Local'], ['devbox', 'Devbox']].map(([id, label]) => ({
    id, label, status: down.includes(id!) ? 'unreachable' : 'open', ready: !down.includes(id!), recents: [], sessions: [], launcher: null
  })) as unknown as MachineState[];
}

/** The fleet as the chat sees it: a `chat.ask` becomes a running turn in the store unless one already runs (the fleet's
 *  « one question at a time ») or `state.refuse` is set; `chat.reset` empties the history. Everything sent is in `sent`. */
export function fakeChatClient(opts: { refuse?: boolean } = {}) {
  const sent: ClientMessage[] = [];
  const state = { refuse: opts.refuse ?? false };
  const client = {
    send(m: ClientMessage) {
      sent.push(m);
      const turns = daemonStore.getState().chat;
      if (m.type === 'chat.ask' && !state.refuse && !turns.some(t => t.answeredAt === undefined && t.error === undefined)) history([...turns, turn(m.qid, { question: m.text })]);
      if (m.type === 'chat.reset') history([]);
    }
  } as unknown as DaemonClient;
  return { client, sent, state };
}

/** `turnMachine` answers with the machine named by the turn; `machineMessage` plays a raw daemon message from one machine. */
export function fakeChatFleet() {
  let list = machinesUp();
  const listeners = new Set<(machine: string, m: ServerMessage) => void>();
  const fleet: ChatFleet = {
    turnMachine(qid) {
      const t = daemonStore.getState().chat.find(x => x.qid === qid);
      return t?.machineId ? list.find(m => m.id === t.machineId) : undefined;
    },
    onMachineMessage(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
  };
  return {
    fleet,
    setMachines(next: MachineState[]) { list = next; },
    machineMessage(machine: string, m: ServerMessage) { for (const l of listeners) l(machine, m); }
  };
}

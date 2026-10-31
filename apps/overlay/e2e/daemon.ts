import type { Page, WebSocketRoute } from '@playwright/test';
import type { ChatAction, ChatClose, ChatProposal, ChatRelay, ChatTurn, ClientMessage, DaemonInfo, Escalation, Exchange, IslandPrefs, LedgeThreadItem, OpenRigStatus, Recent, Rig, Session } from '@ledge/protocol';

export const T0 = new Date(Date.now() - 5 * 60_000).toISOString();
export function session(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}

/** Ledge's scripted answer to every `ledge.say` (lot 4): its text and the cards of its turn. */
export interface ChatReply { text: string; proposal?: ChatProposal; relay?: ChatRelay; closes?: ChatClose[]; actions?: ChatAction[] }

/**
 * Simulates the ledge daemon inside the page: answers the overlay's WebSocket with a snapshot and lets the test push updates.
 * OpenRig (lot 4), as Desktop's fake speaks it: after the snapshot, `openrig.status` (`openrig`, none by default), the local
 * `rig.snapshot` of `rigs` (when `openrig` is given), an `escalation.updated` per `escalations`, then `ledge.thread.history` from `thread`.
 * A `rig.exchanges.request` is answered from `exchanges` (keyed by rig id); `ledge.thread.request` from the thread. An `escalation.answer`
 * is accepted after `answerDelayMs` (`escalation.updated` answered, then `rig.result` ok), a later one gets `already_answered`.
 * A `ledge.say` adds the user's item (`to` for a leading `@seat`, which is all it does), else plays `chat` as the runner does
 * (`chat.history` first, the pending bubble, `chat.delta`, `chat.done`, the finished bubble). `pushEscalation`, `pushExchange`
 * and `threadItem` play later news; `said` gives each `ledge.say`'s turn.
 */
export async function fakeDaemon(page: Page, initial: Session[], {
  island: islandPrefs, openrig, rigs: rigList, escalations: escalationList, exchanges: exchangeLists, thread: threadItems, answerDelayMs, chat, ...extras
}: {
  recents?: Recent[]; launcher?: string[]; daemon?: DaemonInfo;
  /** The island's settings it holds (null: none yet); absent, a daemon that never speaks of them. */
  island?: IslandPrefs | null;
  openrig?: OpenRigStatus; rigs?: Rig[]; escalations?: Escalation[]; exchanges?: Record<string, Exchange[]>; thread?: LedgeThreadItem[]; answerDelayMs?: number; chat?: ChatReply;
} = {}) {
  const sessions = new Map(initial.map(s => [s.id, s]));
  let island = islandPrefs;
  const received: ClientMessage[] = [];
  const rigs = new Map((rigList ?? []).map(r => [r.id, r]));
  const exchanges = new Map(Object.entries(exchangeLists ?? {}).map(([rigId, items]) => [rigId, [...items]]));
  const escalations = new Map((escalationList ?? []).map(e => [e.id, e]));
  const thread: LedgeThreadItem[] = [...(threadItems ?? [])];
  const answering = new Set<string>();
  const turns: ChatTurn[] = [];
  let says = 0;
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/127\.0\.0\.1:47831/, ws => {
    socket = ws;
    const out = (m: unknown) => { try { ws.send(JSON.stringify(m)); } catch { /* the page is gone */ } };
    out({ type: 'snapshot', sessions: [...sessions.values()], ...extras });
    if (island !== undefined) out({ type: 'island', prefs: island });
    if (openrig) { out({ type: 'openrig.status', status: openrig }); out({ type: 'rig.snapshot', machine: 'local', rigs: [...rigs.values()] }); }
    for (const escalation of escalations.values()) out({ type: 'escalation.updated', escalation });
    out({ type: 'ledge.thread.history', items: thread });
    ws.onMessage(m => {
      let msg: ClientMessage; try { msg = JSON.parse(String(m)); } catch { return; }
      received.push(msg);
      // Like the daemon: keep the island's settings and broadcast them.
      if (msg.type === 'island.set') { island = msg.prefs; out({ type: 'island', prefs: island }); }
      if (msg.type === 'rig.exchanges.request') out({ type: 'rig.exchanges', machine: msg.machine, rigId: msg.rigId, items: exchanges.get(msg.rigId) ?? [] });
      if (msg.type === 'ledge.thread.request') out({ type: 'ledge.thread.history', items: msg.before === undefined ? thread : [], ...(msg.before === undefined ? {} : { before: msg.before }) });
      // The first answer to an escalation is accepted after `answerDelayMs`; a later one, or one for a closed escalation, is `already_answered`.
      if (msg.type === 'escalation.answer') {
        const e = escalations.get(msg.id);
        if (e === undefined || e.state === 'answered' || e.state === 'closed' || answering.has(msg.id)) { out({ type: 'rig.result', rid: msg.rid, ok: false, code: 'already_answered' }); return; }
        answering.add(msg.id);
        const { rid, answers } = msg;
        setTimeout(() => {
          const answered: Escalation = { ...escalations.get(msg.id)!, state: 'answered', answer: { by: 'user', answers, at: new Date().toISOString() } };
          escalations.set(msg.id, answered);
          out({ type: 'escalation.updated', escalation: answered });
          out({ type: 'rig.result', rid, ok: true });
        }, answerDelayMs ?? 0);
      }
      if (msg.type === 'ledge.say') {
        const n = ++says, qid = `say-${n}`, at = new Date().toISOString();
        const seat = /^@(\S+)/.exec(msg.text.trim());
        const user: LedgeThreadItem = { kind: 'user', id: `u-${n}`, at, text: msg.text, ...(seat ? { to: `@${seat[1]}` } : { qid }) };
        thread.push(user);
        out({ type: 'ledge.thread.item', item: user });
        if (seat) return;
        const reply = chat ?? { text: 'Nothing to report.' };
        const { text, ...cards } = reply;
        // The fleet only follows a turn it knows: the history comes first.
        turns.push({ qid, question: msg.text, askedAt: at, steps: [] });
        out({ type: 'chat.history', turns });
        out({ type: 'ledge.thread.item', item: { kind: 'ledge', id: `l-${n}`, at, text: '', qid, pending: true } });
        out({ type: 'chat.delta', qid, text });
        out({ type: 'chat.done', qid, text, at, ...cards });
        turns[turns.length - 1] = { ...turns.at(-1)!, answer: text, answeredAt: at, ...cards };
        const done: LedgeThreadItem = { kind: 'ledge', id: `l-${n}`, at, text, qid };
        thread.push(done);
        out({ type: 'ledge.thread.item', item: done });
      }
    });
  });
  const send = (m: unknown) => socket?.send(JSON.stringify(m));
  return {
    received,
    /** Any server message, as is (update.progress, update.failed, …). */
    send,
    upsert(s: Session) { sessions.set(s.id, s); send({ type: 'session.updated', session: s }); },
    remove(id: string) { sessions.delete(id); send({ type: 'session.removed', id }); },
    preview(id: string, lines: string[]) { send({ type: 'session.preview', id, lines }); },
    error(id: string, message: string) { send({ type: 'error', id, message }); },
    /** Answers a `session.launch`: the new session, then the `session.launched` reply. */
    launched(s: Session) { sessions.set(s.id, s); send({ type: 'session.updated', session: s }); send({ type: 'session.launched', id: s.id }); },
    /** Answers a `folder.list` or `folder.create`. */
    listing(l: { path: string; parent: string | null; entries: string[]; error?: string }) { send({ type: 'folder.listing', ...l }); },
    /** A launch refused: an `error` with no id. */
    refuse(message: string) { send({ type: 'error', message }); },
    /** The island's settings changed in Desktop: kept and broadcast. */
    island(p: IslandPrefs) { island = p; send({ type: 'island', prefs: p }); },
    /** Any other server message (chat.done, chat.history, …). */
    emit(m: unknown) { send(m); },
    /** The turn Ledge answered to the n-th `ledge.say` (1-based), as the daemon keeps it: change it and `emit` a `chat.history` of `turns()`. */
    said(n = says) { return turns.find(t => t.qid === `say-${n}`)!; },
    /** Every turn kept, in order. */
    turns() { return [...turns]; },
    /** Adds or replaces an escalation, broadcast as `escalation.updated`. */
    pushEscalation(e: Escalation) { escalations.set(e.id, e); send({ type: 'escalation.updated', escalation: e }); },
    /** An exchange between a rig's agents (kept for `rig.exchanges.request`), broadcast as `rig.exchange`. */
    pushExchange(e: Exchange) { exchanges.set(e.rigId, [...(exchanges.get(e.rigId) ?? []), e]); send({ type: 'rig.exchange', exchange: e }); },
    /** Adds or replaces an item of Ledge's thread, broadcast as `ledge.thread.item`. */
    threadItem(item: LedgeThreadItem) { const at = thread.findIndex(i => i.id === item.id); if (at >= 0) thread[at] = item; else thread.push(item); send({ type: 'ledge.thread.item', item }); }
  };
}

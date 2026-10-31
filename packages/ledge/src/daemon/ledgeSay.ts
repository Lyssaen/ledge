import { randomUUID } from 'node:crypto';
import { MANDATE_CATEGORY_LABEL, type Escalation, type LedgeThreadItem, type ServerMessage, type Tool } from '@ledge/protocol';
import { ONE_AT_A_TIME, TOO_MANY, type Chat, type ChatMessage } from '../chat/service.js';
import type { LedgeThread } from './ledgeThread.js';
import { log } from '../log.js';

type UserItem = Extract<LedgeThreadItem, { kind: 'user' }>;
/** What writing to a rig seat gave (task 6 re-exports it from openrig/seatSend.ts). */
export type SeatSendResult = { ok: true; to: string } | { ok: false; reason: string; /** the seat word the user aimed at (the user item keeps it) */ to?: string };
/** Answers a user item of Ledge's thread; lot 7 sets the brain in place of the one-shot runner. */
export type Responder = (item: UserItem, about?: Escalation) => Promise<void>;
export interface LedgeSay {
  /** Adds the user item (in the thread when `say` returns, before its promise settles), then routes: an `@seat` at the head goes to
   *  `toSeat` (task 6); otherwise the current responder, one question at a time. Settles once the message is answered. */
  say(rid: string, text: string, about?: string): Promise<void>;
  /** Lot 7 replaces the responder while the brain runs; null brings the one-shot runner back. */
  setResponder(r: Responder | null): void;
}

/** How many messages may wait while Ledge answers one. */
export const MAX_WAITING = 5;
export const BUSY_TEXT = 'Je réponds encore à tes messages précédents : renvoie celui-ci dans un instant.';
/** Tries before giving up when every shared chat place stays taken. */
const MAX_TOO_MANY = 30;
const failed = (message: string) => `Je n'ai pas pu répondre : ${message}`;
/** A Ledge bubble still pending when the daemon starts again: its answer was lost with the old daemon. */
export const RESTARTED_TEXT = failed('le daemon a redémarré');

/** The line that tells the chat which escalation the user speaks of (« En parler »). */
export function aboutLine(e: Escalation): string {
  const who = [e.from, ...(e.category ? [MANDATE_CATEGORY_LABEL[e.category].fr] : [])].join(', ');
  const options = e.questions.length === 0 ? 'aucune'
    : e.questions.length === 1 ? e.questions[0]!.options.map(o => o.label).join(' ; ')
    : e.questions.map(q => `${q.question} → ${q.options.map(o => o.label).join(' ; ')}`).join(' | ');
  return `[Ledge] L'utilisateur parle de l'escalade ${e.id} (${who}) : « ${e.summary.replace(/\s*[\r\n]+\s*/g, ' ').trim()} ». Ses options : ${options}.`;
}

export function createLedgeSay(d: {
  thread: LedgeThread; chat: Chat;
  /** One escalation by id (the OpenRig bridge's; `() => undefined` without one). */
  escalations: (id: string) => Escalation | undefined;
  /** Sends a text that starts with `@…` to a rig seat; null when the word is no seat's address (the text goes to Ledge). */
  toSeat: (rid: string, text: string) => Promise<SeatSendResult | null>;
  /** The harness the one-shot runner asks with (the day's chat tool). */
  tool: () => Tool | Promise<Tool>;
  broadcast: (m: ServerMessage) => void;
  maxWaiting?: number;
  /** Wait before asking again when every shared chat place is taken (a phone's question holds it). */
  retryMs?: number;
  uuid?: () => string;
}): LedgeSay {
  const maxWaiting = d.maxWaiting ?? MAX_WAITING;
  const uuid = d.uuid ?? randomUUID;

  /** The one-shot runner: a pending bubble, then the desktop chat's answer (its cards stay on the turn `qid = user.id`). */
  const oneShot: Responder = async (user, about) => {
    const qid = user.qid ?? user.id;
    const bubble = d.thread.append({ kind: 'ledge', text: '', qid, pending: true });
    const question = about ? `${aboutLine(about)}\n${user.text}` : user.text;
    let outcome: { text: string } | { error: string } | null = null;
    try {
      const tool = await d.tool();
      let tooMany = 0;
      for (;;) {
        let held: string | null = null;
        const emit = (m: ChatMessage): void => {
          // Someone else holds the chat (the docked panel, a phone): wait and ask again, the bubble stays « Ledge lit… ».
          if (m.type === 'chat.error' && m.qid === qid && (m.message === ONE_AT_A_TIME || m.message === TOO_MANY)) { held = m.message; return; }
          d.broadcast(m);
          if (m.type === 'chat.done' && m.qid === qid) outcome = { text: m.text };
          else if (m.type === 'chat.error' && m.qid === qid) outcome = { error: m.message };
        };
        await d.chat.ask(qid, question, emit, tool);
        if (held === null) break;
        if (held === ONE_AT_A_TIME) await d.chat.idle();
        else if (++tooMany >= MAX_TOO_MANY) { outcome = { error: held }; break; }
        else await new Promise(r => setTimeout(r, d.retryMs ?? 1000));
      }
    } catch (e) { outcome = { error: (e as Error).message }; }
    const o = outcome as { text: string } | { error: string } | null;
    const text = o === null ? failed('pas de réponse') : 'text' in o ? o.text : failed(o.error);
    d.thread.upsert({ kind: 'ledge', id: bubble.id, at: bubble.at, text, qid });
  };
  let responder: Responder = oneShot;

  // Ledge's own FIFO: the chat refuses a second question rather than queueing it.
  type Job = { run: () => Promise<void> };
  let running = false;
  const waiting: Job[] = [];
  const full = () => running && waiting.length >= maxWaiting;
  const pump = (): void => {
    if (running) return;
    const next = waiting.shift(); if (!next) return;
    running = true;
    void next.run().finally(() => { running = false; pump(); });
  };
  const respond = async (item: UserItem, about?: Escalation): Promise<void> => {
    try { await responder(item, about); } catch (e) { log(`ledge.say: responder failed (${(e as Error).message})`); }
  };
  const enqueue = (item: UserItem, about?: Escalation): Promise<void> => new Promise(done => {
    waiting.push({ run: async () => { try { await respond(item, about); } finally { done(); } } });
    pump();
  });
  /** A place kept in the FIFO for a message whose route (a seat or Ledge) is not known yet: later messages queue behind it. */
  const reserve = () => {
    let settle!: (v: { item: UserItem; about?: Escalation } | null) => void;
    const decided = new Promise<{ item: UserItem; about?: Escalation } | null>(r => { settle = r; });
    let finish!: () => void;
    const finished = new Promise<void>(r => { finish = r; });
    const job: Job = { run: async () => { try { const v = await decided; if (v) await respond(v.item, v.about); } finally { finish(); } } };
    waiting.push(job); pump();
    return {
      finished,
      toLedge: (item: UserItem, about?: Escalation) => settle({ item, about }),
      /** Not for Ledge after all: the place is given back. */
      release: () => { const i = waiting.indexOf(job); if (i >= 0) waiting.splice(i, 1); settle(null); finish(); }
    };
  };
  const refuse = (): void => { d.thread.append({ kind: 'ledge', text: BUSY_TEXT }); };

  return {
    async say(rid, text, aboutId) {
      const about = aboutId ? d.escalations(aboutId) : undefined;
      const id = uuid();
      if (/^@\S/.test(text.trimStart())) {
        const user = d.thread.append({ kind: 'user', id, text }) as UserItem;
        // The place is kept before toSeat is awaited, so a plain message sent meanwhile cannot overtake this one.
        const place = full() ? null : reserve();
        let sent: SeatSendResult | null;
        try { sent = await d.toSeat(rid, text); } catch (e) { sent = { ok: false, reason: (e as Error).message }; }
        if (sent?.ok) { place?.release(); d.thread.upsert({ ...user, to: sent.to }); return; }
        if (sent) { place?.release(); if (sent.to) d.thread.upsert({ ...user, to: sent.to }); d.thread.append({ kind: 'ledge', text: sent.reason }); return; }
        // No seat by that name: a question to Ledge.
        if (!place) return refuse();
        place.toLedge(d.thread.upsert({ ...user, qid: user.id }) as UserItem, about);
        return place.finished;
      }
      if (full()) { d.thread.append({ kind: 'user', id, text }); return refuse(); }
      return enqueue(d.thread.append({ kind: 'user', id, text, qid: id }) as UserItem, about);
    },
    setResponder(r) { responder = r ?? oneShot; },
  };
}

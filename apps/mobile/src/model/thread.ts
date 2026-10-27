import type { AttachmentRef, PhoneSession, ThreadItem as PcItem } from '@ledge/protocol';
import { copy } from '../copy';
import type { LinkState } from '../link/link';
import type { Op } from '../state/operations';
import { requestsOf, type InboxItem } from './requests';

export { MESSAGE_MAX } from '@ledge/protocol';

/** `sending`: on its way to the PC. `taken`: the terminal took it. `uncertain`: the link broke before the PC answered. */
export type Delivery = 'sending' | 'taken' | 'uncertain';

/** `cut`: the PC shortened that item. */
export type ThreadItem =
  | { key: string; kind: 'me'; text: string; at: string; delivery?: Delivery; fresh?: boolean; cut?: true;
    /** The images a prompt from the PC carried. */ images?: AttachmentRef[];
    /** The ids of the images of this phone's own instruction not yet shown by the PC. */ attachments?: string[] }
  | { key: string; kind: 'agent'; text: string; at: string; cut?: true }
  | { key: string; kind: 'event'; label: string; at: string }
  | { key: string; kind: 'awaiting'; item: InboxItem };

type Instruction = Op & { message: Extract<Op['message'], { type: 'session.reply' }> };

/** Two lists of attachment ids, in the same order. */
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, n) => x === b[n]);

/** The instructions this phone sent to the session (replies that answer no request), oldest first. */
export const messagesOf = (sessionId: string, ops: Record<string, Op>): Instruction[] =>
  Object.values(ops)
    .filter((o): o is Instruction => o.message.type === 'session.reply' && o.message.expect === null && o.message.id === sessionId)
    .sort((a, b) => a.at.localeCompare(b.at));

/** Whether one of this phone's applied decisions answered that permission. */
function decidedHere(item: Extract<PcItem, { kind: 'permission' }>, sessionId: string, ops: Record<string, Op>): boolean {
  return Object.values(ops).some(o => o.phase === 'applied' && o.message.type === 'session.decide' && o.message.id === sessionId
    && o.message.expect.text === item.text && o.message.decision === item.decision);
}

function eventLabel(item: Extract<PcItem, { kind: 'permission' }>, sessionId: string, ops: Record<string, Op>): string | null {
  const E = copy.thread.event;
  if (!item.decision) return null;
  if (item.decision === 'unknown') return E.resolved;
  const from = decidedHere(item, sessionId, ops) ? E.fromPhone : E.fromPc;
  return item.decision === 'deny' ? E.deny(from) : E.accept(from);
}

/** How long a taken instruction is said to be taken « à l’instant », and keeps the composer closed. */
export const TAKEN_WINDOW = 20_000;

/** Whether the PC's prompt is this phone's instruction: the same text but for the spaces around it, or its start when the PC shortened it. */
const sameText = (prompt: string, sent: string, shortened: boolean) => {
  const p = prompt.trim(), m = sent.trim();
  return p === m || (shortened && p.length > 0 && m.startsWith(p));
};

/**
 * The thread in the PC's order (a row updated in place keeps its place; the PC's rows are not sorted by time), what
 * this phone sent that the PC's thread does not show yet in its place in time, what is still on its way, then the
 * request still waiting. A taken instruction the PC never lists (a command such as `/new`, or a prompt that fell off its
 * window) goes once the PC lists something `TAKEN_WINDOW` past it: the PC moved on without it. Tools, helpers and
 * messages between agents are left to the terminal; a permission shows once decided.
 */
export function threadItems(items: PcItem[], session: PhoneSession, ops: Record<string, Op>, now: number = Date.now(), cut: string[] = []): ThreadItem[] {
  const out: ThreadItem[] = [];
  const shortened = new Set(cut);
  const mark = (id: string) => shortened.has(id) ? { cut: true as const } : {};
  const mine = messagesOf(session.id, ops);
  // Each applied instruction is consumed by the first prompt of the same text the PC shows, so it is never said twice.
  const claimed = new Set<string>();
  const shown = new Set<string>();
  for (const o of mine) {
    if (o.phase !== 'applied') continue;
    const ids = o.message.attachments ?? [];
    const hit = items.find(i => i.kind === 'prompt' && sameText(i.text, o.message.text, shortened.has(i.id)) && !claimed.has(i.id) && sameIds(i.images?.map(x => x.id) ?? [], ids));
    if (hit) { claimed.add(hit.id); shown.add(o.op); }
  }
  for (const i of items) {
    if (i.kind === 'prompt') out.push({ key: i.id, kind: 'me', text: i.text, at: i.at, ...(i.images?.length ? { images: i.images } : {}), ...(claimed.has(i.id) ? { delivery: 'taken' as const } : {}), ...mark(i.id) });
    else if (i.kind === 'reply') out.push({ key: i.id, kind: 'agent', text: i.text, at: i.at, ...mark(i.id) });
    else if (i.kind === 'permission') {
      const label = eventLabel(i, session.id, ops);
      if (label) out.push({ key: i.id, kind: 'event', label, at: i.at });
    }
  }
  const newest = Math.max(...items.map(i => Date.parse(i.at)));
  for (const o of mine) {
    const at = Date.parse(o.at);
    const base = { key: o.op, kind: 'me' as const, text: o.message.text, at: o.at, ...(o.message.attachments?.length ? { attachments: o.message.attachments } : {}) };
    if (o.phase === 'sending') out.push({ ...base, delivery: 'sending' });
    else if (o.phase === 'uncertain') out.push({ ...base, delivery: 'uncertain' });
    else if (o.phase === 'applied' && !shown.has(o.op) && !(newest - at > TAKEN_WINDOW)) {
      // Before the first of the PC's rows that came after it (a live one stays last: it is the newest).
      const next = out.findIndex(i => i.kind !== 'awaiting' && !(i.kind === 'me' && i.delivery && i.delivery !== 'taken') && Date.parse(i.at) > at);
      out.splice(next < 0 ? out.length : next, 0, { ...base, delivery: 'taken', ...(now - at < TAKEN_WINDOW ? { fresh: true } : {}) });
    }
  }
  const awaiting = requestsOf([session])[0];
  if (awaiting) out.push({ key: `awaiting-${awaiting.key}`, kind: 'awaiting', item: awaiting });
  return out;
}

export interface Composer {
  enabled: boolean;
  placeholder: string;
  status: { tone: 'ok' | 'info' | 'approval' | 'attention' | 'muted'; label: string };
}

const C = copy.thread.composer;

/** Whether the person may write to this agent now, and what the composer says about why not. Nothing is ever queued. */
export function composerState(session: PhoneSession, link: LinkState, sending: boolean): Composer {
  const off = (placeholder: string, tone: Composer['status']['tone'], label: string): Composer => ({ enabled: false, placeholder, status: { tone, label } });
  if (link === 'handshaking') return off(C.placeholder.connecting, 'muted', C.status.connecting);
  if (link !== 'ready') return off(C.placeholder.offline, 'muted', C.status.offline);
  if (session.state === 'exited' || session.state === 'error') return off(C.placeholder.ended, 'muted', C.status.ended);
  // As on the desktop: an accord waits in red, a question in amber.
  if (session.pending || session.state === 'waiting_permission' || session.state === 'waiting_input') {
    const question = session.pending ? session.pending.kind === 'question' : session.state === 'waiting_input';
    return off(C.placeholder.awaiting, question ? 'attention' : 'approval', C.status.awaiting);
  }
  if (session.state !== 'idle') return off(C.placeholder.working, 'info', C.status.working);
  if (sending) return off(C.placeholder.idle(session.name), 'info', C.status.sending);
  return { enabled: true, placeholder: C.placeholder.idle(session.name), status: { tone: 'ok', label: C.status.idle } };
}

export const QUICK_REPLIES = ['Montre le diff', 'Lance les tests', 'Explique les changements'] as const;

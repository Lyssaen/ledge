import { parseReply, type ReplyDoc } from '@ledge/client';
import type { Session, Turn } from '@ledge/protocol';
import { copy } from '../copy';
import { requestsOf, type InboxItem } from './requests';
import type { OpState } from './operations';
import type { Link } from '../state/store';

/** `sending`: on its way to the PC. `taken`: the terminal took it. `uncertain`: the link broke before the PC answered. */
export type Delivery = 'sending' | 'taken' | 'uncertain';

export type ThreadItem =
  | { key: string; kind: 'me'; text: string; at: string; delivery?: Delivery; fresh?: boolean }
  | { key: string; kind: 'agent'; doc: ReplyDoc; at: string }
  | { key: string; kind: 'event'; label: string; at: string }
  | { key: string; kind: 'awaiting'; item: InboxItem };

const from = (s: Turn['source']) => s === 'phone' ? copy.thread.event.fromPhone : copy.thread.event.fromPc;

function eventLabel(t: Turn): string | null {
  switch (t.kind) {
    case 'decision': return t.decision === 'deny' ? copy.thread.event.deny(from(t.source)) : copy.thread.event.accept(from(t.source));
    case 'answer': return copy.thread.event.answer(t.text ?? '');
    case 'resolved': return copy.thread.event.resolved;
    case 'interrupt': return copy.thread.event.interrupt;
    default: return null;
  }
}

/** The instructions this phone sent to the session, oldest first. */
export const messagesOf = (sessionId: string, ops: Record<string, OpState>): OpState[] =>
  Object.values(ops).filter(o => o.kind === 'message' && o.sessionId === sessionId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));

/**
 * The thread in the PC's order (a row updated in place keeps its place; nothing is sorted by time), then what this
 * phone sent that the PC's thread does not show yet, then the request still waiting. A decision turn already sits
 * at its request's position and carries the request's time.
 */
/** How long a taken instruction is said to be taken « à l’instant », and keeps the composer closed. */
export const TAKEN_WINDOW = 20_000;

export function threadItems(turns: Turn[], session: Session, ops: Record<string, OpState>, now: number = Date.now()): ThreadItem[] {
  const items: ThreadItem[] = [];
  // Each applied instruction is consumed by the first prompt of the same text the PC shows, so it is never said twice.
  const claimed = new Set<string>();
  const shown = new Set<string>();
  for (const o of messagesOf(session.id, ops)) {
    if (o.phase !== 'applied') continue;
    const hit = turns.find(t => t.kind === 'prompt' && t.source !== 'pc' && t.text === o.text && !claimed.has(t.id));
    if (hit) { claimed.add(hit.id); shown.add(o.operationId); }
  }
  for (const t of turns) {
    if (t.kind === 'prompt') items.push({ key: t.id, kind: 'me', text: t.text ?? '', at: t.at, ...(t.source === 'phone' ? { delivery: 'taken' as const } : {}) });
    else if (t.kind === 'reply') { if (t.text !== undefined) items.push({ key: t.id, kind: 'agent', doc: parseReply(t.text), at: t.at }); }
    else { const label = eventLabel(t); if (label) items.push({ key: t.id, kind: 'event', label, at: t.at }); }
  }
  const oldest = turns[0]?.at;
  for (const o of messagesOf(session.id, ops)) {
    const base = { key: o.operationId, kind: 'me' as const, text: o.text ?? '', at: o.startedAt };
    if (o.phase === 'sending' || o.phase === 'received') items.push({ ...base, delivery: 'sending' });
    else if (o.phase === 'uncertain') items.push({ ...base, delivery: 'uncertain' });
    // Applied but not in the PC's thread yet. One older than everything the PC still lists has fallen off its window.
    else if (o.phase === 'applied' && !shown.has(o.operationId) && !(oldest && Date.parse(oldest) - Date.parse(o.startedAt) > 300_000)) items.push({ ...base, delivery: 'taken', ...(now - Date.parse(o.startedAt) < TAKEN_WINDOW ? { fresh: true } : {}) });
  }
  const awaiting = requestsOf([session])[0];
  if (awaiting) items.push({ key: `awaiting-${awaiting.pendingId}`, kind: 'awaiting', item: awaiting });
  return items;
}

export interface Composer {
  enabled: boolean;
  placeholder: string;
  status: { tone: 'ok' | 'info' | 'attention' | 'muted'; label: string };
}

const C = copy.thread.composer;

/** Whether the person may write to this agent now, and what the composer says about why not. Nothing is ever queued. */
export function composerState(session: Session, link: Link, sending: boolean): Composer {
  const off = (placeholder: string, tone: Composer['status']['tone'], label: string): Composer => ({ enabled: false, placeholder, status: { tone, label } });
  if (link === 'offline' || link === 'unpaired') return off(C.placeholder.offline, 'muted', C.status.offline);
  if (link === 'connecting') return off(C.placeholder.connecting, 'muted', C.status.connecting);
  if (session.source === 'hook_only') return off(C.placeholder.readOnly, 'muted', C.status.readOnly);
  if (session.state === 'exited' || session.state === 'error') return off(C.placeholder.ended, 'muted', C.status.ended);
  if (session.pending || session.state === 'waiting_permission' || session.state === 'waiting_input') return off(C.placeholder.awaiting, 'attention', C.status.awaiting);
  if (session.state !== 'idle') return off(C.placeholder.working, 'info', C.status.working);
  if (sending) return off(C.placeholder.idle(session.name), 'info', C.status.sending);
  return { enabled: true, placeholder: C.placeholder.idle(session.name), status: { tone: 'ok', label: C.status.idle } };
}

export const QUICK_REPLIES = ['Montre le diff', 'Lance les tests', 'Explique les changements'] as const;

/** The longest instruction the PC accepts. */
export const MESSAGE_MAX = 4000;

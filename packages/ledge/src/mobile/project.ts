import { pendingKey, PENDING_BODY_MAX, THREAD_BUDGET, THREAD_ITEMS_MAX, THREAD_TEXT_MAX, TOOL_TEXT_MAX, TOPIC_MAX, ToolSchema } from '@ledge/protocol';
import type { CapabilitiesByTool, FileChange, Pending, PhonePending, PhoneSession, Session, ThreadItem, Tool } from '@ledge/protocol';
import { adapterFor } from '../adapters/index.js';
import { riskOf } from './risk.js';

// Every object below is built field by field: a field added to a daemon type never reaches the phone unless it is named here.

/** The keys of `o` that are set, copied: a key left out of the list is never copied, one that is unset stays absent. */
function pickSet<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/** `s` shortened to `max` characters, never inside a surrogate pair. */
function clip(s: string, max: number): { text: string; cut: boolean } {
  if (s.length <= max) return { text: s, cut: false };
  const end = /[\ud800-\udbff]/.test(s[max - 1] ?? '') ? max - 1 : max;
  return { text: s.slice(0, end), cut: true };
}

function toPhonePending(p: Pending, key: string, risk: PhonePending['risk'], riskReason: PhonePending['riskReason']): PhonePending {
  const body = p.body === undefined ? undefined : clip(p.body, PENDING_BODY_MAX);
  return {
    kind: p.kind, text: p.text, source: p.source,
    ...(body ? { body: body.text } : {}),
    ...pickSet(p, ['tool', 'helperId', 'parentState']),
    ...(p.options ? { options: [...p.options] } : {}),
    ...(p.optionDetails ? { optionDetails: [...p.optionDetails] } : {}),
    key, risk, riskReason,
    ...(body?.cut ? { cut: true as const } : {})
  };
}

export function toPhoneSession(s: Session, readAt: string): PhoneSession {
  const verdict = riskOf(s);
  return {
    id: s.id, name: s.name, tool: s.tool, project: s.project, title: s.title, state: s.state,
    startedAt: s.startedAt, lastActivityAt: s.lastActivityAt,
    // Topics are already cut to TOPIC_MAX where they are set; clipped again so no source can swell a snapshot.
    ...(s.topic !== undefined ? { topic: clip(s.topic, TOPIC_MAX).text } : {}),
    ...pickSet(s, ['repo', 'branch', 'worktree']),
    helpers: s.helpers.map(h => ({ id: h.id, kind: h.kind, task: h.task, state: h.state, ...pickSet(h, ['finishedAt']) })),
    // A preview only: the whole reply is in the thread.
    ...(s.lastReply ? { lastReply: { text: clip(s.lastReply.text, TOOL_TEXT_MAX).text, at: s.lastReply.at, ...pickSet(s.lastReply, ['plan']) } } : {}),
    ...(s.pending && verdict ? { pending: toPhonePending(s.pending, pendingKey(s.pending), verdict.risk, verdict.reason) } : {}),
    unread: !!s.lastReply && s.lastReply.at > readAt
  };
}

/** A thread item for the phone: its texts shortened, a tool's file diffs dropped. `cut`: some text was shortened. */
export function toPhoneItem(item: ThreadItem): { item: ThreadItem; cut: boolean } {
  let cut = false;
  const text = (s: string, max = THREAD_TEXT_MAX): string => {
    const c = clip(s, max);
    if (c.cut) cut = true;
    return c.text;
  };
  const optText = (s: string | undefined, max = THREAD_TEXT_MAX): { v?: string } => (s === undefined ? {} : { v: text(s, max) });
  const base = { id: item.id, at: item.at, turn: item.turn, ...pickSet(item, ['helperId']) };
  let out: ThreadItem;
  switch (item.kind) {
    case 'prompt': case 'message': case 'reply':
      out = { kind: item.kind, ...base, text: text(item.text) };
      break;
    case 'tool': {
      const input = optText(item.input, TOOL_TEXT_MAX), output = optText(item.output, TOOL_TEXT_MAX), error = optText(item.error, TOOL_TEXT_MAX);
      out = {
        kind: 'tool', ...base, tool: item.tool, label: text(item.label), status: item.status,
        ...(input.v !== undefined ? { input: input.v } : {}),
        ...(output.v !== undefined ? { output: output.v } : {}),
        ...(error.v !== undefined ? { error: error.v } : {}),
        ...pickSet(item, ['durationMs']),
        files: item.files.map((f): FileChange => ({ path: f.path, ...pickSet(f, ['from']), change: f.change }))
      };
      break;
    }
    case 'permission':
      out = { kind: 'permission', ...base, tool: item.tool, text: text(item.text), ...pickSet(item, ['decision']) };
      break;
    case 'helper':
      out = { kind: 'helper', ...base, task: text(item.task), state: item.state, ...pickSet(item, ['agentType']) };
      break;
    case 'sent': {
      const summary = optText(item.summary);
      out = {
        kind: 'sent', ...base, to: item.to, text: text(item.text), status: item.status,
        ...(summary.v !== undefined ? { summary: summary.v } : {}),
        ...pickSet(item, ['peer', 'received', 'via'])
      };
      break;
    }
    case 'received':
      out = { kind: 'received', ...base, from: item.from, text: text(item.text), ...pickSet(item, ['peer', 'sent']) };
      break;
    case 'notice': {
      const summary = optText(item.summary), reason = optText(item.reason);
      out = {
        kind: 'notice', ...base, notice: item.notice, text: text(item.text),
        ...pickSet(item, ['name', 'peer', 'time', 'status', 'count']),
        ...(item.recipients ? { recipients: [...item.recipients] } : {}),
        ...(summary.v !== undefined ? { summary: summary.v } : {}),
        ...(reason.v !== undefined ? { reason: reason.v } : {})
      };
      break;
    }
  }
  return { item: out, cut };
}

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

/** The newest items that fit `THREAD_ITEMS_MAX` and `THREAD_BUDGET`, in chronological order. */
export function toPhoneThread(items: ThreadItem[]): { items: ThreadItem[]; cut: string[]; more: boolean } {
  const kept: ThreadItem[] = [];
  const cut: string[] = [];
  let used = 2; // the array's brackets
  for (let i = items.length - 1; i >= 0 && kept.length < THREAD_ITEMS_MAX; i--) {
    const projected = toPhoneItem(items[i]!);
    const size = bytes(projected.item) + (kept.length > 0 ? 1 : 0); // the comma
    if (used + size > THREAD_BUDGET) break;
    used += size;
    kept.push(projected.item);
    if (projected.cut) cut.push(projected.item.id);
  }
  return { items: kept.reverse(), cut: cut.reverse(), more: kept.length < items.length };
}

/** What each tool's adapter can type for a phone. */
export function capabilities(): CapabilitiesByTool {
  const caps = {} as CapabilitiesByTool;
  for (const tool of ToolSchema.options as readonly Tool[]) caps[tool] = { freeTextAnswer: !!adapterFor(tool).freeText };
  return caps;
}

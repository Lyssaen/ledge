import { LEDGE_GIVER, pendingKey, PENDING_BODY_MAX, SNAPSHOT_BODY_MAX, taskClosed, THREAD_BUDGET, THREAD_ITEMS_MAX, THREAD_TEXT_MAX, TOOL_TEXT_MAX, TOPIC_MAX, ToolSchema } from '@ledge/protocol';
import type { CapabilitiesByTool, FileChange, Pending, PhonePending, PhoneSession, PhoneTask, PhoneTeam, Session, Task, Team, ThreadItem, Tool } from '@ledge/protocol';
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
export function clip(s: string, max: number): { text: string; cut: boolean } {
  if (s.length <= max) return { text: s, cut: false };
  const end = /[\ud800-\udbff]/.test(s[max - 1] ?? '') ? max - 1 : max;
  return { text: s.slice(0, end), cut: true };
}

function toPhonePending(p: Pending, key: string, risk: PhonePending['risk'], riskReason: PhonePending['riskReason'], bodyMax: number): PhonePending {
  const body = p.body === undefined ? undefined : clip(p.body, bodyMax);
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

/**
 * A session's request as the phone sees it, its body cut to `bodyMax`. A request `riskOf` has no verdict for is still
 * there, as `high`/`unknown`: the phone shows it, and only the PC can accept it.
 */
export function toPhoneRequest(s: Session, bodyMax: number): PhonePending | undefined {
  if (!s.pending) return undefined;
  const verdict = riskOf(s) ?? { risk: 'high' as const, reason: 'unknown' as const };
  return toPhonePending(s.pending, pendingKey(s.pending), verdict.risk, verdict.reason, bodyMax);
}

/** The request with its whole body (up to `PENDING_BODY_MAX`), for `session.pending`. */
export const toPhoneFullRequest = (s: Session): PhonePending | undefined => toPhoneRequest(s, PENDING_BODY_MAX);

export function toPhoneSession(s: Session, readAt: string): PhoneSession {
  const pending = toPhoneRequest(s, SNAPSHOT_BODY_MAX);
  return {
    id: s.id, name: s.name, tool: s.tool, project: s.project, title: s.title, state: s.state,
    startedAt: s.startedAt, lastActivityAt: s.lastActivityAt,
    // Topics are already cut to TOPIC_MAX where they are set; clipped again so no source can swell a snapshot.
    ...(s.topic !== undefined ? { topic: clip(s.topic, TOPIC_MAX).text } : {}),
    ...pickSet(s, ['repo', 'branch', 'worktree', 'role', 'roleLabel', 'team', 'context', 'relieves']),
    // Its relief's state only (context handover spec §3.2): the phone shows it, the PC starts it.
    ...(s.handover ? { handover: { state: s.handover.state, ...(s.handover.toName ? { toName: s.handover.toName.slice(0, 80) } : {}) } } : {}),
    helpers: s.helpers.map(h => ({ id: h.id, kind: h.kind, task: h.task, state: h.state, ...pickSet(h, ['finishedAt']) })),
    // A preview only: the whole reply is in the thread.
    ...(s.lastReply ? { lastReply: { text: clip(s.lastReply.text, TOOL_TEXT_MAX).text, at: s.lastReply.at, ...pickSet(s.lastReply, ['plan']) } } : {}),
    ...(pending ? { pending } : {}),
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

/** What each tool's adapter can type for a phone. OMP has no adapter: its dialogs are answered with their own options and questions (`session.answer`), never typed. */
export function capabilities(): CapabilitiesByTool {
  const caps = {} as CapabilitiesByTool;
  for (const tool of ToolSchema.options as readonly Tool[]) {
    caps[tool] = tool === 'omp'
      ? { freeTextAnswer: false, decide: false, questions: true }
      : { freeTextAnswer: !!adapterFor(tool).freeText, decide: true, questions: false };
  }
  return caps;
}

/** A live team as the phone sees it: its project's name, its seats, the progress of the tasks Ledge gave it (ledge home spec §2.4). */
export function toPhoneTeam(t: Team, tasks: readonly Task[], projectName: (id: string | null) => string | null): PhoneTeam | null {
  if (t.state === 'dissolved') return null;
  const mine = tasks.filter(x => x.team === t.id && x.giver === LEDGE_GIVER);
  return { id: t.id, name: t.name.slice(0, 60), project: projectName(t.project)?.slice(0, 80) ?? null, state: t.state,
    seats: t.seats.slice(0, 16).map(x => ({ role: x.role, sessionId: x.sessionId })), done: mine.filter(x => x.state === 'done').length, given: mine.length };
}

/** A task Ledge gave, as the phone sees it: the start of its result only. */
export function toPhoneTask(x: Task, owner: Session | undefined, teamName: string | undefined): PhoneTask {
  const result = x.result !== undefined ? clip(x.result, TOOL_TEXT_MAX) : undefined;
  return { id: x.id, title: x.title.slice(0, 200), owner: x.owner, ownerName: x.ownerName.slice(0, 80), ...(owner?.role ? { ownerRole: owner.role } : {}),
    ...(x.team ? { team: x.team } : {}), ...(teamName ? { teamName: teamName.slice(0, 60) } : {}), state: x.state,
    ...(result ? { result: result.text, ...(result.cut ? { cut: true as const } : {}) } : {}), at: x.at, updatedAt: x.updatedAt, ...(x.seen ? { seen: true as const } : {}) };
}

/** The tasks Ledge gave that the phone lists: open ones, and those closed in the last day not put away. */
export const phoneTasks = (tasks: readonly Task[], now: number): Task[] =>
  tasks.filter(x => x.giver === LEDGE_GIVER && (!taskClosed(x) || (!x.seen && now - Date.parse(x.updatedAt) < 86_400_000))).slice(-200);

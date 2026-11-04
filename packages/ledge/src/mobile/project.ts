import { LEDGE_GIVER, openDecision, pendingKey, PENDING_BODY_MAX, SNAPSHOT_BODY_MAX, taskClosed, THREAD_BUDGET, THREAD_ITEMS_MAX, THREAD_TEXT_MAX, TOOL_TEXT_MAX, TOPIC_MAX, ToolSchema } from '@ledge/protocol';
import { EffortSchema, PhoneModelChoiceSchema, type ModelChoice, type PhoneModelChoice } from '@ledge/protocol';
import { PHONE_COMMANDS_MAX, PhoneSlashCommandSchema, type PhoneSlashCommand, type SlashCommand } from '@ledge/protocol';
import { CHECKLIST_TASKS_MAX, CHECKLIST_TEXT_MAX, doneCount } from '@ledge/protocol';
import type { PhoneChecklist, PhoneChecklistSummary, Todo } from '@ledge/protocol';
import type { RigInfo, CapabilitiesByTool, FileChange, Pending, PhonePending, PhoneSession, PhoneTask, Session, Task, ThreadItem, Tool } from '@ledge/protocol';
import { PHONE_PROJECTS_MAX, PHONE_RIG_NAME_MAX, projectOf, type PhoneProject, type Projects } from '@ledge/protocol';
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

/** Whether the phone's checklist leaves something out: more tasks than it carries, or a text it clips. */
const checklistCut = (todos: readonly Todo[]): boolean =>
  todos.length > CHECKLIST_TASKS_MAX || todos.some(t => t.text.length > CHECKLIST_TEXT_MAX);

/** The agent's checklist for the session screen: its first tasks, texts clipped; `done` and `total` count the whole list. */
export function toPhoneChecklist(todos: readonly Todo[] | null): PhoneChecklist | null {
  if (!todos) return null;
  return {
    tasks: todos.slice(0, CHECKLIST_TASKS_MAX).map(t => ({ text: clip(t.text, CHECKLIST_TEXT_MAX).text, status: t.status })),
    done: doneCount(todos), total: todos.length,
    ...(checklistCut(todos) ? { cut: true as const } : {})
  };
}

/** The checklist for « Agents »: the counts and the first task in progress, from the whole list (one past the cap still shows). */
export function checklistSummary(todos: readonly Todo[] | null): PhoneChecklistSummary | undefined {
  if (!todos) return undefined;
  const current = todos.find(t => t.status === 'in_progress');
  return {
    done: doneCount(todos), total: todos.length,
    ...(current ? { current: clip(current.text, CHECKLIST_TEXT_MAX).text } : {}),
    ...(checklistCut(todos) ? { cut: true as const } : {})
  };
}

/** The user's projects for the Atelier: id, name and colour, in their order. Never a folder nor a rule. */
export function toPhoneProjects(p: Projects): PhoneProject[] {
  return p.projects.slice(0, PHONE_PROJECTS_MAX).map(x => ({ id: x.id, name: clip(x.name, 80).text, color: x.color }));
}

/**
 * Where the Atelier puts a session: the user's project it belongs to, placed as the desktop places this PC's sessions (the
 * fleet calls this machine `local`), and its OpenRig rig and role, without the seat.
 */
export function atelierOf(s: Session, projects: Projects): Pick<PhoneSession, 'projectId' | 'rig'> {
  const projectId = projectOf({ machineId: 'local', cwd: s.cwd }, projects);
  return {
    ...(projectId !== null ? { projectId } : {}),
    ...(s.rig ? { rig: { name: clip(s.rig.name, PHONE_RIG_NAME_MAX).text, ...(s.rig.role !== undefined ? { role: clip(s.rig.role, PHONE_RIG_NAME_MAX).text } : {}) } } : {})
  };
}

/** `projects`: the daemon feeds the Atelier (`daemon.atelier`): the session gets its project and its rig. */
export function toPhoneSession(s: Session, readAt: string, checklist?: PhoneChecklistSummary, projects?: Projects): PhoneSession {
  const pending = toPhoneRequest(s, SNAPSHOT_BODY_MAX);
  return {
    id: s.id, name: s.name, tool: s.tool, project: s.project, title: s.title, state: s.state,
    startedAt: s.startedAt, lastActivityAt: s.lastActivityAt,
    // Topics are already cut to TOPIC_MAX where they are set; clipped again so no source can swell a snapshot.
    ...(s.topic !== undefined ? { topic: clip(s.topic, TOPIC_MAX).text } : {}),
    ...pickSet(s, ['repo', 'branch', 'worktree', 'context', 'relieves', 'exitedAt']),
    // Known up front: the phone shows neither Close nor Resume for it, rather than learning it from a refusal.
    ...(s.source === 'hook_only' ? { readOnly: true as const } : {}),
    // Its relief's state only (context handover spec §3.2): the phone shows it, the PC starts it.
    ...(s.handover ? { handover: { state: s.handover.state, ...(s.handover.toName ? { toName: s.handover.toName.slice(0, 80) } : {}) } } : {}),
    // Its model, effort and the change waiting for its next free moment (#58), cut to the bounds of a model id and an effort.
    ...(s.model !== undefined ? { model: clip(s.model, MODEL_MAX).text } : {}),
    ...(s.effort !== undefined ? { effort: clip(s.effort, EFFORT_MAX).text } : {}),
    ...(s.modelNext ? { modelNext: {
      ...(s.modelNext.model !== undefined ? { model: clip(s.modelNext.model, MODEL_MAX).text } : {}),
      ...(s.modelNext.effort !== undefined ? { effort: clip(s.modelNext.effort, EFFORT_MAX).text } : {})
    } } : {}),
    ...(canSwitch(s) ? { canSwitch: true as const } : {}),
    helpers: s.helpers.map(h => ({ id: h.id, kind: h.kind, task: h.task, state: h.state, ...pickSet(h, ['finishedAt']) })),
    // A preview only: the whole reply is in the thread.
    ...(s.lastAnswer ? { lastAnswer: { ...s.lastAnswer, by: s.lastAnswer.by.kind === 'device' ? { ...s.lastAnswer.by, name: clip(s.lastAnswer.by.name, 60).text } : s.lastAnswer.by } } : {}),
    ...(s.lastReply ? { lastReply: { text: clip(s.lastReply.text, TOOL_TEXT_MAX).text, at: s.lastReply.at, ...pickSet(s.lastReply, ['plan']) } } : {}),
    ...(pending ? { pending } : {}),
    ...(checklist ? { checklist } : {}),
    ...(projects ? atelierOf(s, projects) : {}),
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
  // OpenRig's side of an item (docs/mockups/ledge-openrig-messages.html): its texts shortened like the others.
  const rigOf = (i: { rig?: RigInfo }): { rig?: RigInfo } => i.rig ? { rig: { ...i.rig, raw: text(i.rig.raw), ...(i.rig.summary !== undefined ? { summary: text(i.rig.summary) } : {}), ...(i.rig.command !== undefined ? { command: text(i.rig.command, TOOL_TEXT_MAX) } : {}) } } : {};
  let out: ThreadItem;
  switch (item.kind) {
    case 'prompt':
      out = { kind: 'prompt', ...base, text: text(item.text), ...(item.images?.length ? { images: item.images } : {}) };
      break;
    case 'message': case 'reply':
      out = { kind: item.kind, ...base, text: text(item.text) };
      break;
    case 'tool': {
      const input = optText(item.input, TOOL_TEXT_MAX), output = optText(item.output, TOOL_TEXT_MAX), error = optText(item.error, TOOL_TEXT_MAX);
      out = {
        kind: 'tool', ...base, tool: item.tool, label: text(item.label), status: item.status,
        ...(input.v !== undefined ? { input: input.v } : {}),
        ...(output.v !== undefined ? { output: output.v } : {}),
        ...(error.v !== undefined ? { error: error.v } : {}),
        ...pickSet(item, ['durationMs', 'imagesDropped']),
        ...(item.images?.length ? { images: item.images } : {}),
        files: item.files.map((f): FileChange => ({ path: f.path, ...pickSet(f, ['from']), change: f.change }))
      };
      break;
    }
    case 'permission':
      out = { kind: 'permission', ...base, tool: item.tool, text: text(item.text), ...pickSet(item, ['decision', 'by']) };
      break;
    case 'helper':
      out = { kind: 'helper', ...base, task: text(item.task), state: item.state, ...pickSet(item, ['agentType']) };
      break;
    case 'sent': {
      const summary = optText(item.summary);
      out = {
        kind: 'sent', ...base, to: item.to, text: text(item.text), status: item.status,
        ...(summary.v !== undefined ? { summary: summary.v } : {}),
        ...pickSet(item, ['peer', 'received', 'via']),
        ...rigOf(item)
      };
      break;
    }
    case 'received':
      out = { kind: 'received', ...base, from: item.from, text: text(item.text), ...pickSet(item, ['peer', 'sent']), ...rigOf(item) };
      break;
    case 'notice': {
      const summary = optText(item.summary), reason = optText(item.reason);
      out = {
        kind: 'notice', ...base, notice: item.notice, text: text(item.text),
        ...pickSet(item, ['name', 'peer', 'time', 'status', 'count', 'task', 'taskOp', 'outgoing']),
        ...(item.recipients ? { recipients: [...item.recipients] } : {}),
        ...(summary.v !== undefined ? { summary: summary.v } : {}),
        ...(reason.v !== undefined ? { reason: reason.v } : {}),
        ...rigOf(item)
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

/** A task Ledge gave, or a decision a session put to the user, as the phone sees it: the start of its result and detail only. */
export function toPhoneTask(x: Task): PhoneTask {
  const result = x.result !== undefined ? clip(x.result, TOOL_TEXT_MAX) : undefined;
  // A decision's detail is the options its session offers: the phone shows them where it is answered.
  const text = x.owner === LEDGE_GIVER && x.text !== undefined ? clip(x.text, TOOL_TEXT_MAX).text : undefined;
  return { id: x.id, title: x.title.slice(0, 200), owner: x.owner, ownerName: x.ownerName.slice(0, 80),
    giver: x.giver.slice(0, 100), giverName: x.giverName.slice(0, 80), ...(text ? { text } : {}),
    state: x.state,
    ...(result ? { result: result.text, ...(result.cut ? { cut: true as const } : {}) } : {}), at: x.at, updatedAt: x.updatedAt, ...(x.seen ? { seen: true as const } : {}),
    // A proposal about the notes: the phone answers it with its buttons. Its fields are the schema's own, already bounded.
    ...(x.brain ? { brain: { kind: x.brain.kind, note: x.brain.note, fact: x.brain.fact, ...(x.brain.create ? { create: true } : {}), ...(x.brain.source ? { source: x.brain.source } : {}),
      ...(x.brain.title ? { title: x.brain.title } : {}), ...(x.brain.when ? { when: x.brain.when } : {}) } } : {}) };
}

/** Ledge's tasks the phone is sent: the ones Ledge gave or that a session put to the user as a decision. */
export const forPhone = (x: Pick<Task, 'giver' | 'owner'>): boolean => x.giver === LEDGE_GIVER || x.owner === LEDGE_GIVER;

/** The tasks the phone lists: Ledge's open ones, and those closed in the last day not put away; the decisions still waiting
 *  (an answered one is its session's, and is never put away). Its updates still reach the phone (`forPhone`), so it leaves the list. */
export const phoneTasks = (tasks: readonly Task[], now: number): Task[] =>
  tasks.filter(x => openDecision(x) || (x.giver === LEDGE_GIVER && (!taskClosed(x) || (!x.seen && now - Date.parse(x.updatedAt) < 86_400_000)))).slice(-200);

/** The bounds of a model id and an effort (`ModelIdSchema`, `EffortSchema`): what the phone shows of a session's. */
const MODEL_MAX = 200;
const EFFORT_MAX = 20;
/** At most this many models in a phone's listing (`PhoneModelChoiceSchema`'s bounds below). */
const MODELS_MAX = 40;

/**
 * Whether the daemon can switch the session's model (#58): one Ledge launched and that has not ended. The daemon this ships
 * with always has the switch, so the gateway's `models` flag does not enter into it.
 */
export function canSwitch(s: Session): boolean {
  return s.source === 'launcher' && s.state !== 'exited';
}

/** A session's slash commands for the phone: descriptions cut to its bounds; one its schema still refuses is left out. */
export function toPhoneCommands(commands: readonly SlashCommand[]): PhoneSlashCommand[] {
  const out: PhoneSlashCommand[] = [];
  for (const c of commands) {
    if (out.length >= PHONE_COMMANDS_MAX) break;
    const p = PhoneSlashCommandSchema.safeParse({ ...c, ...(c.description !== undefined ? { description: clip(c.description, 200).text } : {}) });
    if (p.success) out.push(p.data);
  }
  return out;
}

/**
 * An agent's models for the phone (#58): strings cut to its bounds, efforts the schema refuses dropped, no key it does not
 * know. A model whose id is too long to be sent back whole, or that the phone's schema still refuses, is left out.
 */
export function toPhoneModels(models: readonly ModelChoice[]): PhoneModelChoice[] {
  const out: PhoneModelChoice[] = [];
  for (const m of models) {
    if (out.length >= MODELS_MAX) break;
    const efforts = m.efforts?.filter(e => EffortSchema.safeParse(e).success).slice(0, 8);
    const c = PhoneModelChoiceSchema.safeParse({
      id: m.id, label: clip(m.label, 80).text,
      ...(m.description !== undefined ? { description: clip(m.description, 200).text } : {}),
      ...(efforts ? { efforts } : {}),
      ...pickSet(m, ['defaultEffort', 'isDefault'])
    });
    if (c.success) out.push(c.data);
  }
  return out;
}

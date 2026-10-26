import type { AskQuestion, SessionEvent } from '@ledge/protocol';
import type { Frame } from './rpc.js';

/**
 * What OMP's event stream means to Ledge's session reducer and thread: its frames become the events the hooks of the other
 * harnesses would have sent, so state, notch and thread need no OMP special case (spec 2026-10-20 §5-6). Pure: `Tracking`
 * is the only memory.
 */

export type DialogMethod = 'select' | 'confirm' | 'input' | 'editor' | 'ask';
/** The one dialog OMP waits on, as the daemon must answer it. */
export interface OpenRequest { id: string; method: DialogMethod; title: string; options?: string[]; /** `ask`: every question of one call, answered together. */ questions?: AskQuestion[] }
export interface Tracking {
  /** The text of the latest assistant message of the turn, what `Stop` carries once the session settles. */
  reply?: string;
  /** Dialogs in the order they arrived; the first one holds the card. */
  requests: OpenRequest[];
  /** An `agent_start` Ledge did not cause (background work restarting the agent) must still read as working. */
  working: boolean;
  /** Instructions the host already recorded when it sent them (a prompt at rest): their echo in the stream is not a second prompt. */
  echo: string[];
  /** Follow-ups and steers the host queued, with the images they carry: OMP's echo of one, when its turn starts, shows them in the thread.
   *  `text` is what OMP was given (it echoes it back); `shown` the person's own words when overflow images were appended as brackets. */
  queued: Array<{ text: string; attachments: string[]; shown?: string }>;
  /** Tool calls in flight, by id: the result frame does not repeat the arguments (a write's path). */
  /** This process's own tag in the ids of its messages: OMP numbers them from 1 in each process, and a resumed session has several. */
  tag: string;
  /** The Stop of the turn need not repeat the text: every assistant message already went to the thread. */
  sent: boolean;
  /** Subagents: the ones whose task is known, and each one's latest message (its report once it ends). */
  helpers: Map<string, { known: boolean; reply?: string }>;
  calls: Map<string, { name: string; args?: Record<string, unknown> }>;
}
export const newTracking = (tag = 'p'): Tracking => ({ requests: [], working: false, echo: [], queued: [], tag, sent: false, helpers: new Map(), calls: new Map() });

const DIALOGS: ReadonlySet<string> = new Set<DialogMethod>(['select', 'confirm', 'input', 'editor', 'ask']);
const CAP_INPUT = 4000;
const CAP_OUTPUT = 20000;

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The text blocks of a message or a tool result, joined. */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(b => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).filter(Boolean).join('\n');
}

/** Tool arguments as a JSON object whose strings are bounded. */
function boundedArgs(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  return Object.fromEntries(Object.entries(args as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? cap(v, CAP_INPUT) : v]));
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** One line saying what a subagent was given: its assignment without the headings, or its first line. */
function taskOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const line = lines.find(l => !l.startsWith('#')) ?? lines[0]?.replace(/^#+\s*/, '');
  return line ? cap(line, 160) : undefined;
}

/** The input a finished `edit` or `write` is recorded with so the thread can list the file: its path and the change as OMP reports it. */
function changeOf(tool: string, args: Record<string, unknown> | undefined, details: unknown): Record<string, unknown> | undefined {
  const d = (details && typeof details === 'object' ? details : {}) as Record<string, unknown>;
  if (tool === 'write') { const path = str(d.resolvedPath) ?? str(args?.path); return path ? { path, ...(str(args?.content) !== undefined ? { content: args!.content } : {}) } : undefined; }
  // The work plan: each call reports the whole list (`details.phases`), the only reliable copy of it.
  if (tool === 'todo') return Array.isArray(d.phases) ? { phases: d.phases } : undefined;
  if (tool === 'edit') { const path = str(d.path); return path ? { path, ...(str(d.diff) ? { diff: cap(d.diff as string, CAP_OUTPUT) } : {}) } : undefined; }
  return undefined;
}

/** The events a frame stands for, in order; updates `t`. Frames Ledge has no use for yield none. */
export function project(f: Frame, t: Tracking, at: string, helper?: string): SessionEvent[] {
  // A subagent's events carry its id; the reducer routes those that say `hook` (what the harness itself reported) to the helper.
  const ev = (e: Omit<SessionEvent, 'at' | 'source'>): SessionEvent => ({ at, source: helper ? 'hook' : 'daemon', ...(helper ? { helperId: helper } : {}), ...e });
  const own = (): boolean => helper === undefined;
  switch (f.type) {
    case 'subagent_lifecycle': {
      const p = (f.payload ?? {}) as Record<string, unknown>; const id = str(p.id); if (!id || !own()) return [];
      const status = str(p.status);
      if (status === 'started') { t.helpers.set(id, t.helpers.get(id) ?? { known: false }); return [ev({ name: 'SubagentStart', helperId: id, tool: str(p.agent) ?? 'subagent', text: '' })]; }
      if (!status) return [];
      const report = t.helpers.get(id)?.reply; t.helpers.delete(id);
      return [ev({ name: 'SubagentStop', helperId: id, tool: str(p.agent) ?? 'subagent', ...(status === 'completed' ? (report ? { text: report } : {}) : { text: `${status}${report ? `: ${report}` : ''}` }) })];
    }
    case 'subagent_progress': {
      const p = (f.payload ?? {}) as Record<string, unknown>;
      const prog = (p.progress ?? {}) as Record<string, unknown>; const id = str(prog.id);
      const h = id ? t.helpers.get(id) : undefined;
      if (!id || !h || h.known || !own()) return [];
      const task = taskOf(str(p.assignment) ?? str(p.task)); h.known = true;
      return task ? [ev({ name: 'SubagentStart', helperId: id, tool: str(p.agent) ?? 'subagent', text: task, task })] : [];
    }
    case 'subagent_event': {
      const p = (f.payload ?? {}) as Record<string, unknown>; const id = str(p.id); const inner = p.event as Frame | undefined;
      if (!id || !own() || !inner || typeof inner.type !== 'string') return [];
      // Only what the thread shows of a helper: its messages and its actions. Its turns and dialogs are not the session's.
      if (inner.type !== 'message_update' && inner.type !== 'message_end' && inner.type !== 'tool_execution_start' && inner.type !== 'tool_execution_end') return [];
      const evs = project(inner, t, at, id);
      const h = t.helpers.get(id); if (h && inner.type === 'message_end') { const m = inner.message as { role?: unknown; content?: unknown } | undefined; const text = m?.role === 'assistant' ? contentText(m.content).trim() : ''; if (text) h.reply = text; }
      return evs;
    }
    case 'agent_start': {
      if (t.working) return [];
      t.working = true;
      return [ev({ name: 'UserPromptSubmit' })];
    }
    case 'message_start': {
      // The user's instruction as OMP takes it: a queued follow-up or a steer enters the thread when its turn starts, not when it was typed.
      const m = f.message as { role?: unknown; attribution?: unknown; content?: unknown } | undefined;
      if (m?.role !== 'user' || m.attribution !== 'user') return [];
      const text = contentText(m.content).trim();
      // A queued instruction is found by its text, an image-only one included (its text is empty).
      const q = t.queued.findIndex(x => x.text === text);
      if (q !== -1) { const [e] = t.queued.splice(q, 1); return [ev({ name: 'UserPromptSubmit', ...((e!.shown ?? text) ? { text: e!.shown ?? text } : {}), ...(e!.attachments.length > 0 ? { attachments: e!.attachments } : {}) })]; }
      if (!text) return [];
      const i = t.echo.indexOf(text);
      if (i !== -1) { t.echo.splice(i, 1); return []; }
      return [ev({ name: 'UserPromptSubmit', text })];
    }
    case 'message_update': {
      const m = (f.assistantMessageEvent as { type?: unknown; partial?: { content?: unknown } } | undefined);
      const id = str(f.messageId);
      if (!id || !m || (m.type !== 'text_delta' && m.type !== 'text_end')) return [];
      const text = contentText(m.partial?.content);
      return text.trim() ? [ev({ name: 'AgentMessage', messageId: `${t.tag}-${helper ? `${helper}-` : ''}${id}`, text, streaming: m.type === 'text_delta' })] : [];
    }
    case 'message_end': {
      const m = f.message as { role?: unknown; content?: unknown } | undefined;
      if (m?.role !== 'assistant') return [];
      const text = contentText(m.content).trim();
      const id = str(f.messageId);
      if (!text) return [];
      if (own()) { t.reply = text; t.sent = !!id; }
      return id ? [ev({ name: 'AgentMessage', messageId: `${t.tag}-${helper ? `${helper}-` : ''}${id}`, text })] : [];
    }
    case 'tool_execution_start': {
      const tool = str(f.toolName); if (!tool) return [];
      const input = boundedArgs(f.args);
      if (str(f.toolCallId)) t.calls.set(str(f.toolCallId)!, { name: tool, ...(input ? { args: input } : {}) });
      return [ev({ name: 'PreToolUse', tool, ...(str(f.toolCallId) ? { toolUseId: str(f.toolCallId)! } : {}), ...(str(f.intent) ? { text: str(f.intent)! } : {}), ...(input ? { toolInput: input } : {}) })];
    }
    case 'tool_execution_end': {
      const tool = str(f.toolName); if (!tool) return [];
      const output = cap(contentText((f.result as { content?: unknown } | undefined)?.content), CAP_OUTPUT);
      const failed = f.isError === true;
      const id = str(f.toolCallId);
      const call = id ? t.calls.get(id) : undefined; if (id) t.calls.delete(id);
      // A file edit is known to have happened only now, with what the harness says it changed (spec §3.2).
      const changed = failed ? undefined : changeOf(tool, call?.args, (f.result as { details?: unknown } | undefined)?.details);
      return [ev({ name: failed ? 'PostToolUseFailure' : 'PostToolUse', tool, ...(id ? { toolUseId: id } : {}), ...(output ? { output } : {}), ...(failed ? { error: output || 'failed' } : {}), ...(changed ? { toolInput: changed } : {}) })];
    }
    case 'extension_ui_request': {
      const method = str(f.method); const id = str(f.id);
      if (method === 'cancel') {
        // OMP withdrew a dialog (its own timeout, or the turn ended): never an answer from the user.
        const target = str(f.targetId);
        const i = t.requests.findIndex(r => r.id === target);
        if (i === -1) return [];
        const first = i === 0; t.requests.splice(i, 1);
        return first ? [ev({ name: 'Decided' }), ...next(t, at)] : [];
      }
      if (!method || !id || !DIALOGS.has(method)) return []; // setWidget, notify, setStatus…: decoration
      const options = Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : undefined;
      const questions = method === 'ask' ? askQuestions(f.questions) : undefined;
      if (method === 'ask' && !questions?.length) return []; // an `ask` we cannot read is left to OMP's own timeout, never answered blind
      const title = questions ? questions.map(q => q.question).join(' · ') : str(f.title) ?? str(f.message) ?? str(f.placeholder) ?? 'OMP';
      const req: OpenRequest = { id, method: method as DialogMethod, title, ...(options?.length ? { options } : {}), ...(questions ? { questions } : {}) };
      t.requests.push(req);
      return t.requests.length === 1 ? [requestEvent(req, at)] : [];
    }
    case 'queue_update': {
      // OMP's queue as it stands: its own words, never an estimate of ours.
      const take = (v: unknown, mode: 'steer' | 'follow_up') => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(text => ({ text: cap(text, 500), mode })) : []);
      return [ev({ name: 'QueueUpdate', queue: [...take(f.steering, 'steer'), ...take(f.followUp, 'follow_up')].slice(0, 20) })];
    }
    case 'session_settled': {
      t.working = false;
      const text = t.reply; t.reply = undefined;
      const streamed = t.sent; t.sent = false;
      return [ev({ name: 'Stop', ...(text ? { text } : {}), ...(streamed ? { streamed: true } : {}) })];
    }
    case 'prompt_result': {
      // The status of one instruction, not the rest of the session: only a failed one says something.
      if (f.status === 'failed' || f.status === 'error') { t.working = false; return [ev({ name: 'StopFailure', text: str(f.error) ?? 'the instruction failed' })]; }
      // An abort with instructions still in OMP's queue stops the work but leaves the session unsettled: no session_settled
      // comes (OMP 18.12.3, probed 2026-10-20), so this result is what says the work stopped.
      if (f.status === 'aborted' && f.sessionSettled === false && t.working) {
        t.working = false; t.reply = undefined; t.sent = false;
        return [ev({ name: 'Stop', interrupt: true })];
      }
      return [];
    }
    default: return [];
  }
}

/** The questions of an `ask` request as Ledge shows them; none when its shape is not the one OMP 18.12.3 sends. */
export function askQuestions(raw: unknown): AskQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AskQuestion[] = [];
  for (const q of raw) {
    const o = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.question !== 'string' || !Array.isArray(o.options)) return undefined;
    const options = o.options.map(x => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>).filter(x => typeof x.label === 'string')
      .map(x => ({ label: x.label as string, ...(typeof x.description === 'string' ? { description: x.description } : {}) }));
    out.push({ id: o.id, question: o.question, ...(typeof o.header === 'string' ? { header: o.header } : {}), ...(o.multi === true ? { multi: true } : {}), options });
  }
  return out;
}

export function requestEvent(r: OpenRequest, at: string): SessionEvent {
  // A lone single-choice question is also offered as options (a digit answers it); several questions only through session.answer.
  const lone = r.questions?.length === 1 && !r.questions[0]!.multi ? r.questions[0]!.options.map(o => o.label) : undefined;
  const options = r.method === 'confirm' ? ['Yes', 'No'] : lone?.length ? lone : r.options;
  return { name: 'NativeRequest', at, source: 'daemon', kind: 'question', text: r.title, ...(options ? { options } : {}), requestId: r.id, ...(r.questions ? { questions: r.questions } : {}), tool: 'omp' };
}

/** After the first dialog closed: the next one, if OMP already asked it, takes the card. */
function next(t: Tracking, at: string): SessionEvent[] {
  const r = t.requests[0];
  return r ? [requestEvent(r, at)] : [];
}

/** The `extension_ui_response` for `text` against the open dialog, or the reason it does not fit. */
export function answerFor(r: OpenRequest, text: string): { frame: Record<string, unknown> } | { refused: string } {
  const t = text.trim();
  if (r.method === 'ask') {
    // Only a lone single-choice question is answered by a digit or its label; the rest has its own card.
    const q = r.questions?.length === 1 && !r.questions[0]!.multi ? r.questions[0]! : undefined;
    if (!q) return { refused: 'answer this request from its card: it has several questions' };
    const n = /^[1-9]\d*$/.test(t) ? Number(t) : 0;
    const label = n >= 1 && n <= q.options.length ? q.options[n - 1]!.label : q.options.find(o => o.label === text)?.label;
    return label === undefined ? { refused: 'this answer is not one of the options OMP offers' }
      : { frame: { type: 'extension_ui_response', id: r.id, answers: [{ id: q.id, selectedOptions: [label] }] } };
  }
  if (r.method === 'input' || r.method === 'editor') return t === '' ? { refused: 'empty reply' } : { frame: { type: 'extension_ui_response', id: r.id, value: text } };
  const options = r.method === 'confirm' ? ['Yes', 'No'] : r.options ?? [];
  const n = /^[1-9]\d*$/.test(t) ? Number(t) : 0;
  const choice = n >= 1 && n <= options.length ? options[n - 1]! : options.find(o => o === text) ;
  if (choice === undefined) return { refused: 'this answer is not one of the options OMP offers' };
  return { frame: r.method === 'confirm' ? { type: 'extension_ui_response', id: r.id, confirmed: choice === 'Yes' } : { type: 'extension_ui_response', id: r.id, value: choice } };
}

/** The `extension_ui_response` of an `ask` from the answers a front sends, or why they do not fit its questions: one answer per
 *  question in order, choices among the question's own labels (one only unless it takes several), free text as `customInput`. */
export function askAnswerFor(r: OpenRequest, answers: ReadonlyArray<{ id: string; selected: string[]; text?: string }>): { frame: Record<string, unknown> } | { refused: string } {
  const qs = r.questions;
  if (r.method !== 'ask' || !qs) return { refused: 'this request is not a set of questions' };
  if (answers.length !== qs.length) return { refused: `OMP asks ${qs.length} question${qs.length > 1 ? 's' : ''}` };
  const out: Array<{ id: string; selectedOptions: string[]; customInput?: string }> = [];
  for (const [i, q] of qs.entries()) {
    const a = answers[i]!;
    if (a.id !== q.id) return { refused: `answer ${i + 1} is not for “${q.question}”` };
    const labels = new Set(q.options.map(o => o.label));
    if (a.selected.some(x => !labels.has(x)) || new Set(a.selected).size !== a.selected.length) return { refused: `“${a.selected.find(x => !labels.has(x)) ?? 'a repeated choice'}” is not a choice of “${q.question}”` };
    if (!q.multi && a.selected.length > 1) return { refused: `“${q.question}” takes one choice` };
    const text = a.text?.trim();
    if (a.selected.length === 0 && !text) return { refused: `“${q.question}” has no answer` };
    out.push({ id: q.id, selectedOptions: a.selected, ...(text ? { customInput: text } : {}) });
  }
  return { frame: { type: 'extension_ui_response', id: r.id, answers: out } };
}

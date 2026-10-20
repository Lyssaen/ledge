import type { SessionEvent } from '@ledge/protocol';
import type { Frame } from './rpc.js';

/**
 * What OMP's event stream means to Ledge's session reducer and thread: its frames become the events the hooks of the other
 * harnesses would have sent, so state, notch and thread need no OMP special case (spec 2026-10-20 §5-6). Pure: `Tracking`
 * is the only memory.
 */

export type DialogMethod = 'select' | 'confirm' | 'input' | 'editor';
/** The one dialog OMP waits on, as the daemon must answer it. */
export interface OpenRequest { id: string; method: DialogMethod; title: string; options?: string[] }
export interface Tracking {
  /** The text of the latest assistant message of the turn, what `Stop` carries once the session settles. */
  reply?: string;
  /** Dialogs in the order they arrived; the first one holds the card. */
  requests: OpenRequest[];
  /** An `agent_start` Ledge did not cause (background work restarting the agent) must still read as working. */
  working: boolean;
  /** Instructions the host already recorded when it sent them (a prompt at rest): their echo in the stream is not a second prompt. */
  echo: string[];
  /** Tool calls in flight, by id: the result frame does not repeat the arguments (a write's path). */
  /** This process's own tag in the ids of its messages: OMP numbers them from 1 in each process, and a resumed session has several. */
  tag: string;
  /** The Stop of the turn need not repeat the text: every assistant message already went to the thread. */
  sent: boolean;
  calls: Map<string, { name: string; args?: Record<string, unknown> }>;
}
export const newTracking = (tag = 'p'): Tracking => ({ requests: [], working: false, echo: [], tag, sent: false, calls: new Map() });

const DIALOGS: ReadonlySet<string> = new Set<DialogMethod>(['select', 'confirm', 'input', 'editor']);
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

/** The input a finished `edit` or `write` is recorded with so the thread can list the file: its path and the change as OMP reports it. */
function changeOf(tool: string, args: Record<string, unknown> | undefined, details: unknown): Record<string, unknown> | undefined {
  const d = (details && typeof details === 'object' ? details : {}) as Record<string, unknown>;
  if (tool === 'write') { const path = str(d.resolvedPath) ?? str(args?.path); return path ? { path, ...(str(args?.content) !== undefined ? { content: args!.content } : {}) } : undefined; }
  if (tool === 'edit') { const path = str(d.path); return path ? { path, ...(str(d.diff) ? { diff: cap(d.diff as string, CAP_OUTPUT) } : {}) } : undefined; }
  return undefined;
}

/** The events a frame stands for, in order; updates `t`. Frames Ledge has no use for yield none. */
export function project(f: Frame, t: Tracking, at: string): SessionEvent[] {
  const ev = (e: Omit<SessionEvent, 'at' | 'source'>): SessionEvent => ({ at, source: 'daemon', ...e });
  switch (f.type) {
    case 'agent_start': {
      if (t.working) return [];
      t.working = true;
      return [ev({ name: 'UserPromptSubmit' })];
    }
    case 'message_start': {
      // The user's instruction as OMP takes it: a queued follow-up or a steer enters the thread when its turn starts, not when it was typed.
      const m = f.message as { role?: unknown; attribution?: unknown; content?: unknown } | undefined;
      if (m?.role !== 'user' || m.attribution !== 'user') return [];
      const text = contentText(m.content).trim(); if (!text) return [];
      const i = t.echo.indexOf(text);
      if (i !== -1) { t.echo.splice(i, 1); return []; }
      return [ev({ name: 'UserPromptSubmit', text })];
    }
    case 'message_update': {
      const m = (f.assistantMessageEvent as { type?: unknown; partial?: { content?: unknown } } | undefined);
      const id = str(f.messageId);
      if (!id || !m || (m.type !== 'text_delta' && m.type !== 'text_end')) return [];
      const text = contentText(m.partial?.content);
      return text.trim() ? [ev({ name: 'AgentMessage', messageId: `${t.tag}-${id}`, text, streaming: m.type === 'text_delta' })] : [];
    }
    case 'message_end': {
      const m = f.message as { role?: unknown; content?: unknown } | undefined;
      if (m?.role !== 'assistant') return [];
      const text = contentText(m.content).trim();
      const id = str(f.messageId);
      if (!text) return [];
      t.reply = text; t.sent = !!id;
      return id ? [ev({ name: 'AgentMessage', messageId: `${t.tag}-${id}`, text })] : [];
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
      const title = str(f.title) ?? str(f.message) ?? str(f.placeholder) ?? 'OMP';
      const req: OpenRequest = { id, method: method as DialogMethod, title, ...(options?.length ? { options } : {}) };
      t.requests.push(req);
      return t.requests.length === 1 ? [requestEvent(req, at)] : [];
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
      return [];
    }
    default: return [];
  }
}

export function requestEvent(r: OpenRequest, at: string): SessionEvent {
  const options = r.method === 'confirm' ? ['Yes', 'No'] : r.options;
  return { name: 'NativeRequest', at, source: 'daemon', kind: 'question', text: r.title, ...(options ? { options } : {}), tool: 'omp' };
}

/** After the first dialog closed: the next one, if OMP already asked it, takes the card. */
function next(t: Tracking, at: string): SessionEvent[] {
  const r = t.requests[0];
  return r ? [requestEvent(r, at)] : [];
}

/** The `extension_ui_response` for `text` against the open dialog, or the reason it does not fit. */
export function answerFor(r: OpenRequest, text: string): { frame: Record<string, unknown> } | { refused: string } {
  const t = text.trim();
  if (r.method === 'input' || r.method === 'editor') return t === '' ? { refused: 'empty reply' } : { frame: { type: 'extension_ui_response', id: r.id, value: text } };
  const options = r.method === 'confirm' ? ['Yes', 'No'] : r.options ?? [];
  const n = /^[1-9]\d*$/.test(t) ? Number(t) : 0;
  const choice = n >= 1 && n <= options.length ? options[n - 1]! : options.find(o => o === text) ;
  if (choice === undefined) return { refused: 'this answer is not one of the options OMP offers' };
  return { frame: r.method === 'confirm' ? { type: 'extension_ui_response', id: r.id, confirmed: choice === 'Yes' } : { type: 'extension_ui_response', id: r.id, value: choice } };
}

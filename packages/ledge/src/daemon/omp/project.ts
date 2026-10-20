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
}
export const newTracking = (): Tracking => ({ requests: [], working: false });

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

/** The events a frame stands for, in order; updates `t`. Frames Ledge has no use for yield none. */
export function project(f: Frame, t: Tracking, at: string): SessionEvent[] {
  const ev = (e: Omit<SessionEvent, 'at' | 'source'>): SessionEvent => ({ at, source: 'daemon', ...e });
  switch (f.type) {
    case 'agent_start': {
      if (t.working) return [];
      t.working = true;
      return [ev({ name: 'UserPromptSubmit' })];
    }
    case 'message_end': {
      const m = f.message as { role?: unknown; content?: unknown } | undefined;
      if (m?.role === 'assistant') { const text = contentText(m.content).trim(); if (text) t.reply = text; }
      return [];
    }
    case 'tool_execution_start': {
      const tool = str(f.toolName); if (!tool) return [];
      const input = boundedArgs(f.args);
      return [ev({ name: 'PreToolUse', tool, ...(str(f.toolCallId) ? { toolUseId: str(f.toolCallId)! } : {}), ...(str(f.intent) ? { text: str(f.intent)! } : {}), ...(input ? { toolInput: input } : {}) })];
    }
    case 'tool_execution_end': {
      const tool = str(f.toolName); if (!tool) return [];
      const output = cap(contentText((f.result as { content?: unknown } | undefined)?.content), CAP_OUTPUT);
      const failed = f.isError === true;
      return [ev({ name: failed ? 'PostToolUseFailure' : 'PostToolUse', tool, ...(str(f.toolCallId) ? { toolUseId: str(f.toolCallId)! } : {}), ...(output ? { output } : {}), ...(failed ? { error: output || 'failed' } : {}) })];
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
      return [ev({ name: 'Stop', ...(text ? { text } : {}) })];
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

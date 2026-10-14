import { cleanTopic, sessionTitle, type Session, type SessionEvent, type Pending, type Helper, type SessionState, type TopicSource } from '@ledge/protocol';

import { identify } from './identify.js';

export const HOOK_PRIORITY_MS = 2000;

/**
 * Claude Code's hooks report its prompts (permission, question, plan), so a pane match right after a hook may be
 * stale or poorer. Cursor Agent's and Codex's never do: their prompts come from the pane alone, at once.
 */
const hooksReportPrompts = (s: Session) => s.tool === 'claude';

export function isPending(s: Session): boolean {
  return s.state === 'waiting_permission' || s.state === 'waiting_input';
}

/** Tools that ask the user a multiple-choice question: Claude Code's, and Codex's (Plan mode). */
export const QUESTION_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'request_user_input']);
/** Tools whose permission request is a file change: Claude Code's, and Codex's patch. */
const DIFF_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'apply_patch']);

function pendingFor(ev: SessionEvent): Pending | undefined {
  if (ev.name === 'PermissionRequest') {
    const diff = !!ev.tool && DIFF_TOOLS.has(ev.tool);
    return { kind: diff ? 'diff' : 'permission', text: ev.text ?? '', tool: ev.tool, source: 'hook', ...(ev.reason ? { reason: ev.reason } : {}) };
  }
  if (ev.name === 'PreToolUse' && ev.tool && QUESTION_TOOLS.has(ev.tool)) {
    // The tool is kept only when it is not Claude's, so its PostToolUse can still be matched (see pendingTool).
    return { kind: 'question', text: ev.text ?? '', options: ev.options, source: 'hook', ...(ev.tool !== 'AskUserQuestion' ? { tool: ev.tool } : {}) };
  }
  if (ev.name === 'PreToolUse' && ev.tool === 'ExitPlanMode') {
    return { kind: 'plan', text: ev.text ?? '', source: 'hook' };
  }
  if (ev.name === 'Notification' && ev.kind === 'permission') {
    return { kind: 'permission', text: ev.text ?? '', source: 'hook' };
  }
  if (ev.name === 'PanePrompt') {
    return { kind: ev.kind ?? 'permission', text: ev.text ?? '', options: ev.options, source: 'pane' };
  }
  return undefined;
}

/** The request keeps its id, first sight and version when a richer description replaces it. */
function keepIdentity(current: Pending, incoming: Pending): Pending {
  return { ...incoming, ...(current.id ? { id: current.id } : {}), ...(current.version ? { version: current.version } : {}), ...(current.since ? { since: current.since } : {}) };
}

/** Richer wins: a hook pending is never replaced by a pane pending. */
function mergePending(current: Pending | undefined, incoming: Pending): Pending {
  if (!current) return incoming;
  if (current.source === 'hook' && incoming.source === 'pane') return current;
  if (incoming.source === 'hook' && current.source === 'pane') return keepIdentity(current, incoming);
  // Two requesters (main agent, helpers) never merge: the first request keeps the card.
  if (current.helperId !== incoming.helperId) return current;
  // A permission/diff request over a richer hook pending (plan, question) keeps that kind.
  if (current.source === 'hook' && (current.kind === 'plan' || current.kind === 'question') && incoming.source === 'hook') return current;
  const kind = incoming.kind;
  return { ...current, ...incoming, kind, text: incoming.text || current.text, tool: incoming.tool ?? current.tool, options: incoming.options ?? current.options };
}

/** The tool whose PostToolUse means a hook pending was answered (in the terminal or from Ledge). */
function pendingTool(p: Pending): string | undefined {
  if (p.kind === 'question') return p.tool ?? 'AskUserQuestion';
  if (p.kind === 'plan') return 'ExitPlanMode';
  return p.tool;
}

/** A pane pending or a tool-less one (from a Notification) cannot be matched to a tool: any tool run ends it. */
function clearedByToolRun(p: Pending, tool: string | undefined): boolean {
  const t = pendingTool(p);
  return p.source === 'pane' || t === undefined || t === tool;
}

function setHelper(s: Session, id: string, patch: Partial<Helper>, kind = 'subagent'): Helper[] {
  const i = s.helpers.findIndex(h => h.id === id);
  if (i < 0) return [...s.helpers, { id, kind, task: '', state: 'working', ...patch }];
  const helpers = [...s.helpers];
  helpers[i] = { ...helpers[i]!, ...patch };
  return helpers;
}

/** The parent's state once a pending is gone: a turn in progress is working, a parent at rest stays at rest. */
function settled(state: SessionState): SessionState {
  return state === 'waiting_permission' || state === 'waiting_input' ? 'working' : state;
}

/** The parent's state once its helper-routed pending is answered: what it was doing underneath. */
function restored(s: Session): SessionState {
  return s.pending?.parentState ?? settled(s.state);
}

/** Main-thread activity under a helper-routed pending: the request stays, the resting state underneath moves. */
function underHelper(s: Session, parentState: SessionState, at: string, extra: Partial<Session> = {}): Session {
  return { ...s, ...extra, pending: { ...s.pending!, parentState }, lastHookAt: at, lastActivityAt: at };
}

/**
 * Events fired inside a subagent (helperId set). They never clear or replace the parent's pending and never
 * flip the parent to working; a helper permission is routed to the parent only when nothing is pending there.
 */
/**
 * Cursor Agent: a subagent's first hook (its own id) takes over the oldest working helper its parent's Task named
 * (`task:<call id>`), with that name. Parallel Tasks are matched in launch order.
 */
function adoptCursorTask(s: Session, id: string): Session {
  if (s.tool !== 'cursor' || id.startsWith('task:') || s.helpers.some(h => h.id === id)) return s;
  const i = s.helpers.findIndex(h => h.id.startsWith('task:') && h.state === 'working');
  if (i < 0) return s;
  const helpers = [...s.helpers];
  helpers[i] = { ...helpers[i]!, id };
  return { ...s, helpers };
}

/**
 * Claude Code announces every helper it shows with SubagentStart. Its internal agents (delegated observation) skip
 * it and not always send SubagentStop, so a helper first seen through another event is not tracked; a request of
 * its own is still routed to the parent.
 */
const untracked = (s: Session, id: string) => s.tool === 'claude' && !s.helpers.some(h => h.id === id);

function reduceHelper(s: Session, ev: SessionEvent & { helperId: string }): Session {
  s = adoptCursorTask(s, ev.helperId);
  const at = ev.at;
  const id = ev.helperId;
  const own = s.pending?.helperId === id;
  // A description arriving with any event names a helper that has none (Claude Code's comes after SubagentStart).
  const named = ev.task && !s.helpers.find(h => h.id === id)?.task ? { task: ev.task } : {};
  const track = (patch: Partial<Helper>, kind?: string) => (untracked(s, id) ? s.helpers : setHelper(s, id, { ...patch, ...named }, kind));
  switch (ev.name) {
    case 'SubagentStart': {
      const known = s.helpers.find(h => h.id === id);
      const patch: Partial<Helper> = { state: 'working', kind: ev.tool ?? known?.kind ?? 'subagent', task: ev.text || known?.task || ev.task || '' };
      return { ...s, helpers: setHelper(s, id, patch), lastHookAt: at, lastActivityAt: at };
    }
    case 'SubagentStop': {
      const helpers = track({ state: 'exited' }, ev.tool ?? 'subagent');
      if (own) return { ...s, helpers, pending: undefined, state: restored(s), lastHookAt: at, lastActivityAt: at };
      return { ...s, helpers, lastHookAt: at, lastActivityAt: at };
    }
    case 'PermissionRequest': {
      const helpers = track({ state: 'waiting_permission' });
      if (s.pending && s.pending.source === 'hook') return { ...s, helpers, lastHookAt: at, lastActivityAt: at };
      const pending = { ...pendingFor(ev)!, helperId: id, parentState: settled(s.state) };
      return { ...s, helpers, state: 'waiting_permission', pending, lastHookAt: at, lastActivityAt: at };
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const helper = s.helpers.find(h => h.id === id);
      const busy = ev.name === 'PreToolUse' && helper?.state === 'waiting_permission';
      const helpers = busy ? s.helpers : track({ state: ev.interrupt ? 'idle' : 'working' });
      if (ev.name !== 'PreToolUse' && own && (ev.interrupt || clearedByToolRun(s.pending!, ev.tool))) {
        return { ...s, helpers, pending: undefined, state: restored(s), lastHookAt: at, lastActivityAt: at };
      }
      return { ...s, helpers, lastHookAt: at, lastActivityAt: at };
    }
    default:
      return { ...s, lastHookAt: at, lastActivityAt: at };
  }
}

function withoutReply(s: Session): Session {
  const { lastReply: _gone, ...rest } = s;
  return rest;
}

function samePending(a: Pending, b: Pending): boolean {
  return a.kind === b.kind && a.text === b.text && a.tool === b.tool && a.source === b.source
    && JSON.stringify(a.options) === JSON.stringify(b.options);
}

/**
 * Cursor Agent never says a subagent stopped. A foreground Task blocks its parent, so the parent's own next step (a tool,
 * the end of the turn, a new prompt) means its helpers are done; launching more Tasks (helper events) does not. A
 * background helper ended this way comes back with its next tool run.
 */
function endCursorHelpers(s: Session, ev: SessionEvent): Session {
  if (s.tool !== 'cursor' || ev.source !== 'hook' || ev.helperId || !s.helpers.some(h => h.state === 'working')) return s;
  const moves = ev.name === 'PostToolUse' || ev.name === 'PostToolUseFailure' || ev.name === 'Stop' || ev.name === 'StopFailure'
    || ev.name === 'UserPromptSubmit' || ev.name === 'PreToolUse';
  return moves ? { ...s, helpers: s.helpers.map(h => (h.state === 'working' ? { ...h, state: 'exited' } : h)) } : s;
}

/** The session with a (possibly empty) topic from `source`, its title following; identical when nothing changes. */
function withTopic(s: Session, text: string, source: TopicSource | undefined): Session {
  const topic = cleanTopic(text) || undefined;
  if (topic === s.topic && (topic ? source : undefined) === s.topicSource) return s;
  const { topic: _t, topicSource: _ts, ...rest } = s;
  const next: Session = topic ? { ...rest, topic, topicSource: source } : rest;
  return { ...next, title: sessionTitle(next) };
}

/** Gives requests their identity around the state machine; returns the same object when nothing changes. */
export function reduce(s: Session, ev: SessionEvent): Session {
  return identify(s, reduceEvent(s, ev), ev.at);
}

function reduceEvent(s: Session, ev: SessionEvent): Session {
  if (s.state === 'exited') return s;
  s = endCursorHelpers(s, ev);
  const at = ev.at;
  const lastHookAt = s.lastHookAt;
  if (ev.name === 'SubagentStart' || ev.name === 'SubagentStop') return ev.helperId ? reduceHelper(s, { ...ev, helperId: ev.helperId }) : s;
  if (ev.helperId && ev.source === 'hook' && ev.name !== 'SessionEnd') return reduceHelper(s, { ...ev, helperId: ev.helperId });

  switch (ev.name) {
    case 'SessionEnd':
      return { ...s, state: 'exited', pending: undefined, exitCode: ev.exitCode ?? null, exitedAt: s.exitedAt ?? at, lastActivityAt: at };
    case 'PaneGone':
      return { ...s, state: 'exited', pending: undefined, exitCode: null, exitedAt: s.exitedAt ?? at, lastActivityAt: at };
    case 'PaneChanged':
      return s.lastActivityAt === at ? s : { ...s, lastActivityAt: at };
    case 'PaneTitle': return s.topicSource === 'user' ? s : withTopic(s, ev.text ?? '', 'pane');
    case 'Renamed': return withTopic(s, ev.text ?? '', ev.text?.trim() ? 'user' : undefined);
    case 'PaneIdle': {
      // The pane shows Claude waiting for a prompt. Ends what no hook ends (a denied request, an Esc) and drops a
      // request answered or dismissed in the terminal. A recent hook describes the turn better; a helper may still wait.
      if (s.state === 'idle' || s.state === 'error' || s.pending?.helperId) return s;
      if (lastHookAt && Date.parse(at) - Date.parse(lastHookAt) < HOOK_PRIORITY_MS) return s;
      return { ...s, state: 'idle', pending: undefined, lastActivityAt: at };
    }
    case 'InjectFailed':
      return { ...s, state: 'error', lastError: ev.text ?? 'injection not confirmed', lastActivityAt: at };
    case 'Decided': {
      const helperId = s.pending?.helperId;
      if (helperId) {
        const state = restored(s);
        const helpers = s.helpers.some(h => h.id === helperId) ? setHelper(s, helperId, { state: 'working' }) : s.helpers;
        return { ...s, state, helpers, pending: undefined, lastError: state === 'error' ? s.lastError : undefined, lastActivityAt: at };
      }
      // Ledge's own keys start the next step as a hook would: the pane, still at rest until the agent redraws (and
      // its prompt hook has run), gets the same grace instead of ending the turn it just started.
      return { ...s, state: 'working', pending: undefined, lastError: undefined, lastHookAt: at, lastActivityAt: at };
    }
    case 'Stop': {
      // The turn's last message rides on the hook; a Stop without one keeps what the last Stop said.
      const lastReply = ev.text ? { text: ev.text, at } : s.lastReply;
      if (s.pending?.helperId) return underHelper(s, 'idle', at, { lastReply });
      return { ...s, state: 'idle', pending: undefined, lastReply, lastHookAt: at, lastActivityAt: at };
    }
    case 'StopFailure': {
      // A failure reported after the turn already ended (Cursor Agent sends a stray one after an abort) changes nothing.
      if (s.state === 'idle') return s;
      const lastError = ev.text || 'the turn stopped on an error';
      if (s.pending?.helperId) return underHelper(s, 'error', at, { lastError });
      return { ...s, state: 'error', pending: undefined, lastError, lastHookAt: at, lastActivityAt: at };
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      // Esc interrupts the turn: Claude waits for input and no Stop follows.
      const rest = ev.interrupt ? 'idle' : 'working';
      if (s.pending?.helperId) return underHelper(s, rest, at);
      if (s.pending && !ev.interrupt && !clearedByToolRun(s.pending, ev.tool)) return { ...s, lastHookAt: at, lastActivityAt: at };
      return { ...s, state: rest, pending: undefined, lastHookAt: at, lastActivityAt: at };
    }
    case 'PanePrompt': {
      if (s.pending?.source === 'hook') return s;
      if (hooksReportPrompts(s) && lastHookAt && Date.parse(at) - Date.parse(lastHookAt) < HOOK_PRIORITY_MS) return s;
      const pending = mergePending(s.pending, pendingFor(ev)!);
      if (s.pending && samePending(s.pending, pending)) return s;
      const state = pending.kind === 'question' ? 'waiting_input' : 'waiting_permission';
      return { ...s, state, pending, lastActivityAt: at };
    }
    case 'SessionStart':
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PermissionRequest':
    case 'Notification': {
      if (ev.name === 'UserPromptSubmit' && ev.text && !s.topic) s = withTopic(s, ev.text, 'prompt');
      const incoming = pendingFor(ev);
      if (incoming) {
        // A Notification never overwrites an existing hook pending: only the hook timestamp moves.
        if (ev.name === 'Notification' && s.pending?.source === 'hook') return { ...s, lastHookAt: at, lastActivityAt: at };
        const pending = mergePending(s.pending, incoming);
        const state = pending.kind === 'question' ? 'waiting_input' : 'waiting_permission';
        return { ...s, state, pending, lastHookAt: at, lastActivityAt: at };
      }
      // A launch, a /clear or a resume starts no turn (only UserPromptSubmit does): the state stays, so nothing "finishes".
      if (ev.name === 'Notification' || ev.name === 'SessionStart') return { ...s, lastHookAt: at, lastActivityAt: at };
      // A new prompt answers the last reply: it is no longer "your turn" on that text.
      const prompted = ev.name === 'UserPromptSubmit' && s.lastReply ? withoutReply(s) : s;
      // A helper's routed request outlives the main agent's own activity (background helpers).
      if (prompted.pending?.helperId) return underHelper(prompted, 'working', at);
      if (prompted === s && s.state === 'working' && s.lastActivityAt === at && !s.pending) return s;
      return { ...prompted, state: 'working', pending: undefined, lastHookAt: at, lastActivityAt: at };
    }
  }
}

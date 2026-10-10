import type { Session, SessionEvent, Pending, Helper, SessionState } from '@ledge/protocol';

export const HOOK_PRIORITY_MS = 2000;

export function isPending(s: Session): boolean {
  return s.state === 'waiting_permission' || s.state === 'waiting_input';
}

function pendingFor(ev: SessionEvent): Pending | undefined {
  if (ev.name === 'PermissionRequest') {
    const diff = ev.tool === 'Edit' || ev.tool === 'Write' || ev.tool === 'MultiEdit';
    return { kind: diff ? 'diff' : 'permission', text: ev.text ?? '', tool: ev.tool, source: 'hook' };
  }
  if (ev.name === 'PreToolUse' && ev.tool === 'AskUserQuestion') {
    return { kind: 'question', text: ev.text ?? '', options: ev.options, source: 'hook' };
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

/** Richer wins: a hook pending is never replaced by a pane pending. */
function mergePending(current: Pending | undefined, incoming: Pending): Pending {
  if (!current) return incoming;
  if (current.source === 'hook' && incoming.source === 'pane') return current;
  if (incoming.source === 'hook' && current.source === 'pane') return incoming;
  // Two requesters (main agent, helpers) never merge: the first request keeps the card.
  if (current.helperId !== incoming.helperId) return current;
  // A permission/diff request over a richer hook pending (plan, question) keeps that kind.
  if (current.source === 'hook' && (current.kind === 'plan' || current.kind === 'question') && incoming.source === 'hook') return current;
  const kind = incoming.kind;
  return { ...current, ...incoming, kind, text: incoming.text || current.text, tool: incoming.tool ?? current.tool, options: incoming.options ?? current.options };
}

/** The tool whose PostToolUse means a hook pending was answered (in the terminal or from Ledge). */
function pendingTool(p: Pending): string | undefined {
  if (p.kind === 'question') return 'AskUserQuestion';
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
function reduceHelper(s: Session, ev: SessionEvent & { helperId: string }): Session {
  const at = ev.at;
  const id = ev.helperId;
  const own = s.pending?.helperId === id;
  switch (ev.name) {
    case 'SubagentStart': {
      const known = s.helpers.find(h => h.id === id);
      const patch: Partial<Helper> = { state: 'working', kind: ev.tool ?? known?.kind ?? 'subagent', task: ev.text || known?.task || '' };
      return { ...s, helpers: setHelper(s, id, patch), lastHookAt: at, lastActivityAt: at };
    }
    case 'SubagentStop': {
      const helpers = setHelper(s, id, { state: 'exited' }, ev.tool ?? 'subagent');
      if (own) return { ...s, helpers, pending: undefined, state: restored(s), lastHookAt: at, lastActivityAt: at };
      return { ...s, helpers, lastHookAt: at, lastActivityAt: at };
    }
    case 'PermissionRequest': {
      const helpers = setHelper(s, id, { state: 'waiting_permission' });
      if (s.pending && s.pending.source === 'hook') return { ...s, helpers, lastHookAt: at, lastActivityAt: at };
      const pending = { ...pendingFor(ev)!, helperId: id, parentState: settled(s.state) };
      return { ...s, helpers, state: 'waiting_permission', pending, lastHookAt: at, lastActivityAt: at };
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const helper = s.helpers.find(h => h.id === id);
      const busy = ev.name === 'PreToolUse' && helper?.state === 'waiting_permission';
      const helpers = busy ? s.helpers : setHelper(s, id, { state: ev.interrupt ? 'idle' : 'working' });
      if (ev.name !== 'PreToolUse' && own && (ev.interrupt || clearedByToolRun(s.pending!, ev.tool))) {
        return { ...s, helpers, pending: undefined, state: restored(s), lastHookAt: at, lastActivityAt: at };
      }
      return { ...s, helpers, lastHookAt: at, lastActivityAt: at };
    }
    default:
      return { ...s, lastHookAt: at, lastActivityAt: at };
  }
}

function samePending(a: Pending, b: Pending): boolean {
  return a.kind === b.kind && a.text === b.text && a.tool === b.tool && a.source === b.source
    && JSON.stringify(a.options) === JSON.stringify(b.options);
}

export function reduce(s: Session, ev: SessionEvent): Session {
  if (s.state === 'exited') return s;
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
      return { ...s, state: 'working', pending: undefined, lastError: undefined, lastActivityAt: at };
    }
    case 'Stop':
      if (s.pending?.helperId) return underHelper(s, 'idle', at);
      return { ...s, state: 'idle', pending: undefined, lastHookAt: at, lastActivityAt: at };
    case 'StopFailure': {
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
      if (lastHookAt && Date.parse(at) - Date.parse(lastHookAt) < HOOK_PRIORITY_MS) return s;
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
      const incoming = pendingFor(ev);
      if (incoming) {
        // A Notification never overwrites an existing hook pending: only the hook timestamp moves.
        if (ev.name === 'Notification' && s.pending?.source === 'hook') return { ...s, lastHookAt: at, lastActivityAt: at };
        const pending = mergePending(s.pending, incoming);
        const state = pending.kind === 'question' ? 'waiting_input' : 'waiting_permission';
        return { ...s, state, pending, lastHookAt: at, lastActivityAt: at };
      }
      if (ev.name === 'Notification') return { ...s, lastHookAt: at, lastActivityAt: at };
      // A helper's routed request outlives the main agent's own activity (background helpers).
      if (s.pending?.helperId) return underHelper(s, 'working', at);
      if (s.state === 'working' && s.lastActivityAt === at && !s.pending) return s;
      return { ...s, state: 'working', pending: undefined, lastHookAt: at, lastActivityAt: at };
    }
  }
}

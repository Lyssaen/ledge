import type { Session, SessionEvent, Pending } from '@ledge/protocol';

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
  // A permission/diff request over a richer hook pending (plan, question) keeps that kind.
  const kind = current.kind === 'plan' || current.kind === 'question' ? current.kind : incoming.kind;
  return { ...current, ...incoming, kind, text: incoming.text || current.text, tool: incoming.tool ?? current.tool, options: incoming.options ?? current.options };
}

function samePending(a: Pending, b: Pending): boolean {
  return a.kind === b.kind && a.text === b.text && a.tool === b.tool && a.source === b.source
    && JSON.stringify(a.options) === JSON.stringify(b.options);
}

export function reduce(s: Session, ev: SessionEvent): Session {
  if (s.state === 'exited' && ev.name !== 'SessionEnd' && ev.name !== 'PaneGone') return s;
  const at = ev.at;
  const lastHookAt = s.lastHookAt;

  switch (ev.name) {
    case 'SessionEnd':
      return { ...s, state: 'exited', pending: undefined, exitCode: ev.exitCode ?? null, exitedAt: s.exitedAt ?? at, lastActivityAt: at };
    case 'PaneGone':
      return { ...s, state: 'exited', pending: undefined, exitCode: null, exitedAt: s.exitedAt ?? at, lastActivityAt: at };
    case 'PaneChanged':
      return s.lastActivityAt === at ? s : { ...s, lastActivityAt: at };
    case 'PaneIdle':
      return s;
    case 'InjectFailed':
      return { ...s, state: 'error', lastError: ev.text ?? 'injection not confirmed', lastActivityAt: at };
    case 'Decided':
      return { ...s, state: 'working', pending: undefined, lastError: undefined, lastActivityAt: at };
    case 'Stop':
      return { ...s, state: 'idle', pending: undefined, lastHookAt: at, lastActivityAt: at };
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
      if (s.state === 'working' && s.lastActivityAt === at && !s.pending) return s;
      return { ...s, state: 'working', pending: undefined, lastHookAt: at, lastActivityAt: at };
    }
  }
}

import { cleanTopic, DOING_LABEL_MAX, RUNNING_MAX, pendingKey, parseRigPrompt, sessionTitle, type RunningCall, type Session, type SessionEvent, type Pending, type Helper, type SessionState, type TopicSource } from '@ledge/protocol';

import { crossSession, crossSessionNotices, ledgeNotice, ledgeTask } from './crossSession.js';
import { codexEditIs, sameQuestion } from '../adapters/types.js';
import { ledgeTitleRest } from '../names.js';

export const HOOK_PRIORITY_MS = 2000;

/**
 * Claude Code's hooks report its prompts (permission, question, plan), so a pane match right after a hook may be
 * stale or poorer. Cursor Agent's and Codex's never do: their prompts come from the pane alone, at once.
 */
const hooksReportPrompts = (s: Session) => s.tool === 'claude';

/** Codex's main agent asking a permission through its hook (#302): not proof that it waits, the terminal's dialog is. Only where
 *  Ledge reads a terminal: a session it only hears through hooks (hook_only, no tmux), or whose capture fails now, keeps the hook's
 *  request, as before (missing a real request is worse than showing one the automatic review settles). */
export function isCodexAsk(s: Pick<Session, 'tool' | 'tmuxSession' | 'paneUnreadable'> | undefined, ev: SessionEvent): boolean {
  return s?.tool === 'codex' && !!s.tmuxSession && !s.paneUnreadable && ev.name === 'PermissionRequest' && ev.source === 'hook' && !ev.helperId;
}

const TURN_ENDS: ReadonlySet<SessionEvent['name']> = new Set(['Stop', 'StopFailure', 'SessionEnd', 'PaneGone']);
const flat = (t: string) => t.replace(/\s+/g, ' ').trim();
/** Whether the dialog on screen is the held Codex request (#302), not only one of its kind: the same command, or an edit of one of
 *  the patch's files. Uncertain is no: the screen's own request (judged high on the phone) then waits instead. */
export function sameCodexAsk(ask: Pending, shown: { kind?: Pending['kind']; text?: string }, cwd?: string): boolean {
  if (ask.kind !== (shown.kind ?? 'permission')) return false;
  const text = shown.text ?? '';
  if (ask.kind === 'diff') return codexEditIs(ask.text, text, cwd);
  return flat(text) !== '' && flat(text) === flat(ask.text);
}
/** Whether `ev` settles a held Codex request (Session.codexAsk) no dialog showed: the main agent's run of that very tool (a helper's
 *  or another parallel call's never does), or the end of the turn (a refusal by the automatic review sends only Stop). */
export function endsCodexAsk(ask: Pending, ev: SessionEvent): boolean {
  // A helper's events are its own, its Stop included.
  if (ev.helperId) return false;
  if (TURN_ENDS.has(ev.name)) return true;
  if ((ev.name !== 'PostToolUse' && ev.name !== 'PostToolUseFailure')) return false;
  return !ask.tool || !ev.tool || ask.tool === ev.tool;
}

function withoutCodexAsk(s: Session): Session {
  const { codexAsk: _held, ...rest } = s;
  return rest;
}

export function isPending(s: Session): boolean {
  return s.state === 'waiting_permission' || s.state === 'waiting_input';
}

/** Tools that ask the user a multiple-choice question: Claude Code's, and Codex's (Plan mode). */
export const QUESTION_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'request_user_input']);
/** Tools whose permission request is a file change: Claude Code's, and Codex's patch. */
const DIFF_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'apply_patch']);

/** The options' descriptions travel with them, only when there are some. */
const details = (ev: SessionEvent) => (ev.optionDetails?.some(Boolean) ? { optionDetails: ev.optionDetails } : {});

/** The request a held Codex PermissionRequest describes (#302). */
export const codexAskOf = (ev: SessionEvent): Pending => pendingFor(ev)!;

function pendingFor(ev: SessionEvent): Pending | undefined {
  if (ev.name === 'PermissionRequest') {
    const diff = !!ev.tool && DIFF_TOOLS.has(ev.tool);
    return { kind: diff ? 'diff' : 'permission', text: ev.text ?? '', tool: ev.tool, source: 'hook' };
  }
  if (ev.name === 'PreToolUse' && ev.tool && QUESTION_TOOLS.has(ev.tool)) {
    // The tool is kept only when it is not Claude's, so its PostToolUse can still be matched (see pendingTool).
    return { kind: 'question', text: ev.text ?? '', options: ev.options, ...details(ev), source: 'hook', ...(ev.tool !== 'AskUserQuestion' ? { tool: ev.tool } : {}) };
  }
  if (ev.name === 'PreToolUse' && ev.tool === 'ExitPlanMode') {
    const plan = ev.toolInput?.plan;
    return { kind: 'plan', text: ev.text ?? '', ...(typeof plan === 'string' && plan.trim() ? { body: plan } : {}), source: 'hook' };
  }
  if (ev.name === 'Notification' && ev.kind === 'permission') {
    return { kind: 'permission', text: ev.text ?? '', source: 'hook' };
  }
  if (ev.name === 'NativeRequest') {
    // OMP's own dialog (spec 2026-10-20 §3.3): its exact text and options, nothing inferred about permission.
    return { kind: 'question', text: ev.text ?? '', ...(ev.options?.length ? { options: ev.options } : {}), ...(ev.questions ? { questions: ev.questions } : {}), ...(ev.requestId ? { requestId: ev.requestId } : {}), source: 'rpc', tool: 'omp' };
  }
  if (ev.name === 'PanePrompt') {
    return { kind: ev.kind ?? 'permission', text: ev.text ?? '', ...(ev.body ? { body: ev.body } : {}), options: ev.options, ...details(ev), source: 'pane' };
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
  // The descriptions belong to the options they came with.
  const options = incoming.options ?? current.options;
  const optionDetails = incoming.options ? incoming.optionDetails : current.optionDetails;
  const { optionDetails: _old, ...rest } = { ...current, ...incoming };
  return { ...rest, kind, text: incoming.text || current.text, tool: incoming.tool ?? current.tool, options, ...(optionDetails ? { optionDetails } : {}) };
}

/** The tool whose PostToolUse means a hook pending was answered (in the terminal or from Ledge). */
export function pendingTool(p: Pending): string | undefined {
  if (p.kind === 'question') return p.tool ?? 'AskUserQuestion';
  if (p.kind === 'plan') return 'ExitPlanMode';
  return p.tool;
}

/**
 * The hook that says a request typed from Ledge was taken: the PostToolUse (or its failure) of the tool it is for,
 * from the same requester. Nothing for a request no tool is tied to (the pane's, a Notification's): the screen tells.
 */
export function answeredBy(p: Pending, ev: SessionEvent): boolean {
  if (p.source !== 'hook' || (ev.name !== 'PostToolUse' && ev.name !== 'PostToolUseFailure')) return false;
  const tool = pendingTool(p);
  return tool !== undefined && ev.tool === tool && ev.helperId === p.helperId;
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
  return a.kind === b.kind && a.text === b.text && a.body === b.body && a.tool === b.tool && a.source === b.source
    && JSON.stringify(a.options) === JSON.stringify(b.options) && JSON.stringify(a.optionDetails) === JSON.stringify(b.optionDetails);
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

/** A tool's label as one short line: its first non-empty line, spaces collapsed, cut to DOING_LABEL_MAX with « … ». */
export function doingLabel(text: string): string {
  const line = (text.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? '').replace(/\s+/g, ' ');
  if (line.length <= DOING_LABEL_MAX) return line;
  let end = DOING_LABEL_MAX - 1;
  if (/[\ud800-\udbff]/.test(line[end - 1] ?? '')) end--;
  return `${line.slice(0, end).trimEnd()}…`;
}

function withRunning(s: Session, running: RunningCall[]): Session {
  if (running.length) return { ...s, running };
  if (!s.running) return s;
  const { running: _gone, ...rest } = s;
  return rest;
}

/** The index of the call an end or a refusal is for: its id when both have one, else the oldest call of that tool. */
function callIndex(running: RunningCall[], tool: string | undefined, id: string | undefined): number {
  if (id) { const i = running.findIndex(c => c.id === id); if (i >= 0) return i; }
  return running.findIndex(c => c.tool === tool && (!id || !c.id));
}

/**
 * The tools the agent itself is running (`running`), after an event. Its own PreToolUse adds a call, unless that tool is a
 * request (a question, a plan); the call's end removes it, matched by id, else the oldest of that tool, so parallel calls
 * end in any order. A request keeps the calls and marks the one that asked (`asks`); accepted, it runs on; refused from
 * Ledge, that call goes.
 * The end of the turn (rest, error, exit, a new prompt) drops them all. A subagent's events never touch them.
 */
function withCalls(before: Session, next: Session, ev: SessionEvent): Session {
  const running = next.running ?? [];
  if (next.state === 'idle' || next.state === 'error' || next.state === 'exited' || next.state === 'starting') return withRunning(next, []);
  if (ev.helperId) return next;
  if (ev.name === 'UserPromptSubmit') return withRunning(next, []);
  if (ev.name === 'PreToolUse' && ev.tool && !QUESTION_TOOLS.has(ev.tool) && ev.tool !== 'ExitPlanMode') {
    if (ev.toolUseId && running.some(c => c.id === ev.toolUseId)) return next; // the same call announced again
    const call: RunningCall = { ...(ev.toolUseId ? { id: ev.toolUseId } : {}), tool: ev.tool, label: doingLabel(ev.text ?? '') || ev.tool, since: ev.at };
    return withRunning(next, [...running, call].slice(-RUNNING_MAX));
  }
  if (ev.name === 'PostToolUse' || ev.name === 'PostToolUseFailure') {
    const i = callIndex(running, ev.tool, ev.toolUseId);
    return i < 0 ? next : withRunning(next, running.filter((_, j) => j !== i));
  }
  // The request this event put up names the call that asked: by its id, else the newest call of that tool.
  if (ev.name === 'PermissionRequest' && next.pending && next.pending !== before.pending && next.pending.source === 'hook') {
    let i = ev.toolUseId ? running.findIndex(c => c.id === ev.toolUseId) : -1;
    if (i < 0 && !ev.toolUseId) i = running.map(c => c.tool).lastIndexOf(ev.tool ?? '');
    if (i < 0) return withoutAsks(next, running);
    return withRunning(next, running.map((c, j) => (j === i ? { ...c, asks: true as const } : withoutAsk(c))));
  }
  // Refused from Ledge: the tool will not run, so the call that asked goes.
  if (ev.name === 'Decided' && ev.decision === 'deny' && before.pending && !before.pending.helperId) {
    const i = running.findIndex(c => c.asks);
    return i < 0 ? withoutAsks(next, running) : withRunning(next, running.filter((_, j) => j !== i));
  }
  // Once no request waits, no call is the one asking any more (accepted, or answered elsewhere).
  return next.pending ? next : withoutAsks(next, running);
}

function withoutAsk(c: RunningCall): RunningCall {
  if (!c.asks) return c;
  const { asks: _a, ...rest } = c;
  return rest;
}

function withoutAsks(s: Session, running: RunningCall[]): Session {
  return running.some(c => c.asks) ? withRunning(s, running.map(withoutAsk)) : s;
}

export function reduce(s: Session, ev: SessionEvent): Session {
  const next = withCalls(s, reduceEvent(s, ev), ev);
  if (next === s) return s;
  let changed = false;
  const helpers = next.helpers.map(h => {
    if (h.state === 'exited' || next.state === 'exited') {
      if (h.state === 'exited' && h.finishedAt) return h;
      changed = true;
      return { ...h, state: 'exited' as const, finishedAt: h.finishedAt ?? next.exitedAt ?? ev.at };
    }
    if (!h.finishedAt) return h;
    changed = true;
    const { finishedAt: _gone, ...active } = h;
    return active;
  });
  return changed ? { ...next, helpers } : next;
}

function reduceEvent(s: Session, ev: SessionEvent): Session {
  // The agent's own conversation id follows its hooks, even a late one after the exit.
  if (ev.agentSessionId && !ev.helperId && ev.agentSessionId !== s.agentSessionId) s = { ...s, agentSessionId: ev.agentSessionId };
  if (s.state === 'exited') return s;
  s = endCursorHelpers(s, ev);
  const at = ev.at;
  const lastHookAt = s.lastHookAt;
  if (ev.name === 'SubagentStart' || ev.name === 'SubagentStop') return ev.helperId ? reduceHelper(s, { ...ev, helperId: ev.helperId }) : s;
  if (ev.helperId && ev.source === 'hook' && ev.name !== 'SessionEnd') return reduceHelper(s, { ...ev, helperId: ev.helperId });
  // The transcript a hook names is the live one (it follows /clear and --resume): it replaces the one the launch implied.
  if (ev.source === 'hook' && ev.transcriptPath && ev.transcriptPath !== s.transcriptPath) s = { ...s, transcriptPath: ev.transcriptPath };
  // #302: Codex sends its main agent's PermissionRequest before it knows whether it will ask: with « Approve for me » (its
  // approvals_reviewer auto_review) the automatic review settles it alone, and the same payload means no question at all. Only its
  // dialog in the terminal (PanePrompt) says it waits on the person: the hook is activity, nothing more. Claude Code, OMP and Codex's
  // helpers are unchanged. Its exact request (tool, files) is held until the dialog shows, then it is the request, as before: the
  // phone judges it from the same files (an edit inside the folder needs no passkey).
  if (isCodexAsk(s, ev)) {
    const ask = pendingFor(ev)!;
    // The dialog was read before its hook: the hook's request replaces the screen's, as a hook's always did.
    if (s.pending?.source === 'pane' && !s.pending.helperId && sameCodexAsk(ask, s.pending, s.workdir ?? s.cwd)) {
      return { ...withoutCodexAsk(s), pending: ask, lastHookAt: at, lastActivityAt: at };
    }
    return { ...s, codexAsk: ask, lastHookAt: at, lastActivityAt: at };
  }
  // The held request was settled without a dialog (the automatic review: the tool ran, or the turn ended on a refusal).
  if (s.codexAsk && endsCodexAsk(s.codexAsk, ev)) s = withoutCodexAsk(s);

  switch (ev.name) {
    case 'SessionEnd':
      return { ...s, state: 'exited', pending: undefined, exitCode: ev.exitCode ?? null, exitedAt: s.exitedAt ?? at, lastActivityAt: at };
    case 'PaneUnreadable': {
      // The terminal can no longer be read: no dialog will prove a held request, so it waits now, as the hook alone did before #302.
      if (s.paneUnreadable) return s;
      const ask = s.codexAsk;
      const marked = { ...withoutCodexAsk(s), paneUnreadable: true as const };
      return ask && !s.pending ? { ...marked, state: 'waiting_permission', pending: ask, lastActivityAt: at } : marked;
    }
    case 'PaneReadable': {
      // Read again: the dialog decides the next requests; the one shown stays until its tool ran or the turn ended.
      if (!s.paneUnreadable) return s;
      const { paneUnreadable: _gone, ...rest } = s;
      return rest;
    }
    case 'PaneGone':
      return { ...s, state: 'exited', pending: undefined, exitCode: null, exitedAt: s.exitedAt ?? at, lastActivityAt: at };
    case 'PaneChanged':
      return s.lastActivityAt === at ? s : { ...s, lastActivityAt: at };
    case 'PaneTitle': {
      if (s.topicSource === 'user') return s;
      const t = ev.text ?? '';
      const rest = ledgeTitleRest(t, s.name);
      // A bare Ledge name is no topic; one an earlier launch stored as such (`-n`) is dropped, so a prompt or a title sets one.
      if (rest === '') return s.topicSource === 'pane' && s.topic !== undefined && ledgeTitleRest(s.topic, s.name) === '' ? withTopic(s, '', undefined) : s;
      return withTopic(s, rest ?? t, 'pane');
    }
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
      // Who answered the request from Ledge, kept with its key: « Déjà traitée sur … » on the devices that did not.
      const answer = ev.by && s.pending ? { lastAnswer: { key: pendingKey(s.pending), by: ev.by, at, ...(ev.decision ? { decision: ev.decision } : {}) } } : {};
      const helperId = s.pending?.helperId;
      if (helperId) {
        const state = restored(s);
        const helpers = s.helpers.some(h => h.id === helperId) ? setHelper(s, helperId, { state: 'working' }) : s.helpers;
        return { ...s, ...answer, state, helpers, pending: undefined, lastError: state === 'error' ? s.lastError : undefined, lastActivityAt: at };
      }
      // Ledge's own keys start the next step as a hook would: the pane, still at rest until the agent redraws (and
      // its prompt hook has run), gets the same grace instead of ending the turn it just started.
      return { ...s, ...answer, state: 'working', pending: undefined, lastError: undefined, lastHookAt: at, lastActivityAt: at };
    }
    case 'Stop': {
      // The turn's last message rides on the hook; a Stop without one keeps what the last Stop said.
      const lastReply = ev.text ? { text: ev.text, at, ...(ev.kind === 'plan' ? { plan: true } : {}) } : s.lastReply;
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
      const incoming = pendingFor(ev)!;
      // #302: Codex's dialog proves its held request waits: the hook's exact request is the one shown and answered.
      if (s.codexAsk) {
        const ask = s.codexAsk;
        s = withoutCodexAsk(s);
        if (!s.pending && sameCodexAsk(ask, incoming, s.workdir ?? s.cwd)) return { ...s, state: 'waiting_permission', pending: ask, lastActivityAt: at };
      }
      // A hook question the pane has moved past (the next question of an AskUserQuestion, its review: the last one
      // answered in the terminal) gives way to what the pane asks. No hook reports the next one: only the end of all.
      const moved = s.pending?.source === 'hook' && s.pending.kind === 'question' && incoming.kind === 'question'
        && !sameQuestion(incoming.text, s.pending.text);
      // A Notification's request names no tool and no option: the pane's says more (question 2 of an AskUserQuestion
      // whose question 1 was answered from Ledge: its Decided emptied the card before the Notification came).
      const bare = s.pending?.source === 'hook' && s.pending.kind === 'permission' && !s.pending.tool;
      if (s.pending?.source === 'hook' && !moved && !bare) return s;
      if (!moved && hooksReportPrompts(s) && lastHookAt && Date.parse(at) - Date.parse(lastHookAt) < HOOK_PRIORITY_MS) return s;
      let pending = moved ? { ...incoming, ...(s.pending!.helperId ? { helperId: s.pending!.helperId } : {}) } : bare ? incoming : mergePending(s.pending, incoming);
      // Codex asks "Implement this plan?" under the plan it just proposed: its last reply is what to review.
      if (pending.kind === 'plan' && !pending.body && s.tool === 'codex' && s.lastReply) pending = { ...pending, body: s.lastReply.text };
      if (s.pending && samePending(s.pending, pending)) return s;
      const state = pending.kind === 'question' ? 'waiting_input' : 'waiting_permission';
      return { ...s, state, pending, lastActivityAt: at };
    }
    case 'QueueUpdate': { const { queue: _q, ...rest } = s; return ev.queue?.length ? { ...rest, queue: ev.queue } : s.queue ? rest : s; }
    case 'AgentMessage': return s.lastActivityAt === at ? s : { ...s, lastActivityAt: at };
    case 'NativeRequest': {
      // A second dialog waits in the harness's queue (the host keeps it): the first request holds the card until it is answered.
      if (s.pending) return s;
      return { ...s, state: 'waiting_input', pending: pendingFor(ev)!, lastActivityAt: at };
    }
    case 'SessionStart':
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PermissionRequest':
    case 'Notification': {
      // The harness's cross-session notices are not the user's words: no topic, and the last reply still waits for the user.
      const notice = ev.name === 'UserPromptSubmit' && !!ev.text && (!!crossSessionNotices(ev.text) || !!ledgeNotice(ev.text) || !!ledgeTask(ev.text));
      if (ev.name === 'UserPromptSubmit' && ev.text && !s.topic && !notice && !crossSession(ev.text) && !parseRigPrompt(ev.text, at)) s = withTopic(s, ev.text, 'prompt'); // OpenRig's words are not the session's subject
      // OMP's dialog is closed by OMP's own word (a cancel) or by the answer: an action starting meanwhile (its `ask` call is
      // announced after its dialog) is not the end of the request.
      if (s.pending?.source === 'rpc' && ev.name === 'PreToolUse') return { ...s, lastHookAt: at, lastActivityAt: at };
      const incoming = pendingFor(ev);
      if (incoming) {
        // A Notification never overwrites an existing pending, a hook's or the pane's (question 2 of an AskUserQuestion,
        // #31): it names no tool and no option. Only the hook timestamp moves.
        if (ev.name === 'Notification' && s.pending) return { ...s, lastHookAt: at, lastActivityAt: at };
        const pending = mergePending(s.pending, incoming);
        const state = pending.kind === 'question' ? 'waiting_input' : 'waiting_permission';
        return { ...s, state, pending, lastHookAt: at, lastActivityAt: at };
      }
      // A launch, a /clear or a resume starts no turn (only UserPromptSubmit does): the state stays, so nothing "finishes".
      if (ev.name === 'Notification' || ev.name === 'SessionStart') return { ...s, lastHookAt: at, lastActivityAt: at };
      // A new prompt answers the last reply: it is no longer "your turn" on that text.
      const prompted = ev.name === 'UserPromptSubmit' && s.lastReply && !notice ? withoutReply(s) : s;
      // A helper's routed request outlives the main agent's own activity (background helpers).
      if (prompted.pending?.helperId) return underHelper(prompted, 'working', at);
      if (prompted === s && s.state === 'working' && s.lastActivityAt === at && !s.pending) return s;
      return { ...prompted, state: 'working', pending: undefined, lastHookAt: at, lastActivityAt: at };
    }
  }
}

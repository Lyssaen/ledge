import {
  contextNear, openDecision, pendingKey, taskClosed, type DecidedBy, type ForgeStateMessage, type HumanAsk, type OpenRigState, type Pending, type Session, type Task
} from '@ledge/protocol';
import type { JournalEvent } from './journal.js';
import { STALE_TASK_MS } from './constants.js';

/*
 * Pure detectors: each compares two states the daemon holds and returns the events the journal should record.
 * The point's items are keyed `${subjectKind}:${subjectId}`, so these strings are stable:
 *   - `session.request`: a request or a question of a session; subjectId `<sessionId>#<pendingKey>`;
 *   - `session`: finished, error, exited and context_full events; subjectId is the session id;
 *   - `task`: every task, decision and brain event; subjectId is the task id;
 *   - `rig.ask`: a row of OpenRig's human channel; subjectId is the qitem id;
 *   - `rig.seat`: a seat of a rig; subjectId `<rig>/<seat logical id>`;
 *   - `rig`: a whole rig; subjectId is the rig name;
 *   - `pr`: a pull or merge request; subjectId is its id (`prIdOf`).
 */

/** An event the journal has not stamped yet (it adds the id, the machine, the time and the settling). */
export type Draft = Omit<JournalEvent, 'id' | 'settledAt' | 'machine' | 'at'>;
export type SettledWhere = 'terminal' | 'phone' | 'desktop' | 'chat' | 'elsewhere';

/** Longest text a payload keeps of what an agent wrote. */
const TEXT_MAX = 1000;
const clip = (s: string): string => (s.length <= TEXT_MAX ? s : `${s.slice(0, TEXT_MAX - 1)}…`);
/** Codex's stock request text says nothing: its command is the body. */
const GENERIC_REASONS = new Set(['Allow the requested shell command?']);

const commandOf = (p: Pending): string => {
  const text = p.text.trim();
  return GENERIC_REASONS.has(text) && p.body?.trim() ? p.body.trim() : text;
};

/** What a session did between two reads: a new request or question, a turn that ended, an error, an exit, a full context. */
export function fromSession(before: Session | undefined, after: Session, contextNearAt: number): Draft[] {
  const out: Draft[] = [];
  const p = after.pending;
  const base = { subjectName: after.name };
  if (p && (!before?.pending || pendingKey(p) !== pendingKey(before.pending))) {
    const key = pendingKey(p);
    out.push({
      ...base, kind: p.kind === 'question' ? 'session.question' : 'session.request', subjectKind: 'session.request', subjectId: `${after.id}#${key}`,
      urgency: 'immediate',
      payload: { session: after.id, key, kind: p.kind, ...(p.tool ? { tool: p.tool } : {}), text: clip(p.text.trim()), command: clip(commandOf(p)), ...(p.options ? { options: p.options } : {}) }
    });
  }
  const session = (kind: Draft['kind'], payload: Record<string, unknown>): Draft =>
    ({ ...base, kind, subjectKind: 'session', subjectId: after.id, urgency: 'grouped', payload });
  if (before?.state === 'working' && after.state === 'idle' && !p) out.push(session('session.finished', { text: clip((after.lastReply?.text ?? '').trim()) }));
  if (before && before.state !== 'error' && after.state === 'error') out.push(session('session.error', {}));
  if (before && before.state !== 'exited' && after.state === 'exited') out.push(session('session.exited', {}));
  if (before && !contextNear(before.context, contextNearAt) && contextNear(after.context, contextNearAt)) {
    out.push(session('session.context_full', { used: after.context!.used, window: after.context!.window }));
  }
  return out;
}

/**
 * A request or question that left (answered, or replaced by another): the subject the journal settles, and where it was
 * answered. `by` is the daemon's `Decided`: a device is the phone, the PC any local front. Without it, a request that came
 * from a hook or the pane was answered in the terminal. The chat card has no `DecidedBy` yet, so `chat` is never returned.
 */
export function settledSession(before: Session | undefined, after: Session, by?: DecidedBy | null): { subjectId: string; where: SettledWhere } | null {
  const was = before?.pending;
  if (!was || (after.pending && pendingKey(after.pending) === pendingKey(was))) return null;
  const where: SettledWhere = by?.kind === 'device' ? 'phone' : by?.kind === 'pc' ? 'desktop' : was.source === 'rpc' ? 'elsewhere' : 'terminal';
  return { subjectId: `${after.id}#${pendingKey(was)}`, where };
}

/**
 * Tasks that opened, closed, or went quiet. `lastActivity` is when a session last did anything (epoch ms); `reported` holds the
 * ids already reported stale, which the caller keeps so a task is said stale once.
 */
export function fromTasks(before: readonly Task[], after: readonly Task[], now: number, lastActivity: (sessionId: string) => number | undefined, reported: ReadonlySet<string>): Draft[] {
  const was = new Map(before.map(t => [t.id, t]));
  const out: Draft[] = [];
  for (const t of after) {
    const prev = was.get(t.id);
    const e = (kind: Draft['kind'], urgency: Draft['urgency'], payload: Record<string, unknown>): Draft =>
      ({ kind, subjectKind: 'task', subjectId: t.id, subjectName: t.title, urgency, payload });
    if (!prev && !taskClosed(t)) {
      const who = { giver: t.giverName, owner: t.ownerName };
      if (t.brain) out.push(e('brain.proposed', 'grouped', { ...who, brain: t.brain }));
      else if (openDecision(t)) out.push(e('decision.asked', 'immediate', { ...who, text: clip(t.text ?? '') }));
      else out.push(e('task.opened', 'grouped', who));
    }
    if (prev && !taskClosed(prev) && taskClosed(t)) out.push(e('task.closed', 'grouped', { state: t.state, owner: t.ownerName, ...(t.result ? { result: clip(t.result) } : {}) }));
    if (t.state === 'taken' && !reported.has(t.id)) {
      const last = Math.max(Date.parse(t.updatedAt) || 0, lastActivity(t.owner) ?? 0);
      if (now - last >= STALE_TASK_MS) out.push(e('task.stale', 'grouped', { owner: t.ownerName, idleMs: now - last }));
    }
  }
  return out;
}

/** A new row of OpenRig's human channel: urgent and critical ones are immediate. */
export function fromAsks(before: readonly HumanAsk[], after: readonly HumanAsk[]): Draft[] {
  const known = new Set(before.map(a => a.id));
  return after.filter(a => !known.has(a.id)).map(a => ({
    kind: 'rig.ask', subjectKind: 'rig.ask', subjectId: a.id, subjectName: a.from.seat,
    urgency: a.priority === 'routine' ? 'grouped' : 'immediate',
    payload: { kind: a.kind, priority: a.priority, summary: clip(a.summary), rig: a.from.rig, seat: a.from.seat, ...(a.goalId ? { goalId: a.goalId } : {}) }
  }));
}

/** A seat that stopped answering while it was not stopped on purpose, or a rig that left `running`. */
export function fromRigs(before: OpenRigState | undefined, after: OpenRigState): Draft[] {
  if (!before) return [];
  const out: Draft[] = [];
  for (const rig of after.rigs) {
    const prev = before.rigs.find(r => r.id === rig.id || r.name === rig.name);
    if (!prev) continue;
    if (prev.status === 'running' && rig.status !== 'running') {
      out.push({ kind: 'rig.state', subjectKind: 'rig', subjectId: rig.name, subjectName: rig.name, urgency: 'grouped', payload: { from: prev.status, to: rig.status } });
    }
    for (const n of rig.nodes) {
      const was = prev.nodes.find(x => x.logicalId === n.logicalId);
      if (!was || was.stopped || was.sessionStatus !== 'running' || n.stopped || n.sessionStatus === 'running') continue;
      out.push({ kind: 'rig.seat_unreachable', subjectKind: 'rig.seat', subjectId: `${rig.name}/${n.logicalId}`, subjectName: n.session, urgency: 'grouped',
        payload: { rig: rig.name, seat: n.session, status: n.sessionStatus } });
    }
  }
  return out;
}

/** A followed request whose pipeline just failed (or failed again on a new commit), or that was merged. */
export function fromForge(before: ForgeStateMessage | undefined, after: ForgeStateMessage): Draft[] {
  if (!before) return [];
  const was = new Map(before.prs.map(p => [p.id, p]));
  const out: Draft[] = [];
  for (const pr of after.prs) {
    const prev = was.get(pr.id);
    const e = (kind: Draft['kind'], payload: Record<string, unknown>): Draft =>
      ({ kind, subjectKind: 'pr', subjectId: pr.id, subjectName: pr.title, urgency: 'grouped', payload: { ref: pr.ref, repo: pr.repo, branch: pr.branch, url: pr.url, ...payload } });
    if (pr.pipeline === 'fail' && (prev?.pipeline !== 'fail' || prev.headSha !== pr.headSha)) out.push(e('forge.pipeline_failed', {}));
    if (prev && prev.state !== 'merged' && pr.state === 'merged') out.push(e('forge.merged', {}));
  }
  return out;
}

import { KERNEL_RIG, type Goal, type GoalError, type OpenRigState } from '@ledge/protocol';
import { log } from '../log.js';
import { GOAL_TAG, goalOf, goalTag, parseTeam, withoutTeam } from './goalTeam.js';
import type { RigRun } from './openrig.js';
import { answerOf, fetchHttp, type RigHttp } from './openrigHuman.js';

/**
 * Lot 2 (docs/vision/ledge-goal-contract.md): the person's goal goes to Max as an ordinary queue row from `ledge@external` (the po-web
 * model: a stable `--id`, so a retry never makes a second row); Max proposes a team with an ask to the person tagged `ledge-goal:<id>`
 * (answered through « À toi », lot 1), then hands the goal row on; Ledge reads that trail back from OpenRig, which stays the record.
 */

/** Who Ledge writes as: the registered person's address (the one « À toi » shows). */
export const PERSON = 'ledge@external';
/** How many goals are read and shown, the most recent first. */
export const GOALS_MAX = 20;
/** How far a goal's chain of handoffs is followed. */
const CHAIN_MAX = 8;
/** How many rows one OpenRig list read takes; a read that fills it may leave some out, and says so (partial). */
const LIST_LIMIT = 2000;
const TERMINAL = new Set(['done', 'handed-off', 'canceled', 'failed', 'denied']);
const SYSTEM_NOTES = new Set(['created', 'claimed']);

export const goalQitemId = (goalId: string): string => `qitem-ledge-goal-${goalId}`;
export const replyQitemId = (replyId: string): string => `qitem-ledge-goal-reply-${replyId}`;

/** The goal row's body: the convention for Max, then the person's own words under the line. Deterministic, so a retry sends the same
 *  body (OpenRig refuses a different body under the same id). */
export function goalBody(text: string, folder: string | undefined, qitemId: string): string {
  return [
    'A goal from the person, sent through Ledge. Their own words are below the line; keep them as they are when you hand the goal on.',
    `Folder: ${folder ?? 'not given'}`,
    '',
    `Ledge ↔ Max convention (Ledge's docs/vision/ledge-goal-contract.md): propose the team with a decision ask to ${PERSON} tagged ${goalTag(qitemId)},`,
    'with one question "team" (options "confirm", recommended, and "launch-rig") and a ```ledge-team``` JSON block in the body',
    '(kind existing|launch, rig, running, folder as an absolute path, seats, reason; for a launch: agents, runtimes, plan, writes, permissions).',
    'If the folder or a fitting team is missing, ask a question the same way (same tag, no "team" question) rather than guessing.',
    `Once confirmed, hand this row on with \`rig queue handoff ${qitemId} --to <seat> --tags ${goalTag(qitemId)}\`, keeping the words below.`,
    'An answer in words changes the team: propose again. A rig launch is always the person\'s own yes.',
    '',
    '---',
    '',
    text
  ].join('\n');
}

/** The person's words and folder back from a goal row's body. */
export function readGoalBody(body: string): { text: string; folder: string | null } {
  const cut = body.indexOf('\n---\n');
  const head = cut < 0 ? '' : body.slice(0, cut), text = cut < 0 ? body : body.slice(cut + 5).replace(/^\n/, '');
  const f = /^Folder: (.*)$/m.exec(head)?.[1]?.trim();
  return { text: text.trim(), folder: f && f !== 'not given' ? f : null };
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const rowsOf = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const tagsOf = (r: Json): string[] => (Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : []);
const firstLine = (t: string): string => t.trim().split(/\r?\n/).find(Boolean)?.trim() ?? '';

export interface GoalsDeps {
  state: () => Promise<OpenRigState>;
  /** Runs `rig` as Ledge, never as a seat (no OPENRIG_SESSION_NAME): `--source ledge@external` is then the source recorded. */
  run: RigRun;
  http?: RigHttp;
}

export interface GoalsList { goals: Goal[]; partial?: boolean }
type Sent = { ok: boolean; qitemId?: string; error?: GoalError; message?: string };

export interface GoalsService {
  send(goalId: string, text: string, folder?: string): Promise<Sent>;
  reply(goalId: string, replyId: string, text: string): Promise<Sent>;
  list(): Promise<GoalsList>;
}

/** Max: the kernel's `operator.agent` seat. */
export function operatorOf(state: OpenRigState): string | null {
  return state.rigs.find(r => r.name === KERNEL_RIG)?.nodes.find(n => n.logicalId === 'operator.agent')?.session ?? null;
}

/** What `rig queue create` said: the row made (or found again on a retry), or why not. A failure after the request may have reached the
 *  daemon is `uncertain`: sending the same id again is safe. */
export function createOutcome(r: { code: number | null; stdout: string; stderr: string }, qitemId: string): Sent {
  const out = `${r.stdout}\n${r.stderr}`;
  const i = r.stdout.indexOf('{');
  let row: Json = {};
  try { row = obj(JSON.parse(r.stdout.slice(i))); } catch { /* not JSON */ }
  if (r.code === 0 && str(row.qitemId) === qitemId) return { ok: true, qitemId };
  if (r.code === null) return { ok: false, error: 'openrig_stopped', message: 'rig: command not found' };
  const last = out.trim().split('\n').filter(Boolean).pop() ?? `rig exited ${r.code}`;
  if (/qitem_id_reuse|invalid_|_required|unknown_destination|not_admitted|reply_to/.test(out)) return { ok: false, error: 'refused', message: last };
  if (/ECONNREFUSED|daemon (is )?not running|Daemon not running/i.test(out)) return { ok: false, error: 'openrig_stopped', message: last };
  return { ok: false, error: 'uncertain', message: last };
}

export function createGoals(deps: GoalsDeps): GoalsService {
  const http = deps.http ?? fetchHttp;

  /** OpenRig's API and Max, or why the goal cannot go. Only a stop OpenRig confirms is a stop. */
  const reach = async (): Promise<{ url: string; operator: string } | { error: GoalError; message: string }> => {
    const st = await deps.state();
    if (!st.installed) return { error: 'openrig_stopped', message: 'OpenRig is not installed' };
    if (st.daemon.state === 'stopped') return { error: 'openrig_stopped', message: 'OpenRig is stopped' };
    if (st.daemon.state !== 'running' || !st.daemon.port) return { error: 'unreachable', message: `OpenRig's state is ${st.daemon.state}` };
    const operator = operatorOf(st);
    if (!operator) return { error: 'no_operator', message: 'the kernel has no operator.agent seat running' };
    return { url: `http://127.0.0.1:${st.daemon.port}`, operator };
  };

  const create = async (to: string, qitemId: string, summary: string, body: string, tags: string): Promise<Sent> => {
    const r = await deps.run(['queue', 'create', '--source', PERSON, '--destination', to, '--id', qitemId, '--summary', summary, '--body', body, '--tags', tags, '--json'], 30_000);
    const out = createOutcome(r, qitemId);
    if (!out.ok) log(`openrig goals: ${qitemId} not created (${out.error}): ${out.message}`);
    return out;
  };

  const send: GoalsService['send'] = async (goalId, text, folder) => {
    const at = await reach();
    if ('error' in at) return { ok: false, ...at };
    const qitemId = goalQitemId(goalId);
    const summary = `Objectif via Ledge : ${firstLine(text).slice(0, 100)}`;
    return create(at.operator, qitemId, summary, goalBody(text, folder, qitemId), GOAL_TAG);
  };

  const reply: GoalsService['reply'] = async (goalId, replyId, text) => {
    const at = await reach();
    if ('error' in at) return { ok: false, ...at };
    const goal = goalQitemId(goalId), qitemId = replyQitemId(replyId);
    const body = [`The person's reply through Ledge about the goal ${goal}, in their own words below the line.`, '', '---', '', text].join('\n');
    return create(at.operator, qitemId, `Réponse via Ledge : ${firstLine(text).slice(0, 100)}`, body, `${GOAL_TAG}-reply:${goal}`);
  };

  /** The goals last read, by id: a read that fails, whole or for one goal, keeps what it had (partial); it never empties the list. */
  let known = new Map<string, Goal>();
  const list: GoalsService['list'] = async () => {
    // Reading needs OpenRig only, not Max: only a stop OpenRig confirms (or no OpenRig at all) empties the list.
    const st = await deps.state();
    if (!st.installed || st.daemon.state === 'stopped') { known = new Map(); return { goals: [] }; }
    // A read that fails is partial even with nothing known yet: an empty list is said only when read.
    const kept = (): GoalsList => ({ goals: [...known.values()], partial: true });
    if (st.daemon.state !== 'running' || !st.daemon.port) return kept();
    const url = `http://127.0.0.1:${st.daemon.port}`;
    let partial = false, missed = false;
    /** A list read, or undefined when it failed; a list that fills its limit may leave rows out, so the result is partial. */
    const rows = async (path: string, limit: number | null = LIST_LIMIT): Promise<Json[] | undefined> => {
      const r = await http('GET', `${url}${path}${limit === null ? '' : `${path.includes('?') ? '&' : '?'}limit=${limit}`}`);
      if (r.status !== 200 || !Array.isArray(r.json)) { partial = missed = true; return undefined; }
      if (limit !== null && r.json.length >= limit) partial = true;
      return rowsOf(r.json);
    };
    const listed = await rows(`/api/queue/list?sourceSession=${encodeURIComponent(PERSON)}`);
    if (!listed) return kept();
    const mine = listed
      .filter(r => str(r.qitemId)?.startsWith('qitem-ledge-goal-') && !str(r.qitemId)!.startsWith('qitem-ledge-goal-reply-') && tagsOf(r).includes(GOAL_TAG))
      .sort((a, b) => (str(b.tsCreated) ?? '').localeCompare(str(a.tsCreated) ?? ''))
      .slice(0, GOALS_MAX);
    if (!mine.length) { known = new Map(); return { goals: [], ...(partial ? { partial } : {}) }; }
    const since = mine.map(r => str(r.tsCreated) ?? '').sort()[0]!;
    // Max's asks about goals (proposals and questions, the answered ones included), from the oldest goal on.
    const asksRead = await rows(`/api/queue/list?destinationSession=${encodeURIComponent(PERSON)}&updatedSince=${encodeURIComponent(since)}`);
    const asks = (asksRead ?? []).filter(r => goalOf(r.tags));
    let tagged: Json[] | undefined | null = null;
    const taggedRows = async () => (tagged === null ? (tagged = await rows(`/api/queue/list?updatedSince=${encodeURIComponent(since)}`)) : tagged) ?? [];

    const next = new Map<string, Goal>();
    for (const g of mine) {
      missed = !asksRead;
      const qitemId = str(g.qitemId)!, goalId = qitemId.slice('qitem-ledge-goal-'.length);
      const { text, folder } = readGoalBody(str(g.body) ?? '');
      const trail: Goal['trail'] = [];
      const steps = await rows(`/api/queue/${encodeURIComponent(qitemId)}/transitions`, null) ?? [];
      let prev: string | null = null;
      for (const t of steps) {
        const st = str(t.state), actor = str(t.actorSession) ?? '', note = str(t.transitionNote), ts = str(t.ts) ?? '';
        if (prev === null) trail.push({ at: ts, kind: 'sent', seat: PERSON, to: str(g.destinationSession) ?? undefined, qitemId });
        else if (st === 'in-progress' && prev === 'pending') trail.push({ at: ts, kind: 'taken', seat: actor, qitemId });
        else if (st === prev && note && !SYSTEM_NOTES.has(note) && actor === str(g.destinationSession)) trail.push({ at: ts, kind: 'note', seat: actor, text: note, qitemId });
        // A close that hands on (`handoff`, `handoff-and-complete`) is the next « handed » step, not an end.
        else if (st && TERMINAL.has(st) && st !== 'handed-off' && str(t.closureReason) !== 'handed_off_to') trail.push({ at: ts, kind: 'closed', seat: actor, ...(str(g.resolution) ? { text: str(g.resolution)! } : {}), qitemId });
        prev = st;
      }
      // The chain the goal went down: its successors by `handedOffFrom` (a row handed on with `handoff-and-complete` is `done` and still
      // has one), else the first seat row tagged with the goal.
      const successor = async (id: string) => (await rows(`/api/queue/list?handedOffFrom=${encodeURIComponent(id)}`, 5))?.[0];
      const chain: Json[] = [];
      let first = await successor(qitemId);
      const rootHandedOn = str(g.state) === 'handed-off' || !!str(g.handedOffTo) || str(g.closureReason) === 'handed_off_to';
      if (!first && TERMINAL.has(str(g.state) ?? '') && !rootHandedOn) {
        first = (await taggedRows()).filter(r => goalOf(r.tags) === qitemId && r.destinationSession !== PERSON && r.sourceSession !== PERSON)
          .sort((a, b) => (str(a.tsCreated) ?? '').localeCompare(str(b.tsCreated) ?? ''))[0];
      }
      // The goal row was handed on but its successor was not found: where the goal is now is not known.
      const rootLost = !first && rootHandedOn;
      if (rootLost) missed = partial = true;
      let cut = false;
      for (let row = first; row; ) {
        if (chain.length >= CHAIN_MAX) { cut = true; break; }
        chain.push(row);
        const id = str(row.qitemId)!;
        trail.push({ at: str(row.tsCreated) ?? '', kind: 'handed', seat: str(row.sourceSession) ?? '', to: str(row.destinationSession) ?? undefined, qitemId: id });
        if (str(row.claimedAt)) trail.push({ at: str(row.claimedAt)!, kind: 'taken', seat: str(row.destinationSession) ?? '', qitemId: id });
        const handedOn = str(row.state) === 'handed-off' || !!str(row.handedOffTo) || str(row.closureReason) === 'handed_off_to';
        const after = handedOn ? await successor(id) : undefined;
        if (!after) {
          if (TERMINAL.has(str(row.state) ?? '') && !handedOn) trail.push({ at: str(row.tsUpdated) ?? '', kind: 'closed', seat: str(row.destinationSession) ?? '', ...(str(row.resolution) ? { text: str(row.resolution)! } : {}), qitemId: id });
          // Handed on, but its successor not found (not read, or out of reach): the chain is not known to its end.
          if (handedOn) missed = partial = true;
          break;
        }
        row = after;
      }
      if (cut) partial = true;
      trail.sort((a, b) => a.at.localeCompare(b.at));
      // Max's asks about this goal: the latest proposal (a « team » question), and a question of his still open.
      const about = asks.filter(r => goalOf(r.tags) === qitemId).sort((a, b) => (str(b.tsCreated) ?? '').localeCompare(str(a.tsCreated) ?? ''));
      const isProposal = (r: Json) => rowsOf(r.humanQuestions).some(q => q.id === 'team');
      const p = about.find(isProposal);
      const q = about.find(r => !isProposal(r) && str(r.state) === 'pending');
      const proposal = p ? {
        askId: str(p.qitemId)!, team: parseTeam(str(p.body) ?? ''), text: withoutTeam(str(p.body) ?? ''),
        answer: answerOf(p.humanAnswers, 'team'), answeredAt: str(p.state) === 'done' ? str(p.tsUpdated) : null
      } : null;
      const last = chain.at(-1);
      const current = last ? { qitemId: str(last.qitemId)!, seat: str(last.destinationSession) ?? '', state: str(last.state) ?? '' }
        : TERMINAL.has(str(g.state) ?? '') ? null : { qitemId, seat: str(g.destinationSession) ?? '', state: str(g.state) ?? '' };
      const lastOpen = last && (cut || missed || !TERMINAL.has(str(last.state) ?? ''));
      const state: Goal['state'] = q ? 'asking'
        : p && str(p.state) === 'pending' ? 'proposed'
        : rootLost ? 'running'
        : last ? (lastOpen ? 'running' : str(last.state) === 'done' ? 'done' : 'closed')
        : str(g.state) === 'pending' ? 'sent'
        : TERMINAL.has(str(g.state) ?? '') ? 'closed' : 'taken';
      const read: Goal = {
        goalId, qitemId, text, folder, sentAt: str(g.tsCreated) ?? '', to: str(g.destinationSession) ?? '', state, proposal,
        question: q ? { askId: str(q.qitemId)!, text: str(q.summary) || firstLine(str(q.body) ?? '') } : null, trail, current
      };
      // A goal some of whose reads failed keeps what was read of it before, whole, rather than a state made of what was missing.
      next.set(goalId, missed && known.has(goalId) ? known.get(goalId)! : read);
    }
    known = next;
    return { goals: [...next.values()], ...(partial ? { partial } : {}) };
  };

  return { send, reply, list };
}

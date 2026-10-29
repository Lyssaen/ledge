import { LEDGE_GIVER, pendingKey, PENDING_BODY_MAX, SNAPSHOT_BODY_MAX, taskClosed, THREAD_BUDGET, THREAD_ITEMS_MAX, THREAD_TEXT_MAX, TOOL_TEXT_MAX, TOPIC_MAX, ToolSchema } from '@ledge/protocol';
import { PhoneRoleSchema, PhoneTemplateSchema } from '@ledge/protocol';
import { CHECKLIST_TASKS_MAX, CHECKLIST_TEXT_MAX, doneCount } from '@ledge/protocol';
import type { PhoneChecklist, PhoneChecklistSummary, Todo } from '@ledge/protocol';
import type { CapabilitiesByTool, FileChange, Pending, PhoneCatalog, PhonePending, PhoneProblem, PhoneRole, PhoneSession, PhoneTask, PhoneTeam, PhoneTemplate, ServerMessage, Session, Task, Team, ThreadItem, Tool } from '@ledge/protocol';
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

export function toPhoneSession(s: Session, readAt: string, checklist?: PhoneChecklistSummary): PhoneSession {
  const pending = toPhoneRequest(s, SNAPSHOT_BODY_MAX);
  return {
    id: s.id, name: s.name, tool: s.tool, project: s.project, title: s.title, state: s.state,
    startedAt: s.startedAt, lastActivityAt: s.lastActivityAt,
    // Topics are already cut to TOPIC_MAX where they are set; clipped again so no source can swell a snapshot.
    ...(s.topic !== undefined ? { topic: clip(s.topic, TOPIC_MAX).text } : {}),
    ...pickSet(s, ['repo', 'branch', 'worktree', 'role', 'roleLabel', 'team', 'context', 'relieves']),
    // Its relief's state only (context handover spec §3.2): the phone shows it, the PC starts it.
    ...(s.handover ? { handover: { state: s.handover.state, ...(s.handover.toName ? { toName: s.handover.toName.slice(0, 80) } : {}) } } : {}),
    helpers: s.helpers.map(h => ({ id: h.id, kind: h.kind, task: h.task, state: h.state, ...pickSet(h, ['finishedAt']) })),
    // A preview only: the whole reply is in the thread.
    ...(s.lastReply ? { lastReply: { text: clip(s.lastReply.text, TOOL_TEXT_MAX).text, at: s.lastReply.at, ...pickSet(s.lastReply, ['plan']) } } : {}),
    ...(pending ? { pending } : {}),
    ...(checklist ? { checklist } : {}),
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
        ...pickSet(item, ['durationMs']),
        files: item.files.map((f): FileChange => ({ path: f.path, ...pickSet(f, ['from']), change: f.change }))
      };
      break;
    }
    case 'permission':
      out = { kind: 'permission', ...base, tool: item.tool, text: text(item.text), ...pickSet(item, ['decision']) };
      break;
    case 'helper':
      out = { kind: 'helper', ...base, task: text(item.task), state: item.state, ...pickSet(item, ['agentType']) };
      break;
    case 'sent': {
      const summary = optText(item.summary);
      out = {
        kind: 'sent', ...base, to: item.to, text: text(item.text), status: item.status,
        ...(summary.v !== undefined ? { summary: summary.v } : {}),
        ...pickSet(item, ['peer', 'received', 'via'])
      };
      break;
    }
    case 'received':
      out = { kind: 'received', ...base, from: item.from, text: text(item.text), ...pickSet(item, ['peer', 'sent']) };
      break;
    case 'notice': {
      const summary = optText(item.summary), reason = optText(item.reason);
      out = {
        kind: 'notice', ...base, notice: item.notice, text: text(item.text),
        ...pickSet(item, ['name', 'peer', 'time', 'status', 'count', 'task', 'team', 'taskOp', 'outgoing']),
        ...(item.recipients ? { recipients: [...item.recipients] } : {}),
        ...(summary.v !== undefined ? { summary: summary.v } : {}),
        ...(reason.v !== undefined ? { reason: reason.v } : {})
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

/** A live team as the phone sees it: its project's name, its seats, the progress of the tasks Ledge gave it (ledge home spec §2.4). */
export function toPhoneTeam(t: Team, tasks: readonly Task[], projectName: (id: string | null) => string | null): PhoneTeam | null {
  if (t.state === 'dissolved') return null;
  const mine = tasks.filter(x => x.team === t.id && x.giver === LEDGE_GIVER);
  return { id: t.id, name: t.name.slice(0, 60), project: projectName(t.project)?.slice(0, 80) ?? null, state: t.state,
    ...(t.template ? { template: t.template.slice(0, 64) } : {}), createdAt: t.createdAt,
    seats: t.seats.slice(0, 16).map(x => ({ role: x.role, sessionId: x.sessionId, ...pickSet(x, ['tool', 'model', 'effort', 'leaving']) })), done: mine.filter(x => x.state === 'done').length, given: mine.length };
}

export type DefinitionsListing = Extract<ServerMessage, { type: 'definitions.listing' }>;

/** The most a catalog may weigh on the wire (bytes of its JSON): the phone's frame is 1 MiB, the rest of the budget is the sealing and the padding. Past it, prompts are sent cut. */
export const CATALOG_BUDGET = 262_144;
/** A cut prompt keeps its first characters: enough to tell the roles apart; the editor asks `teams.role` for the whole. */
const CUT_PROMPT = 200;

/**
 * Why a file is not a role or a team, as the phone reads it: a fixed phrase. The daemon's reasons carry file names, a line of the
 * file or an error message of the system (which holds a path), so none of them is passed on: each known kind has its phrase, and
 * anything else is « fichier illisible ». The phone never sees a path.
 */
const PROBLEM_KINDS: [RegExp, string][] = [
  [/^file over /, 'fichier trop volumineux'],
  [/^prompt over /, 'consigne trop longue'],
  [/^unknown key /, 'clé inconnue dans l\'en-tête'],
  [/^(front matter line without a key|line without a key|not a key: value pair|indented line outside a list|line outside a seat|tabs are not allowed)/, 'syntaxe illisible'],
  [/^name: /, 'nom d\'équipe invalide'],
  [/^seats(\.|: )/, 'sièges invalides'],
  [/^(id|label|prompt|tool|model|effort|autonomy|source|path|hash|role)(\.[\w.]+)?: /, 'champ de rôle invalide']
];
const UNREADABLE = 'fichier illisible';
export const problemReason = (reason: string): string => PROBLEM_KINDS.find(([re]) => re.test(reason))?.[1] ?? UNREADABLE;
const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? '';

/** The scopes of a listing the phone can address, each with its project's name, and the role ids each side holds (what shadows what). */
function phoneScopes(l: DefinitionsListing, projectName: (id: string | null) => string | null) {
  // A scope of a project the phone has no name for cannot be addressed: skipped, and it shadows nothing.
  const scopes = l.scopes.flatMap(sc => {
    const name = sc.scope === 'repo' ? projectName(sc.project) : null;
    return sc.scope === 'repo' && name === null ? [] : [{ sc, project: name?.slice(0, 80) ?? null }];
  });
  const repoIds = new Map<string, string[]>(); // role id → the projects holding it
  const homeIds = new Set<string>();
  for (const { sc, project } of scopes) for (const r of sc.roles) {
    if (sc.scope !== 'repo') { homeIds.add(r.id); continue; }
    const names = repoIds.get(r.id) ?? [];
    if (project && !names.includes(project)) names.push(project);
    repoIds.set(r.id, names);
  }
  return { scopes, repoIds, homeIds };
}

const roleCandidate = (r: DefinitionsListing['scopes'][number]['roles'][number], sc: DefinitionsListing['scopes'][number], project: string | null, homeIds: ReadonlySet<string>, repoIds: ReadonlyMap<string, readonly string[]>) => ({
  id: r.id, label: r.label, prompt: r.prompt, ...pickSet(r, ['tool', 'model', 'effort', 'autonomy']), scope: sc.scope, project, hash: r.hash ?? '',
  ...(sc.scope === 'repo' && homeIds.has(r.id) ? { shadows: true as const } : {}), ...(sc.scope === 'home' && repoIds.has(r.id) ? { shadowed: true as const, shadowedIn: repoIds.get(r.id)!.slice(0, 8) } : {})
});

/**
 * The role and team definitions as the phone sees them: no path (a problem keeps the basename of its file), a repository item
 * under its project's name, a role flagged when a repository role and a home role share its id. The prompts are sent whole while
 * the catalog fits `CATALOG_BUDGET`; from the first that does not fit, each one is cut to its first 200 characters (`cut: true`).
 * What the phone schema would refuse (an id or a seat count it does not know) is left out and told as a problem.
 */
export function toPhoneCatalog(l: DefinitionsListing, projectName: (id: string | null) => string | null): PhoneCatalog {
  const { scopes, repoIds, homeIds } = phoneScopes(l, projectName);
  const problems: PhoneProblem[] = [];
  const problem = (file: string, scope: 'home' | 'repo', project: string | null, reason: string) => {
    problems.push({ file: clip(baseName(file) || file, 80).text, scope, project, reason });
  };
  const roles: PhoneRole[] = [];
  const templates: PhoneTemplate[] = [];
  for (const { sc, project } of scopes) {
    for (const p of sc.problems) problem(p.path, sc.scope, project, problemReason(p.reason));
    for (const r of sc.roles) {
      const ok = PhoneRoleSchema.safeParse(roleCandidate(r, sc, project, homeIds, repoIds));
      if (ok.success) roles.push(ok.data); else problem(r.path, sc.scope, project, 'rôle illisible sur le téléphone');
    }
    for (const t of sc.templates) {
      const ok = PhoneTemplateSchema.safeParse({ id: t.id, name: t.name, seats: t.seats.map(x => ({ role: x.role, ...pickSet(x, ['tool', 'model', 'effort', 'name']) })), scope: sc.scope, project, hash: t.hash ?? '' });
      if (ok.success) templates.push(ok.data); else problem(t.path, sc.scope, project, 'équipe illisible sur le téléphone');
    }
  }
  const tpls = templates.slice(0, 100);
  const frame = (rs: PhoneRole[]): PhoneCatalog => ({ projects: scopes.flatMap(x => (x.project === null ? [] : [x.project])).slice(0, 50), roles: rs.slice(0, 200), templates: tpls, problems: problems.slice(0, 50) });
  const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
  const cutRole = (r: PhoneRole): PhoneRole => (r.prompt.length > CUT_PROMPT ? { ...r, prompt: clip(r.prompt, CUT_PROMPT).text, cut: true } : r);
  // Everything cut first, then the prompts made whole in order while they fit: the first that does not fit ends it.
  const out = roles.slice(0, 200).map(cutRole);
  let used = size(frame(out));
  for (let i = 0; i < out.length; i++) {
    if (out[i] === roles[i]) continue;
    const grown = used - size(out[i]) + size(roles[i]);
    if (grown > CATALOG_BUDGET) break;
    used = grown;
    out[i] = roles[i]!;
  }
  // Last resort, so the budget always holds: the prompts still cut go, last role first, then the last templates.
  for (let i = out.length - 1; i >= 0 && size(frame(out)) > CATALOG_BUDGET; i--) out[i] = { ...out[i]!, prompt: '', cut: true };
  while (tpls.length > 0 && size(frame(out)) > CATALOG_BUDGET) tpls.pop();
  return frame(out);
}

/**
 * One role whole, as the catalog shows it but never cut: found in the listing itself, so a role the catalog dropped for its budget
 * (the 200-entry cap, the bytes) can still be read by its address. Undefined when there is none, or the phone could not hold it.
 */
export function toPhoneRole(l: DefinitionsListing, projectName: (id: string | null) => string | null, scope: 'home' | 'repo', projectId: string | null, id: string): PhoneRole | undefined {
  const { scopes, repoIds, homeIds } = phoneScopes(l, projectName);
  const at = scopes.find(x => x.sc.scope === scope && x.sc.project === projectId);
  const r = at?.sc.roles.find(x => x.id === id);
  if (!at || !r) return undefined;
  const ok = PhoneRoleSchema.safeParse(roleCandidate(r, at.sc, at.project, homeIds, repoIds));
  return ok.success ? ok.data : undefined;
}

/** A task Ledge gave, as the phone sees it: the start of its result only. */
export function toPhoneTask(x: Task, owner: Session | undefined, teamName: string | undefined): PhoneTask {
  const result = x.result !== undefined ? clip(x.result, TOOL_TEXT_MAX) : undefined;
  return { id: x.id, title: x.title.slice(0, 200), owner: x.owner, ownerName: x.ownerName.slice(0, 80), ...(owner?.role ? { ownerRole: owner.role } : {}),
    ...(x.team ? { team: x.team } : {}), ...(teamName ? { teamName: teamName.slice(0, 60) } : {}), state: x.state,
    ...(result ? { result: result.text, ...(result.cut ? { cut: true as const } : {}) } : {}), at: x.at, updatedAt: x.updatedAt, ...(x.seen ? { seen: true as const } : {}) };
}

/** The tasks Ledge gave that the phone lists: open ones, and those closed in the last day not put away. */
export const phoneTasks = (tasks: readonly Task[], now: number): Task[] =>
  tasks.filter(x => x.giver === LEDGE_GIVER && (!taskClosed(x) || (!x.seen && now - Date.parse(x.updatedAt) < 86_400_000))).slice(-200);

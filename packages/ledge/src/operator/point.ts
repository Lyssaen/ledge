import { openDecision, pendingKey, taskClosed, type ChatPoint, type HumanAsk, type PointGroup, type PointItem, type Session, type Task } from '@ledge/protocol';
import { POINT_ITEMS_MAX } from './constants.js';
import type { JournalEvent } from './journal.js';

/** What the daemon knows now: it drops the items already settled and fills the answers. */
export interface LiveState { sessions: readonly Session[]; asks: readonly HumanAsk[]; tasks: readonly Task[]; lang: 'fr' | 'en' }

type Lang = 'fr' | 'en';

/** The daemon has no UI catalogue: the few words it writes itself live here, in the mockup's words. */
const L = {
  fr: {
    deny: 'Refuser', accept: 'Autoriser', add: 'Ajouter', refuse: 'Refuser',
    finished: 'a terminé', error: 'est en erreur', exited: "s'est arrêté", contextFull: 'a presque rempli son contexte',
    taskDone: 'tâche terminée', taskRefused: 'tâche refusée', taskDropped: 'tâche abandonnée', stale: 'sans nouvelles depuis {n} min',
    taskOpen: 'tâche en cours', merged: 'fusionnée', pipelineFailed: 'pipeline en échec', brain: 'propose une note', decision: 'te demande une décision',
    unreachable: 'injoignable', rigState: 'passée de {from} à {to}', goalUpdate: 'objectif mis à jour',
    leadThings: (n: number) => `${n} ${n === 1 ? 'chose' : 'choses'}`, leadSince: 'depuis', leadWaiting: (n: number) => `${n} ${n === 1 ? "t'attend" : "t'attendent"}`
  },
  en: {
    deny: 'Deny', accept: 'Allow', add: 'Add', refuse: 'Refuse',
    finished: 'finished', error: 'hit an error', exited: 'exited', contextFull: 'nearly filled its context',
    taskDone: 'task done', taskRefused: 'task refused', taskDropped: 'task dropped', stale: 'no news for {n} min',
    taskOpen: 'task in progress', merged: 'merged', pipelineFailed: 'pipeline failed', brain: 'proposes a note', decision: 'asks for a decision',
    unreachable: 'unreachable', rigState: 'went from {from} to {to}', goalUpdate: 'goal updated',
    leadThings: (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`, leadSince: 'since', leadWaiting: (n: number) => `${n} waiting for you`
  }
} as const;

type Answers = NonNullable<PointItem['answers']>;
const ANSWERS_MAX = 4;
const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const firstLine = (s: string): string => s.trim().split('\n')[0] ?? '';
const fill = (s: string, vars: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

const GROUP_OF: Partial<Record<JournalEvent['kind'], PointGroup>> = {
  'session.request': 'atoi', 'session.question': 'atoi', 'decision.asked': 'atoi', 'brain.proposed': 'atoi', 'rig.ask': 'atoi',
  'session.finished': 'done', 'session.error': 'done', 'session.exited': 'done', 'session.context_full': 'done', 'task.closed': 'done',
  'forge.merged': 'done', 'forge.pipeline_failed': 'done',
  'task.stale': 'ongoing',
  'rig.seat_unreachable': 'rigs', 'rig.state': 'rigs', 'rig.goal_update': 'rigs'
};

/** An event that waits on the user (« À toi »): while open, it is in every point, whatever the cursor. */
export const isWaiting = (e: Pick<JournalEvent, 'kind'>): boolean => GROUP_OF[e.kind] === 'atoi';

/** Options a session put in a decision's text (`oui / non ; je recommande oui`): what comes before the first `;`, split on ` / `. */
function decisionOptions(text: string | undefined): string[] {
  const head = (text ?? '').split(/[;\n]/)[0] ?? '';
  const parts = head.split(' / ').map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, ANSWERS_MAX).map(s => clip(s, 60)) : [];
}

const optionAnswers = (labels: readonly { id: string; label: string }[]): Answers =>
  labels.slice(0, ANSWERS_MAX).map(o => ({ id: o.id, label: clip(o.label, 60), style: 'plain' as const }));

interface Built { item: PointItem; actionable: boolean; settledNow: boolean }

function build(e: JournalEvent, live: LiveState, t: (typeof L)[Lang]): Built | undefined {
  const group = GROUP_OF[e.kind];
  if (!group) return undefined;
  const p = e.payload;
  const id = `${e.subjectKind}:${e.subjectId}`;
  const item: PointItem = { id, event: e.id, group, tone: 'idle', who: clip(e.subjectName, 100), text: '', at: e.at };
  let gone = false;
  switch (e.kind) {
    case 'session.request':
    case 'session.question': {
      const session = str(p.session); const key = str(p.key);
      const liveSession = live.sessions.find(s => s.id === session);
      gone = !liveSession?.pending || pendingKey(liveSession.pending) !== key;
      item.ref = { kind: 'session.request', session, key };
      item.nav = [{ kind: 'session', id: session }];
      if (p.kind === 'question') {
        const options = Array.isArray(p.options) ? (p.options as unknown[]).map(str) : liveSession?.pending?.options ?? [];
        item.tone = 'ask'; item.text = clip(str(p.text), 400); item.freeText = true;
        if (!gone && options.length) item.answers = optionAnswers(options.map((label, i) => ({ id: String(i), label })));
      } else {
        item.tone = 'perm'; item.text = clip(str(p.command) || str(p.text), 400);
        if (!gone) item.answers = [{ id: 'deny', label: t.deny, style: 'plain' }, { id: 'accept', label: t.accept, style: 'primary' }];
      }
      break;
    }
    case 'rig.ask': {
      const ask = live.asks.find(a => a.id === e.subjectId);
      gone = !ask;
      item.tone = 'ask'; item.text = clip(str(p.summary), 400); item.ref = { kind: 'rig.ask', qitem: e.subjectId };
      if (str(p.rig)) { item.rig = clip(str(p.rig), 100); item.nav = [{ kind: 'rig', id: str(p.rig) }]; }
      if (ask) {
        item.freeText = true;
        const options = ask.questions.find(q => !q.answer)?.options ?? [];
        if (options.length) item.answers = optionAnswers(options);
      }
      break;
    }
    case 'decision.asked': {
      const task = live.tasks.find(x => x.id === e.subjectId);
      gone = !task || !openDecision(task);
      item.tone = 'ask'; item.text = clip(e.subjectName, 400); item.sub = clip(`${str(p.giver) || e.subjectName} ${t.decision}`, 200);
      item.ref = { kind: 'task', task: e.subjectId }; item.nav = [{ kind: 'task', id: e.subjectId }];
      if (task && !gone) {
        item.freeText = true;
        const options = decisionOptions(task.text);
        if (options.length) item.answers = optionAnswers(options.map(label => ({ id: label, label })));
      }
      break;
    }
    case 'brain.proposed': {
      const task = live.tasks.find(x => x.id === e.subjectId);
      gone = !task || taskClosed(task);
      const brain = p.brain as { fact?: string } | undefined;
      item.tone = 'ask'; item.text = clip(brain?.fact ?? e.subjectName, 400); item.sub = clip(`${str(p.giver)} ${t.brain}`.trim(), 200);
      item.ref = { kind: 'task', task: e.subjectId }; item.nav = [{ kind: 'task', id: e.subjectId }];
      if (!gone) item.answers = [{ id: 'accept', label: t.add, style: 'primary' }, { id: 'deny', label: t.refuse, style: 'plain' }];
      break;
    }
    case 'session.finished':
      item.text = t.finished; item.nav = [{ kind: 'session', id: e.subjectId }];
      if (str(p.text)) item.sub = clip(firstLine(str(p.text)), 200);
      break;
    case 'session.error': item.tone = 'perm'; item.text = t.error; item.nav = [{ kind: 'session', id: e.subjectId }]; break;
    case 'session.exited': item.tone = 'off'; item.text = t.exited; item.nav = [{ kind: 'session', id: e.subjectId }]; break;
    case 'session.context_full': item.tone = 'off'; item.text = t.contextFull; item.nav = [{ kind: 'session', id: e.subjectId }]; break;
    case 'task.closed': {
      const state = str(p.state);
      item.text = clip(e.subjectName, 400); item.nav = [{ kind: 'task', id: e.subjectId }];
      item.sub = clip(state === 'refused' ? t.taskRefused : state === 'dropped' ? t.taskDropped : t.taskDone, 200);
      break;
    }
    case 'forge.merged':
    case 'forge.pipeline_failed':
      item.tone = e.kind === 'forge.merged' ? 'idle' : 'perm'; item.text = clip(e.subjectName, 400);
      item.sub = clip(`${str(p.ref)} ${e.kind === 'forge.merged' ? t.merged : t.pipelineFailed}`.trim(), 200);
      item.nav = [{ kind: 'pr', id: e.subjectId }];
      break;
    case 'task.stale':
      item.tone = 'work'; item.text = clip(e.subjectName, 400); item.nav = [{ kind: 'task', id: e.subjectId }];
      item.sub = fill(t.stale, { n: Math.round(Number(p.idleMs ?? 0) / 60_000) }); item.who = clip(str(p.owner) || e.subjectName, 100);
      break;
    case 'rig.seat_unreachable':
      item.tone = 'perm'; item.text = t.unreachable; item.rig = clip(str(p.rig), 100); item.nav = [{ kind: 'rig', id: str(p.rig) }];
      break;
    case 'rig.state':
      item.tone = 'perm'; item.text = fill(t.rigState, { from: str(p.from), to: str(p.to) }); item.rig = clip(e.subjectName, 100);
      item.nav = [{ kind: 'rig', id: e.subjectId }];
      break;
    case 'rig.goal_update':
      item.tone = 'ask'; item.text = t.goalUpdate; item.rig = str(p.rig) ? clip(str(p.rig), 100) : undefined;
      if (item.rig) item.nav = [{ kind: 'rig', id: item.rig }];
      break;
    default: return undefined;
  }
  if (item.rig === undefined) delete item.rig;
  const actionable = group === 'atoi';
  return { item, actionable, settledNow: actionable && (gone || e.settledAt !== null) };
}

/** An open task the live state holds, as an `ongoing` row. */
function ongoingTask(task: Task, event: number, t: (typeof L)[Lang]): PointItem {
  return {
    id: `task:${task.id}`, event, group: 'ongoing', tone: 'work', who: clip(task.ownerName, 100), text: clip(task.title, 400), sub: t.taskOpen,
    at: task.updatedAt, nav: [{ kind: 'task', id: task.id }]
  };
}

const BY_AGE = (a: PointItem, b: PointItem): number => Date.parse(a.at) - Date.parse(b.at) || a.event - b.event;
const GROUP_ORDER: PointGroup[] = ['atoi', 'done', 'ongoing', 'rigs'];
/** Which group gives way first when the point is too long. */
const DROP_ORDER: PointGroup[] = ['done', 'ongoing', 'rigs', 'atoi'];

/**
 * The point: the journal's events collapsed to one item per subject (the latest), grouped as board 1, with the answers the
 * live state allows. A request whose target is already gone is created settled `elsewhere`.
 */
export function buildPoint(events: readonly JournalEvent[], live: LiveState, since: string, lead: { text: string; by: 'agent' | 'daemon' }): ChatPoint {
  const t = L[live.lang];
  const latest = new Map<string, JournalEvent>();
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    if (e.kind === 'request.settled' || !GROUP_OF[e.kind]) continue;
    latest.set(`${e.subjectKind}:${e.subjectId}`, e);
  }
  const urgent = new Map<string, boolean>();
  const items: PointItem[] = [];
  for (const e of latest.values()) {
    const b = build(e, live, t);
    if (!b) continue;
    if (b.settledNow) {
      const where = ['terminal', 'phone', 'desktop', 'chat', 'elsewhere'].includes(str(e.payload.where)) ? (str(e.payload.where) as 'elsewhere') : 'elsewhere';
      b.item.settled = { at: e.settledAt ?? since, where };
    }
    if (b.actionable) urgent.set(b.item.id, e.urgency === 'immediate');
    items.push(b.item);
  }
  for (const task of live.tasks) {
    if (taskClosed(task) || openDecision(task) || task.brain || items.some(i => i.id === `task:${task.id}`)) continue;
    items.push(ongoingTask(task, 0, t));
  }
  const rank = (i: PointItem): number => GROUP_ORDER.indexOf(i.group);
  items.sort((a, b) => rank(a) - rank(b) || (a.group === 'atoi' ? Number(urgent.get(b.id)) - Number(urgent.get(a.id)) : 0) || BY_AGE(a, b));
  return { since, lead: clip(lead.text, 300), leadBy: lead.by, items: cap(items) };
}

/** At most `POINT_ITEMS_MAX` items: the oldest `done` ones go first, then the other groups. */
function cap(items: PointItem[]): PointItem[] {
  let kept = items;
  for (const g of DROP_ORDER) {
    const over = kept.length - POINT_ITEMS_MAX;
    if (over <= 0) break;
    const drop = new Set(kept.filter(i => i.group === g).sort(BY_AGE).slice(0, over).map(i => i.id));
    kept = kept.filter(i => !drop.has(i.id));
  }
  return kept;
}

const clock = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The lead the daemon writes when no agent did: « 6 choses depuis 13:50 · 2 t'attendent ». */
export function daemonLead(point: Pick<ChatPoint, 'items' | 'since'>, lang: Lang): string {
  const t = L[lang];
  const waiting = point.items.filter(i => i.group === 'atoi' && !i.settled).length;
  const head = `${t.leadThings(point.items.length)} ${t.leadSince} ${clock(point.since)}`;
  return waiting > 0 ? `${head} · ${t.leadWaiting(waiting)}` : head;
}

/** Marks the open item of a subject settled; null when no open item matches (an item already settled keeps its first answer). */
export function settleItem(point: ChatPoint, ref: { subjectKind: string; subjectId: string }, settled: NonNullable<PointItem['settled']>): ChatPoint | null {
  const id = `${ref.subjectKind}:${ref.subjectId}`;
  if (!point.items.some(i => i.id === id && !i.settled)) return null;
  return { ...point, items: point.items.map(i => (i.id === id && !i.settled ? { ...i, settled } : i)) };
}

/** Folds the point once it holds « à toi » items and every one is settled. */
export function foldIfDone(point: ChatPoint, at: string): ChatPoint {
  const atoi = point.items.filter(i => i.group === 'atoi');
  if (point.foldedAt || atoi.length === 0 || atoi.some(i => !i.settled)) return point;
  return { ...point, foldedAt: at };
}

import type { ChatAction, ChatPoint, DecidedBy, ForgeStateMessage, Goal, HumanAsk, OpenRigAction, OpenRigState, OperatorNotice, PointItem, Task, Tool } from '@ledge/protocol';
import type { Chat, ChatDeps, ChatMessage } from '../chat/service.js';
import type { Store } from '../daemon/store.js';
import { log } from '../log.js';
import { fromAsks, fromForge, fromGoals, fromRigs, fromSession, fromTasks, settledSession, type Draft } from './detect.js';
import { openJournal, type DeviceId, type Journal, type JournalEvent } from './journal.js';
import { runLead as defaultRunLead } from './lead.js';
import { buildPoint, daemonLead, foldIfDone, isWaiting, settleItem, type LiveState } from './point.js';
import { createWakes } from './wakes.js';

export type SettledWhere = NonNullable<PointItem['settled']>['where'];

export interface OperatorThreads {
  all(): Array<[DeviceId, Chat]>;
  /** Opens a paired device's thread (it may never have been opened since the daemon started). */
  device?(id: string): Chat;
  emitterOf(id: DeviceId): ((m: ChatMessage) => void) | undefined;
}

export interface OperatorDeps {
  journal: Journal; machine: string; threads: OperatorThreads;
  live: () => LiveState;
  /** The user's chat harness: a wake runs it as a question with no explicit tool would. */
  tool: () => Tool | Promise<Tool>;
  chatDeps: ChatDeps;
  onNotices: (n: OperatorNotice[]) => void;
  onPointPush: (lead: string, qidByDevice: Map<DeviceId, string>) => void;
  /** The ids of the paired devices with the chat: each gets its point, its thread opened if need be. */
  devices?: () => readonly string[];
  now?: () => string;
  /** The lead run; tests give a fake. */
  runLead?: typeof defaultRunLead;
}

export interface Operator {
  record(d: Draft): void;
  settle(subjectKind: string, subjectId: string, where: SettledWhere, answer?: string): void;
  read(device: DeviceId, eventId: number): void;
  later(device: DeviceId, qid: string): void;
  notices(): OperatorNotice[];
  start(): void; stop(): void;
}

const ANSWER_MAX = 60;
const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** The events of a list once each, oldest first. */
function union(...lists: JournalEvent[][]): JournalEvent[] {
  const byId = new Map<number, JournalEvent>();
  for (const l of lists) for (const e of l) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * The operator (spec §2): records what the detectors find, wakes on it, and posts one point per chat thread. A wake makes one lead run
 * over everything it covers, then builds each thread's point from that thread's own cursor with the shared lead sentence.
 */
export function createOperator(deps: OperatorDeps): Operator {
  const { journal, threads } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const runLead = deps.runLead ?? defaultRunLead;
  const emitOf = (id: DeviceId) => threads.emitterOf(id) ?? (() => {});
  /** Task 9 computes the notch's and the phone's notices from the points and the rig asks; none until then. */
  const notices = (): OperatorNotice[] => [];
  const tellNotices = () => { try { deps.onNotices(notices()); } catch (e) { log(`operator notices: ${(e as Error).message}`); } };

  /** What still waits on the user, up to the last event a wake covers. */
  const waiting = (last: number): JournalEvent[] => journal.open().filter(e => isWaiting(e) && e.id <= last);
  /** The events a thread's point is built from: those after its cursor, and those still waiting, up to the last the wake covers. */
  const eventsOf = (device: DeviceId, last: number): JournalEvent[] =>
    union(journal.since(journal.cursor(device)).filter(e => e.id <= last), waiting(last));

  /** Every thread a point goes to: the desktop's and every paired device's, opened if need be. */
  function postTargets(): Array<[DeviceId, Chat]> {
    for (const id of deps.devices?.() ?? []) {
      try { threads.device?.(id); } catch (e) { log(`operator: thread of device ${id.slice(0, 8)} not opened: ${(e as Error).message}`); }
    }
    return threads.all();
  }

  async function run(events: JournalEvent[]): Promise<void> {
    const first = events[0]!.id; const last = events.at(-1)!.id;
    const wake = journal.startWake(first, last, now());
    const qids: string[] = []; const qidByDevice = new Map<DeviceId, string>();
    let outcome: 'posted' | 'empty' | 'failed' = 'empty';
    try {
      // A wake whose events were all settled before it ran says nothing (spec §2): no run, no point.
      if (union(events, waiting(last)).every(e => e.settledAt !== null || e.kind === 'request.settled')) return;
      const live = deps.live();
      const since = events[0]!.at;
      const all = buildPoint(union(events, waiting(last)), live, since, { text: '', by: 'daemon' });
      // Nothing to say gives no run at all: the harness is not started for an empty point.
      const lead = all.items.length > 0
        ? await runLead({ deps: deps.chatDeps, tool: await deps.tool(), events, point: all })
        : { lead: null, suggestions: [], actions: [] as ChatAction[], error: 'nothing to report' };
      if (lead.error && all.items.length > 0) log(`operator lead failed, the daemon writes it: ${lead.error}`);
      const suggestion = new Map(lead.suggestions.map(s => [s.item, s.action]));
      for (const [device, chat] of postTargets()) {
        // Read after the lead run: what was settled meanwhile is posted settled.
        const own = eventsOf(device, last);
        const sinceOwn = own[0]?.at ?? since;
        const draft = buildPoint(own, deps.live(), sinceOwn, { text: '', by: 'daemon' });
        if (draft.items.length === 0) continue;
        const point: ChatPoint = {
          ...draft,
          lead: lead.lead ?? daemonLead(draft, live.lang), leadBy: lead.lead ? 'agent' : 'daemon',
          items: draft.items.map(i => { const a = suggestion.get(i.id); return a && !i.settled ? { ...i, suggestion: a } : i; })
        };
        const qid = chat.postPoint(point, lead.actions, emitOf(device));
        qids.push(qid); qidByDevice.set(device, qid);
      }
      outcome = qids.length > 0 ? 'posted' : lead.error && all.items.length > 0 ? 'failed' : 'empty';
      if (qids.length > 0) deps.onPointPush(lead.lead ?? daemonLead(all, live.lang), qidByDevice);
    } catch (e) {
      outcome = 'failed';
      log(`operator wake failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      journal.endWake(wake.id, outcome, qids, now());
    }
    tellNotices();
  }

  const wakes = createWakes({
    journal, now: () => Date.parse(now()),
    setTimer: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return () => clearTimeout(t); },
    chatIdle: () => Promise.all(threads.all().map(([, c]) => c.idle())).then(() => {}),
    run
  });

  return {
    record(d) {
      const e = journal.record({ ...d, machine: deps.machine, at: now() });
      wakes.onEvent(e);
    },
    settle(subjectKind, subjectId, where, answer) {
      const at = now();
      const settled = { at, where, ...(answer ? { answer: clip(answer, ANSWER_MAX) } : {}) };
      journal.settle(subjectKind, subjectId, at, { where, ...(answer ? { answer: settled.answer } : {}) });
      for (const [device, chat] of threads.all()) {
        for (const { qid } of chat.points()) {
          chat.updatePoint(qid, p => { const s = settleItem(p, { subjectKind, subjectId }, settled); return s ? foldIfDone(s, at) : p; }, emitOf(device));
        }
      }
      tellNotices();
    },
    read(device, eventId) { journal.setCursor(device, eventId, now()); },
    later(device, qid) {
      const chat = threads.all().find(([id]) => id === device)?.[1];
      chat?.updatePoint(qid, p => ({ ...p, laterAt: now() }), emitOf(device));
      tellNotices();
    },
    notices,
    start() { wakes.start(); },
    stop() { wakes.stop(); }
  };
}

/** How long a rig's stop or restart started by Ledge itself (a card, the Rigs view, the phone) keeps its fall out of the journal. */
const OWN_ACT_MS = 2 * 60_000;
const DAY_MS = 86_400_000;
const STALE_EVERY_MS = 60_000;

export interface OperatorWiring {
  journalPath: string; machine: string; threads: OperatorThreads;
  store: Pick<Store, 'all' | 'get' | 'onApply' | 'onEvent'>;
  tasks: () => Task[];
  /** The user's context threshold, as the daemon holds it now. */
  contextNear: () => number;
  tool: OperatorDeps['tool']; chatDeps: ChatDeps;
  devices?: OperatorDeps['devices'];
  lang?: LiveState['lang'];
}

/**
 * The operator as the daemon runs it: the journal opened, the detectors fed from what the daemon already sees, each source's first read
 * taken as its baseline (what exists at start is never news), the journal pruned at start and daily.
 */
export function wireOperator(w: OperatorWiring) {
  const journal = openJournal(w.journalPath);
  let asks: readonly HumanAsk[] | undefined;
  let rigs: OpenRigState | undefined;
  let forge: ForgeStateMessage | undefined;
  let goals: readonly Goal[] | undefined;
  let tasksBefore: readonly Task[] = [];
  /** The tasks already said stale: said once, until the task leaves `taken`. */
  const reported = new Set<string>();
  /** Rig name (or `*` for OpenRig's daemon) → when Ledge itself last stopped or restarted it. */
  const ownActs = new Map<string, number>();
  /** Who answered each session's request, from its `Decided` (heard before the change it makes). */
  const answeredBy = new Map<string, DecidedBy | null>();
  const timers: NodeJS.Timeout[] = [];
  const unsubscribe: Array<() => void> = [];

  const operator = createOperator({
    journal, machine: w.machine, threads: w.threads, tool: w.tool, chatDeps: w.chatDeps, ...(w.devices ? { devices: w.devices } : {}),
    live: () => ({ sessions: w.store.all(), asks: asks ?? [], tasks: w.tasks(), lang: w.lang ?? 'fr' }),
    // Task 9 broadcasts the notices and pushes the point to the phones.
    onNotices: () => {}, onPointPush: () => {}
  });
  let stopped = false;
  /** The daemon's listeners call it: a journal that fails (or is closed at shutdown) never breaks them. */
  const record = (drafts: Draft[]) => {
    if (stopped) return;
    try { for (const d of drafts) operator.record(d); } catch (e) { log(`operator: event not recorded: ${(e as Error).message}`); }
  };
  const settle = (...a: Parameters<Operator['settle']>) => {
    if (stopped) return;
    try { operator.settle(...a); } catch (e) { log(`operator: not settled: ${(e as Error).message}`); }
  };
  const lastActivity = (id: string) => { const at = w.store.get(id)?.lastActivityAt; return at ? Date.parse(at) : undefined; };

  function tasksChanged(): void {
    const after = w.tasks();
    for (const id of reported) if (after.find(t => t.id === id)?.state !== 'taken') reported.delete(id);
    const drafts = fromTasks(tasksBefore, after, Date.now(), lastActivity, reported);
    for (const d of drafts) if (d.kind === 'task.stale') reported.add(d.subjectId);
    tasksBefore = after;
    record(drafts);
  }

  const ownAct = (rig: string) => {
    const at = Math.max(ownActs.get(rig) ?? 0, ownActs.get('*') ?? 0);
    return Date.now() - at < OWN_ACT_MS;
  };

  function prune(): void {
    try { const n = journal.prune(new Date().toISOString()); if (n > 0) log(`operator: ${n} old journal events pruned`); }
    catch (e) { log(`operator: journal not pruned: ${(e as Error).message}`); }
  }

  return {
    operator, journal,
    /** The rig asks as last read: the chat's attentes.md. */
    asks: () => asks,
    /** A thread's journal for the chat's journal.md: what came after its cursor, and what still waits. */
    journalFor(thread: DeviceId): JournalEvent[] {
      if (stopped) return [];
      try { return union(journal.since(journal.cursor(thread)), journal.open().filter(isWaiting)); }
      catch (e) { log(`operator: journal not read: ${(e as Error).message}`); return []; }
    },
    tasksChanged,
    /** OpenRig's human channel changed: new rows are events, rows gone are settled (unless the list is partial). */
    asksChanged(l: { channel?: { state: string }; asks: HumanAsk[]; partial?: boolean; truncated?: boolean }): void {
      // A channel that is not ready (OpenRig stopped, restarting) lists nothing: the asks are not gone, the baseline stays.
      if (l.channel && l.channel.state !== 'ready') return;
      const before = asks;
      // A partial list says nothing of the rows it misses: they are kept until a whole list leaves them out.
      asks = before && (l.partial || l.truncated) ? [...l.asks, ...before.filter(a => !l.asks.some(x => x.id === a.id))] : l.asks;
      if (!before) return;
      record(fromAsks(before, l.asks));
      for (const a of before) if (!asks.some(x => x.id === a.id)) settle('rig.ask', a.id, 'elsewhere');
    },
    /** An ask answered through Ledge (`desktop`: a PC front, `phone`: the gateway): settled there, unless questions still wait. */
    askAnswered(qitemId: string, where: SettledWhere, r: { ok: boolean; outcome?: string }): void {
      if (r.ok && r.outcome !== 'recorded') settle('rig.ask', qitemId, where);
    },
    /** Max's goals as read again: the first list is the baseline; a partial one says nothing. */
    goalsChanged(l: { goals: Goal[]; partial?: boolean }): void {
      if (l.partial) return;
      const before = goals; goals = l.goals;
      if (before) record(fromGoals(before, l.goals));
    },
    /** A read of OpenRig's state: a rig Ledge stopped or restarted itself in the last two minutes says nothing. */
    rigsRead(st: OpenRigState): void {
      const before = rigs; rigs = st;
      record(fromRigs(before, st).filter(d => !ownAct(d.kind === 'rig.state' ? d.subjectId : String(d.payload.rig))));
    },
    forgeChanged(st: ForgeStateMessage): void {
      const before = forge; forge = st;
      if (before) record(fromForge(before, st));
    },
    /** An OpenRig action Ledge applies (`openrig.act`, whoever asked): its stops and restarts are not news. */
    ledgeRigAct(a: OpenRigAction): void {
      if (a.kind === 'rig.stop' || a.kind === 'rig.restart') ownActs.set(a.rig, Date.now());
      else if (a.kind === 'daemon.stop' || a.kind === 'daemon.restart') ownActs.set('*', Date.now());
    },
    start(): void {
      stopped = false;
      // The first read of the tasks is the baseline; the tasks already stale then are not said stale at start.
      tasksBefore = w.tasks();
      for (const d of fromTasks([], tasksBefore, Date.now(), lastActivity, new Set())) if (d.kind === 'task.stale') reported.add(d.subjectId);
      unsubscribe.push(w.store.onEvent((id, ev) => { if (ev.name === 'Decided') answeredBy.set(id, ev.by ?? null); }));
      unsubscribe.push(w.store.onApply((before, after) => {
        record(fromSession(before, after, w.contextNear()));
        const settled = settledSession(before, after, answeredBy.get(after.id));
        if (before?.pending && !after.pending) answeredBy.delete(after.id);
        if (settled) settle('session.request', settled.subjectId, settled.where);
      }));
      prune();
      const daily = setInterval(prune, DAY_MS); daily.unref?.();
      const stale = setInterval(tasksChanged, STALE_EVERY_MS); stale.unref?.();
      timers.push(daily, stale);
      operator.start();
    },
    stop(): void {
      stopped = true;
      for (const u of unsubscribe.splice(0)) u();
      for (const t of timers.splice(0)) clearInterval(t);
      operator.stop();
      journal.close();
    }
  };
}

export type OperatorWired = ReturnType<typeof wireOperator>;

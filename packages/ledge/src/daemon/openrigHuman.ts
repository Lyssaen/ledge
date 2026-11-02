import { z } from 'zod';
import { HUMAN_ASK_BODY_MAX, HUMAN_ASKS_MAX, type HumanAnswer, type HumanAnswerError, type HumanAsk, type HumanChannel, type HumanQuestionAnswer, type OpenRigAnswered, type OpenRigState } from '@ledge/protocol';
import { log } from '../log.js';
import type { RigRun } from './openrig.js';

/**
 * « À toi » (docs/vision/ledge-human-channel-contract.md): what OpenRig asks or tells the person, read from its daemon's own API, and
 * their answers written back through it, the way OpenRig's TUI does. Read: `GET /api/attention` (the open asks to a person and the rows
 * parked on one, already classified) and `GET /api/queue/<id>` for each row's text; woken by `GET /api/events` (SSE, resumed with
 * Last-Event-ID), with a slow poll as a safety net. Answer: `POST /api/mission-control/action` with the primary user's authority and
 * no seat header, so OpenRig records the person as the actor, returns the answer to the asking seat and wakes it.
 */

/** The OpenRig daemon's answer to one HTTP call: `status` 0 when none came; `unsent` then when the request surely never left (the
 *  connection was refused), as opposed to a timeout or a dropped connection, after which it may have been acted on. */
export type RigHttp = (method: 'GET' | 'POST', url: string, body?: unknown) => Promise<{ status: number; json: unknown; unsent?: boolean }>;
/** Follows an SSE stream: `onEvent` for each event (its `id` and parsed `data`); resolves when the stream ends or fails. */
export type RigSse = (url: string, lastEventId: string | null, onEvent: (id: string | null, data: unknown) => void, signal: AbortSignal) => Promise<void>;

export interface HumanChannelDeps {
  /** OpenRig's state on this machine (installed, daemon, port). */ state: () => Promise<OpenRigState>;
  run: RigRun; http?: RigHttp; sse?: RigSse;
  /** Delay between an OpenRig event and the read it triggers (several events, one read). */ debounceMs?: number;
  /** The safety poll. */ pollMs?: number;
  /** How long the person's name and Slack readiness stand. */ personTtlMs?: number;
  now?: () => number;
}

export interface HumanList { channel: HumanChannel; asks: HumanAsk[]; truncated?: boolean; partial?: boolean }

export interface HumanChannelService {
  /** What waits on the person now (read again, at most once per call). */
  list(): Promise<HumanList>;
  answer(qitemId: string, answer: HumanAnswer): Promise<Omit<OpenRigAnswered, 'type' | 'requestId' | 'machineId'>>;
  /** Follow OpenRig's events and call `onChange` with the whole list each time it changes. */
  start(onChange: (list: HumanList) => void): void;
  stop(): void;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };

const HTTP_MS = 10_000;

export const fetchHttp: RigHttp = async (method, url, body) => {
  try {
    const res = await fetch(url, {
      method, signal: AbortSignal.timeout(HTTP_MS),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    });
    return { status: res.status, json: parse(await res.text()) };
  } catch (e) {
    const code = str(obj(obj(e).cause).code);
    return { status: 0, json: undefined, ...(code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? { unsent: true } : {}) };
  }
};

// What Ledge needs of OpenRig's answers, checked before use: an HTTP 200 whose body is not this is unreadable, never an empty answer.
// Fields beyond these are kept (OpenRig's JSON grows between versions).
const AttentionShape = z.object({
  perspective: z.object({ actingAs: z.object({ person: z.string().nullable() }).passthrough() }).passthrough().optional(),
  items: z.array(z.object({ id: z.string() }).passthrough()),
  sources: z.array(z.object({ source: z.string(), state: z.string() }).passthrough()).optional()
}).passthrough();
const RowShape = z.object({
  qitemId: z.string(), state: z.string(), body: z.string(), sourceSession: z.string(), destinationSession: z.string(),
  tsCreated: z.string(), tsUpdated: z.string()
}).passthrough();
const AnswerShape = z.object({
  verb: z.literal('answer'), qitemId: z.string(),
  answer: z.object({ outcome: z.enum(['recorded', 'answered']), unanswered: z.array(z.string()), message: z.string().optional() }).passthrough(),
  createdQitemId: z.string().nullable().optional()
}).passthrough();
/** `approve` and `resolve` answer with the action done on that row. */
const ActedShape = z.object({ verb: z.string(), qitemId: z.string() }).passthrough();

/** A minimal SSE reader: `id:` and `data:` lines, events separated by a blank line. */
export const fetchSse: RigSse = async (url, lastEventId, onEvent, signal) => {
  const res = await fetch(url, { signal, headers: { accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buf = '', id: string | null = null, data: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, ''); buf = buf.slice(nl + 1);
      if (line === '') { if (data.length) onEvent(id, parse(data.join('\n'))); id = null; data = []; continue; }
      if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
};

/** `pod-member@rig` → its rig and its role (`pod.member`), when the name has that form. */
export function seatParts(seat: string): { rig: string | null; role: string | null } {
  const m = /^([A-Za-z0-9][A-Za-z0-9_]*)-([A-Za-z0-9][A-Za-z0-9_-]*)@([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(seat);
  if (m) return { rig: m[3]!, role: `${m[1]}.${m[2]}` };
  const at = seat.lastIndexOf('@');
  return { rig: at > 0 ? seat.slice(at + 1) : null, role: null };
}

const PRIORITIES = new Set(['routine', 'urgent', 'critical']);
const RANK: Record<HumanAsk['priority'], number> = { critical: 0, urgent: 1, routine: 2 };

/** A recorded answer as OpenRig keeps it in `humanAnswers`: an option id, or the person's typed reply `{ kind: 'typed-reply', text }`.
 *  Own keys only, as OpenRig reads them: a question id like `constructor` never reads an inherited member. */
export function answerOf(answers: unknown, questionId: string): HumanQuestionAnswer | null {
  const a = obj(answers);
  if (!Object.hasOwn(a, questionId)) return null;
  const v = a[questionId];
  if (typeof v === 'string') return { kind: 'option', id: v };
  const o = obj(v);
  return o.kind === 'typed-reply' && typeof o.text === 'string' ? { kind: 'words', text: o.text } : null;
}

/** One OpenRig row (`GET /api/queue/<id>`) as « À toi » shows it; null when it is not something waiting on a person. */
export function toAsk(raw: unknown, kind: HumanAsk['kind']): HumanAsk | null {
  const q = obj(raw);
  const id = str(q.qitemId), body = str(q.body) ?? '';
  if (!id) return null;
  const seat = (kind === 'parked' ? str(q.destinationSession) : str(q.sourceSession)) ?? 'unknown';
  const answers = q.humanAnswers;
  const questions = (Array.isArray(q.humanQuestions) ? q.humanQuestions : []).flatMap(x => {
    const o = obj(x), qid = str(o.id), question = str(o.question);
    if (!qid || !question) return [];
    const options = (Array.isArray(o.options) ? o.options : []).flatMap(y => {
      const p = obj(y), oid = str(p.id), label = str(p.label);
      return oid && label ? [{ id: oid, label, recommended: p.recommended === true }] : [];
    });
    return [{ id: qid, question, options, answer: answerOf(answers, qid) }];
  });
  const priority = str(q.priority);
  return {
    id, kind, alert: Array.isArray(q.tags) && q.tags.includes('human-alert'),
    priority: priority && PRIORITIES.has(priority) ? priority as HumanAsk['priority'] : 'routine',
    from: { seat, ...seatParts(seat) },
    summary: str(q.summary)?.trim() || body.trim().split(/\r?\n/).find(Boolean)?.trim() || id,
    body: body.length > HUMAN_ASK_BODY_MAX ? body.slice(0, HUMAN_ASK_BODY_MAX) : body, bodyTruncated: body.length > HUMAN_ASK_BODY_MAX,
    detail: str(q.humanDetail), evidenceRef: str(q.evidenceRef), questions,
    createdAt: str(q.tsCreated) ?? '', updatedAt: str(q.tsUpdated) ?? str(q.tsCreated) ?? ''
  };
}

/** An ask from its attention item alone, when its row could not be read: its text is then the summary (`bodyTruncated`). */
export function fromAttention(raw: unknown, kind: HumanAsk['kind']): HumanAsk | null {
  const i = obj(raw), ref = attentionRef(raw);
  if (!ref) return null;
  const seat = str(i.asker) ?? 'unknown', summary = str(i.summary) ?? ref.id, at = str(i.at) ?? '';
  const answers = i.humanAnswers, urgency = str(i.urgency);
  const questions = (Array.isArray(i.humanQuestions) ? i.humanQuestions : []).flatMap(x => {
    const o = obj(x), qid = str(o.id), question = str(o.question);
    if (!qid || !question) return [];
    const options = (Array.isArray(o.options) ? o.options : []).flatMap(y => { const p = obj(y), oid = str(p.id), label = str(p.label); return oid && label ? [{ id: oid, label, recommended: p.recommended === true }] : []; });
    return [{ id: qid, question, options, answer: answerOf(answers, qid) }];
  });
  return { id: ref.id, kind, alert: false, priority: urgency && PRIORITIES.has(urgency) ? urgency as HumanAsk['priority'] : 'routine',
    from: { seat, ...seatParts(seat) }, summary, body: summary, bodyTruncated: true, detail: null, evidenceRef: null, questions, createdAt: at, updatedAt: at };
}

/** An attention item's row id and what it is: `queue:<id>` an ask (or a park, by its verb), `queue-update:<id>` a piece of news. */
export function attentionRef(raw: unknown): { id: string; kind: HumanAsk['kind'] } | null {
  const i = obj(raw), ref = str(i.id);
  if (!ref) return null;
  if (ref.startsWith('queue-update:')) return { id: ref.slice(13), kind: 'update' };
  if (!ref.startsWith('queue:')) return null;
  return { id: ref.slice(6), kind: str(obj(i.answer).verb) === 'resolve' ? 'parked' : 'decision' };
}

/** Whether a session names the registered person `entityId`, as OpenRig resolves it (resolveRegisteredHumanAddress): its part before the
 *  first `@`, for an external address (`ledge@external`) as for a canonical seat (`ledge@some-rig`). */
export function samePerson(session: string, entityId: string): boolean {
  const at = session.indexOf('@');
  return at > 0 && at < session.length - 1 && session.slice(0, at) === entityId;
}

/** OpenRig's events that may change what waits on the person. */
const WAKING = /^(queue\.|qitem\.|mission_control\.action_executed$|inbox\.)/;

/** What OpenRig's refusal means for the person (contract: `openrig.answered.error`). */
export function answerError(status: number, json: unknown): { error: HumanAnswerError; message?: string } {
  const j = obj(json), code = str(j.error), message = str(j.message) ?? undefined;
  if (status === 0) return { error: 'unreachable', message: "OpenRig's daemon did not answer" };
  if (status === 404 || code === 'qitem_not_found') return { error: 'not_found', message };
  if (code === 'qitem_already_terminal') return { error: 'closed', message };
  if (code === 'answer_not_closed') return { error: 'not_closed', message };
  if (status >= 500) return { error: 'unreachable', message: message ?? `OpenRig answered HTTP ${status}` };
  if (status === 200) return { error: 'unreachable', message: 'OpenRig answered something Ledge cannot read' };
  return { error: 'refused', message: message ?? code ?? `OpenRig answered HTTP ${status}` };
}

const TERMINAL = new Set(['done', 'handed-off', 'canceled', 'failed', 'denied']);

export function createHumanChannel(deps: HumanChannelDeps): HumanChannelService {
  const http = deps.http ?? fetchHttp, sse = deps.sse ?? fetchSse;
  const now = deps.now ?? Date.now, debounceMs = deps.debounceMs ?? 400, pollMs = deps.pollMs ?? 60_000, personTtl = deps.personTtlMs ?? 60_000;
  /** A row read, kept while its `tsUpdated` stands. */
  const rows = new Map<string, { at: string; row: unknown }>();
  let person: { at: number; byAddress: Map<string, { name: string; slack: boolean; entityId: string | null }> } | null = null;
  let last = '', lastEventId: string | null = null;
  let onChange: ((list: HumanList) => void) | null = null;
  let running = false, abort: AbortController | null = null, timer: NodeJS.Timeout | null = null, poll: NodeJS.Timeout | null = null;

  /** The OpenRig API's base, or the channel state that says why there is none. */
  const base = async (): Promise<{ url: string } | { channel: HumanChannel }> => {
    const st = await deps.state();
    const none = (state: HumanChannel['state'], message?: string) => ({ channel: { state, person: null, slack: false, ...(message ? { message } : {}) } });
    if (!st.installed) return none('not_installed');
    // Only a stop OpenRig confirms is one: `rig status` failing or printing nothing readable (`unknown`, `stale`) is not knowing.
    if (st.daemon.state === 'stopped') return none('openrig_stopped');
    if (st.daemon.state !== 'running') return none('unreachable', `OpenRig's state is ${st.daemon.state}`);
    if (!st.daemon.port) return none('unreachable', 'OpenRig did not say its port');
    return { url: `http://127.0.0.1:${st.daemon.port}` };
  };

  /** The registered people's names and whether Slack reaches them (`rig gateway human list --json`), read at most once a minute. */
  const people = async () => {
    if (person && now() - person.at < personTtl) return person.byAddress;
    const byAddress = new Map<string, { name: string; slack: boolean; entityId: string | null }>();
    const r = await deps.run(['gateway', 'human', 'list', '--json'], 15_000).catch(() => null);
    for (const h of Array.isArray(obj(parse(r?.stdout ?? '')).humans) ? obj(parse(r!.stdout)).humans as unknown[] : []) {
      const o = obj(h), address = str(o.address);
      if (address) byAddress.set(address, { name: str(o.displayName) ?? str(o.entityId) ?? address, slack: obj(o.deliveryReadiness).ready === true, entityId: str(o.entityId) });
    }
    if (r?.code === 0) person = { at: now(), byAddress };
    return byAddress;
  };

  /** A row read: `gone` when OpenRig no longer has it, `failed` when it could not be read (which settles nothing). */
  const row = async (url: string, id: string, at: string | null): Promise<{ row: unknown } | 'gone' | 'failed'> => {
    const kept = rows.get(id);
    if (kept && at && kept.at === at) return { row: kept.row };
    const r = await http('GET', `${url}/api/queue/${encodeURIComponent(id)}`);
    if (r.status === 404) return 'gone';
    // A row that is not the one asked for is no read of it: it never stands in for it.
    if (r.status !== 200 || !RowShape.safeParse(r.json).success || obj(r.json).qitemId !== id) return 'failed';
    rows.set(id, { at: at ?? '', row: r.json });
    return { row: r.json };
  };

  /** The asks of the last complete or partial read, by id: a read that fails keeps them, it never settles them. */
  let known = new Map<string, HumanAsk>();
  /** Whose asks `known` (and the rows read) are: a change of default person forgets them, so one person never sees another's. */
  let knownFor: string | null = null;
  const forget = () => { known = new Map(); rows.clear(); knownFor = null; };
  const sorted = (channel: HumanChannel, asks: HumanAsk[], partial: boolean): HumanList => {
    // The pressing first (critical, then urgent: the team's rule is `--priority urgent`, never `--alert`), then the most recent.
    asks.sort((x, y) => RANK[x.priority] - RANK[y.priority] || y.updatedAt.localeCompare(x.updatedAt));
    return { channel, asks: asks.slice(0, HUMAN_ASKS_MAX), ...(asks.length > HUMAN_ASKS_MAX ? { truncated: true } : {}), ...(partial ? { partial: true } : {}) };
  };

  const read = async (): Promise<HumanList> => {
    const b = await base();
    if ('channel' in b) {
      if (b.channel.state !== 'unreachable') forget();
      return sorted(b.channel, [...known.values()], b.channel.state === 'unreachable' && known.size > 0);
    }
    // `view=default`: the default person's queue only. Without it OpenRig's Feed shows every registered person's asks, and an answer
    // here would settle someone else's with the primary user's authority.
    const a = await http('GET', `${b.url}/api/attention?view=default`);
    if (a.status !== 200 || !AttentionShape.safeParse(a.json).success) {
      const message = a.status === 200 ? 'attention answered something Ledge cannot read' : a.status ? `attention answered HTTP ${a.status}` : "OpenRig's daemon did not answer";
      const channel: HumanChannel = { state: 'unreachable', person: null, slack: false, message };
      return sorted(channel, [...known.values()], known.size > 0);
    }
    const perspective = obj(obj(a.json).perspective);
    const address = str(obj(perspective.actingAs).person);
    if (!address) {
      forget();
      // A perspective without a person: several are registered and none is the default, so whose asks these are is unknown.
      return sorted(Object.keys(perspective).length
        ? { state: 'no_default', person: null, slack: false, message: 'several people are registered and none is the default (rig gateway default <id>)' }
        : { state: 'no_person', person: null, slack: false }, [], false);
    }
    if (address !== knownFor) { forget(); knownFor = address; }
    const who = (await people()).get(address);
    const channel: HumanChannel = { state: 'ready', person: { address, name: who?.name ?? address.replace(/@.*$/, '') }, slack: who?.slack ?? false };
    // A source OpenRig could not read fully (the queue, its updates) lists fewer rows than there are: what is missing is not settled.
    const sources = Array.isArray(obj(a.json).sources) ? obj(a.json).sources as unknown[] : [];
    const sourcePartial = sources.some(s => /^queue/.test(str(obj(s).source) ?? '') && str(obj(s).state) !== 'available');
    let partial = sourcePartial;
    const items = Array.isArray(obj(a.json).items) ? obj(a.json).items as unknown[] : [];
    // A row's cache key is its time AND its answers as attention gives them: OpenRig records a choice without moving `tsUpdated`, so the
    // time alone would keep showing a question as unanswered after it was answered (here, in another window, or by another surface).
    const refs = items.flatMap(i => {
      const r = attentionRef(i);
      return r ? [{ ...r, at: `${str(obj(i).at) ?? ''}|${JSON.stringify(obj(i).humanAnswers ?? null)}`, item: i }] : [];
    });
    const next = new Map<string, HumanAsk>();
    for (const r of refs) {
      const got = await row(b.url, r.id, r.at);
      if (got === 'gone') continue;
      const ask = got === 'failed' ? (partial = true, known.get(r.id) ?? fromAttention(r.item, r.kind)) : toAsk(got.row, r.kind);
      if (ask) next.set(ask.id, ask);
    }
    if (sourcePartial) for (const [id, ask] of known) if (!next.has(id) && !refs.some(r => r.id === id)) next.set(id, ask);
    for (const id of rows.keys()) if (!next.has(id)) rows.delete(id);
    known = next;
    return sorted(channel, [...next.values()], partial);
  };
  /** One read at a time: an older read never lands after a newer one, nor mixes its cache with a later person's. */
  let reading: Promise<unknown> = Promise.resolve();
  const list = (): Promise<HumanList> => {
    const next = reading.then(read, read);
    reading = next.catch(() => undefined);
    return next;
  };

  /** Read again and push when something changed. */
  const refresh = async () => {
    try {
      const l = await list();
      const key = JSON.stringify(l);
      if (key !== last) { last = key; onChange?.(l); }
    } catch (e) { log(`openrig human: not read: ${(e as Error).message}`); }
  };
  const soon = () => { if (timer) return; timer = setTimeout(() => { timer = null; void refresh(); }, debounceMs); };

  const follow = async () => {
    let wait = 2_000;
    while (running) {
      const b = await base().catch(() => null);
      if (b && 'url' in b) {
        abort = new AbortController();
        const started = now();
        try {
          await sse(`${b.url}/api/events${lastEventId ? '' : '?replay=0'}`, lastEventId, (id, data) => {
            if (id) lastEventId = id;
            if (WAKING.test(str(obj(data).type) ?? '')) soon();
          }, abort.signal);
        } catch (e) { if (running && !abort.signal.aborted) log(`openrig human: events dropped: ${(e as Error).message}`); }
        if (now() - started > 30_000) wait = 2_000;
        soon(); // what happened while it was down
      }
      if (!running) return;
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 2, 30_000);
    }
  };

  const answer: HumanChannelService['answer'] = async (qitemId, ans) => {
    const b = await base();
    if ('channel' in b) return { qitemId, ok: false, error: b.channel.state === 'openrig_stopped' ? 'openrig_stopped' : 'unreachable', message: b.channel.message ?? b.channel.state };
    const r = await http('GET', `${b.url}/api/queue/${encodeURIComponent(qitemId)}`);
    if (r.status !== 200 || !RowShape.safeParse(r.json).success || obj(r.json).qitemId !== qitemId) {
      return { qitemId, ok: false, ...(r.status === 200 ? { error: 'unreachable' as const, message: `OpenRig did not answer with row ${qitemId}` } : answerError(r.status, r.json)) };
    }
    const q = obj(r.json), intent = str(q.humanIntent), state = str(q.state) ?? '';
    const parked = state === 'blocked';
    // A resolve on a row no longer parked: it was unparked (by this answer, sent again after `uncertain`, or by someone else), so it no
    // longer waits on the person, as a closed row: `closed`, never a refusal that would read as a mistake.
    // (A seat's own row carries no human intent; an ask to the person, which a resolve never fits, does.)
    if (ans.kind === 'resolve' && !parked && intent === null) return { qitemId, ok: false, error: 'closed', message: `the row is no longer parked on the person (${state})` };
    const fits = ans.kind === 'seen' ? intent === 'update' : ans.kind === 'resolve' ? parked : intent !== 'update' && !parked;
    if (!fits) return { qitemId, ok: false, error: 'refused', message: `a ${ans.kind} answer does not fit this row (${intent ?? 'no intent'}, ${state})` };
    if (TERMINAL.has(state) && ans.kind !== 'choice' && ans.kind !== 'words') return { qitemId, ok: false, error: 'closed', message: `the row is ${state}` };
    const action = ans.kind === 'choice' ? { verb: 'answer', questionId: ans.questionId, optionId: ans.optionId }
      : ans.kind === 'words' ? { verb: 'answer', decision: ans.text }
      : ans.kind === 'resolve' ? { verb: 'resolve', decision: ans.text }
      : { verb: 'approve', reason: 'seen in Ledge' };
    // OpenRig needs a declared actor without a seat header: the person asked (the row's destination, or the person it is parked on), as its
    // TUI sends it; the primary user's authority then records the default person whoever that is.
    const actorSession = (parked ? str(q.blockedOn) : str(q.destinationSession)) ?? undefined;
    // Only the default person's asks are answered from here: OpenRig's primary-user authority would settle anyone's. Who that is is read
    // again now (it may have changed), and nothing is sent when it cannot be checked.
    const current = await list();
    const me = current.channel.state === 'ready' ? current.channel.person : null;
    if (!me) {
      const error: HumanAnswerError = current.channel.state === 'openrig_stopped' ? 'openrig_stopped' : current.channel.state === 'unreachable' ? 'unreachable' : 'refused';
      return { qitemId, ok: false, error, message: `the default person could not be checked (${current.channel.message ?? current.channel.state})` };
    }
    const entityId = (await people()).get(me.address)?.entityId ?? me.address.slice(0, me.address.indexOf('@'));
    if (!actorSession || !samePerson(actorSession, entityId)) return { qitemId, ok: false, error: 'refused', message: `this row is not addressed to ${me.address}` };
    const res = await http('POST', `${b.url}/api/mission-control/action`, { ...action, qitemId, actorSession, authority: 'primary-user', auditNotes: { client: 'ledge' } });
    rows.delete(qitemId); // whatever came back, the next read takes the row afresh
    soon();
    // Once the request may have left, only OpenRig's own readable answer says what happened: a lost answer (timeout, dropped connection),
    // a server error or an unreadable 200 is `uncertain`, never « sent » nor « not sent ». Sending again is safe: OpenRig records an
    // answer once and says so.
    const uncertain = (message: string) => ({ qitemId, ok: false, error: 'uncertain' as const, message });
    if (res.status === 0) return res.unsent ? { qitemId, ok: false, error: 'unreachable' as const, message: "OpenRig's daemon refused the connection" } : uncertain("OpenRig's answer was lost");
    if (res.status >= 500) return uncertain(str(obj(res.json).message) ?? `OpenRig answered HTTP ${res.status}`);
    if (res.status !== 200) return { qitemId, ok: false, ...answerError(res.status, res.json) };
    if (ans.kind === 'seen' || ans.kind === 'resolve') {
      // Proof is OpenRig's account of this very action: the verb sent, on this row.
      const acted = ActedShape.safeParse(res.json);
      return acted.success && acted.data.qitemId === qitemId && acted.data.verb === action.verb ? { qitemId, ok: true, outcome: 'answered' } : uncertain('OpenRig answered with another action than this one');
    }
    const parsed = AnswerShape.safeParse(res.json);
    if (!parsed.success) return uncertain('OpenRig answered something Ledge cannot read');
    if (parsed.data.qitemId !== qitemId) return uncertain('OpenRig answered with another action than this one');
    const told = parsed.data.answer, replyId = parsed.data.createdQitemId ?? undefined;
    if (told.outcome === 'recorded') {
      // OpenRig names what still waits by its questions' text: their ids come from the row read before answering, no second read. A text
      // it does not find, or one several questions share, leaves `remaining` out (unknown), never a guess nor an empty list.
      const questions = toAsk(r.json, 'decision')?.questions ?? [];
      const ids = told.unanswered.map(t => { const same = questions.filter(x => x.question === t); return same.length === 1 ? same[0]!.id : null; });
      const known = ids.length > 0 && ids.every(Boolean) && new Set(ids).size === ids.length;
      return { qitemId, ok: true, outcome: 'recorded', ...(known ? { remaining: ids as string[] } : {}) };
    }
    const already = (told.message ?? '').startsWith('Already answered');
    return { qitemId, ok: true, outcome: already ? 'already' : 'answered', ...(replyId ? { replyId } : {}) };
  };

  return {
    list, answer,
    start(fn) {
      if (running) return;
      running = true; onChange = fn;
      void follow();
      poll = setInterval(() => void refresh(), pollMs);
      void refresh();
    },
    stop() {
      running = false; abort?.abort();
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      timer = poll = null;
    }
  };
}

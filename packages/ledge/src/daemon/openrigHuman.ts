import { HUMAN_ASK_BODY_MAX, HUMAN_ASKS_MAX, type HumanAnswer, type HumanAnswerError, type HumanAsk, type HumanChannel, type OpenRigAnswered, type OpenRigState } from '@ledge/protocol';
import { log } from '../log.js';
import type { RigRun } from './openrig.js';

/**
 * « À toi » (docs/vision/ledge-human-channel-contract.md): what OpenRig asks or tells the person, read from its daemon's own API, and
 * their answers written back through it, the way OpenRig's TUI does. Read: `GET /api/attention` (the open asks to a person and the rows
 * parked on one, already classified) and `GET /api/queue/<id>` for each row's text; woken by `GET /api/events` (SSE, resumed with
 * Last-Event-ID), with a slow poll as a safety net. Answer: `POST /api/mission-control/action` with the primary user's authority and
 * no seat header, so OpenRig records the person as the actor, returns the answer to the asking seat and wakes it.
 */

/** The OpenRig daemon's answer to one HTTP call: `status` 0 when it could not be reached. */
export type RigHttp = (method: 'GET' | 'POST', url: string, body?: unknown) => Promise<{ status: number; json: unknown }>;
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

export interface HumanList { channel: HumanChannel; asks: HumanAsk[]; truncated?: boolean }

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
  } catch { return { status: 0, json: undefined }; }
};

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

/** One OpenRig row (`GET /api/queue/<id>`) as « À toi » shows it; null when it is not something waiting on a person. */
export function toAsk(raw: unknown, kind: HumanAsk['kind']): HumanAsk | null {
  const q = obj(raw);
  const id = str(q.qitemId), body = str(q.body) ?? '';
  if (!id) return null;
  const seat = (kind === 'parked' ? str(q.destinationSession) : str(q.sourceSession)) ?? 'unknown';
  const answers = obj(q.humanAnswers);
  const questions = (Array.isArray(q.humanQuestions) ? q.humanQuestions : []).flatMap(x => {
    const o = obj(x), qid = str(o.id), question = str(o.question);
    if (!qid || !question) return [];
    const options = (Array.isArray(o.options) ? o.options : []).flatMap(y => {
      const p = obj(y), oid = str(p.id), label = str(p.label);
      return oid && label ? [{ id: oid, label, recommended: p.recommended === true }] : [];
    });
    return [{ id: qid, question, options, answer: str(answers[qid]) }];
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

/** An attention item's row id and what it is: `queue:<id>` an ask (or a park, by its verb), `queue-update:<id>` a piece of news. */
export function attentionRef(raw: unknown): { id: string; kind: HumanAsk['kind'] } | null {
  const i = obj(raw), ref = str(i.id);
  if (!ref) return null;
  if (ref.startsWith('queue-update:')) return { id: ref.slice(13), kind: 'update' };
  if (!ref.startsWith('queue:')) return null;
  return { id: ref.slice(6), kind: str(obj(i.answer).verb) === 'resolve' ? 'parked' : 'decision' };
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
  return { error: 'refused', message: message ?? code ?? `OpenRig answered HTTP ${status}` };
}

const TERMINAL = new Set(['done', 'handed-off', 'canceled', 'failed', 'denied']);

export function createHumanChannel(deps: HumanChannelDeps): HumanChannelService {
  const http = deps.http ?? fetchHttp, sse = deps.sse ?? fetchSse;
  const now = deps.now ?? Date.now, debounceMs = deps.debounceMs ?? 400, pollMs = deps.pollMs ?? 60_000, personTtl = deps.personTtlMs ?? 60_000;
  /** A row read, kept while its `tsUpdated` stands. */
  const rows = new Map<string, { at: string; row: unknown }>();
  let person: { at: number; byAddress: Map<string, { name: string; slack: boolean }> } | null = null;
  let last = '', lastEventId: string | null = null;
  let onChange: ((list: HumanList) => void) | null = null;
  let running = false, abort: AbortController | null = null, timer: NodeJS.Timeout | null = null, poll: NodeJS.Timeout | null = null;

  /** The OpenRig API's base, or the channel state that says why there is none. */
  const base = async (): Promise<{ url: string } | { channel: HumanChannel }> => {
    const st = await deps.state();
    const none = (state: HumanChannel['state'], message?: string) => ({ channel: { state, person: null, slack: false, ...(message ? { message } : {}) } });
    if (!st.installed) return none('not_installed');
    if (st.daemon.state !== 'running') return none('openrig_stopped');
    if (!st.daemon.port) return none('unreachable', 'OpenRig did not say its port');
    return { url: `http://127.0.0.1:${st.daemon.port}` };
  };

  /** The registered people's names and whether Slack reaches them (`rig gateway human list --json`), read at most once a minute. */
  const people = async () => {
    if (person && now() - person.at < personTtl) return person.byAddress;
    const byAddress = new Map<string, { name: string; slack: boolean }>();
    const r = await deps.run(['gateway', 'human', 'list', '--json'], 15_000).catch(() => null);
    for (const h of Array.isArray(obj(parse(r?.stdout ?? '')).humans) ? obj(parse(r!.stdout)).humans as unknown[] : []) {
      const o = obj(h), address = str(o.address);
      if (address) byAddress.set(address, { name: str(o.displayName) ?? str(o.entityId) ?? address, slack: obj(o.deliveryReadiness).ready === true });
    }
    if (r?.code === 0) person = { at: now(), byAddress };
    return byAddress;
  };

  const row = async (url: string, id: string, at: string | null): Promise<unknown> => {
    const kept = rows.get(id);
    if (kept && at && kept.at === at) return kept.row;
    const r = await http('GET', `${url}/api/queue/${encodeURIComponent(id)}`);
    if (r.status !== 200) return null;
    rows.set(id, { at: str(obj(r.json).tsUpdated) ?? at ?? '', row: r.json });
    return r.json;
  };

  const list = async (): Promise<HumanList> => {
    const b = await base();
    if ('channel' in b) return { channel: b.channel, asks: [] };
    const a = await http('GET', `${b.url}/api/attention`);
    if (a.status !== 200) return { channel: { state: 'unreachable', person: null, slack: false, message: a.status ? `attention answered HTTP ${a.status}` : "OpenRig's daemon did not answer" }, asks: [] };
    const address = str(obj(obj(obj(a.json).perspective).actingAs).person);
    const who = address ? (await people()).get(address) : undefined;
    const channel: HumanChannel = address
      ? { state: 'ready', person: { address, name: who?.name ?? address.replace(/@.*$/, '') }, slack: who?.slack ?? false }
      : { state: 'no_person', person: null, slack: false };
    const items = Array.isArray(obj(a.json).items) ? obj(a.json).items as unknown[] : [];
    const refs = items.flatMap(i => { const r = attentionRef(i); return r ? [{ ...r, at: str(obj(i).at) }] : []; });
    const asks: HumanAsk[] = [];
    for (const r of refs) {
      const ask = toAsk(await row(b.url, r.id, r.at), r.kind);
      if (ask) asks.push(ask);
    }
    for (const id of rows.keys()) if (!refs.some(r => r.id === id)) rows.delete(id);
    // The pressing first (critical, then urgent: the team's rule is `--priority urgent`, never `--alert`), then the most recent.
    asks.sort((x, y) => RANK[x.priority] - RANK[y.priority] || y.updatedAt.localeCompare(x.updatedAt));
    return { channel, asks: asks.slice(0, HUMAN_ASKS_MAX), ...(asks.length > HUMAN_ASKS_MAX ? { truncated: true } : {}) };
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
    if (r.status !== 200) return { qitemId, ok: false, ...answerError(r.status, r.json) };
    const q = obj(r.json), intent = str(q.humanIntent), state = str(q.state) ?? '';
    const parked = state === 'blocked';
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
    const res = await http('POST', `${b.url}/api/mission-control/action`, { ...action, qitemId, actorSession, authority: 'primary-user', auditNotes: { client: 'ledge' } });
    soon();
    if (res.status !== 200) return { qitemId, ok: false, ...answerError(res.status, res.json) };
    const out = obj(res.json), told = obj(out.answer), replyId = str(out.createdQitemId) ?? undefined;
    if (ans.kind === 'seen' || ans.kind === 'resolve') return { qitemId, ok: true, outcome: 'answered' };
    if (str(told.outcome) === 'recorded') {
      const after = toAsk((await http('GET', `${b.url}/api/queue/${encodeURIComponent(qitemId)}`)).json, 'decision');
      return { qitemId, ok: true, outcome: 'recorded', remaining: after?.questions.filter(x => x.answer === null).map(x => x.id) ?? [] };
    }
    const already = (str(told.message) ?? '').startsWith('Already answered');
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

import { randomUUID } from 'node:crypto';
import { MandateCategorySchema, type ClientMessage, type Escalation, type LedgeRule } from '@ledge/protocol';
import type { RemotePeers } from '../openrig/remote.js';
import type { LedgeThread } from '../ledgeThread.js';
import type { BrainEvent } from './inbox.js';
import type { Memory } from './memory.js';
import type { Mandate } from './mandate.js';
import type { AskResult, DecideResult } from './decide.js';
import { guardDecide, validAnswers } from './guard.js';
import type { PendingJournal, RemotePending } from './remoteJournal.js';

/** Encodes both components, so two origin daemons can safely use the same native id. */
export function remoteBrainId(machine: string, id: string): string {
  return `remote~${Buffer.from(machine).toString('base64url')}~${Buffer.from(id).toString('base64url')}`;
}

type DelegateMessage = Extract<ClientMessage, { type: 'brain.delegate.claim' | 'brain.delegate.decide' | 'brain.delegate.release' | 'brain.delegate.query' }>;
type DelegateResult = { ok: boolean; token?: string; graceUntil?: string; status?: 'applied'; code?: string; reason?: string };
type Pending = { machine: string; done: (r: DelegateResult | null) => void; timer: ReturnType<typeof setTimeout> };
type Candidate = { answers: Record<string, string>; category: string; rule?: string; why?: string; timer: ReturnType<typeof setTimeout> };
type Lease = { id: string; machine: string; nativeId: string; token: string; graceUntil: string; escalation: Escalation; candidate?: Candidate; applying: boolean };
const ACK_TIMEOUT_MS = 30_000;

/** The coordinator never patches remote grace or treats a queued/optimistic update as an applied decision. */
export function createRemoteBrainCoordinator(d: {
  remote: RemotePeers;
  brainOn(): boolean;
  inbox: { push(e: BrainEvent): boolean };
  memory: Pick<Memory, 'rules' | 'record'>;
  thread: Pick<LedgeThread, 'append'> & Partial<Pick<LedgeThread, 'flush' | 'flushStrict'>>;
  journal?: PendingJournal;
  mandate(): Mandate;
  now?: () => number;
  uuid?: () => string;
}) {
  const leases = new Map<string, Lease>(), claiming = new Set<string>(), pending = new Map<string, Pending>();
  const latest = new Map<string, Escalation>();
  const reconciling = new Set<string>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  const notified = new Set<string>();
  const now = d.now ?? Date.now, uuid = d.uuid ?? randomUUID;
  const send = (machine: string, msg: DelegateMessage): Promise<DelegateResult | null> => new Promise(resolve => {
    let done = false;
    const settle = (r: DelegateResult | null) => { if (done) return; done = true; const p = pending.get(msg.rid); if (p) clearTimeout(p.timer); pending.delete(msg.rid); resolve(r); };
    const timer = setTimeout(() => settle(null), ACK_TIMEOUT_MS); timer.unref?.();
    pending.set(msg.rid, { machine, done: settle, timer });
    if (!d.remote.send(machine, msg)) settle(null);
  });
  const note = (text: string) => { d.inbox.push({ kind: 'state', text }); };
  const release = async (l: Lease, advice?: string, category?: string): Promise<DelegateResult | null> => {
    const parsed = category === undefined ? undefined : MandateCategorySchema.safeParse(category);
    if (parsed && !parsed.success) return { ok: false, code: 'invalid', reason: 'catégorie inconnue' };
    return send(l.machine, { type: 'brain.delegate.release', rid: uuid(), id: l.nativeId, token: l.token, ...(advice !== undefined ? { advice } : {}), ...(parsed?.success ? { category: parsed.data } : {}) });
  };
  const forget = (l: Lease) => { if (l.candidate) clearTimeout(l.candidate.timer); leases.delete(l.id); };
  const acquire = async (e: Escalation) => {
    const id = remoteBrainId(e.machine, e.id);
    if (d.journal?.all().some(x => x.id === id) || claiming.has(id) || leases.has(id) || !d.brainOn() || !d.remote.supportsBrainDelegate?.(e.machine)) return;
    claiming.add(id);
    try {
      const r = await send(e.machine, { type: 'brain.delegate.claim', rid: uuid(), id: e.id });
      if (!r?.ok || !r.token || !r.graceUntil) return;
      const l: Lease = { id, machine: e.machine, nativeId: e.id, token: r.token, graceUntil: r.graceUntil, escalation: { ...e, id, state: 'grace', graceUntil: r.graceUntil }, applying: false };
      const current = latest.get(id);
      if (!d.brainOn() || !current || current.state !== 'grace' || current.graceUntil !== r.graceUntil) { void release(l); return; }
      leases.set(id, l);
      if (!d.inbox.push({ kind: 'escalation', escalation: l.escalation, rules: d.memory.rules().filter((x: LedgeRule) => x.status === 'active') })) { forget(l); void release(l); }
    } finally { claiming.delete(id); }
  };
  const confirmed = async (p: RemotePending) => {
    const e = p.escalation;
    const summary = e.questions.flatMap(q => p.answers[q.id] === undefined ? [] : [`${q.question} → ${q.options.find(o => o.id === p.answers[q.id])?.label ?? p.answers[q.id]}`]).join(' ; ') || e.summary;
    const decision = d.memory.record({ by: 'ledge', category: p.category, escalationId: p.id, summary, answers: p.answers, ...(p.rule ? { rule: p.rule } : {}), ...(p.why ? { why: p.why } : {}), at: new Date(now()).toISOString(), from: e.from, ...(e.rigId ? { rigId: e.rigId } : {}) }, `remote-${p.operation}`);
    d.thread.append({ id: `remote-${p.operation}`, kind: 'decided', decisionId: decision.id });
    if (d.thread.flushStrict) await d.thread.flushStrict(); else await d.thread.flush?.();
    d.journal?.remove(p.operation); notified.delete(p.operation);
    note(`Décision appliquée sur ${p.machine} : ${decision.summary}.`);
  };
  const reconcile = async (machine: string) => {
    for (const p of d.journal?.all().filter(x => x.machine === machine) ?? []) {
      if (reconciling.has(p.operation)) continue;
      reconciling.add(p.operation);
      try {
        const r = await send(machine, { type: 'brain.delegate.query', rid: uuid(), operation: p.operation, token: p.token });
        if (r?.ok && r.status === 'applied') await confirmed(p);
        else {
          if (!notified.has(p.operation)) { notified.add(p.operation); note(`La décision sur ${p.id} reste non confirmée : vérifie la machine d'origine.`); }
          if (d.remote.status(machine) === 'open' && !retries.has(machine)) { const timer = setTimeout(() => { retries.delete(machine); void reconcile(machine); }, 30_000); timer.unref?.(); retries.set(machine, timer); }
        }
      } catch {
        note(`La réconciliation de ${p.id} reste en attente.`);
        if (d.remote.status(machine) === 'open' && !retries.has(machine)) { const timer = setTimeout(() => { retries.delete(machine); void reconcile(machine); }, 30_000); timer.unref?.(); retries.set(machine, timer); }
      }
      finally { reconciling.delete(p.operation); }
    }
  };
  const apply = async (l: Lease, c: Omit<Candidate, 'timer'>) => {
    if (!leases.has(l.id) || !d.brainOn()) return;
    const parsed = MandateCategorySchema.safeParse(c.category); if (!parsed.success) return;
    const p: RemotePending = { operation: uuid(), token: l.token, machine: l.machine, nativeId: l.nativeId, id: l.id, escalation: l.escalation, answers: c.answers, category: parsed.data, ...(c.rule ? { rule: c.rule } : {}), ...(c.why ? { why: c.why } : {}) };
    try { d.journal?.put(p); } catch { forget(l); void release(l); note(`Journal indisponible : aucune décision envoyée pour ${l.id}.`); return; }
    l.applying = true;
    const r = await send(l.machine, { type: 'brain.delegate.decide', rid: p.operation, id: l.nativeId, token: l.token, answers: c.answers, category: parsed.data });
    l.applying = false;
    if (!r || r.code === 'unknown') { forget(l); note(`La décision sur ${l.id} n'est pas confirmée : vérifie la machine d'origine.`); return; }
    if (!r.ok) {
      try { d.journal?.remove(p.operation); } catch { forget(l); note(`Journal indisponible : réconciliation nécessaire pour ${l.id}.`); return; }
      if (r.code === 'too_early' && leases.has(l.id) && d.brainOn()) {
        const timer = setTimeout(() => { if (l.candidate?.timer === timer) { l.candidate = undefined; void apply(l, c); } }, 1000); timer.unref?.();
        l.candidate = { ...c, timer }; return;
      }
      forget(l); void release(l); note(`La décision sur ${l.id} n'a pas été confirmée : ${r.reason ?? r.code ?? 'résultat inconnu'}.`); return;
    }
    if (r.status !== 'applied') { forget(l); note(`La décision sur ${l.id} reste non confirmée.`); return; }
    forget(l);
    try { await confirmed(p); } catch { note(`La preuve de ${l.id} doit être réconciliée.`); }
  };
  const offMessage = d.remote.onMessage((machine, m) => {
    if (m.type !== 'brain.delegate.result') return;
    const p = pending.get(m.rid); if (p?.machine === machine) p.done(m);
  });
  const offStatus = d.remote.onStatus((machine, status) => {
    if (status === 'open') { void reconcile(machine); return; }
    const retry = retries.get(machine); if (retry) clearTimeout(retry); retries.delete(machine);
    for (const p of [...pending.values()]) if (p.machine === machine) p.done(null);
    for (const l of [...leases.values()]) if (l.machine === machine) { forget(l); note(`La concession sur ${l.id} a été perdue : aucune application n'est confirmée.`); }
  });
  return {
    observe(e: Escalation) {
      if (e.machine === 'local') return;
      const id = remoteBrainId(e.machine, e.id), l = leases.get(id);
      latest.set(id, e);
      if (l) {
        if (e.state === 'pending') { forget(l); note(`La concession sur ${id} a expiré ou a été retirée.`); return; }
        // A user answer may still be in flight at the origin. Cancel the candidate but retain the lease until it settles or rolls back.
        if (e.state === 'answered' || e.state === 'closed') { if (l.candidate) clearTimeout(l.candidate.timer); l.candidate = undefined; }
        else l.escalation = { ...e, id, graceUntil: l.graceUntil };
      } else if (e.state === 'pending') void acquire(e);
    },
    list(): Escalation[] { return [...leases.values()].map(l => l.escalation); },
    has(id: string): boolean { return leases.has(id); },
    async decide(id: string, answers: Record<string, string>, category: string, o: { rule?: string; why?: string }): Promise<DecideResult> {
      const l = leases.get(id); if (!l) return { ok: false, code: 'unreachable', line: 'Concession distante absente.' };
      if (l.applying) return { ok: false, code: 'already_answered', line: 'Une réponse est en cours.' };
      const verdict = guardDecide(l.escalation, category, answers, d.mandate());
      if (!verdict.ok) {
        const r = await release(l, undefined, verdict.category); if (r?.ok) forget(l);
        return { ok: false, code: 'mandate', line: r?.ok ? `Refusé par le garde : ${verdict.reason}. Remonté à l'utilisateur.` : `Refusé par le garde : ${verdict.reason}. Libération non confirmée.` };
      }
      const bad = validAnswers(l.escalation, answers); if (bad) return { ok: false, code: 'invalid', line: bad };
      if (l.candidate) clearTimeout(l.candidate.timer);
      const c = { answers, category: verdict.category, ...(o.rule ? { rule: o.rule } : {}), ...(o.why ? { why: o.why } : {}) };
      const timer = setTimeout(() => { if (l.candidate?.timer === timer) { l.candidate = undefined; void apply(l, c); } }, Math.max(0, Date.parse(l.graceUntil) - now())); timer.unref?.();
      l.candidate = { ...c, timer };
      return { ok: true, line: `Noté : application après la grâce si l'utilisateur n'a pas répondu.` };
    },
    async ask(id: string, category: string | undefined, advice: string): Promise<AskResult> {
      const l = leases.get(id); if (!l) return { ok: false, code: 'failed', line: 'Concession distante absente.' };
      if (!advice.trim()) return { ok: false, code: 'invalid', line: "L'avis est vide." };
      const r = await release(l, advice.trim(), category);
      if (!r?.ok) return { ok: false, code: 'failed', line: `Libération non confirmée : ${r?.reason ?? 'machine injoignable'}.` };
      forget(l); return { ok: true, line: "Remonté à l'utilisateur avec ton avis." };
    },
    releaseAll() { for (const l of [...leases.values()]) { if (l.applying) continue; forget(l); void release(l); } },
    close() { for (const l of [...leases.values()]) { if (l.candidate) clearTimeout(l.candidate.timer); if (!l.applying) void release(l); } leases.clear(); for (const timer of retries.values()) clearTimeout(timer); retries.clear(); offMessage(); offStatus(); for (const p of [...pending.values()]) p.done(null); }
  };
}

import { createHash } from 'node:crypto';
import { TOOL_TEXT_MAX, type ClientMessage, type Escalation, type Exchange, type LedgeDecision, type LedgeRule, type PhoneClientMessage, type PhoneEscalation, type PhoneExchange, type PhoneLedgeDecision, type PhoneRig, type PhoneRigPlan, type Rig, type RigPlan, type RigResultCode } from '@ledge/protocol';

/** Stable, opaque per-machine rig identity; length-delimited input avoids ambiguous concatenations. */
export const rigKey = (machine: string, rigId: string): string => createHash('sha256').update(JSON.stringify([machine, rigId])).digest('hex').slice(0, 16);
/** Free text may quote local paths. Replace absolute paths before it crosses the phone boundary. */
export function phoneText(value: string, max: number): string {
  return value.replace(/(?:[A-Za-z]:\\|\/)(?:[^\s<>"'`]+[\\/])*[^\s<>"'`,;:)]*/g, '[chemin]').slice(0, max);
}
const text = (s: string, max = TOOL_TEXT_MAX) => phoneText(s, max);
const safe = (s: string, max = 120) => text(s, max) || '?';
/** An identifier is routed back to the daemon unchanged: never clip or redact it into another identifier. */
const stable = (s: string, max = 120): string => { if (!s || s.length > max || text(s, max) !== s) throw new Error('unsafe phone identifier'); return s; };

export function toPhoneRig(r: Rig, projectName: (id: string) => string | undefined): PhoneRig {
  return { key: rigKey(r.machine, r.id), name: safe(r.name, 80), ...(r.spec ? { spec: safe(r.spec, 80) } : {}), project: r.projectId ? safe(projectName(r.projectId) ?? r.projectId, 80) : null,
    offProject: r.offProject, ...(r.branch ? { branch: text(r.branch, 200) } : {}), lifecycle: r.lifecycle, kernel: r.kernel,
    seats: r.seats.slice(0, 16).map(s => ({ ref: stable(s.ref), address: stable(s.address), name: safe(s.name, 80), runtime: safe(s.runtime, 80), ...(s.model ? { model: safe(s.model) } : {}), state: s.state,
      ...(s.contextPct !== undefined ? { contextPct: s.contextPct } : {}), ...(r.machine === 'local' && s.sessionId ? { sessionId: stable(s.sessionId) } : {}) })), repos: r.repos.length,
    ...(r.launch ? { launch: { planId: stable(r.launch.planId), goal: text(r.launch.goal, 600), lead: stable(r.launch.lead), startedAt: r.launch.startedAt, ...(r.launch.goalSentAt ? { goalSentAt: r.launch.goalSentAt } : {}), ...(r.launch.lateNotice ? { lateNotice: true as const } : {}) } } : {}) };
}
export function toPhoneEscalation(e: Escalation, rules: LedgeRule[], rigs: Rig[]): PhoneEscalation {
  const rig = e.rigId ? rigs.find(r => r.machine === e.machine && r.id === e.rigId) : undefined;
  const active = rules.filter(r => r.status === 'active' && r.category === e.category).slice(0, 5);
  return { id: stable(e.id), source: e.source, ...(e.rigId ? { rigKey: rigKey(e.machine, e.rigId) } : {}), ...(rig ? { rigName: safe(rig.name, 60) } : {}), from: safe(e.from), intent: e.intent, summary: text(e.summary),
    ...(e.detail ? { detail: text(e.detail) } : {}), questions: e.questions.slice(0, 4).map(q => ({ id: stable(q.id), question: text(q.question), options: q.options.slice(0, 4).map(o => ({ id: stable(o.id), label: text(o.label, 200), ...(o.recommended !== undefined ? { recommended: o.recommended } : {}) })) })),
    createdAt: e.createdAt, state: e.state, ...(e.graceUntil ? { graceUntil: e.graceUntil } : {}), ...(e.correcting ? { correcting: stable(e.correcting) } : {}), ...(e.category ? { category: e.category } : {}), ...(e.advice ? { advice: text(e.advice) } : {}),
    ...(active.length ? { rules: active.map(r => ({ text: text(r.text, 200), since: r.since.slice(0, 10) })) } : {}), ...(e.answer ? { answer: { by: e.answer.by, answers: Object.fromEntries(Object.entries(e.answer.answers).map(([k, v]) => [safe(k), text(v, 20_000)])), at: e.answer.at, ...(e.answer.rule ? { rule: stable(e.answer.rule) } : {}), ...(e.answer.delivery ? { delivery: e.answer.delivery } : {}) } } : {}) };
}
export function toPhoneExchange(e: Exchange): PhoneExchange {
  const t = text(e.text); return { id: stable(e.id), rigKey: rigKey(e.machine, e.rigId), from: safe(e.from), to: safe(e.to), kind: e.kind, text: t, at: e.at, ...(t !== e.text ? { cut: true as const } : {}) };
}
export function toPhoneDecision(d: LedgeDecision, rigs: Rig[]): PhoneLedgeDecision {
  const matching = d.rigId ? rigs.filter(r => r.id === d.rigId) : [];
  return { id: stable(d.id), escalationId: stable(d.escalationId), by: d.by, ...(d.category ? { category: d.category } : {}), summary: text(d.summary), answers: Object.fromEntries(Object.entries(d.answers).map(([k, v]) => [safe(k), text(v, 20_000)])), ...(d.rule ? { rule: stable(d.rule) } : {}), ...(d.from ? { from: safe(d.from) } : {}), ...(matching.length === 1 ? { rigName: safe(matching[0]!.name, 60) } : {}), ...(d.why ? { why: text(d.why) } : {}), at: d.at, ...(d.revisitedBy ? { revisitedBy: stable(d.revisitedBy) } : {}) };
}
export function toPhonePlan(p: RigPlan, projectName: (id: string) => string | undefined): PhoneRigPlan {
  return { id: stable(p.id), spec: safe(p.spec, 80), goal: text(p.goal, 600), where: p.where.kind === 'project' ? { kind: 'project', project: safe(projectName(p.where.projectId) ?? p.where.projectId, 80), branch: text(p.where.branch, 200), copy: p.where.copy } : { kind: 'off-project', name: safe(p.where.name, 80) }, seats: p.seats.slice(0, 16).map(s => ({ address: stable(s.address), runtime: safe(s.runtime, 80), ...(s.model ? { model: safe(s.model) } : {}), autonomy: safe(s.autonomy, 80) })), writes: p.writes.slice(0, 40).map(w => text(w, 200)), required: p.required };
}
type RigMessage = Extract<PhoneClientMessage, { type: 'rig.act' | 'rig.exchanges.request' | 'escalation.answer' | 'ledge.say' | 'decision.revisit' | 'rig.launch' }>;
export function fromPhone(m: RigMessage, keys: Map<string, { machine: string; rigId: string }>): ClientMessage | { refused: RigResultCode } {
  switch (m.type) {
    case 'rig.act': { const r = keys.get(m.key); return r ? { type: 'rig.act', rid: m.op, machine: r.machine, rigId: r.rigId, verb: m.verb, ...(m.seatRef ? { seatRef: m.seatRef } : {}) } : { refused: 'invalid' }; }
    case 'rig.exchanges.request': { const r = keys.get(m.key); return r ? { type: 'rig.exchanges.request', machine: r.machine, rigId: r.rigId } : { refused: 'invalid' }; }
    case 'escalation.answer': return { type: 'escalation.answer', rid: m.op, id: m.id, answers: m.answers, by: 'user' };
    case 'ledge.say': return { type: 'ledge.say', rid: m.op, text: m.text, ...(m.about ? { about: m.about } : {}) };
    case 'decision.revisit': return { type: 'decision.revisit', rid: m.op, id: m.id, ...(m.text ? { text: m.text } : {}) };
    case 'rig.launch': return { type: 'rig.launch', rid: m.op, planId: m.planId };
  }
}

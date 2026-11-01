import { randomUUID } from 'node:crypto';
import type { Escalation } from '@ledge/protocol';
import type { AnswerResult } from '../openrig/answer.js';
import type { EscalationPatch } from '../openrig/bridge.js';
import { guardDecide, GRACE_MS, validAnswers } from './guard.js';
import type { Mandate } from './mandate.js';

/** The origin's clock controls both the grace and its bounded delegation. */
export const REMOTE_GRACE_MS = GRACE_MS;
export const REMOTE_LEASE_MS = 600_000;
type Refusal = { ok: false; code: string; reason: string };
type Grant = { ok: true; token: string; graceUntil: string } | Refusal;
type Outcome = { ok: true; status: 'applied'; escalation: Escalation } | Refusal;
type Lease = { owner: string; token: string; deadline: number; timer: ReturnType<typeof setTimeout>; applying: boolean; ended: boolean };

/**
 * Origin-side arbitration for a delegated brain. This object owns no network: the caller must authenticate and bind `owner`
 * to one peer connection. The existing Answers lock serializes its final write against user answers at the origin.
 */
export function createRemoteBrainOwner(d: {
  escalation(id: string): Escalation | undefined;
  patch(id: string, p: EscalationPatch): Escalation | undefined;
  localBrainOn(): boolean;
  mandate(): Mandate;
  hasReplyRow(id: string): boolean;
  answer(id: string, answers: Record<string, string>): Promise<AnswerResult>;
  now?: () => number;
  token?: () => string;
}) {
  const leases = new Map<string, Lease>();
  const now = d.now ?? Date.now, token = d.token ?? randomUUID;
  const refusal = (code: string, reason: string): Refusal => ({ ok: false, code, reason });
  const stop = (id: string, l: Lease) => {
    if (leases.get(id) !== l) return;
    l.ended = true; clearTimeout(l.timer); leases.delete(id);
    const e = d.escalation(id);
    // Never restore pending over a user answer, including one currently being delivered by Answers.
    if (!l.applying && e?.state === 'grace') d.patch(id, { state: 'pending', graceUntil: undefined });
  };
  const claim = (id: string, owner: string): Grant => {
    const e = d.escalation(id);
    if (!owner || d.localBrainOn()) return refusal('busy', 'le cerveau local est prioritaire');
    if (!e || e.machine !== 'local' || e.source === 'ask' || e.intent !== 'decision' || !e.questions.length) return refusal('invalid', 'escalade non délégable');
    if (e.state !== 'pending' || leases.has(id)) return refusal('busy', 'escalade déjà prise');
    const deadline = now() + REMOTE_GRACE_MS;
    const l: Lease = { owner, token: token(), deadline, applying: false, ended: false, timer: setTimeout(() => {}, 0) };
    clearTimeout(l.timer);
    l.timer = setTimeout(() => stop(id, l), REMOTE_LEASE_MS); l.timer.unref?.();
    leases.set(id, l);
    const graceUntil = new Date(deadline).toISOString();
    if (!d.patch(id, { state: 'grace', graceUntil })) { stop(id, l); return refusal('failed', 'escalade disparue'); }
    return { ok: true, token: l.token, graceUntil };
  };
  const decide = async (id: string, owner: string, claimedToken: string, answers: Record<string, string>, category: string): Promise<Outcome> => {
    const l = leases.get(id); const e = d.escalation(id);
    if (!l || l.owner !== owner || l.token !== claimedToken || l.ended) return refusal('invalid', 'concession absente ou expirée');
    if (!e || e.state === 'answered' || e.state === 'closed') return refusal('already_answered', 'déjà répondue');
    if (l.applying) return refusal('already_answered', 'réponse en cours');
    if (d.localBrainOn()) { stop(id, l); return refusal('busy', 'le cerveau local est prioritaire'); }
    if (now() < l.deadline) return refusal('too_early', 'la grâce est en cours');
    const verdict = guardDecide(e, category, answers, d.mandate());
    if (!verdict.ok) return refusal('mandate', verdict.reason);
    const bad = validAnswers(e, answers); if (bad) return refusal('invalid', bad);
    // A previously created reply could belong to an unacknowledged or competing answer; never infer authorship from a 409.
    if (d.hasReplyRow(id)) return refusal('unknown', 'une réponse antérieure doit être réconciliée');
    l.applying = true;
    let applied = false;
    try {
      const result = await d.answer(id, answers);
      if (!result.ok) return refusal(result.code, result.reason);
      // A positive delivery ends this lease even if a mirror update has not arrived yet.
      applied = true; l.ended = true; clearTimeout(l.timer); leases.delete(id);
      return { ok: true, status: 'applied', escalation: result.escalation };
    } catch {
      return refusal('unknown', 'résultat de livraison inconnu');
    } finally {
      l.applying = false;
      // Once the attempt has finished, a disconnected/expired owner must not leave an escalation in grace.
      if (l.ended && !applied) { const x = d.escalation(id); if (x?.state === 'grace') d.patch(id, { state: 'pending', graceUntil: undefined }); }
      else if (d.escalation(id)?.state === 'answered' || d.escalation(id)?.state === 'closed') stop(id, l);
    }
  };
  return {
    claim, decide,
    disconnect(owner: string) { for (const [id, l] of leases) if (l.owner === owner) stop(id, l); },
    close() { for (const [id, l] of leases) stop(id, l); }
  };
}

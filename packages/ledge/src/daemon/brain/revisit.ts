import type { Escalation, LedgeDecision } from '@ledge/protocol';
import { log } from '../../log.js';
import type { Answers } from '../openrig/answer.js';
import type { Bridge, EscalationPatch } from '../openrig/bridge.js';
import type { LedgeThread } from '../ledgeThread.js';
import type { BrainEvent } from './inbox.js';
import type { Memory } from './memory.js';

export type RevisitResult = { ok: boolean; reason?: string };
export interface Revisit { revisit(decisionId: string, text?: string): Promise<RevisitResult> }

export interface RevisitDeps {
  memory: Pick<Memory, 'decisions'>;
  escalations: { escalation(id: string): Escalation | undefined; patchEscalation(id: string, p: EscalationPatch): Escalation | undefined };
  answers: Pick<Answers, 'correct'>;
  thread: Pick<LedgeThread, 'append'>;
  inbox: { push(e: BrainEvent): boolean };
  brainOn: () => boolean;
  bridge: Pick<Bridge, 'replyRow' | 'replyClaimed'>;
}

/** The bubble when the seat already acted and no brain can talk it through. */
export const claimedLine = (seat: string): string => `${seat} a déjà agi sur cette décision. Écris-lui avec @${seat} pour la défaire.`;

/**
 * « Revenir dessus » (spec §6): a decision, Ledge's or the user's, taken back.
 * - Reply row not yet claimed by the seat: the correction. With `text`, it leaves at once as the correction body; without, the card
 *   comes back (`pending`, `correcting` = the decision) with a new thread item, and the user's next answer goes through
 *   `answers.correct` (the first one wins). The decision recorder links the old decision to the new one (`markRevisited`).
 * - Claimed (or unknown: a row read as '?', none noted, an escalation forgotten): a conversation. The brain is asked to explain
 *   what undoing implies; without a brain, Ledge tells the user to write to the seat.
 */
export function createRevisit(d: RevisitDeps): Revisit {
  const fail = (reason: string): RevisitResult => ({ ok: false, reason });

  function conversation(dec: LedgeDecision, e: Escalation | undefined, text?: string): RevisitResult {
    const t = text?.trim() ? text : undefined;
    if (d.brainOn()) {
      let pushed = false;
      try { pushed = d.inbox.push({ kind: 'revisit', decision: dec, claimed: true, ...(t !== undefined ? { text: t } : {}) }); }
      catch (err) { log(`brain: revisit push failed: ${(err as Error).message}`); }
      if (pushed) return { ok: true };
    }
    const seat = dec.from ?? e?.from;
    if (!seat) return fail("le siège de cette décision n'est pas connu");
    d.thread.append({ kind: 'ledge', text: claimedLine(seat) });
    return { ok: true };
  }

  async function claimed(e: Escalation): Promise<boolean> {
    const row = d.bridge.replyRow(e.id);
    if (!row || row === '?') return true;
    try { return await d.bridge.replyClaimed(e.machine, row); }
    catch (err) { log(`brain: reply row ${row} unreadable, taken as claimed: ${(err as Error).message}`); return true; }
  }

  return {
    async revisit(decisionId, text) {
      const dec = d.memory.decisions().find(x => x.id === decisionId);
      if (!dec) return fail(`aucune décision ${decisionId}`);
      if (dec.revisitedBy) return fail('cette décision a déjà été revue');
      const e = d.escalations.escalation(dec.escalationId);
      if (e?.correcting) return fail('cette décision est déjà en cours de correction');
      if (!e || e.source === 'ask' || await claimed(e)) return conversation(dec, e, text);
      // The awaits are over: check again that nothing reopened it meanwhile.
      const cur = d.escalations.escalation(e.id);
      if (!cur || cur.correcting) return fail('cette décision est déjà en cours de correction');
      if (text?.trim()) {
        d.escalations.patchEscalation(cur.id, { correcting: dec.id });
        const r = await d.answers.correct(cur.id, { text });
        if (r.ok) return { ok: true };
        if (d.escalations.escalation(cur.id)?.correcting === dec.id) d.escalations.patchEscalation(cur.id, { correcting: undefined });
        return fail(r.reason);
      }
      d.escalations.patchEscalation(cur.id, { state: 'pending', correcting: dec.id, answer: undefined, graceUntil: undefined });
      // The thread holds this escalation already (the server never adds it twice): the reopened card gets its own item.
      d.thread.append({ kind: 'escalation', escalationId: cur.id });
      return { ok: true };
    },
  };
}

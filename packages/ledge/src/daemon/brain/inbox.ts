import { randomUUID } from 'node:crypto';
import type { Escalation, LedgeDecision, LedgeRule, LedgeThreadItem } from '@ledge/protocol';
import { ledgeBody } from '../crossSession.js';
import type { Mailbox } from '../mailbox.js';

/** What the brain is told: each event becomes one line typed into its session. */
export type BrainEvent =
  | { kind: 'escalation'; escalation: Escalation; rules: LedgeRule[] }
  | { kind: 'user'; item: Extract<LedgeThreadItem, { kind: 'user' }>; about?: Escalation }
  | { kind: 'state'; text: string }
  | { kind: 'answered'; escalation: Escalation }
  | { kind: 'refused'; escalationId: string; reason: string }
  | { kind: 'revisit'; decision: LedgeDecision; claimed: boolean; text?: string };

/** A field on one line: `ledgeBody` turns line breaks into ` ⏎ ` and `<` into `‹`; the line itself starts with the tag, never with `!`; a `!` that opens a line of the original text is made fullwidth (Claude's bash mode). */
const f = (s: string): string => ledgeBody(s).replace(/\s+/g, ' ').trim().replace(/(^|⏎ )!/g, '$1！');
const wrap = (kind: string, id: string, parts: Array<string | undefined>): string =>
  `<ledge-event kind="${f(kind).replace(/"/g, '')}" id="${f(id).replace(/"/g, '')}">${parts.filter((p): p is string => !!p).join(' | ')}</ledge-event>`;

const answerOf = (e: Escalation): string => Object.entries(e.answer?.answers ?? {}).map(([q, o]) => `${q}=${o}`).join(', ');

function escalation(e: Escalation, rules: LedgeRule[]): string {
  const asked = e.source === 'ask';
  const qs = e.questions.map(q => `${f(q.id)} « ${f(q.question)} » : ${q.options.map(o => `${f(o.id)} = ${f(o.label)}${o.recommended ? ' (recommandée)' : ''}`).join(' ; ')}`).join(' || ');
  return wrap('escalation', e.id, [
    `${asked ? 'Question libre' : 'Escalade'} ${f(e.id)} de ${f(e.from)} (source ${e.source}${e.rigId ? `, rig ${f(e.rigId)}` : ''}, intention ${e.intent})`,
    `Résumé : ${f(e.summary)}`, e.detail ? `Détail : ${f(e.detail)}` : undefined,
    qs ? `Questions : ${qs}` : undefined,
    e.graceUntil ? `Tu as jusqu'à ${e.graceUntil}` : undefined,
    rules.length ? `Règles de la catégorie : ${rules.map(r => f(r.text)).join(' ; ')}` : undefined,
    asked
      ? `Pour information, sans réponse à choix : donne ton avis avec \`ledge brain ask ${f(e.id)} --category <cat> --advice "…"\`, ou parle à l'utilisateur avec \`ledge brain say "…"\`.`
      : `Tranche avec \`ledge brain decide ${f(e.id)} --answer q1=<option> --category <cat> --why "…"\`, ou remonte avec \`ledge brain ask ${f(e.id)} --category <cat> --advice "…"\`.`]);
}

export function formatBrainEvent(e: BrainEvent): string {
  switch (e.kind) {
    case 'escalation': return escalation(e.escalation, e.rules);
    case 'user': return wrap('user', e.item.id, [
      `L'utilisateur t'écrit${e.item.to ? ` (à ${f(e.item.to)})` : ''} : ${f(e.item.text)}`,
      e.about ? `À propos de l'escalade ${f(e.about.id)} : ${f(e.about.summary)}` : undefined,
      'Réponds-lui avec `ledge brain say "…"`.']);
    case 'state': return wrap('state', `s-${randomUUID().slice(0, 6)}`, [f(e.text)]);
    case 'answered': return wrap('answered', e.escalation.id, [
      `L'escalade ${f(e.escalation.id)} (${f(e.escalation.summary)}) a reçu sa réponse${e.escalation.answer ? ` de ${e.escalation.answer.by === 'user' ? "l'utilisateur" : 'Ledge'}` : ''}${answerOf(e.escalation) ? ` : ${f(answerOf(e.escalation))}` : ''}.`,
      "Rien à faire, retiens-le pour la suite."]);
    case 'refused': return wrap('refused', e.escalationId, [
      `Ta décision sur ${f(e.escalationId)} est refusée par le garde : ${f(e.reason)}. Elle est devenue une remontée à l'utilisateur.`,
      `Complète ton avis avec \`ledge brain ask ${f(e.escalationId)} --category <cat> --advice "…"\`.`]);
    case 'revisit': return wrap('revisit', e.decision.id, [
      `L'utilisateur veut revenir sur ta décision ${f(e.decision.id)} (${f(e.decision.summary)}, réponses ${f(Object.entries(e.decision.answers).map(([q, o]) => `${q}=${o}`).join(', '))})${e.text ? ` : ${f(e.text)}` : ''}.`,
      e.claimed
        ? "Le seat l'a déjà pris en compte : explique-lui avec `ledge brain say \"…\"`, puis `propose` ou `send` seulement avec l'accord de l'utilisateur."
        : "La réponse n'est pas encore partie : elle sera corrigée ; explique-toi avec `ledge brain say \"…\"` si besoin."]);
  }
}

export function createBrainInbox(d: { mailbox: Pick<Mailbox, 'notify'>; brainId: () => string | undefined }): { push(e: BrainEvent): boolean } {
  return {
    push(e) {
      const to = d.brainId();
      if (!to) return false;
      return d.mailbox.notify(to, formatBrainEvent(e), `brain-inbox-${randomUUID()}`, { first: e.kind === 'user' });
    }
  };
}

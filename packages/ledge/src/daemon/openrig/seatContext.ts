import { mandateEntries } from '../brain/mandate.js';

const DEFAULT_SELF = 'git et branches, tests et relectures, contexte et relèves, petits choix de code';
const DEFAULT_USER = 'design, architecture, critique (données, sécurité, suppression, coûts)';

const sentences = (self: readonly string[] | string, user: readonly string[] | string): string =>
  `Ledge tranche seul : ${typeof self === 'string' ? self : self.join(', ')}.\nTe reviennent toujours, via Ledge, à l'utilisateur : ${typeof user === 'string' ? user : user.join(', ')}.`;

/**
 * What Ledge decides alone and what always goes to the user, in two sentences. `text` is mandat.md (null: none yet, the
 * default mandate). Lines are `- <id> : <description>` under the headings « Ledge tranche seul » and « Te revient
 * toujours »; design, architecture and critical go to the user whatever list they sit in.
 */
export function mandateSummary(text: string | null): string {
  if (text === null) return sentences(DEFAULT_SELF, DEFAULT_USER);
  const e = mandateEntries(text);
  const toUser = [...e.user, ...e.always].map(x => x.said);
  if (e.self.length === 0) return "Ledge ne tranche rien seul : tout revient, via Ledge, à l'utilisateur.";
  return sentences(e.self.map(x => x.said), toUser.length ? toUser : DEFAULT_USER);
}

/** Ledge reads the OpenRig queue directly; the required Slack binding is deliberately inert. */
export function ledgeContact(human: string): string {
  return `Pour contacter Ledge, crée une entrée dans la file OpenRig vers ${human}. Pour un compte rendu, utilise --human-intent update ; pour une décision, --human-intent decision avec les questions structurées. Fournis --summary, --body-file et --evidence-ref comme demandé par rig queue create --help. Ledge lit la file directement : le connecteur Slack non configuré est intentionnel et son état ne prouve pas que le message est perdu. Vérifie que la ligne existe et reste ouverte ; une confirmation de réception par Ledge est distincte de sa création.`;
}

/** What an OpenRig seat (one Ledge did not launch) is told at SessionStart: who its human is, how to escalate, the mandate. */
export function rigSeatContext(p: { seat: string; rig: string; human: string; mandate: string }): string {
  return [
    `Tu es ${p.seat}, siège du rig ${p.rig}.`,
    `Ton humain est Ledge (${p.human}) : il lit tes escalades et tranche pour l'utilisateur, ou les lui remonte.`,
    `Pour une décision qui ne t'appartient pas, escalade vers ${p.human} avec le skill messaging-the-human d'OpenRig (\`rig queue create --destination ${p.human} --human-intent decision …\`).`,
    ledgeContact(p.human),
    p.mandate,
  ].join('\n');
}

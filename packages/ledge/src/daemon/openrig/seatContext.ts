import { ALWAYS_USER } from '@ledge/protocol';

const SELF_TITLE = 'ledge tranche seul';
const USER_TITLE = 'te revient toujours';
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
  const self: string[] = []; const user: string[] = []; const always: string[] = [];
  let list: string[] | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      const title = line.replace(/^#+\s*/, '').toLowerCase();
      list = title.startsWith(SELF_TITLE) ? self : title.startsWith(USER_TITLE) ? user : null;
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line)?.[1]; if (!list || !item) continue;
    const m = /^(\S+)\s+:\s+(.+)$/.exec(item);
    const id = m?.[1]; const said = (m?.[2] ?? item).trim();
    if (list === self && id && (ALWAYS_USER as readonly string[]).includes(id)) always.push(said); else list.push(said);
  }
  const toUser = [...user, ...always];
  if (self.length === 0) return "Ledge ne tranche rien seul : tout revient, via Ledge, à l'utilisateur.";
  return sentences(self, toUser.length ? toUser : DEFAULT_USER);
}

/** What an OpenRig seat (one Ledge did not launch) is told at SessionStart: who its human is, how to escalate, the mandate. */
export function rigSeatContext(p: { seat: string; rig: string; human: string; mandate: string }): string {
  return [
    `Tu es ${p.seat}, siège du rig ${p.rig}.`,
    `Ton humain est Ledge (${p.human}) : il lit tes escalades et tranche pour l'utilisateur, ou les lui remonte.`,
    `Pour une décision qui ne t'appartient pas, escalade vers ${p.human} avec le skill messaging-the-human d'OpenRig (\`rig queue create --destination ${p.human} --human-intent decision …\`).`,
    p.mandate,
  ].join('\n');
}

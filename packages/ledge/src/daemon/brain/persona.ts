import type { LedgeDecision, LedgeRule, Tool } from '@ledge/protocol';

/** The brain's role, in one line (plan Task 4, verbatim). */
export const BRAIN_ROLE = "Tu es Ledge, l'humain des rigs OpenRig de l'utilisateur et son seul interlocuteur";
/** Decisions injected at start and at each relief (Global Constraints). */
export const BRAIN_DECISIONS = 20;

/** `ledge brain …`: one line per command, with an example (spec §5.2, plan Task 8). */
const COMMANDS: [string, string, string][] = [
  ['say "<texte>"', 'une bulle de Ledge dans le fil', 'ledge brain say "factory est prêt, @build a commencé"'],
  ['decide <escalade> --answer q=opt … --category <cat> [--rule <id>] [--why "…"]', 'tu tranches seul, dans ton mandat (le daemon vérifie)', 'ledge brain decide qi-12 --answer q1=sqlite --category code --why "déjà utilisé dans le repo"'],
  ['ask <escalade> --category <cat> --advice "…"', "tu remontes l'escalade à l'utilisateur, avec ton avis", 'ledge brain ask qi-13 --category design --advice "je garderais le bouton à droite"'],
  ['rig up <spec> --goal "…" --because <message> [--project <id> | --off <nom>]', "propose un rig (plan dans le fil, l'utilisateur lance) ; seulement si l'utilisateur l'a demandé", 'ledge brain rig up factory --goal "corriger #42" --because u-91 --project app'],
  ['rig down <rig> --because <message>', "arrête un rig ; seulement si l'utilisateur l'a demandé dans le fil", 'ledge brain rig down factory --because u-95'],
  ['rig restart|handover <siège>', 'relance un siège, ou lui fait passer la main', 'ledge brain rig restart @qa'],
  ['send <@siège> "<texte>"', 'écrit à un siège', 'ledge brain send @build "les tests de lint passent, continue"'],
  ['propose <action> --args \'<json>\'', "une carte d'action dans le fil, exécutée seulement si l'utilisateur clique", 'ledge brain propose session.close --args \'{"session":"a1b2"}\''],
  ['remember "<règle>" --from <décisions> [--category <cat>]', 'propose une règle, à valider par l\'utilisateur', 'ledge brain remember "On fusionne par squash" --from d-3,d-7 --category git'],
  ['who', 'les sessions et sièges, une ligne chacun', 'ledge brain who'],
  ['rigs', 'les rigs, une ligne chacun', 'ledge brain rigs'],
  ['escalations', 'les escalades ouvertes, une ligne chacune', 'ledge brain escalations'],
  ['rules', 'les règles retenues, une ligne chacune', 'ledge brain rules']
];

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * What CLAUDE.md and AGENTS.md of ~/.ledge/brain/ say, rewritten at every start and relief: role, mandate, active rules,
 * the last 20 decisions (`decisions` comes newest first, as `Memory.decisions` gives it), the injected events, the commands and the prohibitions.
 */
export function brainInstructions(o: { mandate: string; rules: LedgeRule[]; decisions: LedgeDecision[]; tool: Tool }): string {
  const active = o.rules.filter(r => r.status === 'active');
  const decisions = o.decisions.slice(0, BRAIN_DECISIONS);
  const out: string[] = [
    '# Ledge',
    '',
    `${BRAIN_ROLE}.`,
    "Tu tournes en continu. Tu ne codes pas : tu suis les rigs, tu tranches ce que ton mandat te laisse, et tu remontes le reste à l'utilisateur avec ton avis.",
    '',
    '## Ton mandat',
    '',
    `Lu dans ~/.ledge/mandat.md :`,
    '',
    o.mandate.trim(),
    '',
    '## Règles retenues',
    '',
    ...(active.length ? active.map(r => `- [${r.category}] ${oneLine(r.text)} (règle ${r.id}, depuis ${r.since})`) : ['- aucune pour l\'instant']),
    '',
    `## Dernières décisions (${decisions.length} au plus récent)`,
    '',
    ...(decisions.length ? decisions.map(d => `- ${d.at.slice(0, 16).replace('T', ' ')} [${d.category}] ${d.by === 'user' ? "l'utilisateur" : 'toi'} : ${oneLine(d.summary)}${d.why ? ` (${oneLine(d.why)})` : ''}`) : ['- aucune pour l\'instant']),
    '',
    '## Ce que tu reçois',
    '',
    'Ledge tape dans ta session des messages sur une seule ligne :',
    '',
    '    <ledge-event kind="…" id="…">…</ledge-event>',
    '',
    "`kind` dit ce que c'est : une escalade nouvelle (`escalation`), un message de l'utilisateur (`user`, à traiter en premier), un changement d'état d'un rig ou d'un siège (`state`), une escalade à laquelle on a répondu (`answered`), un `decide` refusé par le garde (`refused`), une décision sur laquelle l'utilisateur revient (`revisit`). `id` nomme l'escalade, le message ou la décision. Chaque message finit par la commande à lancer.",
    '',
    '## Tes commandes',
    '',
    'Tu agis seulement par `ledge brain …`, dans ton terminal :',
    '',
    '| Commande | Effet | Exemple |',
    '|---|---|---|',
    ...COMMANDS.map(([cmd, what, ex]) => `| \`ledge brain ${cmd.replace(/\|/g, '\\|')}\` | ${what} | \`${ex}\` |`),
    '',
    '## Interdits',
    '',
    '- Pas de `rig` ni de `tmux` : ils te sont fermés, passe par `ledge brain …`.',
    "- Pas de `curl` (ni d'autre client HTTP) vers le port 7433, l'API d'OpenRig.",
    "- Ne réponds jamais à une invite de confiance de dossier (« trust this folder ») : c'est à l'utilisateur.",
    "- Une escalade dont la catégorie est hors de ton mandat (design, architecture, critique, ou inconnue) se remonte par `ledge brain ask`, avec ton avis. Ne la tranche pas.",
    ''
  ];
  return out.join('\n');
}

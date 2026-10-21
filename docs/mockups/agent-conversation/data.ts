// The mockup's fleet: Otto and Nova on the Ledge repository of this machine, talking about a protocol field; Iris and Rio
// around them for the sidebar. Times are relative to the page's opening, so « il y a » reads right whenever it is opened.
import type { Projects, SentItem, Session, ThreadItem } from '@ledge/protocol';

const opened = Date.now();
/** An instant `min` minutes before the page opened. */
const T = (min: number) => new Date(opened + min * 60_000).toISOString();
const now = () => new Date().toISOString();

const session = (id: string, extra: Partial<Session>): Session => ({
  id: `local:${id}`, name: id, tool: 'claude', cwd: '/home/jde/soft/ledge', project: 'ledge', repo: 'ledge', title: '', tmuxSession: `ledge-${id}`,
  state: 'working', helpers: [], startedAt: T(-90), lastActivityAt: T(-1), source: 'launcher', machineId: 'local', ...extra
});

export const OTTO = session('otto', { name: 'Otto', title: 'Otto · ledge', topic: 'Heure de lecture des messages', branch: 'feat/read-at-card', lastActivityAt: T(-0.5) });
export const NOVA = session('nova', { name: 'Nova', title: 'Nova · ledge', topic: 'Schéma v3 et readAt', branch: 'feat/read-at', lastActivityAt: T(-3) });
const IRIS = session('iris', { name: 'Iris', title: 'Iris · ledge', topic: 'Relire la PR #208', branch: 'main', state: 'idle', lastActivityAt: T(-26) });
const RIO = session('rio', {
  name: 'Rio', title: 'Rio · docs', topic: 'Guide d’installation', cwd: '/home/jde/soft/docs', project: 'docs', repo: 'docs', branch: 'main',
  state: 'waiting_input', pending: { kind: 'question', text: 'Je garde la section Windows ?', source: 'hook' }, lastActivityAt: T(-7)
});
export const sessionsFor = (withNova: boolean): Session[] => (withNova ? [OTTO, NOVA, IRIS, RIO] : [OTTO, IRIS, RIO]);

export const PROJECTS: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/home/jde/soft/ledge' }] },
    { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [{ machine: 'local', path: '/home/jde/soft/docs' }] }
  ],
  rules: []
} as Projects;

const tool = (id: string, min: number, turn: number, name: string, label: string, extra: Partial<Extract<ThreadItem, { kind: 'tool' }>> = {}): ThreadItem =>
  ({ kind: 'tool', id, at: T(min), turn, tool: name, label, status: 'success', durationMs: 400, files: [], ...extra });
const edit = (id: string, min: number, turn: number, path: string): ThreadItem =>
  tool(id, min, turn, 'Edit', path, { files: [{ path, change: 'edit', diff: '- a\n+ b' }] });

const SRC = '/home/jde/soft/ledge/apps/desktop/src';

// The messages, written once: Otto's thread receives Nova's, Nova's thread receives Otto's.
const S1 = 'Pour afficher l’heure de lecture dans la carte d’un message envoyé, il me faudrait un champ `readAt` sur l’élément `sent`. Tu peux le poser quand le daemon apparie le message reçu ?';
const N1 = 'Oui, c’est simple : je le pose dans `pairing.ts` au moment où je marque le message `read`. Je te fais signe dès que c’est poussé.';
const N2 = [
  'C’est poussé sur `feat/read-at`. Ce qui change :',
  '',
  '- `sent.readAt` : l’instant où le hook de l’autre agent a livré le message, posé une seule fois, en même temps que `status: \'read\'` ;',
  '- il n’existe que pour un message lu : `delivered` et `failed` n’en ont jamais ;',
  '- les fils déjà enregistrés n’en ont pas, la carte doit garder « lu » sans heure dans ce cas ;',
  '- le schéma l’accepte en optionnel, les tests du daemon couvrent l’appariement et le rechargement.',
  '',
  'Dis-moi si tu veux aussi l’heure de remise (`deliveredAt`), c’est au même endroit.'
].join('\n');
const S2 = 'Merci ! `readAt` est bien au même format que `at` (ISO, UTC) ? Pas besoin de `deliveredAt` pour l’instant.';
const N3 = 'Oui, ISO 8601 en UTC, exactement comme `at`. Je laisse `deliveredAt` de côté.';
const S3 = 'Les tests de la carte passent avec `readAt`. J’ai ouvert la PR #212 : tu peux la relire quand tu as un moment ?';
const N4 = 'Je relis la PR #212 après ma migration. Une remarque déjà : dans `en.ts`, garde « read » seul quand l’heure manque, comme en français.';
const S4 = 'J’ai ajouté le libellé anglais (« read at … »). Je relance les tests et je pousse sur la PR.';
const N5 = 'PR #212 relue : c’est bon pour moi. Deux détails dans les commentaires, rien de bloquant.';

/** The live part, step by step (« Simuler la suite »): 0 as the page opens, then each step one event of the two threads. */
export const STEPS = 5;
export const STEP_LABELS = {
  fr: ['Le message d’Otto est remis à Nova', 'Otto reçoit le message de Nova', 'Nova lit le message d’Otto', 'Nova répond', 'Otto reçoit la réponse'],
  en: ['Otto’s message reaches Nova', 'Otto receives Nova’s message', 'Nova reads Otto’s message', 'Nova replies', 'Otto receives the reply']
} as const;

export interface Threads { otto: ThreadItem[]; nova: ThreadItem[] }

/** Both threads after `step` events; `stamps` holds the instant each event happened (kept across renders). */
export function threadsAt(step: number, stamps: string[]): Threads {
  const at = (k: number) => stamps[k] ?? now();
  const s4: SentItem = { kind: 'sent', id: 's4', at: T(-1), turn: 5, to: 'nova', peer: 'nova', summary: 'Libellé anglais ajouté', text: S4, status: step >= 3 ? 'read' : step >= 1 ? 'delivered' : 'sending', ...(step >= 3 && { received: 'recv-5-0' }) };
  const otto: ThreadItem[] = [
    { kind: 'prompt', id: 'p1', at: T(-40), turn: 1, text: 'Dans la carte d’un message envoyé, affiche l’heure à laquelle il a été lu. Vois avec Nova pour le protocole.' },
    tool('t1', -39.6, 1, 'Read', `${SRC}/session/MessageCard.tsx`),
    tool('t2', -39.4, 1, 'Grep', 'status: z.enum'),
    { kind: 'message', id: 'm1', at: T(-39), turn: 1, text: 'Le protocole ne garde pas l’heure de lecture d’un message. Je demande à Nova, qui tient le daemon.' },
    { kind: 'sent', id: 's1', at: T(-38), turn: 1, to: 'nova', peer: 'nova', summary: 'Heure de lecture dans le protocole ?', text: S1, status: 'read', received: 'recv-2-0' },
    { kind: 'reply', id: 'rp1', at: T(-37.5), turn: 1, text: 'J’ai écrit à Nova pour le champ `readAt`. J’attends sa réponse avant de toucher la carte.' },
    { kind: 'received', id: 'recv-2-0', at: T(-36), turn: 2, from: 'nova', peer: 'nova', text: N1, sent: 'nova-s1' },
    edit('t3', -35, 2, `${SRC}/session/MessageCard.tsx`),
    { kind: 'reply', id: 'rp2', at: T(-34), turn: 2, text: 'Nova ajoute `readAt` côté daemon. Je prépare la carte en attendant.' },
    { kind: 'received', id: 'recv-3-0', at: T(-21), turn: 3, from: 'nova', peer: 'nova', text: N2, sent: 'nova-s2' },
    tool('t4', -20, 3, 'Read', '/home/jde/soft/ledge/packages/protocol/src/thread.ts'),
    { kind: 'sent', id: 's2', at: T(-19), turn: 3, to: 'nova', peer: 'nova', text: S2, status: 'read', received: 'recv-3-0' },
    { kind: 'received', id: 'recv-4-0', at: T(-18), turn: 4, from: 'nova', peer: 'nova', text: N3, sent: 'nova-s3' },
    edit('t5', -16, 4, `${SRC}/session/MessageCard.tsx`),
    edit('t6', -15, 4, `${SRC}/i18n/fr.ts`),
    tool('t7', -14, 4, 'Bash', 'pnpm --filter desktop test', { durationMs: 41_000 }),
    { kind: 'sent', id: 's3', at: T(-9), turn: 4, to: 'nova', peer: 'nova', summary: 'Tests verts, PR #212 ouverte', text: S3, status: 'read', received: 'recv-4-0' },
    { kind: 'reply', id: 'rp4', at: T(-8.5), turn: 4, text: 'La carte affiche « lu à … » quand l’heure est connue, et « lu » seul pour les anciens fils. PR #212 ouverte ; Nova la relira.' },
    { kind: 'prompt', id: 'p5', at: T(-5), turn: 5, text: 'Ajoute aussi le libellé anglais, puis préviens Nova.' },
    edit('t8', -4, 5, `${SRC}/i18n/en.ts`),
    s4,
    tool('t9', -0.5, 5, 'Bash', 'pnpm --filter desktop test', step >= 2 ? { durationMs: 38_000 } : { status: 'running', durationMs: undefined })
  ];
  if (step >= 2) otto.push({ kind: 'received', id: 'recv-6-0', at: at(1), turn: 6, from: 'nova', peer: 'nova', text: N4, sent: 'nova-s4' });
  if (step >= 5) otto.push({ kind: 'received', id: 'recv-7-0', at: at(4), turn: 7, from: 'nova', peer: 'nova', text: N5, sent: 'nova-s5' });

  // Nova's own ids collide with Otto's (`recv-<turn>-<i>` is unique per thread only): the pane keys by thread.
  const nova: ThreadItem[] = [
    { kind: 'prompt', id: 'p1', at: T(-60), turn: 1, text: 'Passe le schéma des sessions en v3 et garde la compatibilité des fils enregistrés.' },
    { kind: 'received', id: 'recv-2-0', at: T(-36.6), turn: 2, from: 'otto', peer: 'otto', text: S1, sent: 's1' },
    { kind: 'sent', id: 'nova-s1', at: T(-36.2), turn: 2, to: 'otto', peer: 'otto', text: N1, status: 'read', received: 'recv-2-0' },
    { kind: 'sent', id: 'nova-s2', at: T(-21.2), turn: 2, to: 'otto', peer: 'otto', summary: 'readAt poussé sur feat/read-at', text: N2, status: 'read', received: 'recv-3-0' },
    { kind: 'received', id: 'recv-3-0', at: T(-18.8), turn: 3, from: 'otto', peer: 'otto', text: S2, sent: 's2' },
    { kind: 'sent', id: 'nova-s3', at: T(-18.2), turn: 3, to: 'otto', peer: 'otto', text: N3, status: 'read', received: 'recv-4-0' },
    { kind: 'received', id: 'recv-4-0', at: T(-8.6), turn: 4, from: 'otto', peer: 'otto', text: S3, sent: 's3' },
    { kind: 'sent', id: 'nova-s4', at: T(-3), turn: 4, to: 'otto', peer: 'otto', summary: 'Je relis la PR #212', text: N4, status: step >= 2 ? 'read' : 'delivered', ...(step >= 2 && { received: 'recv-6-0' }) }
  ];
  if (step >= 3) nova.push({ kind: 'received', id: 'recv-5-0', at: at(2), turn: 5, from: 'otto', peer: 'otto', text: S4, sent: 's4' });
  if (step >= 4) nova.push({ kind: 'sent', id: 'nova-s5', at: at(3), turn: 5, to: 'otto', peer: 'otto', summary: 'PR #212 relue', text: N5, status: step >= 5 ? 'read' : 'delivered', ...(step >= 5 && { received: 'recv-7-0' }) });
  return { otto, nova };
}

/** The peer is not a session Ledge knows here (another machine, or a Claude process Ledge did not launch): Otto's thread
 *  names it by its raw Claude name, unresolved, unpaired, never « read »; Nova's thread is not there. */
export const RAW_PEER = 'harness-assistant-bf';
export function oneSided({ otto }: Threads): Threads {
  return {
    otto: otto.map(i => {
      if (i.kind === 'sent') { const { peer: _p, received: _r, ...rest } = i; return { ...rest, to: RAW_PEER, status: i.status === 'read' ? 'delivered' : i.status }; }
      if (i.kind === 'received') { const { peer: _p, sent: _s, ...rest } = i; return { ...rest, from: RAW_PEER }; }
      return i;
    }),
    nova: []
  };
}

/** Both agents ran /clear since: their threads start over, the conversation is gone from them. */
export function cleared(): Threads {
  return {
    otto: [
      { kind: 'prompt', id: 'p1', at: T(-2), turn: 1, text: 'On repart de zéro : relis les remarques sur la PR #212 et corrige-les.' },
      tool('t1', -1.5, 1, 'Bash', 'gh pr view 212 --comments', { durationMs: 1200 }),
      tool('t2', -0.5, 1, 'Read', `${SRC}/i18n/en.ts`, { status: 'running', durationMs: undefined })
    ],
    nova: []
  };
}

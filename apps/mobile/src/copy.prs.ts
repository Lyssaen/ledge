// The MR/PR tab's French words (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html and its handover sheet): the mockup's words, then
// Desktop's `forge.*` (apps/desktop/src/i18n/fr.ts) passed to « tu ». Kept apart from copy.ts so the other lots' sections stay
// untouched; copy.ts spreads them into its `prs` section. English: copy.prs.en.ts.
import type { ForgeKind, PipeStatus, PrState } from '@ledge/protocol';

const plural = (n: number, one: string, many: string) => (n <= 1 ? one : many);

export const prsFr = {
  host: { github: 'GitHub', gitlab: 'GitLab' } as Record<ForgeKind, string>,
  /** What a forge calls its requests. */
  kind: { github: 'PR', gitlab: 'MR' } as Record<ForgeKind, string>,
  /** §1: the list. */
  openHead: (n: number) => `Ouvertes · ${n}`,
  asOf: (t: string) => `relevé ${t}`,
  state: { draft: 'brouillon', open: 'ouverte', review: 'en revue', merged: 'fusionnée', closed: 'fermée' } as Record<PrState, string>,
  /** The pipeline's chip in a row and in À toi. */
  pipeline: { ok: 'pipeline réussi', run: 'pipeline en cours', fail: 'pipeline échoué', wait: 'pipeline en attente', skip: 'pipeline ignoré', none: 'sans CI' } as Record<PipeStatus, string>,
  /** The pipeline's and a job's state, beside « Pipeline » and in a job's row. */
  pipe: { ok: 'réussi', run: 'en cours', fail: 'échoué', wait: 'en attente', skip: 'ignoré', none: 'aucun' } as Record<PipeStatus, string>,
  threads: (n: number) => plural(n, `${n} discussion ouverte`, `${n} discussions ouvertes`),
  ready: 'prête à fusionner',
  closedGroup: (n: number) => `Fusionnées et fermées (${n})`,
  /** A day in a folded row: today's time, « hier », the weekday, or the date. */
  yesterday: 'hier',
  /** §2: the list's states. */
  error: (forge: string, pc: string, since: string) => `${forge} sur ${pc} : le relevé échoue depuis ${since}.`,
  retryAt: (t: string) => `Nouvel essai à ${t}.`,
  readAt: (kind: string, t: string) => `Les ${kind} ci-dessous sont celles du relevé de ${t}.`,
  unauth: (cli: string, host: string, pc: string) => `${cli} n'est pas connecté à ${host} sur ${pc}. Dans un terminal de ${pc} :`,
  missing: (cli: string, pc: string, host: string, kind: string) => `${cli} n'est pas installé sur ${pc} : Ledge ne voit pas les ${kind} de ${host}.`,
  copy: 'Copier', copied: 'Commande copiée',
  loading: 'Chargement…',
  emptyTitle: 'Aucune MR ni PR ouverte',
  emptyBody: 'Ledge suit les branches des sessions et des sièges. Une MR ou PR ouverte depuis l\'une d\'elles apparaît ici.',
  emptyUnread: 'Ledge ne peut lire aucune forge pour l\'instant : voir ci-dessus.',
  /** Under the offline strip (« WSL ne répond plus »): Desktop's sentence, its time the list's. */
  offlineBody: (t: string) => `MR et PR au relevé de ${t}, sans action possible.`,
  /** §3: the overview. */
  openOn: (host: string) => `Ouvrir sur ${host}`,
  tabs: { overview: 'Vue d\'ensemble', discussion: 'Discussion', changes: 'Modifications', commits: 'Commits' },
  pipelineTitle: 'Pipeline',
  rerun: 'Relancer',
  /** GitLab's stages are numbered; GitHub's are its workflows, named as they are. */
  stage: (n: number, name: string) => `Étape ${n} · ${name}`,
  hours: (t: string) => `${t} h`,
  log: {
    title: (job: string) => `Journal de ${job}`,
    lines: '60 dernières lignes',
    reading: (job: string) => `Lecture du journal de ${job}…`,
    failed: 'Le journal n\'a pas pu être lu.',
    failedBody: (cli: string, host: string) => `${cli} n'a pas répondu. Réessaie, ou ouvre le job sur ${host}.`,
    note: 'Les 60 dernières lignes du job, sans couleurs, secrets masqués par le PC.',
    cut: (host: string) => `Il commence par « … » : le début est coupé, le journal entier est sur ${host}.`
  },
  noCi: 'Pas de CI sur ce dépôt.',
  notStarted: 'Aucun pipeline n\'a encore démarré sur le dernier commit.',
  description: 'Description', author: 'Auteur', reviewers: 'Relecteurs', labels: 'Étiquettes', issue: 'Ticket',
  reviewer: { approved: 'approuvé', changes: 'changements demandés', pending: 'attendu' },
  close: 'Fermer',
  /** §4: merging. */
  toMerge: 'Pour fusionner',
  ok: { pipeline: 'Pipeline réussi', noCi: 'Pas de CI sur ce dépôt', approved: (g: number, r: number) => `Approuvée (${g}/${r})`, noChanges: 'Aucun changement demandé' },
  blocker: {
    draft: (host: string) => `C'est un brouillon : marque-la prête sur ${host}.`, not_open: 'Elle est fermée.',
    approvals: (g: number, r: number) => `Il manque une approbation (${g}/${r}).`, changes_requested: (who: string) => `${who} demande des changements.`,
    pipeline_fail: 'Le pipeline a échoué.', pipeline_run: 'Le pipeline tourne encore.', pipeline_wait: 'Le pipeline est en attente.', pipeline_skip: 'Le pipeline a été sauté.',
    pipeline_not_started: 'Aucun pipeline n\'a encore démarré sur le dernier commit.'
  },
  /** The footer: « 1/1 approbation · le pipeline a échoué », or, ready, « Pipeline réussi · approuvée (1/1) ». */
  footApprovals: (appr: string) => `${appr} approbation`,
  merge: 'Fusionner',
  confirm: (ref: string, target: string) => `Fusionner ${ref} dans ${target} ?`,
  runsOn: (pc: string) => `Ledge lance, sur ${pc} :`,
  headRead: (sha: string) => `Sur la tête que tu as lue, ${sha}. Si la branche bouge d'ici là, rien n'est fusionné.`,
  cancel: 'Annuler',
  merging: 'Fusion…',
  answers: (cli: string) => `${cli} répond quand c'est fait`,
  merged: (ref: string) => `${ref} fusionnée`,
  mergedSub: (t: string, target: string) => `${t} · dans ${target}`,
  stale: (sha: string) => `La branche a bougé depuis ta lecture (nouveau commit ${sha}).`,
  staleBody: 'Relis-la avant de fusionner. Rien n\'a été fusionné.',
  reload: 'Relire',
  refused: (forge: string, why: string) => `${forge} refuse la fusion maintenant : ${why}`,
  failed: (cli: string) => `Échec : dernière ligne de ${cli}`,
  /** « Fil non résolu : dernière ligne de gh ». */
  lastLine: (cli: string) => `dernière ligne de ${cli}`,
  /** What did not happen, before the reason (« Pas fusionnée : la vérification Face ID a expiré. »). */
  notDone: { merge: 'Pas fusionnée', rerun: 'Relance refusée', comment: 'Non publié', reply: 'Non publié', resolve: 'Fil non résolu' },
  /** « Rien n'a été envoyé. Fusionne de nouveau pour vérifier encore. » */
  mergeAgain: 'Fusionne',
  keptText: 'Ton texte est gardé.',
  retry: 'Réessayer',
  gone: (kind: string, pc: string) => `Cette ${kind} n'est plus suivie sur ${pc}.`,
  goneBody: 'Sa branche n\'est plus celle d\'une session ou d\'un siège.',
  /** §5: rerun, ask to fix. */
  rerunTitle: (ref: string) => `Relancer le pipeline de ${ref} ?`,
  rerunBody: (forge: string) => `${forge} relance les jobs échoués, sous ton nom. Le PC vérifie d'abord que le pipeline ne tourne pas.`,
  rerunDone: (ref: string) => `Pipeline de ${ref} relancé`,
  rerunDoneSub: (t: string) => `${t} · la liste le montre en cours d'ici 15 s`,
  rerunRefused: (why: string) => `Relance refusée : ${why}`,
  rerunBusy: 'le pipeline tourne encore.',
  nothingToRerun: 'Rien à relancer : aucun job n\'a échoué sur le dernier commit.',
  askFix: (name: string) => `Demander à ${name} de corriger`,
  fixText: (ref: string, job: string) => `Le pipeline de ${ref} échoue sur « ${job} ». Lis le job, corrige et pousse.`,
  sentTo: (name: string) => `Envoyé à ${name}`,
  openAgent: (name: string) => `Ouvrir ${name}`,
  mostActive: 'la plus active',
  otherSession: 'Une autre session',
  noSession: (branch: string) => `Aucune session ne travaille sur ${branch} : personne à qui l'envoyer.`,
  /** §6: the discussion. */
  discSub: (open: number, resolved: number) => `${plural(open, `${open} ouvert`, `${open} ouverts`)} · ${plural(resolved, `${resolved} résolu`, `${resolved} résolus`)}`,
  sendAll: (name: string) => `Tout envoyer à ${name}`,
  fileLine: (file: string, n: number) => `${file} · ligne ${n}`,
  reply: 'Répondre', replyPh: 'Répondre…',
  sendTo: (name: string) => `Envoyer à ${name}`,
  resolve: 'Résoudre',
  resolvedRow: (parts: string[]) => ['Résolu', ...parts].join(' · '),
  addComment: 'Ajouter un commentaire…',
  post: 'Publier',
  postedAs: (host: string) => `Publié sous ton nom sur ${host}.`,
  commentSent: (name: string) => `Commentaire envoyé à ${name}`,
  replyPosted: (host: string) => `Réponse publiée sur ${host}`,
  commentPosted: (host: string) => `Commentaire publié sur ${host}`,
  noComment: 'Aucun commentaire.',
  /** What goes to the agent (Desktop's texts). */
  threadText: (ref: string, who: string, where: string | null, text: string) => `${ref} · ${who}${where ? ` sur ${where}` : ''} : ${text}`,
  notesText: (ref: string, notes: readonly string[]) => `Commentaires sur ${ref} : ${notes.join(' / ')}`,
  note: (who: string, where: string | null, text: string) => `${who}${where ? ` (${where})` : ''} : ${text}`,
  /** §7: changes and commits. */
  fileCount: (n: number) => plural(n, `${n} fichier`, `${n} fichiers`),
  fileThreads: (n: number) => plural(n, `${n} discussion`, `${n} discussions`),
  noPatch: (host: string) => `Diff trop lourd pour le téléphone : ouvre-le sur ${host}.`,
  noChange: 'Aucune modification.',
  today: (t: string) => `aujourd'hui ${t}`,
  yesterdayAt: (t: string) => `hier ${t}`,
  commitsReadOnly: (host: string) => `Lecture seule. Le détail d'un commit est sur ${host} (« Ouvrir sur ${host} », en haut à droite).`,
  /** §8: the detail's states. */
  detailLoading: 'L\'état du pipeline vient de la liste ; les jobs arrivent avec le détail.',
  cut: (host: string) => `Trop longue pour le téléphone : des commentaires, commits ou diffs anciens manquent. Tout est sur ${host}.`,
  readFailed: (cli: string, kind: string) => `${cli} n'a pas pu lire cette ${kind}.`,
  readFailedBody: 'Il a échoué ou n\'a pas répondu en 60 s.',
  tooLarge: 'Trop lourde pour le téléphone, même allégée.',
  tooLargeBody: (host: string) => `Ouvre-la sur ${host}.`,
  open: 'Ouvrir',
  mergedInto: (target: string, when: string) => `dans ${target} · ${when}`,
  /** §9: À toi and the session's foot. */
  atoi: { title: 'MR et PR', sub: 'pipelines échoués, prêtes à fusionner', ready: 'pipeline réussi, approuvée', readyNoCi: 'sans CI, approuvée' },
  chipUnknown: (kind: string) => `${kind} ?`,
  chipTip: (forge: string, pc: string, kind: string) => `${forge} ne se lit pas sur ${pc} : Ledge ne sait pas si cette branche a une ${kind}.`
};

export type PrsCopy = typeof prsFr;

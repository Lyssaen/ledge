# Ledge Desktop Atelier, lot 11 : Propositions de Ledge — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ledge propose des projets et l'utilisateur les vérifie.
- **Dans l'éditeur**, « Laisser Ledge faire » et « Demander à Ledge » proposent un nom, une couleur, et des dépôts cochables avec leur raison : même remote, dossiers ouverts par des agents, nommage commun.
- **Dans Réglages › Projets**, « Ledge, propose-moi des projets » en propose plusieurs d'un coup.
- **Dans le chat**, une réponse de Ledge peut porter une proposition de projet : « Vérifier la proposition » ouvre l'éditeur prérempli.
- Une proposition qui recoupe un projet existant devient « Ajouter à X ».
- **Rien n'est créé sans un clic**, ni projet, ni règle.

**Décision de l'utilisateur (2026-10-17) : les deux mécanismes.**
- Un **balayage déterministe** des machines sert « Laisser Ledge faire » et Réglages › Projets. Il est rapide, gratuit, et ses raisons sont exactes.
- Dans le **chat**, le LLM répond avec un bloc ` ```ledge-project `.

**Architecture:**
- **Daemon**
  - Un nouveau message `repos.scan` → `repos.found` rend les dépôts Git d'une machine, avec leur branche et leur remote normalisé.
  - Le parcours est borné en profondeur, en nombre de dossiers et en temps.
  - Le fleet le route par machine, comme `repos.inspect`.
- **Modèle pur** : `proposeProjects` dans `@ledge/fleet` regroupe les dépôts et les dossiers d'agents en propositions raisonnées.
- **Desktop**
  - L'éditeur gagne son mode proposition.
  - Les réglages gagnent le bloc de suggestions.
  - Le chat gagne une carte de projet et le lien qui ouvre l'éditeur.
- **Le daemon** valide le bloc du LLM.

**Tech Stack:** TypeScript, zod, Node (daemon), React 19, Vite 6, vitest 3 + Testing Library + jsdom, Playwright 1.49.

**Spec:**
- Build design : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md` §§ 2 (anti-objectif : rien créé sans clic), 5 et 7, lot 11.
- Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` §§ 4, 6 et 7.
- Maquette : `docs/mockups/desktop-observatory/projects.tsx` et `projects.css` :
  - fonctions : `groups`, `proposeFor`, `proposeFromChat` ;
  - éditeur : `ProjectEditor` en mode proposition, avec `.pe-scan`, `.pe-ledge`, `.pe-proposal`, `.pe-why` et `.pe-agents` ;
  - réglages : `LedgeSuggestions`.
- Maquette, côté `observatory.tsx` : `reviewProposal`, et le lien `ledge://project/` du panneau de chat.

## Global Constraints

- **Contraintes des lots 6a à 10, toutes** :
  - la maquette fait foi ;
  - les textes vont dans `i18n/fr.ts` et `i18n/en.ts`, `fr` source de vérité ;
  - l'anglais fixé par les tests est listé par tâche ;
  - rien d'optimiste, aucune nouvelle dépendance, pas de Tauri ni de Rust ;
  - suite unitaire en anglais ;
  - « en ligne » = `MachineState.ready` ;
  - le morceau principal reste sous 500 kB (il fait 451 kB), et ce qui est propre aux propositions va dans les morceaux paresseux existants (éditeur, réglages, chat) ;
  - les commits se terminent par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Rien n'est créé sans clic** : balayer, proposer et ouvrir l'éditeur n'écrivent rien. Seul le bouton de l'éditeur (« Créer le projet » / « Ajouter à X ») passe par `useProjectSave` du lot 8.
- **Un dépôt appartient à un seul projet** (règle du lot 8) :
  - un dépôt déjà dans un projet n'est jamais proposé ;
  - un dépôt pris entre-temps est signalé par `repo_taken` et bloque l'enregistrement tant qu'il est coché.
- **Le remote** ne voyage que normalisé par `repositoryId` (`packages/ledge/src/daemon/git.ts` : sans identifiants ni requête). Il ne sort jamais vers une autre machine et n'est pas journalisé.
- **Le bloc du LLM n'est pas fiable** : il est validé par zod, borné (nom 80, 50 dépôts, raison 200), et ses chemins sont vérifiés.

## Review Focus

1. **Le balayage d'un dossier personnel énorme ou d'un disque lent** reste borné : budget de dossiers, échéance, liste d'exclusions. Un résultat partiel est dit (« parcours limité »), et rien ne bloque. Test à la tâche 1.
2. **Un dépôt proposé qui a été pris par un autre projet** entre la proposition et la validation : la ligne affiche « déjà dans X », et l'enregistrement est refusé tant que la case est cochée. Test à la tâche 3.
3. **Une machine hors ligne, ou trop ancienne pour `repos.scan`**, pendant un balayage : son étape le dit (« hors ligne, ignorée » / « daemon trop ancien »), et les autres machines sont quand même proposées. Test aux tâches 1 et 3.
4. **Un bloc du LLM avec des chemins inventés ou absents, ou un projet cible qui n'existe plus** :
   - les chemins absents sont retirés ;
   - « Ajouter à » retombe sur un nouveau projet quand la cible a disparu ;
   - sans aucun dépôt valable, il n'y a pas de carte ;
   - rien ne casse.

   Test à la tâche 5.
5. **Deux propositions qui veulent le même dépôt** : chaque dépôt n'apparaît qu'une fois. Une fois l'une créée, les autres sont recalculées. Test aux tâches 2 et 4.

---

### Task 1: Le daemon balaie ses dépôts

**Files:**
- Create: `packages/protocol/src/scan.ts`, `packages/ledge/src/daemon/scan.ts`, `packages/ledge/test/scan.test.ts`
- Modify: `packages/protocol/src/{messages,index}.ts`, `packages/ledge/src/daemon/server.ts`, `packages/fleet/src/fleet.ts`, `packages/fleet/test/mockDaemon.ts`, et leurs tests

**Interfaces:**
- Produces :

```ts
// protocol/scan.ts
export const ReposScanSchema = z.object({ type: z.literal('repos.scan'), requestId: z.string().min(1).max(100), machineId: z.string().optional() });
export const FoundRepoSchema = z.object({ path: z.string(), branch: z.string().nullable(), remote: z.string().optional() });   // remote = repositoryId(url)
export const ReposFoundSchema = z.object({ type: z.literal('repos.found'), requestId: z.string(), repos: z.array(FoundRepoSchema).max(500), truncated: z.boolean(), error: z.string().optional() });
// daemon/scan.ts
export const SCAN_DEPTH = 4, SCAN_DIRS = 5000, SCAN_MS = 4000, SCAN_REPOS = 500;
export const SKIP: ReadonlySet<string>;   // node_modules, .git (on n'y descend pas), .cache, dist, build, target, vendor, __pycache__, venv, .venv, Library, AppData, et tout dossier caché
export async function scanRepos(opts: { home: string; extra?: readonly string[]; now?: () => number; readdir?: …; readFile?: … }): Promise<{ repos: FoundRepo[]; truncated: boolean }>;
```

**Règles du parcours** :
- **Point de départ** : le dossier personnel, plus les dossiers `extra` (les parents des dossiers récents `store.recents()` et des `cwd` des sessions, quand ils ne sont pas déjà sous le dossier personnel).
- **Ordre** : en largeur, jusqu'à `SCAN_DEPTH` sous chaque racine. On ne suit pas les liens symboliques et on ne descend pas dans un dépôt.
- **Un dépôt** est un dossier qui contient `.git`, que ce soit un dossier ou un fichier.
- **Branche** : `headBranch` pour un dossier `.git` ; `inspectRepos` pour un fichier `.git`.
- **Remote** : lu dans `.git/config`, section `[remote "origin"]`, ligne `url =`, puis passé par `repositoryId` ; sans lancer git.
- **Arrêt** : à `SCAN_DIRS` dossiers lus, à `SCAN_MS`, ou à `SCAN_REPOS` dépôts. Dans ces trois cas, `truncated: true`.

**Côté serveur** : il répond `repos.found` sur la même socket.

**Fleet** (motif de `repos.inspect`) :
- `machineId` désigne la machine visée, `local` par défaut. Il est retiré avant l'envoi.
- Une machine hors ligne répond `repos.found { repos: [], truncated: false, error: 'offline' }`.
- Une machine qui tombe, ou un daemon qui refuse (`error` avec `request: 'repos.scan'`, c'est-à-dire un daemon trop ancien), répond `error: 'offline'` ou `error: 'outdated'`.
- Le résultat n'est relayé que depuis la machine interrogée.

**Faux daemon du fleet** : il gagne `found: FoundRepo[]`.

- [ ] **Step 1: Écrire les tests** :
  - **Arborescence temporaire** :
    - `~/w/ledge` (dépôt, remote `git@github.com:paradow/ledge.git`) donne `{ path, branch: 'main', remote: 'github.com/paradow/ledge' }` ;
    - `~/w/notes` (pas Git) est absent ;
    - `~/w/ledge/sub` n'est pas visité ;
    - `~/node_modules/x` (dépôt) est absent ;
    - `~/.hidden/r` est absent.
  - **Bornes** : budget de 3 dossiers → `truncated: true` ; échéance dépassée (horloge injectée) → `truncated: true`.
  - **Identifiants** : un remote `https://user:tok@host/a/b.git` donne `host/a/b`, sans identifiants.
  - **Fleet** :
    - le routage par `machineId` ;
    - la réponse hors ligne ;
    - un daemon trop ancien donne `error: 'outdated'` ;
    - une réponse d'une autre machine est ignorée.
- [ ] **Step 2: Vérifier qu'ils échouent**
- [ ] **Step 3: Implémenter**
- [ ] **Step 4: Vérifier** — paquet par paquet : `pnpm --filter @ledge/protocol test`, `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/fleet test`, `pnpm --filter overlay test` (l'instabilité connue est à signaler), `pnpm -r typecheck`.
- [ ] **Step 5: Commit** — `feat(daemon): repos.scan lists a machine's Git repositories with their branch and normalised remote, bounded in depth, folders and time; the fleet routes it per machine`

### Task 2: Le modèle des propositions

**Files:**
- Create: `packages/fleet/src/proposals.ts`, `packages/fleet/test/proposals.test.ts`
- Modify: `packages/fleet/src/index.ts`

**Interfaces:**
- Produces :

```ts
export interface ScanOf { machine: string; label: string; status: 'ok' | 'offline' | 'outdated'; repos: FoundRepo[]; truncated: boolean }
export interface ProposedRepo { machine: string; path: string; why: Why }
export type Why = { kind: 'remote'; remote: string; machines: string[] } | { kind: 'agent'; names: string[] } | { kind: 'naming'; stem: string } | { kind: 'folder'; parent: string };
export interface Proposal { pid: string; name: string; color: ProjectColor; description: string; repos: ProposedRepo[]; file: string[]; targetId?: string; summary: Summary }
export type Summary = { repos: number; machines: string[]; target?: string; agents: string[] };   // les textes sont faits par l'app
/** Les groupes : même remote (sur plusieurs machines ou chemins) > dossiers d'agents sans projet > nommage commun (préfixe avant « - », au moins 2 dépôts) > même dossier parent (au moins 2).
 *  Un dépôt déjà dans un projet (projectOf) est exclu ; chaque dépôt n'est que dans une proposition (la première raison l'emporte).
 *  Recoupement : un groupe dont un dépôt a le remote ou le dossier parent d'un dépôt d'un projet existant devient targetId (« Ajouter à »).
 *  Nom : le préfixe ou le dossier parent, mis en forme (« paper-fonts » → « Paper ») ; un nom déjà pris devient un recoupement sur ce projet.
 *  Couleur : la première libre, en tenant compte des propositions précédentes de la liste. pid : stable (hash du contenu). */
export function proposeProjects(input: { projects: Projects; scans: readonly ScanOf[]; sessions: readonly Session[] }): Proposal[];
/** « Laisser Ledge faire » depuis l'éditeur : avec un nom tapé, les dépôts libres dont le nom contient un de ses mots (> 2 lettres) ;
 *  sinon la proposition qui contient les sessions à ranger du brouillon ; sinon la première ; null s'il n'y a rien de libre. */
export function proposeFor(draft: { id?: string; name: string; file: readonly string[] }, all: readonly Proposal[], input: Parameters<typeof proposeProjects>[0]): Proposal | null;
```

« Dossiers ouverts par des agents » : les `cwd` des sessions sans projet (`projectOf` est nul). Ils sont rattachés au dépôt balayé qui les contient, ou proposés tels quels comme dossier sans Git. `file` vaut les ids de ces sessions.

- [ ] **Step 1: Écrire `proposals.test.ts`**, avec des balayages de deux machines et des sessions :
  - **Même remote** : `paradow/paper-api` sur local et dev donne une proposition avec les deux, `why.kind` à `remote`.
  - **Agents** : Kit et Zed dans `/var/log` et `~/Téléchargements`, sans projet, donnent `file: ['local:kit', 'dev:zed']` et `why.kind` à `agent`.
  - **Nommage** : `paper-fonts` et `paper-templates` donnent « Paper ».
  - **Exclusion** : un dépôt d'un projet existant n'est jamais proposé.
  - **Recoupement** : un dépôt au remote d'un dépôt de Ledge donne `targetId: 'ledge'`.
  - **Partition** : un dépôt candidat à deux groupes n'apparaît qu'une fois.
  - **Couleurs** : la première libre, puis la suivante pour la deuxième proposition.
  - **pid** : stable d'un appel à l'autre.
  - **`proposeFor`** : avec « paper », les dépôts paper-* ; avec Kit à ranger, sa proposition ; rien de libre donne `null`.
  - **Machine hors ligne** : ses dépôts sont absents, sans erreur.
- [ ] **Step 2: Vérifier qu'il échoue**
- [ ] **Step 3: Implémenter** (fonctions pures)
- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/fleet test && pnpm -r typecheck`.
- [ ] **Step 5: Commit** — `feat(fleet): Ledge's project proposals from the scans: same remote, agents' folders, common naming, same parent; each repository once, overlapping a project means « add to »`

### Task 3: L'éditeur propose

**Files:**
- Create: `apps/desktop/src/projects/{useLedgeScan,proposals}.ts`, `apps/desktop/test/project-proposals.test.tsx`
- Modify: `apps/desktop/src/projects/{ProjectEditor,ProjectDialog,draft}.tsx`, `apps/desktop/src/nav/state.ts` (la fenêtre `project` gagne `proposal?: string`), `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/projects.css`, `apps/desktop/src/i18n/{fr,en}.ts`

**Interfaces:**
- Produces :

```ts
// projects/useLedgeScan.ts — un repos.scan par machine prête (requestId propre, 15 s par machine), résultats partiels
export type ScanStep = { machine: string; label: string; state: 'waiting' | 'done' | 'offline' | 'outdated' | 'timeout'; repos: number; truncated: boolean };
export function useLedgeScan(client: DaemonClient, machines: readonly MachineState[]): { status: 'idle' | 'scanning' | 'done'; steps: ScanStep[]; scans: ScanOf[]; start(): void; cancel(): void };
// projects/proposals.ts — le registre des propositions ouvertes (par pid), vivant le temps de la session de l'app
export function rememberProposal(p: Proposal): string;   // rend le pid
export function proposalOf(pid: string): Proposal | undefined;
// draft.ts : ProjectDraft gagne proposed?: Record<string, { why: Why; checked: boolean }> (clé machine\npath) ; seuls les dépôts cochés
// comptent dans draftProblem, afterSave et le compte ; draftFromProposal(p, state) : nouveau brouillon, ou draftOf(cible) + dépôts proposés à la suite.
```

**Rendu** (maquette `ProjectEditor` : vue de balayage, `.pe-ledge`, `.pe-proposal`, le bouton « Demander à Ledge », les cases et les raisons) :
- **`.pe-ledge`** : seulement pour un nouveau projet sans nom ni proposition. Il contient la mascotte, « Pas envie de chercher les dépôts vous-même ? » et le texte de la maquette, avec « Laisser Ledge faire » en bouton principal.
- **« Demander à Ledge »** est un bouton fantôme. Il apparaît dès que le brouillon a un nom ou des dépôts, et seulement s'il n'y a pas de proposition en cours.
- **Vue de balayage** :
  - le titre est « Ledge prépare un projet » ;
  - la mascotte (avec ses points) suit « Ledge parcourt {machines}… » ;
  - chaque machine a une étape : « {machine} · {n} dépôts trouvés », « {machine} hors ligne, ignorée » ou « {machine} : daemon trop ancien, ignorée », plus « · parcours limité » si le résultat est tronqué ;
  - la dernière étape est « Remotes et sessions comparés » ;
  - « Annuler » revient au formulaire, sans rien écrire.
- **Résultat** :
  - `proposeFor` remplit le brouillon. Les dépôts proposés sont cochés, avec leur raison (`small.pe-why`, préfixe « Ledge · ») et une case « Garder {nom} ({machine}) ».
  - `.pe-proposal` affiche « Ledge propose » + le résumé + « Décochez ce qui ne va pas, puis validez : rien n’est créé avant. ».
  - Sans rien de libre, le message de la maquette s'affiche.
- **Titre** : « Proposition de Ledge », ou « Proposition de Ledge pour {X} » pour un recoupement.
- **Pied de page** : le bouton principal devient « Ajouter à {X} » pour un recoupement. « Supprimer le projet » est caché pendant une proposition.
- **« Ranger aussi »** : les sessions de `file`, cochées (mécanisme existant).
- **Ouverture par la navigation** : `{ kind: 'project', proposal: pid }` ouvre l'éditeur sur `draftFromProposal(proposalOf(pid))`. Un pid inconnu ferme la fenêtre et affiche « Cette proposition n’existe plus. ».

**Textes des raisons** (`projects.why.*`) :

| Raison | fr | en |
| --- | --- | --- |
| `remote` | `Même remote ${r}` (`, sur ${machines}` si plusieurs) | `Same remote ${r}` (`, on ${machines}`) |
| `agent` | `Dossier ouvert par ${names}` | `Folder opened by ${names}` |
| `naming` | `Nommé ${stem}-*` | `Named ${stem}-*` |
| `folder` | `Rangé dans ${parent}` | `Kept in ${parent}` |

- [ ] **Step 1: Écrire `project-proposals.test.tsx`** (faux daemon : `found` par machine, une machine hors ligne) :
  - **« Laisser Ledge faire »** :
    - les étapes s'affichent, avec « Dev hors ligne, ignorée » pour la machine hors ligne ;
    - puis la proposition : nom, dépôts cochés avec leur raison, « Ledge propose… » ;
    - décocher un dépôt le retire du `projects.set` envoyé ;
    - aucun `projects.set` ne part avant le clic.
  - **Recoupement** : le titre devient « Ledge proposal for Ledge » et le bouton « Add to Ledge ». L'envoi garde les dépôts existants et ajoute les cochés.
  - **Dépôt pris entre-temps** (une diffusion le met dans un autre projet) : « déjà dans X » s'affiche et l'enregistrement est refusé ; décocher la case débloque.
  - **Annuler pendant le balayage** : rien n'est écrit, et le formulaire revient.
  - **Pid inconnu** : la fenêtre se ferme avec le message.
- [ ] **Step 2: Vérifier qu'il échoue**
- [ ] **Step 3: Implémenter** (dans le morceau paresseux de l'éditeur ; seuls le type de navigation et le registre touchent le morceau principal)
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build` (sans avertissement de taille de morceau).
- [ ] **Step 5: Commit** — `feat(desktop): « Let Ledge do it » in the project editor: a scan step by step, a proposal with checkable repositories and their reasons, « add to » an existing project, nothing written before the click`

### Task 4: Réglages › Projets propose

**Files:**
- Create: `apps/desktop/src/settings/Suggestions.tsx`, `apps/desktop/test/settings-suggestions.test.tsx`
- Modify: `apps/desktop/src/settings/Projects.tsx` (lot 10, tâche 5), `apps/desktop/src/i18n/{fr,en}.ts`, `apps/desktop/src/styles/settings.css` ou `projects.css`

**Rendu** (maquette `LedgeSuggestions`, en tête de la section Projets) :
- **En-tête** : la mascotte, « Laisser Ledge organiser » et l'indication de la maquette.
- **Bouton** : « Ledge, propose-moi des projets » au départ, puis « Relancer ».
- **Pendant le balayage** : « Ledge parcourt {machines}… », avec les étapes de `useLedgeScan` en ligne.
- **Cartes `article.suggest-card`** : une par proposition de `proposeProjects`. Chaque carte montre :
  - la pastille ;
  - le titre : le nom, ou « Compléter {X} » pour un recoupement ;
  - le résumé ;
  - les puces des dépôts (nom · machine, avec la raison en `title`) et celles des agents ;
  - deux boutons : « Vérifier et créer… » (ou « Vérifier et ajouter… ») et « Ignorer ».
- **« Vérifier… »** : `rememberProposal(p)` puis `{ kind: 'project', proposal: pid }`.
- **« Ignorer »** : retire la carte jusqu'au prochain « Relancer ».
- **Vide** : « Tout est déjà rangé : aucun dépôt libre ni agent sans projet à regrouper. ».
- **Après la création d'un projet** (diffusion), les propositions sont recalculées depuis les mêmes balayages, sans relancer : un dépôt désormais pris disparaît des autres cartes.

- [ ] **Step 1: Écrire `settings-suggestions.test.tsx`** :
  - trois propositions s'affichent ;
  - « Ignorer » en retire une, et « Relancer » la rend ;
  - « Vérifier et créer… » ouvre l'éditeur prérempli ;
  - après la création, la carte disparaît, et un dépôt partagé disparaît aussi de l'autre carte ;
  - le cas vide affiche le message ;
  - une machine hors ligne le dit.
- [ ] **Step 2: Vérifier qu'il échoue**
- [ ] **Step 3: Implémenter**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`.
- [ ] **Step 5: Commit** — `feat(desktop): Settings › Projects can ask Ledge for several projects at once: review, ignore, run again; created ones drop out of the rest`

### Task 5: Le chat propose

**Files:**
- Modify:
  - `packages/protocol/src/{proposal,chat,messages}.ts` et leurs tests ;
  - `packages/ledge/src/chat/{service,claude,routing}.ts` (persona) et leurs tests ;
  - `packages/ui/src/chat/{ChatView,copy}.tsx` (+ `ProjectCard.tsx`) ;
  - `apps/overlay/src/i18n/{messages,lang}.ts(x)` (textes de la carte) ;
  - `apps/desktop/src/chat/ChatPanel.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/i18n/{fr,en}.ts` ;
  - les tests desktop du chat.

**Interfaces:**
- Produces :

```ts
// protocol/proposal.ts — troisième bloc
export const ProjectBlockSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).optional(),
  repos: z.array(z.object({ path: z.string().min(1), why: z.string().trim().min(1).max(200) })).min(1).max(50), addTo: z.string().trim().max(80).optional() });
// ```ledge-project dans FENCES et BLOCK ; extractProposal rend kind 'project' ; hideProposal masque aussi un ```ledge-pro… en cours de frappe
// protocol/chat.ts — ChatTurn et chat.done gagnent :
projectProposal: ChatProjectProposalSchema.optional()   // { name, description?, repos: [{ path, why }], addTo? } — chemins vérifiés par le daemon
// ui/chat/ChatView.tsx — ChatViewProps gagne :
onProject?: (qid: string) => void;   // sans lui, pas de carte (l'île) ; la réponse se suffit à elle-même
```

**Daemon** :
- `projectFrom(raw, qid)` valide le bloc. Il garde les chemins qui existent sur cette machine (`resolveFolder`) et retire les autres. Sans aucun chemin valable, il n'y a pas de proposition (consigné dans le journal).
- **Persona** (`PERSONA`, claude.ts) :
  - lire `projects.md` ;
  - ne proposer un projet que sur une demande explicite de créer ou compléter un projet ;
  - ne citer que des chemins lus dans `sessions.md`, `folders.md` ou `projects.md`, sans jamais en inventer ;
  - utiliser `addTo` pour compléter un projet existant ;
  - toujours écrire une réponse qui se suffit à elle-même (pour les interfaces sans carte).
- **Persona de routage** (`routing.ts`) : une demande de projet va à la machine locale, qui connaît les projets.

**Desktop** :
- `ChatView` affiche une `ProjectCard` sous la réponse quand `turn.projectProposal` existe et que `onProject` est passé. La carte porte :
  - le titre : « Proposition de projet · {nom} », ou « Compléter {X} » quand `addTo` désigne un projet existant ;
  - « {n} dépôt(s) » ;
  - le bouton « Vérifier la proposition ».
- `onProject(qid)` construit une `Proposal` :
  - le nom ;
  - une couleur, la première libre ;
  - les dépôts sur la machine du tour (`turn.machineId ?? 'local'`), chacun avec `why: { kind: 'chat', text }` (nouveau `Why`) ;
  - `targetId` quand `addTo` est le nom d'un projet existant (même comparaison que `name_taken`), sinon un nouveau projet.

  Puis `rememberProposal`, puis l'éditeur. Les dépôts déjà pris sont exclus. Si plus rien ne reste, rien ne s'ouvre et « Cette proposition n’existe plus. » s'affiche ; c'est aussi le cas pour un tour effacé.
- La carte et ses textes passent par `ChatCopy` : l'interface grandit, et les messages de l'île et de Desktop la remplissent. L'île ne passe pas `onProject` et ne montre donc pas de carte.

- [ ] **Step 1: Écrire les tests** :
  - **Protocole** :
    - un bloc ` ```ledge-project ` valide est extrait ;
    - un bloc invalide est ignoré ;
    - `hideProposal` masque un bloc en cours de frappe.
  - **Daemon** :
    - un chemin inventé est retiré ;
    - un bloc sans chemin valable ne donne aucune proposition ;
    - `PERSONA` contient ` ```ledge-project ` et mentionne `projects.md`.
  - **Desktop** :
    - une réponse avec proposition montre la carte, et « Vérifier la proposition » ouvre l'éditeur prérempli : dépôts cochés, raison « Ledge · … » ;
    - avec un `addTo` existant, l'éditeur affiche « Add to Ledge » ;
    - avec un `addTo` disparu, l'éditeur ouvre un nouveau projet ;
    - un tour effacé (`chat.reset`) donne le message ;
    - aucun `projects.set` ne part avant le clic.
  - **Île** : ses tests de chat passent sans changer d'assertion.
- [ ] **Step 2: Vérifier qu'ils échouent**
- [ ] **Step 3: Implémenter**
- [ ] **Step 4: Vérifier** — paquet par paquet : `pnpm --filter @ledge/protocol test`, `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/ui test`, `pnpm --filter desktop test`, `pnpm --filter overlay test`, `pnpm -r typecheck`, `pnpm --filter desktop build`.
- [ ] **Step 5: Commit** — `feat(chat): Ledge can propose a project in the chat (a ledge-project block checked by the daemon); « Review the proposal » opens the editor prefilled, nothing created before the click`

### Task 6: Les propositions dans le navigateur

**Files:**
- Create: `apps/desktop/e2e/proposals.spec.ts`
- Modify: `apps/desktop/e2e/daemon.ts` (`repos.scan` depuis `extras.found` ; une réponse de chat avec `projectProposal`)

Scénarios :
1. **Nouveau projet › « Laisser Ledge faire »** : les étapes, puis la proposition. Décocher un dépôt, puis « Créer le projet » : le projet apparaît dans la barre latérale avec les seuls dépôts gardés.
2. **Réglages › Projets › « Ledge, propose-moi des projets »** : les cartes. « Vérifier et ajouter… » sur un recoupement, puis « Ajouter à Ledge » : les dépôts rejoignent Ledge.
3. **Le chat** : une réponse avec proposition, puis « Vérifier la proposition », puis l'éditeur prérempli, puis « Annuler ». Rien n'a changé.
4. **Fenêtre de 900 px** : la vue de balayage et les cartes tiennent sans défilement horizontal.

- [ ] **Step 1: Écrire les scénarios et étendre le faux daemon**
- [ ] **Step 2: Lancer Playwright** — `pnpm --filter desktop e2e`. Expected : les scénarios d'avant et les 4 de `proposals` passent.
- [ ] **Step 3: Vérification du dépôt** — paquet par paquet, toutes les suites, `pnpm -r typecheck` et `pnpm -r build`. Seule l'instabilité connue de l'overlay peut apparaître : la signaler.
- [ ] **Step 4: Commit** — `test(desktop): Ledge's proposals in the browser: let Ledge do it, several at once in Settings, from the chat, a narrow window`

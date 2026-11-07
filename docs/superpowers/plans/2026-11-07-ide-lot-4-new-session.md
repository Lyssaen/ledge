# Refonte IDE, lot 4 : nouvelle session en modale, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** derrière l'interrupteur « Interface IDE (aperçu) », « Nouvelle session » prend la forme de la maquette : une fenêtre modale à deux colonnes (libellé, champ), avec la limite 5 h de chaque agent et le champ « Ouvrir ». On l'ouvre par le + d'un groupe, par `N`, par « + N » de la vue Projets et par la palette. `Ctrl+Entrée` lance, Échap ferme. La session lancée s'ouvre à l'endroit choisi.

**Architecture :**
- Un nouveau formulaire, **`LaunchModal`** (`launch/LaunchModal.tsx`), rendu dans `shell/Modal.tsx` quand l'IDE est actif. Il réutilise tout le modèle de lancement partagé (`@ledge/fleet/launch` : `launchDefaults`, `withProject`, `withTool`, `withPick`, `missingOf`, `launchMessage`), `useRepoInfo`, `useModels`, `ModelPicker`, `modelPrefs` et `useLaunch`. Il ne réécrit aucune règle d'envoi.
- Les règles nouvelles sont pures et testées sans DOM, dans **`launch/modalModel.ts`** : les lignes du champ Projet, la limite 5 h d'un agent, la valeur de départ de « Ouvrir ».
- `App.tsx` garde le seul `useLaunch`. Interrupteur coupé, il rend `LaunchComposer` comme aujourd'hui. Allumé, il rend `LaunchModal`. Une fois la session lancée, l'IDE ouvre son onglet par `dispatch({ type: 'open', id, where })`.
- Le + d'un groupe met d'abord ce groupe au premier plan (`focusGroup`), comme la maquette (`case 'plus'`).

**Tech Stack:** React 19, TypeScript, `dockview-react` 8.6.1 (jamais `dockview-core` en import), vitest + Testing Library, Playwright.

**Spec:**
- [`docs/ide-workspace.md`](../../ide-workspace.md) : « Nouvelle session », « Raccourcis », « Limites d'usage ».
- [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md) : lot 4 (§5), décisions D1 à D5.
- Le prototype [`docs/mockups/ledge-ide-interactive.html`](../../mockups/ledge-ide-interactive.html) (v26), qui fait foi pour l'aspect :
  - `launchModal()`, `launchPage()` (l. 1017-1033), `launchGo()` (l. 1334) ;
  - le `keydown` global (l. 1477-1480 : `Ctrl+Entrée`, Échap, `N`) ;
  - `case 'plus'` / `'newsession'` (l. 1358-1359), l'en-tête `.ex-h` « Projets » + `+ N` (l. 844), la commande « Nouvelle session » de la palette (l. 1151) ;
  - CSS `.modal`, `.modal-bg`, `.modal-x`, `.modal .page` (l. 455-459), `.page h3`, `.page .sub`, `.fld`, `.inp`, `.radios`, `.radio`, `.agents`, `.agent`, `.agent.on`, `.segc`, `.go`.

## Global Constraints

- Branche `feat/ide-lot-4`, partie de `origin/main` 71646d13 (0.50.0, lots 1 à 3 fusionnés). Une PR vers `main` (`Lyssaen/ledge`), seulement avec l'accord de l'utilisateur. Rien n'est poussé sans lui.
- Interrupteur coupé, l'interface actuelle est **inchangée** : `LaunchComposer` et ses tests (`launch.test.tsx`, `launch-flow.test.tsx`, `e2e/launch.spec.ts`) restent verts sans retouche.
- Échecs déjà présents sur `main` : e2e `island.spec.ts:166`, `proposals.spec.ts:36`, `daemon-update.spec.ts:8` (instable) ; vitest « reconnect asks Nova's thread again » (instable) ; mobile `link.test.ts` « relay out of reach ».
- Textes en français et en anglais (`src/i18n/fr.ts`, `en.ts`), sous `launch.modal`. Le français reprend la maquette mot pour mot.
- Couleurs par les jetons du thème (clair et sombre), jamais les hex de la maquette (`#ffffff08` de `.agent.on` → `var(--accent)` ; `#000a` du fond → le fond de `.modal-backdrop` existant).
- Tout état absent de la maquette se demande à `design-ux` et ne s'invente pas. On le note dans `docs/ide-lot-4-questions.md`, reporté dans le compte rendu puis supprimé avant la PR. En attendant la réponse, on reprend le texte existant de `LaunchComposer` pour cet état.
- « Nouvelle fenêtre » (lot 9) reste **masqué** dans le champ « Ouvrir ».
- Node 22 (`eval "$(fnm env)"; fnm use 22`). Tests : `pnpm --filter desktop test`, `pnpm --filter desktop typecheck`, `pnpm --filter desktop e2e`.
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ne jamais committer `apps/desktop/test-results/*.png`.
- `docs/ide-lot-4-brief.md` est un fichier de travail : supprimé avant la PR.

## Rulings (à valider)

Le daemon ne sait aujourd'hui ni **créer un worktree** au lancement, ni passer un **mode de permissions** à Claude Code ou Codex (`session.launch` n'a que `approval`, pour omp). Le lot 4 est un lot front (§5) : les rulings R1 et R2 en découlent.

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | **« Où travailler »** montre la seule option que le daemon sait faire : « Sur `<branche>`, dans le dossier du projet », la branche lue par `useRepoInfo`, sans bouton radio. « Nouvelle branche dans un worktree » attend un lot back (issue à ouvrir) : un worktree à créer côté daemon, le dossier et la branche dans `session.launch`. | Un lot back de plus (daemon + protocole), puis la radio à ajouter : ~1 jour. |
| R2 | **« Permissions »** ne s'affiche que pour omp, avec ses trois modes actuels (`always-ask`, `write`, `yolo`, mêmes libellés que `LaunchComposer`) dans le segment `.segc`. Pour Claude Code et Codex, la ligne est absente, faute de support daemon. Les quatre niveaux de la maquette (Auto, Standard, Ouvert, YOLO) attendent le même lot back que R1. | Même lot back : `--permission-mode` / `--dangerously-skip-permissions` côté daemon, puis le segment pour tous. |
| R3 | **« Projet »** est un menu dont chaque ligne est un dossier du projet sur une machine : « ledge · ~/Workspace/ledge · WSL », comme la maquette. Une machine hors ligne grise ses lignes. Le choix de plusieurs dossiers (`--add-dir`, Claude et omp) n'est pas repris dans la modale : un seul dossier. | Une case « Ajouter un dossier » à concevoir avec `design-ux`. Ceux qui lancent sur plusieurs dossiers passent par l'ancienne interface ou la carte du chat. |
| R4 | **« Agent »** propose quatre tuiles : Claude Code, Codex, Cursor et omp. La maquette en montre trois, mais Cursor est un agent que Ledge sait lancer, on ne le retire pas. La grille passe à `repeat(4, …)`. La tuile présélectionnée est l'agent par défaut (Réglages › Général). « Définir par défaut » n'est pas repris. | Retirer une tuile, ou remettre « Définir par défaut ». |
| R5 | **La limite 5 h d'une tuile** est celle du compte de cet agent sur la machine choisie (le `UsageGroup` dont `machines` contient la machine, sinon le premier groupe du harnais). Format de la maquette : « Limite 5 h **84 %** · réinit. 14:20 », en ambre au-delà du seuil d'alerte. Pas de fenêtre 5 h lue (omp, Cursor, compte non lu) : « Limite non lue ». | Une ligne dans `agentLimit`. |
| R6 | **Le nom de l'agent** n'est pas un champ (la maquette n'en a pas) : Ledge en choisit un libre (`pickName`), comme quand on laisse le champ vide aujourd'hui. Les suggestions de consigne disparaissent aussi. | Une ligne « Nom » à rajouter sous Agent. |
| R7 | **« Ouvrir »** part du réglage « Ouvrir une session » (`useOpenSession`). Ouverte par le + d'un groupe, la modale part de « Dans le groupe actif », et ce groupe devient le groupe actif (maquette `case 'plus'`). Le choix ne s'enregistre pas : il vaut pour ce lancement. | Mémoriser le dernier choix : une ligne. |
| R8 | **La palette** (`Ctrl+K`, `SearchPalette`) gagne, dans l'IDE seulement, une ligne « Nouvelle session » avec `N` à droite, en tête quand la recherche est vide, ou quand elle commence par `>`, ou quand le mot tapé est dans le libellé. La vraie palette de commandes (`>`, `@`) reste au lot 10. | Une ligne de plus, réécrite au lot 10 de toute façon. |
| R9 | **« + N »** : l'IDE gagne l'en-tête de la vue Projets de la maquette (`.ex-h` : « PROJETS » à gauche, le bouton `+ N` à droite). Il n'existe pas aujourd'hui. Interrupteur coupé, la barre latérale ne change pas. | Retirer l'en-tête. |
| R10 | L'ancienne interface garde son `LaunchComposer` tel quel (brief). Le nouveau formulaire n'est rendu que dans l'IDE. | Les deux formulaires coexistent jusqu'au lot 12, qui retirera l'ancien. |

## Review Focus

1. **Lancer, puis le daemon répond pendant que la modale est encore ouverte et que le réglage dit « À droite ».** L'onglet s'ouvre dans un nouveau groupe à droite du groupe actif au moment de l'ouverture de la modale, une seule fois, et la modale se ferme. Un deuxième `Ctrl+Entrée` pendant « Lancement… » n'envoie rien.
2. **Ouvrir par le + d'un groupe qui n'est pas le groupe actif.** Ce groupe devient actif, « Ouvrir » vaut « Dans le groupe actif », et la session s'ouvre dans ce groupe.
3. **`N` pendant qu'une autorisation attend dans la session active.** `N` refuse l'autorisation et la modale ne s'ouvre pas. Sans autorisation, `N` ouvre la modale. `N` tapé dans le premier message reste une lettre.
4. **La machine choisie se déconnecte pendant que la modale est ouverte.** Les lignes du Projet sur cette machine se grisent. Le formulaire passe sur une ligne d'une machine en ligne s'il en reste une. Sinon, « Lancer » nomme le champ manquant, sans rien envoyer.
5. **Échap pendant que le menu Projet ou le menu Modèle est ouvert.** Échap ferme le menu seulement, pas la modale. Un second Échap ferme la modale, et le focus revient où il était.

---

### Task 1 : Les règles pures de la modale

**Files:** Create `apps/desktop/src/launch/modalModel.ts`. Test `apps/desktop/test/launch-modal-model.test.ts`.

**Interfaces — Produces :**
```ts
import type { MachineState } from '@ledge/fleet';
import type { Project, UsageWindow } from '@ledge/protocol';
import type { UsageGroup } from '../usage/model';
import type { OpenSession } from '../workspace/openPrefs';
import type { Tool } from './model';

/** Une ligne du champ Projet : un dossier d'un projet sur une machine (R3). */
export interface ProjectRow { key: string; project: string; projectName: string; machine: string; machineLabel: string; path: string; up: boolean }
/** Les projets dans leur ordre, puis leurs dossiers dans l'ordre du projet ; `key` = `${project}|${machine}|${path}`. */
export function projectRows(projects: readonly Project[], machines: readonly MachineState[]): ProjectRow[];
/** La fenêtre 5 h du compte de `tool` sur `machine` (R5) ; null : « Limite non lue ». */
export function agentLimit(groups: readonly UsageGroup[], tool: Tool, machine: string | null, threshold: number): { pct: number; resetsAt: string | null; warn: boolean } | null;
/** La valeur de départ de « Ouvrir » (R7). */
export function openWhere(setting: OpenSession, from: 'plus' | 'other'): 'active' | 'right';
```
- `path` affiché : le chemin raccourci par `~` côté UI, pas ici.
- `agentLimit` : `tool` → harnais d'usage par `claude → 'claude'`, `codex → 'codex'`, les autres → null. `pct` est le pourcentage entier (comme `UsageFooter`), `warn` = `pct >= threshold * 100`.

- [ ] **Step 1 : tests qui échouent** (`launch-modal-model.test.ts`)
  - `projectRows` : deux projets, le premier avec un dossier sur `local` et un sur `srv` (hors ligne) → trois lignes dans l'ordre, celle de `srv` avec `up: false`, `machineLabel` = le `label` de la machine. Un projet sans dossier → aucune ligne.
  - `agentLimit` : deux groupes Claude (`machines: ['local']` à 84 %, `['srv']` à 10 %) → sur `srv`, 10 % ; sur une machine sans groupe → le premier groupe Claude. `threshold: 0.8`, 84 % → `warn: true` ; 79 % → `false`. `omp` et `cursor` → `null`. Un groupe sans fenêtre `five_hour` → `null`.
  - `openWhere('right', 'plus')` → `'active'` ; `openWhere('right', 'other')` → `'right'` ; `openWhere('active', 'other')` → `'active'`.
- [ ] **Step 2 :** `pnpm --filter desktop test launch-modal-model` → FAIL (module absent).
- [ ] **Step 3 :** implémenter `modalModel.ts`.
- [ ] **Step 4 :** même commande → PASS.
- [ ] **Step 5 : commit** `feat(desktop): the IDE launch modal's rules — project rows, an agent's 5 h limit, where it opens`.

### Task 2 : Le formulaire `LaunchModal`

**Files:** Create `apps/desktop/src/launch/LaunchModal.tsx`. Modify `apps/desktop/src/launch/lazy.tsx` (export `LaunchModalPlace`, même chunk que `LaunchComposer`), `apps/desktop/src/i18n/fr.ts`, `en.ts`, `apps/desktop/src/styles/ide.css`. Create `docs/ide-lot-4-questions.md`. Test `apps/desktop/test/ide/launch-modal.test.tsx`.

**Interfaces :**
- Consumes : Task 1 ; `LaunchState` (`useLaunch`) ; `UsageGroup` (`useUsageView`).
- Produces :
```ts
export type LaunchWhere = 'active' | 'right';
export function LaunchModal(p: {
  client: DaemonClient; projects: readonly Project[]; machines: readonly MachineState[]; sessions: readonly Session[];
  projectIdOf(s: Session): string | null; wanted: { project?: string; filter?: string };
  usage: { groups: readonly UsageGroup[]; threshold: number };
  where: LaunchWhere;                    // la valeur de départ (openWhere)
  launch: LaunchState;
  onLaunch(msg: LaunchMessage, preview: { name: string; project: string; projectId: string }, where: LaunchWhere): void;
  onNewProject(): void; onCancel(): void;
}): JSX.Element;
```
- **Mise en page** (maquette `launchPage()`) : `h3` n'est pas répété (le titre est celui de `Modal`, « Nouvelle session ») ; en tête, la ligne d'aide `.sub` : `S'ouvre dans le groupe actif. Ctrl+Entrée lance, Échap ferme.` / `S'ouvre dans un groupe à droite. …` selon « Ouvrir ». Puis la grille `.fld` (150 px | 1fr, `gap: 10px 16px`) dans cet ordre : Projet, Où travailler, Agent, Modèle, Permissions (omp seul, R2), Premier message, Ouvrir, puis les boutons « Lancer `Ctrl Entrée` » (primaire) et « Annuler ».
- **Projet** (R3) : un bouton `.inp` « `<projet>` · `<chemin ~>` · `<machine>` ▾ » qui ouvre un `Menu` (`shell/Menu.tsx`) des `projectRows` ; une ligne `up: false` est désactivée avec « hors ligne ». Choisir une ligne applique `withProject` puis `withMachine` puis `repos: [path]`, et recharge le choix de modèle mémorisé (`loadPick`). Aucun projet : la ligne affiche le texte existant `t.launch.noProjects` et le bouton « Nouveau projet » (`onNewProject`).
- **Où travailler** (R1) : texte seul `Sur ⎇ <branche>, dans le dossier du projet` ; branche inconnue ou dossier sans Git : `Dans le dossier du projet`.
- **Agent** (R4, R5) : `.agents` en `repeat(4, minmax(0, 1fr))`, une tuile `button` `.agent` par outil, `aria-pressed`. Contenu : `ProviderLogo` 16 px + nom (`t.launch.tools[id][0]`), `small` fournisseur (`Anthropic`, `OpenAI`, `Cursor`, `omp`), `small` limite : `Limite 5 h <b>84 %</b> · réinit. 14:20` (heure par `resetShort`), `<b>` en `var(--st-ask)` si `warn` ; sinon `Limite non lue`. Changer de tuile applique `withTool(f, id, loadPick(project, id))`.
- **Modèle** : `ModelPicker` existant (`key` machine|outil|projet), dans la colonne de droite. Daemon trop ancien : `t.launch.modelsOutdated`. omp indisponible : `t.launch.ompUnavailable` / `ompOutdated` en `role="alert"` sous la tuile.
- **Permissions** (R2) : omp seulement, `.segc` des trois `t.launch.approvals[a][0]` ; daemon sans `ompApproval` : `t.launch.approvalOutdated`.
- **Premier message** : `textarea` 80 px, `resize: vertical`, focus à l'ouverture, `aria-invalid` après un essai s'il est vide.
- **Ouvrir** (R7) : deux radios en ligne, « Dans le groupe actif », « À droite ». « Nouvelle fenêtre » n'est pas rendu.
- **Envoi** : même logique que `LaunchComposer.submit` (rien si `missingOf` ou en cours ou omp indisponible ; `savePick` ; `approval` forcé à `always-ask` si non pris), puis `onLaunch(msg, preview, where)`. `Ctrl+Entrée` / `⌘+Entrée` dans tout le formulaire envoie ; Entrée seule dans un `input` ne soumet pas.
- **États hors maquette** (à noter dans `docs/ide-lot-4-questions.md`, texte existant en attendant) : champ manquant après un essai (`t.launch.missing[...]`), refus (`t.launch.refused`), délai (`t.launch.timeout`), « Lancement… » (`t.launch.launching`), aucun projet, machine hors ligne.
- **Textes** sous `launch.modal` (fr / en) : `opensIn: { active: 'S’ouvre dans le groupe actif.' / 'Opens in the active group.', right: 'S’ouvre dans un groupe à droite.' / 'Opens in a group on the right.' }`, `keys: 'Ctrl+Entrée lance, Échap ferme.' / 'Ctrl+Enter launches, Escape closes.'`, `project: 'Projet'`, `where: 'Où travailler'`, `onBranch: (b) => \`Sur ${b}, dans le dossier du projet\`` / `On ${b}, in the project folder`, `inFolder: 'Dans le dossier du projet'` / `In the project folder`, `agent: 'Agent'`, `model: 'Modèle'`, `permissions: 'Permissions'`, `message: 'Premier message'`, `open: 'Ouvrir'`, `openActive: 'Dans le groupe actif'` / `In the active group`, `openRight: 'À droite'` / `On the right`, `limit: (pct, reset) => …` (`Limite 5 h {pct} % · réinit. {reset}` / `5 h limit {pct} % · resets {reset}`), `limitUnread: 'Limite non lue'` / `Limit not read`, `offline: 'hors ligne'`, `launch: 'Lancer'`, `cancel: 'Annuler'`.
- **CSS** (`ide.css`, préfixe `.launch-modal`) : la modale fait `width: min(780px, calc(100vw - 32px))`, padding `20px 22px 22px`, comme `.modal` / `.modal .page`. Bordure de tuile `var(--border)`, tuile choisie `border-color: var(--foreground)` et fond `var(--accent)`. Rayons `9px` (tuile) et `7px` (`.inp`).

- [ ] **Step 1 : tests qui échouent** (`test/ide/launch-modal.test.tsx`, avec les aides de `test/fleet-helpers.ts`)
  - Rend les libellés dans l'ordre : Projet, Où travailler, Agent, Modèle, Premier message, Ouvrir ; pas de « Permissions » avec Claude ; avec omp choisi et `ompApproval: true`, « Permissions » et ses trois modes.
  - La tuile Claude affiche « Limite 5 h 84 % · réinit. » et son `<b>` porte la classe d'alerte avec `threshold: 0.8` ; la tuile omp affiche « Limite non lue ».
  - `where: 'right'` → l'aide dit « S'ouvre dans un groupe à droite. » ; cliquer « Dans le groupe actif » → l'aide change ; « Nouvelle fenêtre » absent.
  - Le message tapé puis `Ctrl+Entrée` → `onLaunch` appelé une fois avec `msg.tool === 'claude'`, `msg.cwd` = le dossier de la ligne, `msg.prompt`, et `where`. Un deuxième `Ctrl+Entrée` avec `launch: { status: 'launching' }` → pas d'autre appel (Review Focus 1).
  - Message vide puis `Ctrl+Entrée` → rien n'est envoyé, le `textarea` a `aria-invalid="true"` et le texte `t.launch.missing.prompt` s'affiche.
  - Choisir dans le menu Projet une ligne d'un autre projet → `msg.cwd` suit ; une ligne d'une machine hors ligne est désactivée. La machine choisie passe hors ligne (rerender) → le formulaire passe sur une ligne en ligne (Review Focus 4).
  - Échap avec le menu Projet ouvert → le menu se ferme et `onCancel` n'est pas appelé (Review Focus 5).
- [ ] **Step 2 :** `pnpm --filter desktop test launch-modal` → FAIL.
- [ ] **Step 3 :** implémenter `LaunchModal`, les textes, le CSS, `LaunchModalPlace` dans `lazy.tsx`, et `docs/ide-lot-4-questions.md` (les états hors maquette listés ci-dessus).
- [ ] **Step 4 :** `pnpm --filter desktop test launch-modal` → PASS ; `pnpm --filter desktop typecheck` → 0 erreur.
- [ ] **Step 5 : commit** `feat(desktop): the IDE's New session modal — the mockup's fields, each agent's 5 h limit, where it opens`.

### Task 3 : Le branchement dans l'IDE

**Files:** Modify `apps/desktop/src/App.tsx`, `apps/desktop/src/nav/state.ts`, `apps/desktop/src/ide/DockHost.tsx`. Test `apps/desktop/test/ide/launch-ide.test.tsx` (sur le modèle de `test/ide/session-tab.test.tsx`).

**Interfaces :**
- Consumes : `LaunchModalPlace`, `LaunchWhere` (Task 2) ; `openWhere` (Task 1) ; `focusGroup` (`workspace/model.ts`).
- Produces :
```ts
// nav/state.ts : le modal launch sait d'où il vient (ignoré hors IDE)
| { kind: 'launch'; project?: string; from?: 'plus' }
// DockHost : onNewSession(groupId: string): void   (était onNewSession(): void)
```
- `DockHost` : le + passe l'id de son groupe. `App` : `onNewSession={gid => { wsStore.update(w => focusGroup(w, gid)); dispatch({ type: 'modal', modal: { kind: 'launch', from: 'plus' } }); }}`. La proposition « Nouvelle session » du groupe vide fait de même (elle focalise déjà).
- `App`, IDE allumé : `nav.modal?.kind === 'launch'` rend `<Modal title={t.modalTitles.launch} className="launch-modal" onClose={close}><LaunchModalPlace … where={openWhere(openSession, nav.modal.from === 'plus' ? 'plus' : 'other')} usage={{ groups: usage.groups, threshold: usage.threshold }} /></Modal>`. Interrupteur coupé : le rendu actuel, inchangé (R10).
- Le `where` reçu par `onLaunch` est gardé avec la préview (`launched.current = { ...preview, where }`). Dans le rappel de `useLaunch`, si l'IDE est allumé : `dispatch({ type: 'open', id, where })` après la fermeture de la modale, puis la notice existante. Le filtre de la vue d'ensemble ne bouge pas dans l'IDE. Interrupteur coupé : comportement actuel.
- [ ] **Step 1 : tests qui échouent** (`launch-ide.test.tsx`, IDE allumé, daemon simulé)
  - Deux groupes, le second non actif ; clic sur son + → la modale s'ouvre, le second groupe est actif, « Dans le groupe actif » est coché (Review Focus 2).
  - Réglage « Ouvrir une session » = « À droite », `N` → la modale part de « À droite » ; `Ctrl+Entrée`, puis le daemon répond `session.launched` → la modale se ferme et l'onglet de la session est dans un nouveau groupe à droite, actif ; un seul onglet pour cette session (Review Focus 1).
  - Clic sur le + puis lancement → l'onglet s'ouvre dans ce groupe.
  - Échap → la modale se ferme, aucun envoi.
  - Interrupteur coupé : `N` sur la vue d'ensemble ouvre toujours `LaunchComposer` (le champ « Consigne » est là, pas « Premier message »).
- [ ] **Step 2 :** `pnpm --filter desktop test launch-ide` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm --filter desktop test` (suite complète, hors échecs connus) → PASS ; `typecheck` → 0.
- [ ] **Step 5 : commit** `feat(desktop): the IDE opens New session as its modal and the launched session where it was asked`.

### Task 4 : Les entrées « + N » et la palette

**Files:** Modify `apps/desktop/src/shell/sidebar/Sidebar.tsx`, `apps/desktop/src/shell/SearchPalette.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/ide.css`, `i18n/fr.ts`, `en.ts`. Tests `apps/desktop/test/ide/launch-entries.test.tsx`, `apps/desktop/test/keys.test.tsx`.

**Interfaces — Produces :**
```ts
// SearchPalette : prop optionnelle, passée par App seulement quand l'IDE est allumé
onNewSession?: () => void;
```
- **« + N »** (R9) : dans `Sidebar`, quand `section === 'projects'` (l'IDE seulement), un en-tête `.ide-ex-h` au-dessus de l'arbre : « Projets » (`text-transform: uppercase`, 10.5-11 px, `var(--muted-foreground)`, `letter-spacing: .06em`) et un bouton `+ N` à droite, style `kbd`, `title` « Nouvelle session (N) » / « New session (N) », qui fait `dispatch({ type: 'modal', modal: { kind: 'launch' } })`.
- **Palette** (R8) : avec `onNewSession`, une ligne `role="option"` « Nouvelle session » (icône +, `Kbd` `N` à droite) en tête des résultats si la recherche est vide, commence par `>`, ou si son libellé contient le texte tapé (sans casse ni accents). Elle compte dans ↑ ↓ ; Entrée ou clic → `onNewSession()` (App : `dispatch({ type: 'modal', modal: { kind: 'launch' } })`, qui remplace la palette). Avec `>` en tête, les sessions ne sont pas listées.
- [ ] **Step 1 : tests qui échouent**
  - IDE, vue Projets : le bouton « Nouvelle session (N) » ouvre la modale. Interrupteur coupé : pas d'en-tête `.ide-ex-h`.
  - Palette dans l'IDE : vide → première option « Nouvelle session » ; tape `nouv` → elle reste ; tape `>` → elle seule ; tape `otto` (une session) → elle n'est pas là ; Entrée sur elle → la modale de lancement est ouverte. Interrupteur coupé : jamais de ligne « Nouvelle session ».
  - `keys.test.tsx` (Review Focus 3) : IDE, la session active a une autorisation en attente → `N` envoie le refus et la modale ne s'ouvre pas ; sans autorisation → la modale s'ouvre ; `N` tapé dans le `textarea` de la modale → la lettre s'écrit.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** `pnpm --filter desktop test` → PASS, `typecheck` → 0.
- [ ] **Step 5 : commit** `feat(desktop): New session from the Projects view's « + N » and the palette`.

### Task 5 : e2e et contrôle visuel

**Files:** Create `apps/desktop/e2e/ide-launch.spec.ts`. Modify `e2e/daemon.ts` seulement s'il manque une réponse `session.launched` à un `session.launch` (`e2e/launch.spec.ts` en a déjà une : la reprendre).

- [ ] **Step 1 : spec** (1920×1080, IDE allumé comme `ide-shell.spec.ts`) : le + du groupe → la modale ; capture zoomée de la modale (thème sombre et clair) comparée au prototype : grille 150 px | 1fr, tuiles alignées, limite 5 h, boutons en bas à gauche de la colonne de droite. Taper un message, `Ctrl+Entrée` → la modale se ferme, l'onglet de la nouvelle session est actif. `N` → la modale ; Échap → fermée, focus rendu. Palette → « Nouvelle session ».
- [ ] **Step 2 :** `pnpm --filter desktop e2e ide-launch` → PASS ; puis la suite e2e complète → seuls les échecs connus.
- [ ] **Step 3 :** corriger les écarts visuels relevés sur les captures (alignements, espacements, jetons). Ne pas committer `test-results/*.png`.
- [ ] **Step 4 : commit** `test(desktop): the IDE's New session modal end to end`.

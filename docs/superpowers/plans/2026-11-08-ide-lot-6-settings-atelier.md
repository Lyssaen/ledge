# Refonte IDE, lot 6 : Réglages et atelier en onglets, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** derrière l'interrupteur « Interface IDE (aperçu) », l'onglet Atelier retrouve les commandes que l'ancienne barre du haut lui donnait. Il s'agit de « Projets | Rigs », « Masquer les sous-agents », du filtre de projet et de « Détacher ». Réglages › Espace de travail gagne la rubrique « Barre d'état » : afficher ou non les limites d'usage, et le seuil d'alerte.

**Ce qui existe déjà (lots 1 à 5, vérifié sur `origin/main` 46987890, 0.53.0) et ne se refait pas :**
- les onglets `atelier:main` et `settings:main` (`workspace/store.ts`), ouverts par la barre d'activité, le groupe vide et la palette ;
- `Ctrl+,` ouvre l'onglet Réglages (`nav/useKeys.ts` → `routeNav` `settings`), sur la dernière section ouverte (`lastSettings` dans `App.tsx`), sans « Retour » (`noBack`) ;
- un clic sur un agent de l'atelier (`openClick`) ouvre sa session selon le réglage « Ouvrir une session » (`routeNav` `open`), `Ctrl`+clic l'ouvre à droite (`where: 'right'`), et J / K / Entrée suivent la même règle ;
- le bureau de Ledge (`LedgeDesk` → `{ type: 'chat' }`) ouvre le chat dans le panneau de droite (`routeNav` `chat`) ;
- le menu clic droit d'un agent de l'atelier passe déjà par `ideSessionMenu` (ouvrir à droite, terminal à côté) ;
- l'atelier détaché : l'onglet montre `AtelierAway` (« Afficher », « Rattacher ») ;
- Réglages › Espace de travail : « Ouvrir une session » (groupe actif, à droite) et Terminaux › WebGL.

**Ce qui manque :** dans l'IDE, `TopBar` n'est pas rendu. L'onglet Atelier n'a donc ni « Projets | Rigs » (le sélecteur ne vit que dans l'ancienne barre latérale, `!section`), ni sous-agents, ni pause, ni « Détacher », ni le filtre de projet et sa croix. Il manque aussi la rubrique « Barre d'état » des réglages.

**Architecture :**
- Un nouveau composant `ide/AtelierBar.tsx`, la barre `.abar` de la maquette, posée **au-dessus** de `<Atelier>` dans le corps de l'onglet (`App.tsx`). `Atelier.tsx` ne change pas (« l'atelier passe en onglet sans modification »). La barre lit et écrit ce qui existe : `useGrouping` / `setGrouping` (`openrig/grouping.ts`), `nav.helpers`, `nav.paused`, le filtre `place.project`, `detach`.
- Une préférence locale `ledge.ide.showUsage` (`workspace/prefs.ts`, même forme que `resumeOnStart`) : quand elle est coupée, `App` ne passe pas `usage` à l'IDE. Le seuil d'alerte est celui des daemons (`fleet.setUsageAlert`), que Général règle déjà.

**Tech Stack :** React 19, TypeScript, vitest + Testing Library, Playwright.

**Spec :**
- [`docs/ide-workspace.md`](../../ide-workspace.md) : « Atelier », « Réglages », « Raccourcis » (`Ctrl+,`), « Points ouverts » (atelier dans un onglet étroit).
- [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md) : lot 6 (§5), D1, R13 du lot 5 (renvoyé ici).
- Le prototype [`docs/mockups/ledge-ide-interactive.html`](../../mockups/ledge-ide-interactive.html) (v26) :
  - `atelierPage()` (l. 1062-1075) et la barre `.abar` ;
  - `settingsPage()` (l. 1045-1061), lignes « Barre d'état » (l. 1056) et « Terminaux » (l. 1058).

## Global Constraints

- Branche `feat/ide-lot-6` (worktree `../ledge-ide-lot-6`), partie de `origin/main` 46987890 (0.53.0). Une PR vers `main` (`Lyssaen/ledge`), seulement avec l'accord de l'utilisateur. Rien n'est poussé sans lui.
- Interrupteur coupé, l'interface actuelle est **inchangée** : `TopBar`, l'ancienne barre latérale et leurs tests restent verts sans retouche.
- `Atelier.tsx` et ses enfants ne changent pas. Seuls les gestes et la barre au-dessus changent.
- Les sections actuelles des réglages ne changent pas : Général garde sa liste « Alerte de limite d'usage ».
- Le daemon (`packages/ledge`) et le protocole (`packages/protocol`) ne changent pas.
- Échecs connus sur `main` (lot 5) : e2e `island.spec.ts:166`, `proposals.spec.ts:36`, `daemon-update.spec.ts:8` (instable), `atelier.spec.ts:208` (instable sous charge) ; vitest « reconnect asks Nova's thread again » ; mobile `link.test.ts`, « relay out of reach ». **À revérifier sur 46987890 avant la Task 1.**
- Textes en français et en anglais (`src/i18n/fr.ts`, `en.ts`). On **reprend les textes existants** (`t.top.groupingBy`, `t.top.helpersHide` / `helpersShow`, `t.top.pause` / `play`, `t.detached.detach` / `detachTitle`, `t.crumb.clearFilter`), sauf les textes nouveaux de la maquette, cités mot pour mot.
- Couleurs par les jetons du thème (clair et sombre), jamais les hex de la maquette. Sélecteurs préfixés pour les boutons (`.ide-atelier .ide-abar button`), à cause du reset `button:not(.ledge-btn)` d'`app.css`.
- Tout état absent de la maquette se demande à `design-ux` et ne s'invente pas. On le note dans `docs/ide-lot-6-questions.md`, on le reporte dans le compte rendu, puis on supprime le fichier avant la PR.
- Node 22 (`eval "$(fnm env)"; fnm use 22`). Tests : `pnpm --filter desktop test`, `pnpm --filter desktop typecheck`, `pnpm --filter desktop e2e`.
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jamais `apps/desktop/test-results/*.png`. Jamais `git stash` nu.

## Rulings (à valider)

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | **La barre de l'atelier** suit `.abar` : « Atelier » en gris, puis le segment « Projets \| Rigs » (seulement quand des rigs existent ou qu'OpenRig est installé, comme `offerRigs` de `Sidebar.tsx`), un espace, puis les boutons texte « Masquer les sous-agents » / « Afficher les sous-agents » et « Détacher ». | — |
| R2 | **Le filtre de projet** (posé depuis l'explorateur, « N'afficher que X dans l'atelier ») s'affiche après « Atelier », comme l'ancien fil d'Ariane : `Atelier / ● Projet ×`. La croix rend tous les projets. Dans l'IDE, Échap ne retire pas le filtre (`routeNav` `escape` ne ferme qu'une modale). | Pas de puce : le filtre reste alors sans moyen visible d'être retiré dans l'IDE. |
| R3 | **« Figer les animations »** (pause), absent de la maquette, reste dans la barre en bouton icône avant « Détacher », comme dans `TopBar`. Sinon il disparaît de l'IDE. | Le retirer de l'IDE : une ligne. |
| R4 | **« Détacher »** n'apparaît que si `canDetach()` et que l'atelier n'est pas déjà détaché, comme `onDetach` aujourd'hui. Détaché, l'onglet garde `AtelierAway`, sans barre. « Ramener » (une popout) relève du lot 9. | — |
| R5 | **« Taper dans un terminal attaché sans confirmation »** (renvoyé ici par le R13 du lot 5) **n'est pas fait** : aucune confirmation n'existe, ni dans le code ni dans la maquette. Elle va aux questions de `design-ux`. On ne pose pas une case sans effet. | La case et la confirmation dans ce lot, une fois dessinées : ~½ jour (une tâche de plus). |
| R6 | **« Barre d'état »** : la case « Limites d'usage des comptes » (cochée par défaut, `ledge.ide.showUsage`, propre à ce poste) masque les limites à droite de la barre d'état. Un `+`/`−` « Alerte à N % d'une fenêtre (ambre au-delà) », par pas de 5, entre `USAGE_ALERT_MIN` et `USAGE_ALERT_MAX`, règle **le même seuil** que Général (`fleet.setUsageAlert`). Il est grisé, avec le texte `usageAlertUnknown` de Général, tant qu'aucune machine ne donne ses limites. | Une seule des deux lignes : à dire. |
| R7 | **Hors lot**, et absents de la section : « Nouvelle fenêtre » (lot 9), « Au démarrage » et « Dispositions » (lot 10), « Ouvrir dans… » (lot 11). | — |
| R8 | **L'atelier et les Réglages dans un groupe étroit** : on ne modifie rien. Des captures à 480 px et à 720 px de large vont à `design-ux` avec les questions. | — |

## Review Focus

1. **Basculer « Projets | Rigs » depuis l'onglet.** L'atelier se regroupe tout de suite. La vue Rigs de l'explorateur n'en dépend pas (elle suit `section`), et l'interface d'avant, rallumée, retrouve le même choix (`setGrouping` est partagé).
2. **Détacher depuis l'onglet, puis rattacher.** L'onglet passe à `AtelierAway`, puis revient à l'atelier avec sa barre. Un clic sur un agent de la fenêtre détachée ouvre son onglet dans la fenêtre principale, selon le réglage.
3. **Décocher « Limites d'usage des comptes ».** Les limites disparaissent de la barre d'état de l'IDE, mais pas de la modale Nouvelle session (`usage=` de `LaunchModal`), ni de l'interface d'avant. Recochées, elles reviennent sans redémarrage.
4. **Le `+` de l'alerte au maximum, ou sans machine.** Pas de pas au-delà des bornes (`aria-disabled`, rien n'est envoyé). Sans limites lues, la ligne est grise et rien n'est envoyé. Une erreur de `setUsageAlert` arrive en toast, comme dans Général.
5. **Le filtre retiré par la croix pendant qu'un groupe lié montre une session.** Seul l'atelier change : aucun onglet ne se ferme, aucun ne passe au premier plan.

---

### Task 1 : La barre de l'onglet Atelier

**Files :** Create `apps/desktop/src/ide/AtelierBar.tsx`. Modify `apps/desktop/src/App.tsx` (corps de l'onglet `atelier`), `apps/desktop/src/styles/ide.css`. Les textes existent déjà. Test `apps/desktop/test/ide/atelier-bar.test.tsx`.

**Interfaces — Produces :**
```ts
// ide/AtelierBar.tsx — mockup atelierPage() .abar
export function AtelierBar(p: {
  /** The project filter shown after « Atelier » (R2): null for all projects. */
  filter: { name: string; color: string | null } | null; onClearFilter(): void;
  /** « Projets | Rigs » (R1): null hides it (no rig, OpenRig not installed). */
  grouping: 'projects' | 'rigs' | null; onGrouping(g: 'projects' | 'rigs'): void;
  helpers: boolean; onHelpers(): void;
  paused: boolean; onPaused(): void;
  /** R4: undefined hides « Détacher ». */
  onDetach?: () => void;
}): JSX.Element;
```
- Aspect (`.abar` de la maquette) : une rangée de 34 px au-dessus de l'atelier, bordure basse `--border`, padding 0 10 px, gap 8 px. « Atelier » est en `--muted-foreground` 12 px. Le segment `.seg2` a deux boutons `role="radio"` dans un `role="radiogroup"` (`aria-label` = `t.top.grouping`, `title` = `t.top.groupingHint[g]`). Les boutons texte sont en `.btn` (« Masquer les sous-agents » quand `helpers`, sinon « Afficher les sous-agents » ; « Détacher » avec `title` = `t.detached.detachTitle`). La pause est un bouton icône `SHELL_ICONS.pause` / `play`, avec `aria-pressed`.
- La puce du filtre reprend `ProjectSwatch` et la croix de `TopBar` (`aria-label` = `t.crumb.clearFilter`).
- Câblage dans `App.tsx`, onglet `atelier` non détaché : un conteneur `.ide-atelier` en colonne, avec `<AtelierBar>` puis `<Atelier>` inchangé. Les props :
  - `filter` vient de `tnav.place.project` (`'all'` → null, `'none'` → `t.side.unassigned` sans couleur) ;
  - `onClearFilter` → `dispatch({ type: 'home' })` ;
  - `grouping` → `offerRigs ? useGrouping() : null`, avec la même règle que `Sidebar.tsx` l. 93 (à extraire dans `openrig/grouping.ts` sous le nom `offersRigs(hasRigs, openrig)` et à réutiliser dans `Sidebar`) ;
  - `onHelpers` → `{ type: 'helpers' }` ; `onPaused` → `{ type: 'paused' }` ;
  - `onDetach` → `canDetach() && !detached ? detach : undefined`.
- [ ] **Step 1 : tests qui échouent** (`atelier-bar.test.tsx`, Testing Library, en français) :
  - `grouping: 'rigs'` → le radio « Rigs » a `aria-checked="true"`, et un clic sur « Projets » appelle `onGrouping('projects')` ;
  - `grouping: null` → aucun `radiogroup` ;
  - `helpers: true` → le bouton « Masquer les sous-agents », et son clic appelle `onHelpers` ;
  - `onDetach` absent → pas de « Détacher » ;
  - `filter: { name: 'ledge', color: '#888' }` → le texte `ledge`, et la croix « Retirer le filtre : voir tous les projets » appelle `onClearFilter` ;
  - `paused: true` → le bouton « Animer » avec `aria-pressed="true"`.

  Dans `test/ide/` (App monté avec l'interrupteur allumé, comme `frame.test.tsx`), on ajoute : l'onglet Atelier montre la barre, et « Rigs » appelle `setGrouping('rigs')`. Pour `offersRigs`, dans `test/sidebar-rigs.test.tsx` : la même réponse qu'avant pour (rigs, pas d'OpenRig), (pas de rigs, OpenRig installé) et (ni l'un ni l'autre).
- [ ] **Step 2 :** `pnpm --filter desktop test atelier-bar sidebar-rigs` → FAIL.
- [ ] **Step 3 :** implémenter `AtelierBar`, `offersRigs`, le câblage et le CSS.
- [ ] **Step 4 :** `pnpm --filter desktop test` et `pnpm --filter desktop typecheck` → PASS (hors échecs connus).
- [ ] **Step 5 : commit** `feat(desktop): the IDE's Atelier tab gets its bar — Projets | Rigs, subagents, filter, pause, Détacher`.

### Task 2 : Réglages › Espace de travail › Barre d'état

**Files :** Modify `apps/desktop/src/workspace/prefs.ts`, `apps/desktop/src/settings/WorkspaceSection.tsx`, `apps/desktop/src/App.tsx` (`usage=` de l'IDE seulement, l. ~803), `apps/desktop/src/i18n/fr.ts`, `en.ts` (`settings.workspace`), `apps/desktop/src/i18n/messages.ts` si la forme est typée là. Test `apps/desktop/test/workspace/prefs.test.tsx`, `apps/desktop/test/ide/settings-status-bar.test.tsx`.

**Interfaces — Produces :**
```ts
// workspace/prefs.ts — same shape as resumeOnStart
export const loadShowUsage: () => boolean;            // `ledge.ide.showUsage`: true unless a stored `false`
export function saveShowUsage(on: boolean): void;
export function useShowUsage(): [boolean, (on: boolean) => void];
```
- Textes (fr, mot pour mot de la maquette) :
  - `statusBar: 'Barre d’état'` ;
  - `usage: 'Limites d’usage des comptes'` ;
  - `alertBefore: 'Alerte à'`, `alertAfter: '% d’une fenêtre (ambre au-delà)'` ;
  - `alertLess: 'Baisser le seuil d’alerte de 5 %'`, `alertMore: 'Monter le seuil d’alerte de 5 %'` ;
  - `usageSaved: (on: boolean) => on ? 'Limites d’usage affichées dans la barre d’état' : 'Limites d’usage masquées de la barre d’état'`.

  Le toast de l'alerte reprend `t.settings.general.usageAlertSaved`. Les mêmes textes en anglais : `Status bar`, `Accounts' usage limits`, `Alert at`, `% of a window (amber beyond)`.
- Dans `WorkspaceSection`, une `Card title={w.statusBar}` entre « Ouvrir une session » et « Terminaux » (ordre de la maquette). Elle contient deux lignes :
  - une case à cocher `set-check` pour l'usage ;
  - un pas à pas `set-step`, comme WebGL. Il part de `Math.round(usageThreshold(useUsage(ctx.client)) * 100)` et avance par 5 dans `[USAGE_ALERT_MIN, USAGE_ALERT_MAX] × 100`. Il appelle `ctx.fleet.setUsageAlert(pct / 100)` dans un `try`, et une erreur arrive en `ctx.notify`. `usage.size === 0` → boutons `aria-disabled`, et le texte `t.settings.general.usageAlertUnknown` en indice de la ligne.
- `App.tsx` : `usage={showUsage ? <UsageFooter …/> : undefined}` pour l'IDE seulement. L'interface d'avant (l. ~834) et `LaunchModal` ne changent pas.
- [ ] **Step 1 : tests qui échouent** :
  - `prefs.test.tsx` : `loadShowUsage()` vaut vrai sans rien de stocké, et faux après `saveShowUsage(false)` ; `useShowUsage` fait rendre à nouveau les deux consommateurs.
  - `settings-status-bar.test.tsx` (avec un faux `ctx.fleet` et un usage à 80 %) :
    - le libellé « Barre d’état » et la case cochée ;
    - un clic sur la case la décoche et `saved` reçoit « Limites d’usage masquées de la barre d’état » ;
    - `+` appelle `setUsageAlert(0.85)` ;
    - à `USAGE_ALERT_MAX`, `+` n'appelle rien ;
    - sans usage, `−` n'appelle rien et l'indice `usageAlertUnknown` est là ;
    - un `setUsageAlert` qui lève → `notify` reçoit son message.
  - Dans `test/ide/status-bar.test.tsx` (ou le test App-niveau de l'IDE) : avec `ledge.ide.showUsage` à `false`, la barre d'état de l'IDE n'a plus le bouton des limites.
- [ ] **Step 2 :** `pnpm --filter desktop test prefs settings-status-bar status-bar` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm --filter desktop test` et `pnpm --filter desktop typecheck` → PASS.
- [ ] **Step 5 : commit** `feat(desktop): Settings › Workspace › Status bar — show the usage limits, the alert threshold`.

### Task 3 : Parcours e2e, captures et questions pour design-ux

**Files :** Create `apps/desktop/e2e/ide-settings-atelier.spec.ts`, `docs/ide-lot-6-questions.md` (fichier de travail).

- Le parcours, en 1920×1080, interrupteur allumé, faux daemon `eight` + `twoProjects` (comme `ide-shell.spec.ts`), avec un rig pour que « Projets | Rigs » apparaisse :
  - **Ctrl+,** ouvre l'onglet « Réglages » sur Général. Choisir Espace de travail, aller à l'Atelier, puis refaire `Ctrl+,` ramène le même onglet sur Espace de travail, sans doublon.
  - **Atelier** : la barre est là, et « Rigs » regroupe les sièges par rig. Un clic sur un agent ouvre sa session dans le groupe actif. `Ctrl`+clic sur un autre agent l'ouvre dans un nouveau groupe à droite. Avec « Ouvrir une session : À droite », un simple clic ouvre aussi à droite. Le bureau de Ledge ouvre le panneau de droite. « Masquer les sous-agents » retire les sièges d'aide. Le filtre posé depuis l'explorateur montre la puce, et la croix la retire.
  - **Barre d'état** : décocher « Limites d'usage des comptes » retire les limites de la barre d'état. `+` envoie `usage.alert` au faux daemon.
- Les captures zoomées de la barre de l'atelier et de la rubrique « Barre d'état », en clair et en sombre, se comparent à la maquette : barre de 34 px, 12 px de texte, alignement des boutons.
- Les captures pour `design-ux` (R8) : l'onglet Atelier et l'onglet Réglages dans un groupe de 480 px et de 720 px (divisé par `Ctrl+\`, puis le séparateur glissé).
- `docs/ide-lot-6-questions.md` pose ces questions :
  1. la lisibilité de l'atelier dans un groupe étroit (captures R8) ;
  2. la nav des Réglages dans un groupe étroit : colonne gardée, ou une rangée d'onglets comme la page OpenRig ;
  3. la confirmation « Taper dans un terminal attaché » (R5) : quand elle s'ouvre, son texte, et ce que fait la case ;
  4. la place de « Figer les animations » dans la barre de l'atelier (R3) ;
  5. la puce du filtre de projet dans la barre (R2) ;
  6. la ligne « Alerte à » sans aucune machine qui donne ses limites (R6).
- [ ] **Step 1 :** écrire le parcours ; `pnpm --filter desktop e2e ide-settings-atelier` → PASS (le premier démarrage prend ~2,5 min).
- [ ] **Step 2 :** `pnpm --filter desktop e2e` complet → seuls les échecs connus (Global Constraints).
- [ ] **Step 3 :** écrire `docs/ide-lot-6-questions.md` avec les captures (sous `apps/desktop/test-results/`, non commitées), puis les transmettre à `design-ux`.
- [ ] **Step 4 : commit** `test(desktop): the IDE's Settings and Atelier tabs, end to end` (le fichier de questions sort du commit final, avant la PR).

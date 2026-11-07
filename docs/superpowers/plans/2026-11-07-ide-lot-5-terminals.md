# Refonte IDE, lot 5 : panneau du bas et terminaux, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** derrière l'interrupteur « Interface IDE (aperçu) », le panneau du bas (`Ctrl+J`) prend la forme de la maquette. Il montre les terminaux côte à côte avec leur nombre en icône, et la Sortie des commandes `rig` lancées par Ledge. Le menu « + ▾ » ouvre un shell WSL, PowerShell, invite de commandes, Git Bash, Ledge ou SSH vers une machine, et le dernier choisi devient celui par défaut. Un terminal glisse du panneau vers un groupe et revient en le déposant sur le panneau. Fermer le dernier terminal masque le panneau. Le rendu WebGL est limité à N terminaux visibles.

**Architecture :**
- **Back (Rust, Desktop) :** `pty_open` ne sait lancer que `wsl.exe`. Il gagne un paramètre `native` (`powershell` | `cmd` | `gitbash`) : le programme est **résolu côté Rust** depuis une liste fermée (jamais un chemin envoyé par la page). Une commande `shells_available` dit ce qui est installé : la distribution WSL par défaut, PowerShell (`pwsh` sinon Windows PowerShell), cmd, Git Bash. La logique de recherche vit dans `crates/ledge-native/src/shells.rs`, pure et testée sous Linux.
- **Le daemon ne change pas.** Ses shells (`term.shell`) sont rattachés à une session ; les shells du panneau n'en ont pas. WSL et SSH passent par le PTY local existant (`wsl.exe --exec`, `ssh -t <alias>` comme `shellCommand`), les machines SSH viennent de la configuration de la flotte (`MachineState.ssh`). La CLI Ledge est un shell WSL.
- **Front :** `TermStore` gagne des **shells libres** (`shell:<n>`), sans session, à côté des shells de session. Le panneau garde la liste de ses terminaux dans un petit magasin pur (`workspace/panel.ts`). Un terminal vit soit dans le panneau, soit dans un onglet du dock (`terminal:shell:<n>` ou `terminal:agent:<id>`), jamais les deux : le xterm se déplace (`surface.host`), le processus reste.
- La Sortie est un journal de l'application (`openrig/rigOutput.ts`) nourri par les réponses `openrig.done`, `openrig.launched` et `openrig.reseated` que reçoit ce Desktop.
- Le budget WebGL vit dans `term/webgl.ts` (règle pure) et `TermStore` (qui l'applique) : un terminal masqué rend en DOM, les N derniers montrés en WebGL.

**Tech Stack:** React 19, TypeScript, xterm.js (`@xterm/addon-webgl`), `dockview-react` 8.6.1 (API d'import externe : `onUnhandledDragOver`, `onDidDrop`), Tauri 2, Rust (`portable-pty`), vitest + Testing Library, Playwright.

**Spec :**
- [`docs/ide-workspace.md`](../../ide-workspace.md) : « La fenêtre » (panneau du bas), « Terminaux », « Réglages » (Terminaux), « Raccourcis » (`Ctrl+J`).
- [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md) : lot 5 (§5), §3.1 (un seul document, les mêmes `Channel` PTY), §3.5 (WebGL), D1.
- Le prototype [`docs/mockups/ledge-ide-interactive.html`](../../mockups/ledge-ide-interactive.html) (v26), qui fait foi pour l'aspect :
  - `bottomPanel()` (l. 1103-1114), CSS `.bpanel`, `.bp-tabs` (l. 224-228), `.bterms` (l. 447-448), `.chip-k` (l. 388), `.term` (l. 203) ;
  - le menu `m.kind==='term'` (l. 1141), `SHELLS` et `newShell()` (l. 1171-1175) ;
  - `case 'addterm'`, `'closeterm'`, `'termmenu'` (l. 1397-1400), le `keydown` `Ctrl+J` (l. 1482) ;
  - le glisser (l. 1497-1517) : tuile du panneau → groupe ou « nouveau groupe », onglet terminal → panneau ;
  - la Sortie : `orApply()` et `seatsDelta()` (l. 1305-1332) ;
  - le groupe vide (l. 895, bouton « Terminal ») ;
  - Réglages › Espace de travail › Terminaux (l. 1058).

## Global Constraints

- Branche `feat/ide-lot-5`, partie de `origin/main` 8cecdac0 (0.51.0, lots 1 à 4). Une PR vers `main` (`Lyssaen/ledge`), seulement avec l'accord de l'utilisateur. Rien n'est poussé sans lui.
- Interrupteur coupé, l'interface actuelle est **inchangée** : le panneau de droite d'une session (`RightPanel`, ses shells de session) et ses tests restent verts sans retouche. Seul le budget WebGL vaut aussi hors IDE.
- Le daemon (`packages/ledge`) et le protocole (`packages/protocol`) ne changent pas.
- Échecs déjà présents sur `main` : e2e `island.spec.ts:166`, `proposals.spec.ts:36`, `daemon-update.spec.ts:8` (instable), `atelier.spec.ts:208` (instable sous charge) ; vitest « reconnect asks Nova's thread again » ; mobile `link.test.ts`, « relay out of reach ».
- Textes en français et en anglais (`src/i18n/fr.ts`, `en.ts`), sous `ide.panel`. Le français reprend la maquette mot pour mot.
- Couleurs par les jetons du thème (clair et sombre), jamais les hex de la maquette. Le reset `button:not(.ledge-btn)` d'`app.css` écrase les règles à une seule classe sur un bouton : sélecteurs préfixés (`.ide-bottom .ide-bp-tabs button`).
- Tout état absent de la maquette se demande à `design-ux` et ne s'invente pas. On le note dans `docs/ide-lot-5-questions.md`, reporté dans le compte rendu puis supprimé avant la PR. En attendant, on reprend le texte existant le plus proche (cité dans chaque tâche).
- « Nouvelle fenêtre » (lot 9) reste masqué : on ne détache pas un terminal hors de la fenêtre.
- Node 22 (`eval "$(fnm env)"; fnm use 22`). Tests : `pnpm --filter desktop test`, `pnpm --filter desktop typecheck`, `pnpm --filter desktop e2e` ; Rust : `cargo test -p ledge-native` (WSL), puis `cargo test` côté Windows avant l'installeur.
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jamais `apps/desktop/test-results/*.png`. Jamais `git stash` nu.
- `docs/ide-lot-5-brief.md` est un fichier de travail : supprimé avant la PR.

## Rulings (à valider)

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | **Le daemon ne change pas.** Les shells du panneau passent par le PTY local de Desktop : WSL par `wsl.exe --exec`, SSH par `ssh -t <alias>` lancé dans WSL (comme le shell d'une session sur une machine SSH aujourd'hui), PowerShell, cmd et Git Bash par un nouveau `pty_open` natif. Le canal du daemon (`term.shell`) reste réservé aux shells de session. | Un shell SSH dépend alors de la clé SSH de WSL, pas du daemon distant. Passer par le daemon demande un `term.shell` sans session, côté daemon et protocole : ~1 jour de plus. |
| R2 | **Shells Windows natifs :** PowerShell = `pwsh.exe` s'il est sur le `PATH`, sinon `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (`-NoLogo`) ; invite de commandes = `%ComSpec%` ; Git Bash = `bash.exe --login -i` sous `%ProgramFiles%\Git\bin`, `%ProgramFiles(x86)%\Git\bin` ou `%LOCALAPPDATA%\Programs\Git\bin`. Ils s'ouvrent dans `%USERPROFILE%`. Un shell absent **n'apparaît pas** dans le menu. | Une ligne grisée « non installé » à la place : une ligne dans `shellMenu` et un texte à demander. |
| R3 | **Libellés :** WSL prend le nom de sa distribution par défaut (« WSL · Ubuntu », lu par `wsl.exe --exec printenv WSL_DISTRO_NAME`), « WSL » s'il ne répond pas. Un terminal s'appelle `<libellé> <n>`, avec un **compteur unique** pour tous les shells du panneau, comme la maquette (« PowerShell 2 »). | Un compteur par sorte : une ligne. |
| R4 | **« Ledge » (CLI `ledge` et `rig`)** ouvre un shell WSL dans le dossier personnel, qui affiche d'abord `ledge who`, puis rend la main. Ce n'est pas une console à part : l'invite `ledge ›` de la maquette n'existe pas. La ligne n'apparaît que si la machine locale a un lanceur Ledge (`MachineState.launcher`). | Retirer `ledge who` (une ligne), ou concevoir une vraie console : hors lot. |
| R5 | **Machines (SSH) :** une ligne par machine configurée qui a un alias SSH, libellée de son nom, avec l'alias à droite (maquette : « SSH · srv-build », « srv-build »). Sans machine SSH, la section « Machines » disparaît. Le shell s'ouvre dans le dossier personnel distant. | Garder la section avec « Ajouter une machine… » : un texte à demander et un lien vers Réglages › Machines. |
| R6 | **Le dossier d'un shell WSL** : celui de la session de l'onglet actif du groupe actif (son worktree, sinon son dossier), sinon le dossier personnel. La maquette montre `~/Workspace/ledge`. | Toujours le dossier personnel : une ligne. |
| R7 | **« par défaut »** : le dernier shell choisi est retenu (`ledge.ide.lastShell`, ce poste), WSL au départ. « + » seul n'existe pas : le bouton ouvre toujours le menu (maquette). `Ctrl+J`, le bouton « Terminal » d'un groupe vide et l'ouverture du panneau vide prennent le shell par défaut. Si ce shell n'est plus disponible (machine retirée, Git Bash désinstallé), c'est WSL. | Rendre « + » direct et « ▾ » menu : un bouton de plus. |
| R8 | **Ce qui glisse :** une tuile du panneau vers un groupe (centre, onglets, bord droit) ou vers la zone « nouveau groupe » ; un onglet terminal (shell ou écran d'agent) vers le panneau. Un autre onglet déposé sur le panneau est refusé avec le message de la maquette (« Seuls les terminaux se rangent dans le panneau du bas. »). Sortir de la fenêtre : lot 9. | — |
| R9 | **Fermer :** fermer un shell (× de la tuile ou de l'onglet) le tue, sans confirmation, comme les shells de session. Fermer l'écran d'un agent ne fait que le retirer du panneau. Fermer le dernier terminal masque le panneau, avec le message de la maquette. | Une confirmation quand un shell tourne encore : un texte à demander. |
| R10 | **Les quatre sortes** sont écrites sur la tuile et sur l'onglet (`.chip-k`) : `attaché`, `shell`, `lecture seule` existent ; `commande` (une commande relancée, `rig ps`) a son texte mais **aucune source** dans ce lot. Elle viendra avec la topologie (lot 7). | Ajouter une commande relancée (« Relancer `rig ps` ») : un lot 7 qui arrive plus tôt. |
| R11 | **La Sortie** liste, pour la session de Desktop, chaque réponse `openrig.done`, `openrig.launched` et `openrig.reseated` : une ligne grise `HH:MM · <commandes jointes par « && »>`, puis `✓ <dernière ligne de la sortie>` (ou `✓` seul) en vert, ou `✗ <erreur>` en rouge. Les commandes `rig` des autres fronts (téléphone, TUI) n'y sont pas : le daemon ne les diffuse pas. 200 entrées au plus, perdues au redémarrage. Le compteur de l'icône est le nombre d'entrées. | Diffuser les actions à tous les fronts : un changement daemon + protocole. Garder l'historique : un fichier côté daemon. |
| R12 | **Budget WebGL :** 12 par défaut, de 1 à 16, réglable dans Réglages › Espace de travail › Terminaux (ligne « Rendu rapide (WebGL) pour N terminaux visibles au plus »). Il vaut pour toute l'application, interrupteur coupé compris. Les plus récemment montrés gardent WebGL ; un terminal masqué rend en DOM et rend son contexte. | — |
| R13 | **« Taper dans un terminal attaché sans confirmation »** n'est pas fait dans ce lot : aucune confirmation n'existe aujourd'hui, ni dans la maquette. Il faudrait la dessiner. Il va au lot 6 (Réglages) avec `design-ux`. | La case et la confirmation à faire ici : ~½ jour, après le dessin. |
| R14 | La palette ne gagne pas « Nouveau terminal » : la vraie palette de commandes est au lot 10. | Une ligne dans la palette, comme « Nouvelle session » au lot 4. |
| R15 | **Le panneau garde ses terminaux** le temps de la fenêtre (pas de persistance) ; la hauteur reste 240 px fixe (maquette), sans poignée. Au redémarrage, un onglet `terminal:shell:*` restauré sans son shell est retiré (`reconcile`). | Une poignée de hauteur : ~½ jour. |

## Review Focus

1. **Un shell glissé du panneau vers un groupe, puis ramené.** Le même xterm, avec son contenu et son processus, passe d'un endroit à l'autre ; rien n'est relancé ; la frappe va toujours au même processus. Le panneau vidé par le glisser se masque.
2. **`Ctrl+J` après la fermeture du dernier terminal.** Le panneau réapparaît avec un shell du type par défaut, un seul, même après plusieurs `Ctrl+J` rapides.
3. **Plus de 12 terminaux visibles.** Le 13e montré rend en DOM ; masquer un terminal WebGL rend son contexte au suivant. Une perte de contexte (`onContextLoss`) ne laisse jamais un terminal sans rendu.
4. **Le shell meurt (exit, ssh coupé) pendant qu'il est dans un onglet du dock.** L'onglet montre « Shell terminé (code N) » ou « connexion perdue » et « Rouvrir » ; rouvrir relance le même type de shell au même endroit.
5. **Sous le navigateur ou sans Tauri (build e2e).** `shells_available` absent : le menu n'offre que ce que la fausse PTY sait faire ; rien ne lève d'exception, et un shell indisponible affiche « Ce dossier ne peut pas être ouvert dans un shell. ».

---

### Task 1 : Les shells Windows natifs (Rust)

**Files:** Create `crates/ledge-native/src/shells.rs` ; Modify `crates/ledge-native/src/lib.rs`, `crates/ledge-native/src/pty.rs` (`Pty::spawn` gagne `cwd: Option<&Path>`), `apps/desktop/src-tauri/src/pty.rs`, `apps/desktop/src-tauri/src/main.rs` (enregistrer `shells_available`). Test : dans `shells.rs` et `pty.rs`.

**Interfaces — Produces :**
```rust
// crates/ledge-native/src/shells.rs
pub enum NativeShell { PowerShell, Cmd, GitBash }
impl NativeShell { pub fn parse(s: &str) -> Option<NativeShell> } // "powershell" | "cmd" | "gitbash"
/// The program, its arguments and its folder (R2). `env` reads a variable, `exists` says whether a file is there.
pub fn locate(shell: NativeShell, env: &dyn Fn(&str) -> Option<String>, exists: &dyn Fn(&Path) -> bool) -> Option<(PathBuf, Vec<String>, Option<PathBuf>)>;
```
```rust
// apps/desktop/src-tauri/src/pty.rs
#[derive(serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct ShellsAvailable { pub wsl: Option<String>, pub powershell: bool, pub cmd: bool, pub git_bash: bool }
#[tauri::command] pub async fn shells_available() -> ShellsAvailable;  // non-Windows: all false, wsl None
// pty_open gains `native: Option<String>`: Some → locate() (argv ignored), unknown or absent → Err; None → wsl.exe as today.
```
- `pwsh.exe` se cherche dans les dossiers de `PATH` (séparés par `;`). `wsl` : la sortie de `wsl.exe --exec printenv WSL_DISTRO_NAME` (fenêtre cachée, `CREATE_NO_WINDOW`, 3 s au plus), `Some("")` devient `Some` du libellé vide → le front affiche « WSL ».
- [ ] **Step 1 : tests qui échouent** (`shells.rs`, `#[cfg(test)]`, avec un `env` et un `exists` simulés) : `pwsh` trouvé dans le 2e dossier du `PATH` → ce chemin, args `["-NoLogo"]`, dossier `USERPROFILE` ; sans `pwsh` → `<SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe` ; cmd → `ComSpec` ; Git Bash sous `ProgramFiles(x86)` seulement → ce chemin, args `["--login", "-i"]` ; rien d'installé → `None` ; `NativeShell::parse("bash")` → `None`.
- [ ] **Step 2 :** `cargo test -p ledge-native shells` → FAIL.
- [ ] **Step 3 :** implémenter `shells.rs`, `Pty::spawn(program, args, cwd, …)` (les appels existants passent `None`), `pty_open` avec `native`, `shells_available`.
- [ ] **Step 4 :** `cargo test -p ledge-native` → PASS ; `cargo check -p ledge-desktop` (WSL) passe.
- [ ] **Step 5 : commit** `feat(desktop): pty_open runs PowerShell, cmd and Git Bash, and says which are installed`.

### Task 2 : Les sortes de shell et le menu « + ▾ » (logique pure)

**Files:** Create `apps/desktop/src/term/shells.ts`. Modify `apps/desktop/src/term/backend.ts`, `apps/desktop/src/tauri/bridge.ts` (`openPty` passe `native`, `shellsAvailable()`), `apps/desktop/src/main.tsx` (la fausse PTY accepte `native`, et `__ledgeShells` simule `shells_available`). Test `apps/desktop/test/term-shells.test.ts`.

**Interfaces — Produces :**
```ts
export type ShellKind = 'wsl' | 'powershell' | 'cmd' | 'gitbash' | 'ledge' | `ssh:${string}`; // ssh:<machine id>
export interface ShellsAvailable { wsl: string | null; powershell: boolean; cmd: boolean; gitBash: boolean }
export interface ShellRow { kind: ShellKind; label: string; hint: string; isDefault: boolean; section: 'local' | 'ledge' | 'machines' }
/** Le menu (R2, R4, R5) : Locaux (WSL, PowerShell, invite de commandes, Git Bash), Ledge, Machines ; « par défaut » sur `last`. */
export function shellMenu(avail: ShellsAvailable, machines: readonly MachineState[], last: ShellKind, t: Messages): ShellRow[];
/** `last` s'il est encore au menu, sinon 'wsl' (R7). */
export function defaultShell(rows: readonly ShellRow[], last: ShellKind): ShellKind;
/** Ce que la PTY lance : argv WSL (`dir` : R6), ou un shell natif. null : impossible (dossier refusé par wsl.exe, machine inconnue). */
export function shellLaunch(kind: ShellKind, ctx: { dir: string; machines: readonly MachineState[] }): { argv: string[] } | { native: 'powershell' | 'cmd' | 'gitbash' } | null;
export function loadLastShell(): ShellKind; export function saveLastShell(k: ShellKind): void; // `ledge.ide.lastShell`
// backend.ts
export interface PtyBackend { open(argv: string[], size: { cols: number; rows: number }, on: PtyEvents, native?: 'powershell' | 'cmd' | 'gitbash'): Promise<PtyHandle | null> }
// bridge.ts
export function shellsAvailable(): Promise<ShellsAvailable>; // hors Tauri : { wsl: null, powershell: false, cmd: false, gitBash: false } ; e2e : window.__ledgeShells
```
- Libellés (fr, maquette) : `WSL · <distro>` (ou `WSL`), `PowerShell`, `Invite de commandes`, `Git Bash`, `Ledge` (hint `ledge, rig`), `SSH · <label>` (hint : l'alias). Hint « par défaut » sur la ligne `last`, qui remplace l'autre hint. En-têtes de section : `Locaux`, `Ledge`, `Machines` ; titre du menu : `Nouveau terminal`.
- Hors Tauri, WSL reste au menu quand la fausse PTY existe (e2e) : `wsl` vaut `'Ubuntu'` dans `__ledgeShells` par défaut.
- `shellLaunch('wsl')` : `shellCommand(local, dir)` de `@ledge/fleet` ; `'ledge'` : `['sh', '-c', 'cd; ledge who; exec $(getent passwd $(id -un) | cut -d: -f7) -l']` ; `'ssh:<id>'` : `shellCommand(machine, '~')` de cette machine (qui a `ssh`).
- [ ] **Step 1 : tests qui échouent** : tout disponible + une machine SSH `srv` (`label: 'srv-build'`) → 7 lignes dans l'ordre WSL, PowerShell, Invite de commandes, Git Bash, Ledge, SSH · srv-build, sections justes ; `last: 'gitbash'` → seule la ligne Git Bash a `isDefault` et le hint « par défaut » ; Git Bash absent → pas de ligne, et `defaultShell(rows, 'gitbash')` → `'wsl'` ; pas de lanceur local → pas de ligne Ledge ; pas de machine SSH → pas de section Machines ; `shellLaunch('powershell')` → `{ native: 'powershell' }` ; `shellLaunch('ssh:inconnue')` → `null` ; `shellsAvailable()` hors Tauri et sans `__ledgeShells` → tout faux, `wsl: null`, sans exception ; `shellLaunch('wsl', { dir: '/home/u/w' })` commence par `['sh', '-c']` et contient `cd '/home/u/w'`.
- [ ] **Step 2 :** `pnpm --filter desktop test term-shells` → FAIL.
- [ ] **Step 3 :** implémenter ; textes sous `t.ide.panel.shells` (fr + en).
- [ ] **Step 4 :** même commande → PASS ; `pnpm --filter desktop typecheck`.
- [ ] **Step 5 : commit** `feat(desktop): the bottom panel's shell kinds — what is installed, the « + ▾ » rows, the default one`.

### Task 3 : Les shells libres dans `TermStore`

**Files:** Modify `apps/desktop/src/term/store.ts`, `apps/desktop/src/term/useTerms.ts`, `apps/desktop/src/App.tsx` (deps). Test `apps/desktop/test/term-free-shells.test.ts`.

**Interfaces :**
- Consumes : Task 2 (`ShellKind`, `shellLaunch`, `PtyBackend.open(…, native)`).
- Produces :
```ts
export interface FreeShell { id: string; kind: ShellKind; n: number; title: string; dir: string; status: 'running' | 'ended' | 'unavailable'; end?: { code: number | null; lost: boolean } }
// TermDeps gains: freeLaunch(kind: ShellKind, dir: string): { argv: string[] } | { native: 'powershell' | 'cmd' | 'gitbash' } | null; freeTitle(kind: ShellKind, n: number): string
class TermStore {
  /** Starts a shell with no session; id `shell:<n>`, n from one counter (R3). Starts at once. */
  openFree(kind: ShellKind, dir: string): string;
  free(id: string): FreeShell | undefined;
  /** Kills it, disposes its xterm (R9). */
  closeFree(id: string): void;
  /** An ended one: the same kind, the same dir, the same xterm. */
  reopenFree(id: string): void;
}
export function useFreeShell(id: string): FreeShell | undefined;
```
- Même règles que les shells de session : rien n'est relancé tout seul, la frappe avant la poignée est gardée (`typed`), `ssh:*` qui sort en 255 → `lost: true`, l'xterm est fait une fois et suit le thème. La surface d'un shell libre a la clé `shell:<n>` (`surface(id)`).
- [ ] **Step 1 : tests qui échouent** (fausse `PtyBackend`, fausse surface comme `test/term-store*.test.ts`) : `openFree('wsl', '/w')` → id `shell:1`, `status: 'running'`, `open` appelé avec l'argv de `freeLaunch` ; `openFree('powershell', …)` → `open(…, 'powershell')` ; deux ouvertures → `shell:1` puis `shell:2` et titres `freeTitle(kind, 1|2)` ; `freeLaunch` null → `unavailable` ; exit 0 → `ended`, code 0 ; `ssh:srv` qui sort en 255 → `lost: true` ; `reopenFree` sur un `ended` → un nouvel `open`, même surface ; `closeFree` → `close()` de la poignée et `dispose()` de la surface ; ce qui est tapé avant la poignée lui arrive dans l'ordre.
- [ ] **Step 2 :** `pnpm --filter desktop test term-free-shells` → FAIL.
- [ ] **Step 3 :** implémenter (une `Map<string, FreeShell & { run }>` à part des `entries` de session ; `emit` partagé). `App.tsx` passe `freeLaunch` (Task 2, machines de la flotte) et `freeTitle` (libellés du menu + n).
- [ ] **Step 4 :** même commande → PASS ; les tests `term-store*` existants passent sans retouche.
- [ ] **Step 5 : commit** `feat(desktop): shells with no session in the terminal store, for the bottom panel`.

### Task 4 : Le budget WebGL

**Files:** Create `apps/desktop/src/term/webgl.ts`. Modify `apps/desktop/src/term/surface.ts` (`setWebgl`), `apps/desktop/src/term/store.ts` (`setShown`), `apps/desktop/src/session/AgentView.tsx`, `apps/desktop/src/session/RightPanel.tsx` (ils disent quand leur surface est montrée), `apps/desktop/src/workspace/prefs.ts` ou un nouveau `term/webglPrefs.ts` (`ledge.ide.webgl`), `apps/desktop/src/settings/WorkspaceSection.tsx`, i18n. Test `apps/desktop/test/term-webgl.test.ts`, `apps/desktop/test/ide/settings-terminals.test.tsx`.

**Interfaces — Produces :**
```ts
// webgl.ts
export const WEBGL_DEFAULT = 12, WEBGL_MIN = 1, WEBGL_MAX = 16;
/** Les terminaux qui rendent en WebGL : les `max` derniers montrés (`shown` dans l'ordre où ils l'ont été, le plus récent à la fin). */
export function webglPick(shown: readonly string[], max: number): ReadonlySet<string>;
// surface.ts — TermSurface gains:
setWebgl(on: boolean): void; // charge ou libère l'addon ; une perte de contexte le libère et le note (le budget ne le redonne qu'au prochain setWebgl(true))
// store.ts
setShown(surfaceId: string, shown: boolean): void; setWebglMax(n: number): void;
// prefs
export function useWebglMax(): [number, (n: number) => void];
```
- Une surface naît **sans** WebGL ; `setShown(id, true)` la met en fin de liste et applique `webglPick` à toutes. `createSurface` ne charge plus l'addon lui-même.
- Réglages › Espace de travail : une 2e carte « Terminaux » (maquette l. 1058) avec la ligne `Rendu rapide (WebGL) pour` [– N +] `terminaux visibles au plus` (bornes 1 à 16), enregistrée à chaque pas avec le message `saved` existant de la section.
- [ ] **Step 1 : tests qui échouent** : `webglPick(['a','b','c'], 2)` → `{b, c}` ; `max` 0 ou négatif → borné à 1 ; store : 3 surfaces montrées avec max 2 → la 1re reçoit `setWebgl(false)`, les deux autres `true` ; `setShown('b', false)` → `a` reçoit `setWebgl(true)` ; `setWebglMax(1)` → seule la dernière reste WebGL ; le réglage : « + » au maximum ne dépasse pas 16, la valeur est relue après remontage ; une perte de contexte d'une surface WebGL la laisse en DOM, et le store ne la compte plus parmi les WebGL (le suivant de la liste reprend WebGL).
- [ ] **Step 2 :** `pnpm --filter desktop test term-webgl settings-terminals` → FAIL.
- [ ] **Step 3 :** implémenter ; `AgentView` et `RightPanel` appellent `setShown` quand leur surface est attachée à un élément visible (montage, `TabPlace.visible`) et `false` au démontage ; `App.tsx` passe `useWebglMax` au store.
- [ ] **Step 4 :** même commande → PASS ; `pnpm --filter desktop test` complet.
- [ ] **Step 5 : commit** `feat(desktop): WebGL for the last 12 terminals shown, the DOM for the rest, set in Settings › Workspace`.

### Task 5 : La Sortie des commandes `rig`

**Files:** Create `apps/desktop/src/openrig/rigOutput.ts`, `apps/desktop/src/ide/OutputView.tsx`. Modify `apps/desktop/src/App.tsx` (un journal par client), i18n. Test `apps/desktop/test/rig-output.test.ts`.

**Interfaces — Produces :**
```ts
export interface RigOutputEntry { at: number; machine: string; commands: readonly string[]; ok: boolean; result: string | null }
export const RIG_OUTPUT_MAX = 200;
/** Écoute openrig.done, openrig.launched, openrig.reseated (R11) ; ignore une réponse sans commande (`commands` vide) et l'annulation locale (`error: 'cancelled'`). */
export function createRigOutput(client: Pick<DaemonClient, 'onMessage'>, now?: () => number): { entries(): readonly RigOutputEntry[]; subscribe(fn: () => void): () => void; dispose(): void };
/** `result` : en succès, la dernière ligne non vide de `output` (null sans sortie) ; en échec, `error`. */
export function useRigOutput(log: ReturnType<typeof createRigOutput>): readonly RigOutputEntry[];
export function OutputView({ entries }: { entries: readonly RigOutputEntry[] }): JSX.Element;
```
- `OutputView` : un `.term` de la maquette en `pre` ; par entrée, `HH:MM · <commandes jointes par « && »>` en `--t-dim`, puis `✓ <result>` (`✓` en `--t-green`) ou `✗ <result>` (`✗` en `--t-red`). Défile en bas à chaque entrée nouvelle si l'on était en bas. Vide : texte à demander à `design-ux` (question 1) ; en attendant `Aucune commande rig lancée depuis l'ouverture de Ledge.`
- [ ] **Step 1 : tests qui échouent** : un `openrig.done` ok avec `commands: ['rig up demo --existing --yes --json']`, `output: 'a\nb\n'` → une entrée `ok`, `result: 'b'`, `machine` = `machineId ?? 'local'` ; un `openrig.reseated` en échec `error: 'busy'` → `ok: false`, `result: 'busy'` ; `commands: []` → ignorée ; 201 entrées → les 200 dernières ; `dispose()` retire l'écoute. Un rendu d'`OutputView` avec deux entrées montre `12:04 · rig down demo` et `✓`.
- [ ] **Step 2 :** `pnpm --filter desktop test rig-output` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** même commande → PASS.
- [ ] **Step 5 : commit** `feat(desktop): the bottom panel's Output — the rig commands Ledge ran and how they ended`.

### Task 6 : Le panneau du bas

**Files:** Create `apps/desktop/src/workspace/panel.ts`, `apps/desktop/src/ide/BottomPanel.tsx`, `apps/desktop/src/session/FreeShellView.tsx` (exporté par `session/Workspace.tsx` et `session/lazy.tsx`, comme `AgentTerminalTab` : xterm vit dans ce chunk). Modify `apps/desktop/src/ide/IdeFrame.tsx` (le panneau sort du fichier, prop `bottom: ReactNode`), `apps/desktop/src/ide/EmptyGroup.tsx` (bouton « Terminal »), `apps/desktop/src/ide/tabs.tsx` (titre de `terminal:shell:*`), `apps/desktop/src/App.tsx` (corps des onglets `terminal:shell:*`, `reconcile`), `apps/desktop/src/styles/ide.css`, i18n, `docs/ide-lot-5-questions.md`. Test `apps/desktop/test/ide/panel-model.test.ts`, `apps/desktop/test/ide/bottom-panel.test.tsx`.

**Interfaces :**
- Consumes : Tasks 2, 3, 5 ; `Menu` (`shell/Menu.tsx`) ; `AgentTerminalPlace`.
- Produces :
```ts
// workspace/panel.ts — pur, + un petit magasin useSyncExternalStore (non persisté, R15)
export interface Panel { terms: readonly string[]; tab: 'term' | 'out' } // terms : refs d'onglet terminal (`shell:<n>`, `agent:<id>`)
export function addTerm(p: Panel, ref: string): Panel;     // à la fin, onglet 'term' ; déjà là : inchangé
export function removeTerm(p: Panel, ref: string): Panel;
export const isTerminalRef = (key: string): boolean;       // `terminal:shell:*` ou `terminal:agent:*`
// ide/BottomPanel.tsx
export function BottomPanel(p: { panel: Panel; onTab(t: 'term' | 'out'): void; outputCount: number; output: ReactNode;
  menu: readonly ShellRow[]; onNewShell(k: ShellKind): void; tile(ref: string): ReactNode; tileTitle(ref: string): string; tileKind(ref: string): string;
  onClose(ref: string): void; onHide(): void }): JSX.Element;
// session/FreeShellView.tsx
export function FreeShellView({ id }: { id: string }): JSX.Element; // le xterm (host déplacé, jamais refait), bandeau ended/unavailable + « Rouvrir »
```
- Aspect (maquette `bottomPanel()`) : 240 px ; barre `.ide-bp-tabs` : onglet Terminaux (icône + nombre de terminaux en mono 11 px), onglet Sortie (icône + nombre d'entrées), espace, « + ▾ » (`aria-label` « Nouveau terminal », `title` « Nouveau terminal : choisir le shell »), « × » (« Masquer le panneau »). Corps Terminaux : `.ide-bterms` en flex, tuiles côte à côte séparées de 1 px (`gap: 1px`, fond `--border`), chaque tuile : une barre d'onglet avec un seul onglet actif `>_ <titre>` (`draggable`, `title` « Glisser vers un groupe, ou hors de la fenêtre » → sans « ou hors de la fenêtre » tant que le lot 9 n'est pas là), puis `.chip-k` (sorte) et « × » (« Fermer ») ; dessous le terminal.
- Le menu « + ▾ » : `Menu` sous le bouton, titre `Nouveau terminal`, sections séparées, hint à droite (`.r`). Choisir une ligne : `saveLastShell`, `openFree(kind, dir R6)`, `addTerm`, onglet Terminaux, panneau affiché.
- Règles câblées dans `App.tsx` :
  - le panneau devient visible (`layout.bottom` passe à vrai) avec `terms` vide → un shell par défaut (R7), **une seule fois** par passage à vrai ;
  - fermer : `closeFree` pour un `shell:*`, puis `removeTerm` ; `terms` vide → `layout show bottom false` et `notify('Dernier terminal fermé : le panneau du bas se masque. Ctrl+J le rouvre avec un shell.')` ;
  - un onglet `terminal:shell:<n>` du dock se rend par `FreeShellView` sous la rangée `.ide-term-kind` (`chip-k` « shell ») ; son titre est `>_ <titre>` ; le fermer tue le shell (R9) ;
  - `reconcile` retire `terminal:shell:*` que le store ne connaît pas ;
  - le groupe vide gagne le bouton « Terminal » (maquette l. 895, après Atelier) : un shell par défaut, en onglet dans ce groupe.
- États absents → `docs/ide-lot-5-questions.md` : (1) la Sortie vide ; (2) le menu quand aucun shell n'est disponible (navigateur) ; (3) le titre `title` de la tuile sans « hors de la fenêtre » ; (4) le bandeau d'un shell libre terminé (on reprend `shellEnded` / `shellLost` / `shellEndedNoCode` + « Rouvrir ») ; (5) un shell indisponible (on reprend `shellUnavailable`).
- [ ] **Step 1 : tests qui échouent** : `panel-model` : `addTerm` deux fois la même ref → une seule ; `removeTerm` d'une ref absente → même objet ; `isTerminalRef('terminal:shell:2')` vrai, `'session:x'` faux. `bottom-panel` (Testing Library) : deux terminaux → deux tuiles et le nombre `2` sur l'onglet Terminaux ; « + ▾ » ouvre le menu avec « Nouveau terminal », « Locaux », la ligne « par défaut » ; choisir PowerShell appelle `onNewShell('powershell')` ; « × » d'une tuile appelle `onClose(ref)` ; l'onglet Sortie montre `output` et le nombre `outputCount` ; « Masquer le panneau » appelle `onHide`.
- [ ] **Step 2 :** `pnpm --filter desktop test panel-model bottom-panel` → FAIL.
- [ ] **Step 3 :** implémenter ; ajouter un test App-niveau dans `test/ide/bottom-panel.test.tsx` (ou `frame.test.tsx`) : panneau affiché vide → un shell ouvert, un seul même après deux `toggle` rapides ; fermer le dernier → panneau masqué et le message.
- [ ] **Step 4 :** `pnpm --filter desktop test` et `typecheck` → PASS.
- [ ] **Step 5 : commit** `feat(desktop): the IDE bottom panel — terminals side by side, the « + ▾ » shells, Output, the last one closed hides it`.

### Task 7 : Glisser un terminal entre le panneau et les groupes

**Files:** Create `apps/desktop/src/ide/termDrag.ts`. Modify `apps/desktop/src/ide/DockHost.tsx`, `apps/desktop/src/ide/BottomPanel.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/workspace/model.ts` (rien de nouveau si `open` + `moveTo` suffisent ; sinon `place(w, tab, to)`), i18n. Test `apps/desktop/test/ide/term-drag.test.tsx`, ajout à `test/ide/dock.test.tsx`.

**Interfaces — Produces :**
```ts
// ide/termDrag.ts — qui glisse quoi, lu par le dock et le panneau
export type TermDrag = { from: 'panel'; ref: string } | { from: 'dock'; key: string };
export const termDrag: { get(): TermDrag | null; set(d: TermDrag | null): void };
// DockHost gains: onPanelDrop(ref: string, to: { group: string; index?: number } | { rightOf: string }): void
// BottomPanel gains: onDockDrop(key: string): void  (key d'un onglet du dock)
```
- **Tuile → dock :** la tuile pose `termDrag` au `dragstart` (et un type `application/x-ledge-term`) ; `DockHost` accepte dans `api.onUnhandledDragOver` quand `termDrag` vient du panneau, puis `api.onDidDrop` donne le groupe et la position : centre ou onglets → `{ group }` (à `index` si dockview le donne), bord droit → `{ rightOf }`. La zone « nouveau groupe » accepte aussi la tuile. `App` : `removeTerm`, puis `open(w, { kind: 'terminal', ref }, …)` dans le groupe visé ; panneau vidé → masqué (sans message).
- **Onglet du dock → panneau :** `DockHost` pose `termDrag` (`from: 'dock'`) dans `onWillDragPanel` ; le panneau accepte `dragover` et souligne son cadre (`--link1` en pointillé, comme `.drop-on`) ; au dépôt, un `isTerminalRef(key)` → `close` du modèle sans `remember` + `addTerm` + onglet Terminaux + `notify('Terminal ramené dans le panneau du bas.')` ; un autre onglet → `notify('Seuls les terminaux se rangent dans le panneau du bas.')`, rien ne bouge.
- Le xterm suit : `FreeShellView` et `AgentView` réattachent `surface.host` là où ils sont montés ; aucun processus n'est relancé (Review Focus 1).
- [ ] **Step 1 : tests qui échouent** (`term-drag.test.tsx`, avec un `api` dockview simulé comme `dock.test.tsx`) : un `onDidDrop` au centre d'un groupe pendant un `termDrag` panneau → `onPanelDrop('shell:1', { group: 'g1' })` ; au bord droit → `{ rightOf: 'g1' }` ; sans `termDrag` → rien ; `onUnhandledDragOver` accepté seulement pendant un `termDrag` panneau. Un dépôt sur le panneau pendant un drag dock `terminal:shell:1` → `onDockDrop('terminal:shell:1')` ; d'un `session:x` → le message de refus.
- [ ] **Step 2 :** `pnpm --filter desktop test term-drag dock` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** même commande → PASS ; `pnpm --filter desktop test` complet.
- [ ] **Step 5 : commit** `feat(desktop): a terminal drags from the bottom panel into a group, and back`.

### Task 8 : Parcours e2e et captures

**Files:** Create `apps/desktop/e2e/ide-terminals.spec.ts`. Modify `apps/desktop/e2e/fixtures.ts` si besoin (`__ledgeShells`).

- Parcours, en 1920×1080, interrupteur allumé, fausse PTY : `Ctrl+J` → panneau avec un shell `WSL · Ubuntu 1`, le nombre `1` ; « + ▾ » → le menu ; PowerShell → deux tuiles côte à côte, « par défaut » passe sur PowerShell ; taper `echo hi` dans la 2e tuile → `__ledgePtyWrites` le reçoit ; glisser la 2e tuile sur le groupe → un onglet `>_ PowerShell 2` avec `shell`, le panneau garde une tuile ; le ramener sur le panneau → deux tuiles, le texte tapé toujours affiché ; fermer les deux → panneau masqué et le message ; `Ctrl+J` → un shell PowerShell (le défaut). Sortie : une action OpenRig du faux daemon → une entrée `✓`.
- Captures zoomées du panneau (Terminaux, menu ouvert, Sortie) en clair et en sombre, comparées à la maquette (aligner hauteur 30 px de la barre, 11,5 px des libellés, puces `.chip-k`).
- [ ] **Step 1 :** écrire le parcours ; `pnpm --filter desktop e2e ide-terminals` → PASS (le premier démarrage prend ~2,5 min).
- [ ] **Step 2 :** `pnpm --filter desktop e2e` complet : seuls les échecs connus (Global Constraints).
- [ ] **Step 3 : commit** `test(desktop): the bottom panel's terminals and Output, end to end`.

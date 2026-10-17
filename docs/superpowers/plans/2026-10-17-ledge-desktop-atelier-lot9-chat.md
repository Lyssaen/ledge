# Ledge Desktop Atelier, lot 9 : Chat Ledge — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le chat de l'île dans Desktop, ancré à droite (même composant) :
- l'atelier reste visible et se réajuste ;
- survoler ou focaliser le nom d'un agent dans une réponse allume cet agent à sa table ;
- une carte « Lancer la session » se lance d'un clic, et l'agent arrive à sa table ;
- une carte « Envoyer l'instruction » (relais) marche comme dans l'île ;
- Ledge connaît les projets.

**Architecture:**
- `ChatView`, `LaunchCard`, `RelayCard` et le rendu en ligne des réponses (`inline`) passent de l'overlay à `@ledge/ui/chat/*`. Leurs textes viennent d'un contexte `ChatCopy` que chaque app remplit. L'overlay garde des fichiers de réexport aux anciens chemins et ne change pas de comportement.
- `ChatView` gagne un mode ancré (`docked`) pour Desktop.
- Desktop branche le chat sur le store du fleet (`useDaemon`, `daemonStore.beginTurn`), suit ses cartes avec un hook `useChatCards`, et allume les agents survolés.
- Le daemon écrit les projets dans le contexte du chat.

**Tech Stack:** TypeScript, React 19, Vite 6, vitest 3 + Testing Library + jsdom, Playwright 1.49.

**Spec:**
- Build design : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md`, § 5 (le chat reçoit le rattachement aux projets) et § 7, lot 9 (« panneau ancré, survol d'un nom qui allume l'agent à sa table, cartes de session »). Les cartes restent aussi dans le chat de l'île (§ 2, non-objectifs).
- Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` § 4 et § 9 (`/`, Échap).
- Maquette : `docs/mockups/desktop-observatory/observatory.tsx`, où `chatHover` allume `.overview-scroll [data-agent=…]` (l. 251-253), `launchProposal` est à la l. 247 et le panneau à la l. 359. CSS : `launch.css` l. 49-58 (`.ledge-chat-panel`, lien `ledge://session/`, `.chat-hover`).

**Hors de ce lot :**
- La proposition de projet (« Vérifier la proposition » qui ouvre l'éditeur prérempli) vient au lot 11, avec son mécanisme. Un lien `ledge://project/…` n'est ni produit ni traité ici.
- L'agent par défaut (réglage) vient au lot 10. En attendant, Desktop envoie `tool: 'claude'`.
- Les liens de documents dans les réponses du chat ne sont pas branchés dans Desktop : `onDocument` n'est pas passé, et la référence s'affiche en texte.

## Global Constraints

- Celles des lots 6a à 8, toutes :
  - la maquette fait foi ;
  - les textes sont dans `messages.ts`, avec `fr` comme source de vérité ;
  - l'anglais fixé par les tests est listé par tâche ;
  - rien d'optimiste ;
  - aucune nouvelle dépendance ;
  - pas de Tauri ni de Rust ;
  - la suite unitaire est en anglais ;
  - les commits se terminent par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Même composant que l'île.** Le chat de Desktop est `ChatView` de `@ledge/ui/chat`. Aucune copie divergente n'est permise.
- **L'overlay ne doit pas bouger.** Ses tests de chat (`chat.test.tsx`, `launch-from-chat.test.tsx`, `relay-from-chat.test.tsx`) passent sans modification de leurs assertions, et sa hauteur mesurée (`CHAT_HEADER_H`, `CHAT_COMPOSER_H`, `contentRef`) reste la même. L'échec connu « drafts survive… » peut apparaître : il faut le signaler.
- **« En ligne » = `MachineState.ready`** (lot 7). Le chat est hors ligne quand la machine locale ne l'est pas.
- **Une carte se lance une seule fois.** Pendant un lancement ou un relais, les autres cartes attendent, comme dans l'île.
- **Le morceau principal reste sous 500 kB.** Le panneau du chat se charge par le motif de `session/lazy.tsx` (préchargé au montage).

## Review Focus

1. **Une carte lancée pendant que le chat est ouvert** :
   - l'agent s'assoit à sa table, la place s'allume, et la carte passe à « lancée » ;
   - un second clic ne relance rien ;
   - un refus s'affiche sur la carte ;
   - si le filtre courant cache la table, il repasse à « Tous » sans quitter la page.

   Test à la tâche 5.
2. **Le nom d'un agent qui n'est pas à l'écran** (une autre machine, un agent terminé, une table hors du filtre, la vue Liste) : rien ne casse, seul ce qui est affiché s'allume, et quitter le nom éteint tout. Test à la tâche 5.
3. **Le chat quand le daemon local est hors ligne** : le champ est désactivé avec la raison, et l'historique reste. Test à la tâche 5.
4. **Clavier** :
   - écrire dans le chat ne déclenche aucun raccourci global ;
   - Échap ferme d'abord le chat ;
   - `/` l'ouvre de n'importe où et met le focus dans le champ ;
   - focaliser un nom au clavier l'allume aussi.

   Test à la tâche 5.
5. **L'île inchangée après le déplacement** : tous ses tests passent, sa taille mesurée est identique, et ses cartes marchent. Test à la tâche 2.

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/ui/src/chat/{ChatView,LaunchCard,RelayCard,inline,format,copy}.tsx`, `packages/ui/package.json` (export `./chat/*`) | Le chat partagé |
| `apps/overlay/src/surface/{ChatView,LaunchCard,RelayCard,ReplyCard}.tsx`, `apps/overlay/src/format.ts`, `apps/overlay/src/i18n/lang.tsx` | Réexports et fourniture de `ChatCopy` |
| `packages/ledge/src/chat/context.ts` | `projects.md` dans le contexte |
| `apps/desktop/src/chat/{ChatPanel,useChatCards,useAgentHighlight,lazy}.tsx`, `apps/desktop/src/{App.tsx,i18n/messages.ts,styles/shell.css}` | Le panneau de Desktop |
| `apps/desktop/e2e/{daemon.ts,chat.spec.ts}` | Faux daemon et scénarios |

---

### Task 1: Les textes par langue

La revue finale du lot 8 a signalé le budget : le morceau principal de Desktop fait 484 kB sur 500, et ce sont les textes qui grossissent (`messages.ts` porte les deux langues dans le morceau principal). Ce lot ajoute ceux du chat, et le lot 10 ceux des Réglages.

**Files:**
- Create: `apps/desktop/src/i18n/fr.ts`, `apps/desktop/src/i18n/en.ts`
- Modify: `apps/desktop/src/i18n/{messages,lang}.ts(x)`, `apps/desktop/src/main.tsx` (ou le point d'entrée), `apps/desktop/test/helpers.ts`, les tests qui importent `MESSAGES`

**Interfaces:**
- Produces :

```ts
// i18n/messages.ts
export type Messages = typeof import('./fr').fr;      // le type vient toujours du français
export async function loadMessages(lang: Lang): Promise<Messages>;   // import() de fr.ts ou en.ts, mis en cache
export function messagesLoaded(lang: Lang): Messages | undefined;
```

Règles :
- **Au démarrage** : le point d'entrée attend `loadMessages` de la langue choisie (`loadLang()`) et du français (le repli), puis rend l'app. L'autre langue ne se charge que si on la demande.
- **`createI18n`** reçoit les messages chargés. `@ledge/ui` ne change pas : un registre mutable, rempli avant le rendu, convient.
- **Tests** : les aides préchargent les deux langues, donc les tests restent synchrones.
- **Écran blanc** : aucun ne doit dépasser un instant. Le chargement est local, comme pour la session paresseuse.

- [ ] **Step 1: Écrire un test** : `loadMessages('en')` renvoie les messages anglais et les met en cache, et le morceau principal construit ne contient pas les textes anglais. Un test de source (comme celui du lot 7 pour le paquet) vérifie que rien dans `src` n'importe statiquement `./en` ni `./fr`, hors `messages.ts` en `import()` et les imports de type.
- [ ] **Step 2: Vérifier qu'il échoue**
- [ ] **Step 3: Déplacer `fr` et `en` dans leurs fichiers** et charger au démarrage.
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build && pnpm --filter desktop e2e`. Expected : tout passe, et le morceau principal descend nettement (donner les tailles avant et après dans le rapport).
- [ ] **Step 5: Commit** — `perf(desktop): each language's strings load on their own; the main chunk no longer carries both`

### Task 2: Le chat passe dans `@ledge/ui`

**Files:**
- Create: `packages/ui/src/chat/ChatView.tsx`, `LaunchCard.tsx`, `RelayCard.tsx`, `inline.tsx`, `format.ts`, `copy.tsx`, `packages/ui/test/chat-copy.test.tsx`
- Modify: `packages/ui/package.json` (exports), `apps/overlay/src/surface/{ChatView,LaunchCard,RelayCard,ReplyCard}.tsx`, `apps/overlay/src/format.ts`, `apps/overlay/src/i18n/lang.tsx` ou l'endroit où l'overlay monte ses fournisseurs

**Interfaces:**
- Produces :

```ts
// packages/ui/src/chat/copy.tsx
export interface ChatCopy {
  chat: OverlayMessages['chat'];      // la même forme que les clés chat.* de l'overlay (apps/overlay/src/i18n/messages.ts l. 178-209 / 415-446)
  machines: { destination: …; local: string; offline: string; choose: …; clarification: … };   // les clés machines.* que les cartes lisent
  time: { seconds: …; minutes: …; hours: …; locale: string };                                   // ce que relativeTime lit
  offline: string;                    // le texte « hors ligne » que l'overlay passe au chat
}
export const ChatCopyProvider: React.Provider<ChatCopy | null>;
export function useChatCopy(): ChatCopy;   // lève une erreur claire sans fournisseur
// packages/ui/src/chat/format.ts
export function relativeTime(iso: string, now: number, time: ChatCopy['time']): string;
export function toolName(tool: Tool): string;
// packages/ui/src/chat/inline.tsx — le rendu en ligne de ReplyCard, l'ouverture d'URL passée en paramètre (plus d'import du pont Tauri de l'overlay)
export function inline(text: string, key: number, onLink: (url: string) => boolean, onDocument?: (ref: DocumentReference) => void, openUrl?: (url: string) => void): ReactNode;
// packages/ui/src/chat/ChatView.tsx : ChatView, ChatViewProps, CHAT_HEADER_H, CHAT_COMPOSER_H — les mêmes qu'aujourd'hui
```

Les types exacts de `ChatCopy` sont recopiés des clés que lisent `ChatView`, `LaunchCard`, `RelayCard` et `format.ts` (fonctions incluses). Rien n'est ajouté ni renommé. `openUrl` vient du contexte `MarkdownLinks` (`@ledge/ui/documents/links`), lu dans les composants (`Answer`, les cartes) et passé à `inline`.

**Overlay :**
- `apps/overlay/src/surface/{ChatView,LaunchCard,RelayCard}.tsx` deviennent `export * from '@ledge/ui/chat/…'` ;
- `ReplyCard.tsx` importe `inline` partagé et le passe à `openUrl` ;
- `format.ts` délègue à `@ledge/ui/chat/format` en gardant sa signature (avec `t: Messages` par défaut) ;
- l'overlay monte `ChatCopyProvider` avec ses messages, au même niveau que son `LangProvider`.

- [ ] **Step 1: Écrire `packages/ui/test/chat-copy.test.tsx`** :
  - `ChatView` monté avec un `ChatCopyProvider` de test affiche `copy.chat.emptyTitle` ;
  - sans fournisseur, `useChatCopy` lève « ChatCopyProvider missing » ;
  - `relativeTime` donne « 2 min » avec des textes `time` français.
- [ ] **Step 2: Vérifier qu'il échoue** — `pnpm --filter @ledge/ui exec vitest run test/chat-copy.test.tsx`. Expected : FAIL, module introuvable.
- [ ] **Step 3: Déplacer** les fichiers, puis créer les réexports et le fournisseur de l'overlay.
- [ ] **Step 4: Vérifier** que l'île n'a pas bougé :
  - `pnpm --filter @ledge/ui test` ;
  - `pnpm --filter overlay test` (les tests `chat`, `launch-from-chat` et `relay-from-chat` passent sans changer leurs assertions) ;
  - `pnpm -r typecheck` ;
  - `pnpm --filter overlay build`.

  Expected : tout passe. Seule l'instabilité connue « drafts survive… » peut apparaître.
- [ ] **Step 5: Commit** — `refactor(ui): the Ledge chat (view, launch and relay cards, inline answers) moves to @ledge/ui with its copy from the app; the island re-exports it`

### Task 3: Le mode ancré

**Files:**
- Modify: `packages/ui/src/chat/ChatView.tsx`, `packages/ui/test/chat-docked.test.tsx` (nouveau)

**Interfaces:**
- Consumes : tâche 2.
- Produces : `ChatViewProps` gagne trois props.

```ts
docked?: boolean;                               // Desktop : dans le flux (pas de position absolue, pas de fondu), pas de bouton Retour ; Fermer dans l'en-tête
onAgentHover?: (id: string | null) => void;      // survol ou focus d'un lien ledge://session/<id> dans une réponse ; null en le quittant
inputRef?: Ref<HTMLInputElement>;               // pour mettre le focus à l'ouverture (/)
```

Règles :
- `docked` :
  - le conteneur occupe la hauteur de son parent (colonne flexible) ;
  - le fil défile ;
  - le champ reste en bas ;
  - le bouton « Retour » (`onBack`) n'est pas rendu ;
  - « Fermer » (`onClose`) est dans l'en-tête.

  Sans `docked`, rien ne change pour l'île.
- `onAgentHover` est appelé par délégation sur `mouseover` / `focusin` des `a[href^="ledge://session/"]` des réponses, et avec `null` sur `mouseleave` du fil / `focusout` hors d'un tel lien.

- [ ] **Step 1: Écrire `chat-docked.test.tsx`** :
  - en mode ancré, pas de bouton « Back », et « Close » appelle `onClose` ;
  - survoler `**Otto**` dans une réponse (Otto connu) appelle `onAgentHover('local:otto')`, et le quitter appelle `onAgentHover(null)` ;
  - le focus clavier sur le lien fait de même ;
  - sans `docked`, le bouton « Back » est là.
- [ ] **Step 2: Vérifier qu'il échoue** — `pnpm --filter @ledge/ui exec vitest run test/chat-docked.test.tsx`. Expected : FAIL.
- [ ] **Step 3: Implémenter**
- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/ui test && pnpm --filter overlay test && pnpm -r typecheck`. Expected : tout passe.
- [ ] **Step 5: Commit** — `feat(ui): the chat docks into a column (no Back, Close in the header) and tells which agent a hovered or focused name points to`

### Task 4: Ledge connaît les projets

**Files:**
- Modify: `packages/ledge/src/chat/context.ts` (et `service.ts` s'il faut lui passer les projets), `packages/ledge/test/chat-context.test.ts` ou le test du contexte existant

**Interfaces:**
- Consumes : l'état des projets du daemon local (`daemon/server.ts`, fichier `projects.json` du lot 2).
- Produces : `writeContext` écrit aussi `projects.md`.

`projects.md` a un titre par projet (`## {nom}`), sa description, puis une ligne par dépôt `- {machine} : {chemin}`. Il se termine par une section « Dossiers rangés » (les règles `machine : chemin → projet`). Dans `sessions.md`, chaque session gagne une ligne `Projet : {nom}`, ou `Projet : Sans projet`, calculée comme `projectOf` du fleet : le dépôt ou la règle le plus profond qui contient le `cwd` sur la même machine, la règle l'emportant à profondeur égale. Pour ne pas faire dépendre le daemon de `@ledge/fleet`, la fonction `projectOf` (pure, sans dépendance) passe dans `@ledge/protocol`, et `@ledge/fleet` la réexporte. Sans projets, `projects.md` dit « Aucun projet. ».

Un daemon distant ne connaît pas les projets (§ 5), et son contexte ne change pas.

- [ ] **Step 1: Écrire les tests** :
  - avec deux projets et une règle, `projects.md` liste les projets, leurs dépôts et la règle ;
  - `sessions.md` donne « Projet : Ledge » à une session sous un dépôt de Ledge, et « Projet : Sans projet » à une autre ;
  - sans projets, « Aucun projet. ».

  Les tests existants de `projectOf` (fleet) passent toujours avec la fonction déplacée.
- [ ] **Step 2: Vérifier qu'ils échouent** — `pnpm --filter @paradow/ledge exec vitest run <le test du contexte>`. Expected : FAIL.
- [ ] **Step 3: Implémenter** — déplacer `projectOf` dans `@ledge/protocol` (le fleet réexporte), puis passer les projets au service de chat et les écrire.
- [ ] **Step 4: Vérifier** — paquet par paquet : `pnpm --filter @ledge/protocol test`, `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/fleet test`, `pnpm --filter desktop test`, `pnpm -r typecheck`. Expected : tout passe.
- [ ] **Step 5: Commit** — `feat(daemon): Ledge's chat context lists the projects, their repositories and remembered folders, and each session's project`

### Task 5: Le chat dans Desktop

**Files:**
- Create: `apps/desktop/src/chat/ChatPanel.tsx`, `useChatCards.ts`, `useAgentHighlight.ts`, `lazy.tsx`, `apps/desktop/test/chat.test.tsx`
- Modify: `apps/desktop/src/App.tsx` (le panneau remplace le `Pending`), `apps/desktop/src/i18n/{messages,lang}.ts(x)` (le bloc `chat`, `machines` et `time` du `ChatCopy`, et le fournisseur), `apps/desktop/src/styles/shell.css`

**Interfaces:**
- Consumes : tâches 2 à 4 ; `useDaemon()` (`chat`, `chatLive`, `lastLaunched`, `lastError`, `status`) et `daemonStore.beginTurn` de `@ledge/fleet` ; `FleetView` (`fleet.turnMachine(qid)`, `machines`) ; `useFiling().markSeated` ; `notify` ; l'action de navigation `filter` du lot 8.
- Produces :

```ts
// chat/useChatCards.ts — la logique de Surface.tsx (overlay, l. 422-480), propre à Desktop
export function useChatCards(o: { send(m: ClientMessage): void; chat: ChatTurn[]; lastLaunched: { id: string; seq: number } | null; errors: readonly DaemonError[];
  turnReady(qid: string): boolean; onLaunched(id: string): void }): { launchingQid: string | null; relayingQid: string | null; launch(qid: string): void; relay(qid: string): void; cancelRelay(qid: string): void };
// chat/useAgentHighlight.ts — la classe chat-hover sur les [data-agent=id] de .overview-scroll (et des lignes de la Liste), retirée en quittant
export function useAgentHighlight(id: string | null): void;
// chat/ChatPanel.tsx
export function ChatPanel(p: { client: DaemonClient; view: FleetView; onClose(): void; onOpenSession(id: string): void; onLaunched(id: string): void }): JSX.Element;
```

Comportement :
- **Panneau** : `aside.ledge-chat-panel[aria-label=Chat Ledge]` contient `ChatView docked visible`, avec :
  - `turns = chat`, `live = chatLive`, `sessions = view.sessions` ;
  - `offline = machine locale pas prête ? copy.offline : null` ;
  - `theme`, `reducedMotion` (« Figer les animations » ou mouvement réduit), `frozen`.

  Le chat se charge par `chat/lazy.tsx` (préchargé au montage), et le temporaire `.chat-close` de `shell.css` disparaît.
- **Envoyer une question** :
  1. `qid = 'q-' + crypto.randomUUID()` ;
  2. `daemonStore.beginTurn({ qid, question, askedAt, steps: [] })` ;
  3. `send({ type: 'chat.ask', qid, text, tool: 'claude' })`.

  Stop envoie `chat.cancel`, et Effacer envoie `chat.reset`.
- **Ouvrir** :
  - `/`, la barre latérale, la barre du haut, le pied de page et le bureau de Ledge ouvrent le panneau et mettent le focus dans le champ (`inputRef`) ;
  - Échap le ferme (déjà le premier dans `escape`) ;
  - `onOpenSession(id)` ouvre la page de l'agent. Comme dans la maquette, cela ferme le chat.
- **Allumer** : `onAgentHover(id)` passe par `useAgentHighlight` :
  - la classe `chat-hover` va sur les éléments `[data-agent="{id}"]` sous `.overview-scroll`, c'est-à-dire les places de l'Atelier, « Sans projet » et les lignes de la Liste ;
  - elle est retirée au changement ou à la fermeture ;
  - rien ne se passe si l'agent n'est pas affiché.
- **Cartes** :
  - « Lancer la session » envoie `session.launch { qid, tool, cwd, prompt }` (le daemon lance la proposition du tour) ;
  - à la réponse, `onLaunched(id)` : la place s'allume (`markSeated`), le filtre repasse à « Tous » si la table est cachée (action `filter`, sans quitter la page), et un message dit « {nom} démarre à la table {projet}. » (texte du lot 7) ;
  - la carte affiche son état d'après le tour (`proposal.launchedId`, `proposal.error`) ;
  - « Envoyer l'instruction » (`session.relay`) et son annulation suivent les mêmes règles que l'île, et un seul lancement ou relais est en cours à la fois ;
  - une carte d'une machine pas prête ne se lance pas.
- **CSS** (de `launch.css`, maquette) :
  - `.chat-hover`, avec la lueur du bot ;
  - la couleur des liens `ledge://session/` dans le panneau ;
  - la disposition du panneau ancré.

Textes : le bloc `chat`, les clés `machines.*` lues par les cartes et `time.*` sont recopiés **mot pour mot** des messages de l'overlay (fr et en), sous le type `ChatCopy`. Aucune clé nouvelle, sauf `copy.offline` : « Le daemon local est hors ligne. » / « The local daemon is offline. ».

- [ ] **Step 1: Écrire `test/chat.test.tsx`** :
  - **Ouvrir et fermer** : `/` ouvre le panneau, le champ a le focus, et taper « n » dedans n'ouvre pas « New session » ; Échap ferme le panneau.
  - **Poser une question** : un `chat.ask` part avec un qid et `tool: 'claude'`. Le faux daemon répond par `chat.step`, `chat.delta`, puis `chat.done` avec « **Otto** relit la PR. », et la réponse s'affiche avec un lien sur Otto.
  - **Survol** : survoler (puis focaliser) Otto donne la classe `chat-hover` à sa place de l'Atelier, et le quitter la retire. Un nom d'une autre machine ou d'un agent hors du filtre n'allume rien et ne casse rien.
  - **Carte de session** :
    - un `chat.done` avec `proposal { tool: 'codex', cwd: '/w/ledge/app', project: 'Ledge', prompt }` affiche la carte ;
    - « Launch » envoie un seul `session.launch` avec ce qid, même avec un second clic pendant l'attente ;
    - `session.launched` et le `chat.history` qui marque `launchedId` font passer la carte à lancée, allument la place et affichent le message ;
    - un `chat.history` qui marque `proposal.error` affiche l'erreur sur la carte, et la carte redevient utilisable.
  - **Filtre** : filtre sur un autre projet, puis carte lancée : le filtre repasse à « Tous » et la vue reste la même.
  - **Daemon local hors ligne** : le champ est désactivé avec « The local daemon is offline. », et l'historique reste affiché.
- [ ] **Step 2: Vérifier qu'il échoue** — `pnpm --filter desktop exec vitest run test/chat.test.tsx`. Expected : FAIL.
- [ ] **Step 3: Implémenter `useChatCards`, `useAgentHighlight`, `ChatPanel`, le chargement paresseux, les textes, le CSS et le branchement**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`. Expected : tout passe, sans avertissement de taille de morceau.
- [ ] **Step 5: Commit** — `feat(desktop): the Ledge chat docked on the right: names light their agent at its table, session cards launch in one click and seat the agent, nothing sent offline`

### Task 6: Le chat dans le navigateur

**Files:**
- Create: `apps/desktop/e2e/chat.spec.ts`
- Modify: `apps/desktop/e2e/daemon.ts`. Il répond à `chat.ask` par une réponse scriptée (`extras.chat` : étapes, texte, proposition éventuelle) et à `session.launch { qid }` en asseyant l'agent, puis il marque `launchedId` dans un `chat.history`.

Scénarios :
1. **`/`, une question, la réponse** : survoler Otto l'allume à sa table ; l'atelier reste visible et se réajuste (la largeur de `.overview-scroll` diminue quand le panneau s'ouvre, et aucun défilement horizontal n'apparaît).
2. **Une carte « Lancer la session »** : un clic, puis l'agent est assis à la table Ledge avec la place allumée, et la carte affiche son état lancé.
3. **Fenêtre de 900 px** : le panneau passe par-dessus (CSS de la maquette), Échap le ferme, et le focus revient sur la page.

- [ ] **Step 1: Écrire les scénarios et étendre le faux daemon**
- [ ] **Step 2: Lancer Playwright** — `pnpm --filter desktop e2e`. Expected : les scénarios d'avant et les 3 de `chat` passent.
- [ ] **Step 3: Vérification du dépôt** — paquet par paquet :
  - `pnpm --filter @ledge/protocol test` ;
  - `pnpm --filter @paradow/ledge test` ;
  - `pnpm --filter @ledge/fleet test` ;
  - `pnpm --filter @ledge/ui test` ;
  - `pnpm --filter desktop test` ;
  - `pnpm --filter overlay test` ;
  - `pnpm -r typecheck` ;
  - `pnpm -r build`.

  Expected : tout passe. Seule l'instabilité connue de l'overlay peut apparaître : la signaler.
- [ ] **Step 4: Commit** — `test(desktop): the Ledge chat in the browser: names light their agent, a session card seats its agent, a narrow window`

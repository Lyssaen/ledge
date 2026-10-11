# Markdown Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only if the user chooses delegated execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ouvrir les fichiers Markdown cités par les agents dans le panneau existant de Ledge et revenir à la conversation avec son contexte intact.

**Architecture:** Un lecteur WSL en lecture seule fournit le texte par WebSocket corrélé. L’overlay détecte les références, rend le document dans une vue dédiée et conserve l’origine/pile de lecture. La surface native existante passe de la session au lecteur avec ses dimensions et ses transitions habituelles.

**Tech Stack:** TypeScript, Node 22, Zod, ws, React 19, Vitest, Testing Library, Playwright, Tauri Windows. Ajouter uniquement `react-markdown` et `remark-gfm` à l’overlay pour le rendu ; versions exactes fixées au moment de l’installation et conservées dans `pnpm-lock.yaml`.

**Spec:** [Design validé et contrats](../specs/2026-10-11-markdown-reader-design.md). [Maquette de référence](../../mockups/ledge-reader-existing.html).

**Statut :** à implémenter. Le présent travail est documentaire ; aucune case d’implémentation n’est acquise. Lire la spec entière avant exécution. Les noms de nouveaux fichiers et interfaces ci-dessous sont les contrats proposés ; les composants existants ont été examinés le 2026-10-11 et peuvent évoluer entre-temps.

## Global Constraints

- Un seul panneau ancré à gauche. Largeurs de base : session 480 px, lecteur 560 px, agrandi 800 px, poignée 28 px.
- Hauteur lecteur : `min(760, screenH / panelScale - 2 * SIZES.margin)` ; `SIZES.margin = 40`. Borner à la zone de travail du moniteur, ombre comprise.
- Fichier régulier `.md` / `.markdown`, UTF-8, maximum 1 048 576 octets. Délai de réponse client : 10 secondes.
- Les fichiers sont lus par le daemon WSL. Les skills absolus hors du dépôt doivent fonctionner.
- Aucune écriture, commande, décision ou instruction d’agent lors d’une lecture. Aucun chargement d’image ou HTML exécutable.
- Libellés FR/EN dans `apps/overlay/src/i18n/messages.ts` ; thèmes, composants et transitions existants.
- Ne pas modifier la sémantique de `parseReply` pour rendre un fichier. Ne pas livrer les fixtures de maquette.

## Review Focus

1. Deux demandes de lecture dont les réponses sont inversées : B doit rester B ; tester en tâche 4.
2. Skill externe, symlink et fichier qui grossit : lecture régulière bornée, sans restriction au dépôt ni blocage FIFO ; tester en tâche 1.
3. Plusieurs sessions et un relatif dans le chat : jamais de choix implicite du mauvais dépôt ; tester en tâches 1 et 5.
4. Brouillon, scroll ou session source modifiés pendant la lecture : retour cohérent et aucune action d’agent ; tester en tâches 4 et 5.
5. Fenêtre native plus petite que le moniteur : agrandissement, ombre, DPI et raccourcis doivent suivre le lecteur ; tester en tâches 5 et 6.

## Carte des responsabilités

| Unité | Responsabilité |
| --- | --- |
| `packages/protocol/src/documents.ts` | Schémas, types et limite documentaire |
| `packages/ledge/src/daemon/documents.ts` | Résolution WSL, lecture bornée, erreurs typées |
| `apps/overlay/src/documents/references.ts` | Références locales, suffixes ligne/ancre ; aucune lecture |
| `apps/overlay/src/documents/MarkdownDocument.tsx` | Rendu Markdown fidèle, ancres et sommaire |
| `apps/overlay/src/documents/markdown.css` | Styles limités au document, fondés sur les tokens |
| `apps/overlay/src/documents/useDocumentReader.ts` | Requêtes, délai, pile, origine, restauration |
| `apps/overlay/src/surface/DocumentView.tsx` | En-tête, barre, chargement/erreur, corps et retour |
| Machine, Surface, clavier et géométrie existants | Navigation, événements, dimensions et fenêtre native |

## Task 1 — Lire un document réel via le daemon

**Files:** créer `packages/protocol/src/documents.ts`, `packages/ledge/src/daemon/documents.ts`, `packages/ledge/test/documents.test.ts` ; modifier `packages/protocol/src/messages.ts`, `packages/protocol/src/index.ts`, `packages/protocol/test/messages.test.ts`, `packages/ledge/src/daemon/server.ts`, `packages/ledge/test/server.test.ts`.

**Interfaces:** produire `DOCUMENT_MAX_BYTES = 1_048_576`, les types `DocumentRead`, `DocumentContent`, `DocumentErrorCode`, `DocumentError` de la spec, et `readDocument(request: DocumentRead, context: { cwd?: string; home: string }): Promise<DocumentContent | DocumentError>`. Le serveur résout `sessionId` via son store et renvoie `session_missing` avant l’appel si nécessaire. La fonction ne dépend pas de tmux.

- [ ] Écrire les tests de protocole : accepter les trois messages documentaires ; rejeter requestId vide, chemin vide et chemins > 4 096 caractères. Vérifier `bytes >= 0`, date ISO et code d’erreur connu.
- [ ] Écrire les tests de fichiers temporaires : relatif au cwd, `../` valide, base de document, espace/Unicode, `~/…`, absolu externe au dépôt et symlink vers fichier régulier. Assert `text` exactement égal au texte lu, `bytes` égal aux octets UTF-8 et `path` absolu utilisable comme base.
- [ ] Ajouter les échecs précis : absent → `not_found`, répertoire/FIFO → `not_file`, `.txt` → `unsupported_type`, mauvais UTF-8 → `invalid_utf8`, 1 048 577 octets → `too_large`, relatif sans base → `ambiguous_path`, refus d’accès → `permission_denied`. Un fichier de 1 048 576 octets est accepté ; un fichier qui croît pendant lecture reste borné.
- [ ] Lancer `pnpm --filter @ledge/protocol test` et `pnpm --filter ledge exec vitest run test/documents.test.ts test/server.test.ts` ; constater l’échec sur les interfaces manquantes.
- [ ] Implémenter les schémas et la lecture asynchrone : extension validée, résolution, vérification du type sans ouvrir un FIFO bloquant, lecture bornée, décodage strict, fermeture du descripteur en `finally`, mapping des erreurs de la spec. Aucun shell, aucune recherche de dépôt homonyme.
- [ ] Raccorder `document.read` dans `server.ts`. Tests : seul le client demandeur reçoit la réponse ; un autre client ne reçoit ni texte ni erreur ; `tmux.sendText` et `tmux.sendKeys` ne sont jamais appelés ; les erreurs restent `document.error`.
- [ ] Relancer les deux commandes ; attendre tous les tests verts. Commit ciblé : `feat(documents): read Markdown files through the daemon`.

## Task 2 — Identifier les références sans casser les liens existants

**Files:** créer `apps/overlay/src/documents/references.ts`, `apps/overlay/test/document-references.test.ts` ; modifier `apps/overlay/src/surface/ReplyCard.tsx`, `apps/overlay/test/reply-inline.test.tsx`.

**Interfaces:** produire `DocumentReference = { path: string; anchor?: string; line?: number; column?: number }`, `parseDocumentReference(raw: string): DocumentReference | null` et `findDocumentReferences(text: string): Array<{ start: number; end: number; reference: DocumentReference }>`. Étendre `inline(text, depth, onLink, onDocument?)` avec `onDocument?: (reference: DocumentReference) => void`, en conservant les appels existants. Faire passer ce callback à tous les rendus imbriqués de `ReplyCard`.

- [ ] Tests table-driven pour `README.md`, `./docs/plan.md`, `~/…/SKILL.md`, absolus, `.MD`, `.markdown`, `plan.md:42:7`, `plan.md#L42`, `plan.md#intention`, chemins avec espaces délimités. Assert extraction correcte de path/ligne/ancre ; nombres strictement positifs.
- [ ] Tester ponctuation terminale, parenthèses dans liens, URL encodées, échappements Markdown ; `https://…/README.md` reste externe, `.mdx` n’est pas un document Markdown, un bloc de code reste du code. Les chemins nus avec espaces ne sont pas devinés.
- [ ] Lancer `pnpm --filter overlay exec vitest run test/document-references.test.ts test/reply-inline.test.tsx` et constater l’échec attendu.
- [ ] Implémenter les helpers puis ajouter le callback optionnel aux liens explicites, aux spans de code inline contenant un chemin complet et aux chemins nus. Respecter `onLink` pour les liens de session `ledge://session/…` existants. Sans `onDocument`, préserver le comportement courant.
- [ ] Vérifier les liens web et le texte autour des références, puis relancer la commande. Commit ciblé : `feat(documents): recognize local Markdown references`.

## Task 3 — Construire le rendu et la vue de lecture

**Files:** créer `apps/overlay/src/documents/MarkdownDocument.tsx`, `apps/overlay/src/documents/markdown.css`, `apps/overlay/src/surface/DocumentView.tsx`, `apps/overlay/test/markdown-document.test.tsx`, `apps/overlay/test/document-view.test.tsx` ; modifier `apps/overlay/package.json`, `pnpm-lock.yaml`, `apps/overlay/src/i18n/messages.ts`.

**Interfaces:** `DocumentHeading = { id: string; depth: number; text: string }`. `MarkdownDocument({ text, onDocument, onHeadings }: { text: string; onDocument: (ref: DocumentReference) => void; onHeadings: (headings: DocumentHeading[]) => void })` produit le corps et son sommaire depuis la même arborescence Markdown. `DocumentView` reçoit `{ state, originName, theme, expanded, onBack, onClose, onExpand, onReload, onDocument }` ; `state` est l’union `{status:'loading'; path}` / `{status:'ready'; document:DocumentContent}` / `{status:'error'; path; code:DocumentErrorCode|'offline'|'timeout'}`. Les réglages de vue/scroll sont contrôlés par l’hôte pour être restaurables.

- [ ] Écrire un test avec H1/H2/H3, titres identiques/accentués, liste imbriquée, tableau, tâches, citation, code clôturé et frontmatter. Assert ordre et niveaux préservés, identifiants uniques, tâches désactivées, sommaire lié aux vrais titres.
- [ ] Tester source brute identique à `document.text`, fichier vide, chargement, chaque famille d’erreur, retour disponible, langues FR/EN. Tester HTML/script et URL `javascript:`/`data:` : aucun élément exécutable ni lien dangereux ; les images ne déclenchent pas de requête.
- [ ] Lancer `pnpm --filter overlay exec vitest run test/markdown-document.test.tsx test/document-view.test.tsx` ; constater l’échec attendu.
- [ ] Installer les deux dépendances du renderer dans `overlay` avec versions fixées. Lire leurs API officielles avant de choisir les composants et plugins ; ne pas ajouter d’activation de HTML brut.
- [ ] Implémenter le renderer dédié et le sommaire depuis un seul arbre. Préserver le frontmatter comme bloc de texte et fournir la même règle d’identifiants aux ancres et aux titres. Router les liens locaux via la tâche 2, les ancres dans le document, HTTP(S) via `openUrl` ; les autres cibles restent explicites et non exécutables.
- [ ] Construire la vue selon les dimensions de la spec. Utiliser les vrais composants UI ; sommaire repliable, Lecture/Markdown, rechargement discret, pied fixe. Ajouter tous les libellés dans les deux langues.
- [ ] Relancer les tests puis `pnpm --filter overlay typecheck`. Commit ciblé : `feat(overlay): render Markdown documents in the reader`.

## Task 4 — Gérer origine, requêtes et pile de lecture

**Files:** créer `apps/overlay/src/documents/useDocumentReader.ts`, `apps/overlay/test/document-reader.test.tsx`.

**Interfaces:** `DocumentOrigin = { kind:'session'; sessionId:string } | { kind:'chat' }`. `useDocumentReader({ client, onExit }: { client:DaemonClient; onExit:(origin:DocumentOrigin)=>void })` expose `state`, `origin`, `canGoBack`, `open(ref, origin)`, `follow(ref)`, `back()`, `close()`, `reload()` et sauvegarde/restauration des positions de lecture. `open` lance une nouvelle pile ; `follow` utilise le `path` retourné du document actuel comme `basePath`. L’API de vue conserve séparément scroll Lecture, scroll Markdown et mode sélectionné pour chaque entrée.

- [ ] Tests avec client simulé et horloge contrôlée : A demandé, B demandé, B reçu, A reçu → B visible. Après `close()`, aucun résultat ne rouvre le lecteur. Après 10 000 ms sans réponse → timeout ; réponse tardive ignorée ; « Réessayer » utilise un nouveau requestId.
- [ ] Tests de pile : A à une position donnée → lien relatif B → retour A au même scroll et au même onglet → retour origine. Les suffixes ligne/ancre sont appliqués après rendu ; cible manquante laisse le document lisible avec une indication.
- [ ] Tester déconnexion avant/après chargement, rechargement échoué, texte déjà chargé conservé hors ligne et aucune nouvelle requête avant reconnexion. Ne pas mélanger le texte d’un document précédent avec le chemin du nouveau.
- [ ] Lancer `pnpm --filter overlay exec vitest run test/document-reader.test.tsx` ; constater l’échec attendu, puis implémenter le hook avec désabonnement, invalidation des requêtes et annulation des timers.
- [ ] Relancer les tests ; assert qu’aucun message `session.reply`/`session.decide` n’a été envoyé. Commit ciblé : `feat(overlay): preserve document navigation and request state`.

## Task 5 — Intégrer le lecteur à la surface réelle

**Files:** modifier `apps/overlay/src/surface/{SessionView,ReplyCard,ChatView,Surface}.tsx`, `apps/overlay/src/surface/{machine,geometry}.ts`, `apps/overlay/src/surface/useFocusRestore.ts`, `apps/overlay/src/keyboard/useKeyboard.ts`, `apps/overlay/src/App.tsx`, `apps/overlay/src/tauri/bridge.ts`, `apps/overlay/src/monitor.ts`, `apps/overlay/src-tauri/src/main.rs` ; tester dans `apps/overlay/test/machine.test.ts`, `apps/overlay/test/geometry.test.ts`, `apps/overlay/test/keyboard.test.tsx`, `apps/overlay/test/tauri.test.tsx`, `apps/overlay/test/monitor.test.tsx` et créer `apps/overlay/test/reader-surface.test.tsx`.

**Interfaces:** ajouter `Mode = … | 'reader'`, événement `{type:'documentOpen'; origin:DocumentOrigin}`, état `documentOrigin:DocumentOrigin|null` et `documentExpanded:boolean`, événement `{type:'documentExpanded'; on:boolean}`. `back` depuis `reader` revient à l’origine lorsque la pile est épuisée ; `close` replie. Ajouter `screenW` à `SurfaceProps` et aux entrées de géométrie ; fournir `screenWidth(choice?:string|null):Promise<number>` dans le bridge, analogue à `screenHeight`, basé sur la zone de travail. Si le chemin natif `list_monitors` est utilisé, ajouter `workW` à `MonitorInfo` et `work_w` à sa sérialisation Rust.

- [ ] Tester la machine : ouverture depuis session et chat, retour à l’origine, fermeture poignée, session source supprimée → retour liste. Une nouvelle demande pendant la lecture reste en file et ne remplace pas le document ; sortie de pointeur sans effet.
- [ ] Tester géométrie 560/800 px à l’échelle 1, hauteur bornée, `panelScale` 1/1.5/2, écran étroit et changement de moniteur. Assert que le cadre avec `FRAME_PAD.right` tient dans `screenW`, que les épaules et l’ombre sont incluses. Ne jamais employer la largeur actuelle de la webview comme largeur d’écran native.
- [ ] Tester clavier : `Y`, `N`, `1`, `R` ne décident/n’envoient rien depuis le document. Échap ferme d’abord le sommaire, sinon dépile/retourne ; Tab reste natif ; la croix replie.
- [ ] Lancer les tests ciblés de cette tâche et constater les échecs attendus.
- [ ] Faire suivre `onDocument` dans la session et le chat ; renseigner une origine de résolution seulement lorsqu’elle est connue. Garder la source montée inactive ou enregistrer son état explicitement. Brancher le hook de la tâche 4, le mode de machine, les animations existantes et la vue de la tâche 3.
- [ ] Étendre le bridge et les informations de moniteur nécessaires, puis calculer la largeur depuis la zone de travail et `panelScale`. Faire passer la géométrie au mécanisme existant `frameOf` / `useNativeFrame` ; modifier ces helpers uniquement si les tests montrent un besoin.
- [ ] Tester un brouillon saisi et un scroll non nul dans session puis chat : ouvrir/retourner conserve les deux et restaure le focus. Tester une référence absolue dans un chat multi-dépôts et un relatif ambigu. Si la réponse source change, retour vers un point de focus de remplacement, sans effacer le brouillon.
- [ ] Exécuter `pnpm --filter overlay test` puis `pnpm typecheck` ; tous verts. Commit ciblé : `feat(overlay): integrate the document reader into the surface`.

## Task 6 — Vérifier le parcours complet et documenter la livraison

**Files:** créer `apps/overlay/e2e/document-reader.spec.ts` ; modifier au besoin `apps/overlay/e2e/daemon.ts`, `apps/overlay/e2e/screenshots.spec.ts`, `docs/tour.md`, `README.md`. Conserver les maquettes comme références historiques.

**Interfaces:** utiliser le faux daemon e2e existant pour répondre aux requêtes documentaires avec des fixtures ; aucun port ou serveur de production supplémentaire. Les tests serveur de la tâche 1 restent la preuve de la vraie lecture WSL.

- [ ] Écrire le scénario : session réelle rendue → lien plan → requête document.read avec cwd correct → contenu → sommaire → source → agrandir → retour et brouillon intact → replier. Ajouter erreur/réessai, skill absolu et arrivée d’une demande pendant lecture.
- [ ] Exécuter `pnpm --filter overlay exec playwright test e2e/document-reader.spec.ts` ; corriger jusqu’à succès. Capturer session et lecteur en clair/sombre depuis les composants intégrés.
- [ ] Exécuter `pnpm --filter @ledge/protocol test`, `pnpm --filter ledge test`, `pnpm --filter overlay test`, `pnpm typecheck` et `pnpm build`. Les gates sont satisfaites lorsque chaque commande termine avec code 0 ; le build Rust/Windows reste un contrôle distinct.
- [ ] Sur Windows avec le daemon WSL, cliquer un vrai fichier de plan et un vrai skill hors dépôt. Vérifier 100/150/200 %, moniteur secondaire, expansion 560→800, absence de clipping, retour du focus et zones de clic. Utiliser la procédure Windows du dépôt pour compiler/exécuter le shell. Consigner le résultat réel ; ne pas marquer cette étape faite sur la seule base de Playwright.
- [ ] Ajouter le parcours livré au tour et mettre à jour le statut du README. La doc doit distinguer limites V1 et fonctionnalités réellement vérifiées.
- [ ] Commit ciblé : `test(documents): verify the Markdown reader end to end`.

## Reprise ultérieure

Instruction proposée : « Implémente `docs/superpowers/plans/2026-10-11-markdown-reader.md` en suivant la spec liée et la maquette validée. Commence par vérifier l’état actuel du dépôt ; préserve les changements en cours. »

L’ordre recommandé est 1 → 2 → 3 → 4 → 5 → 6. Chaque tâche se termine par ses tests et un commit limité à ses fichiers ; ne jamais inclure les changements d’une autre session dans ces commits. Une vérification Windows non effectuée reste une case ouverte dans le bilan.

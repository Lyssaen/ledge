# Affichage des outils dans une session — maquettes du 14 octobre 2026

**Décision du 14 octobre 2026 : la piste 1 (ligne vivante) est retenue et implémentée.** Elle est désormais le seul
rendu des appels d'outils dans le fil, à la place des lignes `ActionRow`. Les autres pistes (B compteur, C pastilles,
D par fichier, E risque visible, F pied de carte) sont écartées, et la story `?story=tools`, le flag
`ledge.proto.tools` et le dossier `apps/overlay/src/proto/` ont été retirés.

- Code : `apps/overlay/src/surface/LiveToolLine.tsx` (le composant), `apps/overlay/src/thread/tools.ts` (helpers purs :
  `target`, `liveTool`, `elapsedMs`, `SPINNER`…), branché dans `apps/overlay/src/surface/Thread.tsx` ; chaînes dans
  `apps/overlay/src/i18n/messages.ts` (`thread.liveLabel`) ; keyframe `ledge-mark-in` dans `styles/base.css`.
- Tests : `apps/overlay/test/live-tool-line.test.tsx`, `thread.test.tsx`, e2e `thread.spec.ts` et `screenshots.spec.ts`.
- Conséquence assumée : requête et résultat d'un appel d'outil ne sont plus consultables dans le fil (décision de
  l'utilisateur). Un échec se voit par son ✕ le temps de la tenue.

Le reste de cette page est la note d'exploration telle qu'écrite avant la décision ; les chemins `proto/` qu'elle
cite n'existent plus.

---

Prototype dans le code, **sans changement du rendu par défaut**. Ce sont des pistes à regarder, pas une décision.

## Ce qui existe aujourd'hui

Le fil d'une session est rendu par `apps/overlay/src/surface/Thread.tsx`. Chaque appel d'outil du tour courant est un
`ActionRow` : une ligne `<details>` repliée (marque d'état ✓ / ! / ◌ / ·, libellé, « En cours » ou « Échec », chevron)
qui s'ouvre sur la commande ou les paramètres, le résultat ou l'erreur, puis l'état et la durée. Les fichiers touchés
s'empilent sous l'action en `FileRow` (chemin, type de changement, diff repliable). Les tours précédents sont repliés
en un bloc « Tour précédent ». Le libellé vient du daemon (`history.ts`) : la commande pour Bash, le chemin pour
Read/Edit/Write, sinon l'entrée JSON tronquée. La spec du 13/10 (§6) a fixé : lignes simples empilées, **sans
compteurs nulle part**, fichiers sous leur action, information absente dite et jamais devinée.

## Comment regarder les maquettes

- **Story de dev** : `pnpm --filter overlay dev` puis `http://localhost:1420/?story=tools`. Un tour scénarisé (neuf
  appels : lectures, Grep, Edit, `vitest`, Write en échec, `git status`) rejoue sur une horloge virtuelle. Les sept
  cartes (aujourd'hui + six variantes) avancent ensemble ; lecture, pause, curseur, vitesse, thème, mouvement réduit,
  langue. Le montage se fait dans `main.tsx`, en `import.meta.env.DEV` uniquement.
- **Flag dans la vraie session** : `localStorage['ledge.proto.tools']` = `live` | `counter` | `dots` | `files` |
  `risky` | `footer` (ou `?tools=live` sur l'URL en dev), puis recharger. Absent ou inconnu : rendu actuel, code
  inchangé. Le sélecteur « Flag session » de la story l'écrit. `Thread.tsx` remplace alors les lignes d'outils du
  tour courant par le bloc de la variante ; `SessionView.tsx` pose la ligne de la variante `footer` à la place de
  l'indice du compositeur.
- Code : `apps/overlay/src/proto/` (`tools.ts` helpers purs, `LiveToolLine.tsx`, `ToolsAlternatives.tsx`,
  `ToolsDisplay.tsx` aiguilleur, `ToolsStory.tsx`, `strings.ts` copie fr/en propre au prototype). Tests :
  `apps/overlay/test/proto-tools.test.tsx`.

## Piste 1 (prioritaire) — la ligne vivante

Une seule ligne, 22 px : spinner braille (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, 80 ms par image), nom de l'outil, cible abrégée en mono, durée
écoulée à droite (chiffres tabulaires, tic à la seconde). Rien n'est affiché sans outil en cours.

- **Fin d'outil** : le spinner devient la marque du résultat, ✓ vert (`--success`) ou ✕ rouge (`--destructive`),
  avec un petit pop de 160 ms ; la ligne la tient 500 ms, la durée figée sur le `durationMs` final, puis fondu de
  200 ms et retrait. Un état inconnu donne « · ».
- **Enchaînement** : si un autre outil démarre pendant la tenue, il attend la fin des 500 ms ; l'ancienne ligne
  glisse alors vers le haut avec sa marque, la nouvelle entre par le bas, 150 ms, `cubic-bezier(.22,1,.36,1)`. Deux
  appels vraiment parallèles (le premier tourne encore) roulent sans tenue. Le conteneur a une hauteur fixe et
  clippe, donc le fil ne saute pas.
- **Cible abrégée** : un chemin → ses deux derniers segments (`surface/Thread.tsx`) ; une commande → sa première
  ligne, coupée à 40 caractères sur un espace (`pnpm vitest run test/thread.test.tsx…`) ; une entrée JSON (Grep,
  Glob, WebFetch) → son champ parlant (`pattern`, `query`, `url`, `path`…).
- **Mouvement réduit** (réglage, OS ou `VITE_LEDGE_MOTION=0`) : image fixe ⠿, aucune transition, remplacement
  immédiat ; la tenue de la marque reste, c'est une information et non un mouvement. Le spinner et le tic s'arrêtent quand la vue est masquée (`paused`).
- **Durée** : la durée en cours est calculée depuis `at` ; une ligne qui s'efface affiche le `durationMs` final si le
  daemon l'a donné.
- Accessibilité : `role="status"`, `aria-live="polite"`.

Ce qu'elle perd par rapport à aujourd'hui : l'historique des appels du tour (résultats, erreurs, diffs) n'est plus
dans le fil. Un échec d'outil n'est vu que par son ✕, le temps de la tenue. À combiner avec E ou avec la carte de réponse si on la retient.

## Alternatives à explorer

| | Variante | Idée | Ce que ça donne | Réserve |
|---|---|---|---|---|
| B | Compteur replié | `⚙ 7 outils · Read ×3 · Bash ×1 · …`, dépliable sur les lignes actuelles ; l'outil en cours est nommé à droite | Fil très court, tout reste accessible | **Contredit la décision « sans compteurs »** de la spec du 13/10 ; le résumé est un chiffre, pas une information |
| C | Frise de pastilles | Une pastille par appel, couleur par famille (lecture `--info`, écriture `--warning`, commande `--primary`, échec `--destructive`) ; la pastille en cours pulse ; un clic ouvre sa ligne | Rythme du tour visible d'un coup d'œil (beaucoup de lectures, une écriture, un test) | Sans légende, la couleur seule ne suffit pas ; au-delà de ~30 appels la frise déborde |
| D | Par fichier | Trois groupes : Lus / Modifiés / Testés ; le fichier en cours de lecture ou d'écriture porte la marque | Répond à la vraie question « qu'a-t-il touché ? » | « Testé » est une heuristique (commande de test + chemins qu'elle cite) ; les commandes hors test n'apparaissent pas |
| E | Risque visible | Bash, Write, Edit gardent leur ligne complète ; les lectures ne passent que sur la ligne vivante | Garde ce qui demande relecture, efface le bruit ; compatible avec la piste 1 | Le partage lecture / risque est une liste de noms d'outils (Claude, Codex, Cursor) à maintenir |
| F | Pied de carte | La ligne vivante remplace l'indice du compositeur ; sans outil en cours, le dernier résultat (`✓ Edit surface/Thread.tsx · 1s`) | Le fil ne bouge plus du tout ; l'activité se lit au même endroit que le bouton Interrompre | Le pied est déjà chargé (indice, Interrompre, Arrêter) ; invisible en lecture seule, où il n'y a pas de pied |

## Choix faits dans le prototype

- Les variantes reçoivent `ActionRow` en `renderItem` depuis `Thread.tsx` : `proto/` n'importe jamais le fil, pas de
  cycle, et la ligne d'aujourd'hui reste la seule façon d'ouvrir un appel.
- Les chaînes fr/en vivent dans `proto/strings.ts` ; `messages.ts` n'est pas touché tant que rien n'est retenu.
- Les durées passent par `ms()` de `motion.ts`, donc `VITE_LEDGE_MOTION` les met à zéro comme le reste de l'app.
- Le flag se lit à chaque rendu (une lecture de `localStorage`), pas de cache, pour que la story et les tests le
  changent sans recharger le module.

## Si on retient quelque chose

Recommandation : **piste 1 + E** (la ligne vivante pour les lectures, les lignes actuelles pour ce qui écrit ou
exécute), et F comme emplacement si le fil doit rester immobile. B est à écarter sauf à rouvrir la décision de la
spec. Reste à faire alors : passer les chaînes dans `messages.ts`, décider où vont les erreurs d'outils effacées,
ajouter la variante aux e2e visuels (`screenshots.spec.ts`), retirer la story et le flag.

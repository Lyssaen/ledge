# Refonte IDE — lot 0 : résultats et reprise

Lot 0 du plan [`docs/ide-workspace-plan.md`](https://github.com/Lyssaen/ledge/blob/docs/ide-workspace-plan/docs/ide-workspace-plan.md), sur la branche `docs/ide-workspace-plan`. Le design validé (v26) est sur la même branche. État au 2026-11-06.

## Verdict

**Validé par l'utilisateur le 2026-11-06 sous Windows : « ça fonctionne, let's go ».** On garde la décision D2 : des fenêtres popout d'un même document, avec dockview.

| Question | Résultat |
|---|---|
| `window.open` donne une vraie fenêtre Tauri, scriptable par la page principale | **Oui.** `on_new_window` répond avec `.window_features(features)` (même environnement WebView2) puis `NewWindowResponse::Create`. dockview y dessine ses groupes en popout. |
| Un PTY ouvert par la page principale s'affiche dans une popout | **Oui.** Son `Channel` reste celui de la page principale ; rien ne bouge côté Rust. |
| Déplacer des onglets entre fenêtres, détacher, ramener | **Oui**, après avoir coupé le gestionnaire de dépôt de fichiers de Tauri (voir plus bas). Les boutons « Détacher » et « Ramener » marchent aussi. |
| Fluidité (le critère 4.2 du plan) | **Pas encore mesurée sous Windows.** Le banc existe, mais la mesure n'a pas été lancée et aucun fichier de résultats n'a été produit. Les chiffres pris dans Chromium sous WSL (rendu logiciel, faux flux sur le fil principal) ne valent pas mesure. À faire en début de lot 1 (voir « Reprise »). |

## Ce qu'on a appris, et qui vaut pour l'implémentation

1. **xterm garde le document où il a été ouvert.** Déplacé tel quel dans une popout, il reste vide. Il faut recréer l'xterm dans le document cible et y rejouer la fin de la sortie, gardée dans un tampon (256 Ko dans le POC). Le PTY ne bouge pas. Comme on ne peut pas se fier à `element.ownerDocument` (l'élément est adopté), on compare au document d'ouverture. Voir `poc/ide-l0/src/terms.ts`, `mount()`.
2. **Le gestionnaire de dépôt de fichiers de Tauri capte le glisser HTML5.** Il faut appeler `.disable_drag_drop_handler()` sur chaque fenêtre, la principale **et** les popouts. Ledge Desktop le fait déjà pour sa fenêtre principale (`"dragDropEnabled": false`). Les popouts créées dans `on_new_window` doivent le faire aussi.
3. **En v8, le binding React est un paquet à part.** dockview 8 se compose de `dockview-core`, de `dockview-react` pour React (`DockviewReact`) et de la CSS `dockview-react/dist/styles/dockview.css`. Le POC utilise la 8.6.1, publiée il y a plus de deux semaines au moment du choix.
4. **Une popout dockview contient un seul groupe.** La maquette v26 montre une seconde fenêtre avec plusieurs groupes côte à côte. Avec dockview, une fenêtre détachée n'a qu'un groupe (plusieurs onglets). Pour plusieurs groupes par fenêtre, il faudrait une grille dockview dans la popout. **À arbitrer avec l'utilisateur et `design-ux` avant le lot 9** : accepter un groupe par fenêtre, ou imbriquer une grille.
5. **Fermer une popout.** Dans une webview, le `close()` de la page peut ne rien faire. Sur `onWillClosePopoutWindow`, on lit le label Tauri de la popout (`__TAURI_INTERNALS__.metadata.currentWindow.label`) et on demande sa fermeture côté Rust (`close_window`).
6. **Fenêtre principale réduite.** Le banc contient un test qui vérifie si les terminaux des popouts dessinent encore quand la fenêtre principale est réduite (tous les rAF partagent un même fil). Ce test n'a pas encore tourné sous Windows. Il fait partie de la mesure à lancer.

## Ce qui est sur la branche `poc/ide-l0`

- `poc/ide-l0/` : le POC **jetable**, jamais livré. Il contient une app Tauri, dockview, 16 terminaux et 3 fils sur 3 fenêtres, plus le banc (`src/bench.ts`).
- `.github/workflows/poc-ide-l0.yml` : il compile le `.exe` Windows sur `windows-latest` à chaque push de cette branche, et le dépose en artefact « poc-ide-l0-windows ». Il disparaîtra avec le POC.
- `apps/desktop/src/workspace/model.ts` et `apps/desktop/test/workspace/model.test.ts` : **le modèle d'espace de travail, à garder** pour le lot 1. C'est de la logique pure et sérialisable, couverte par 25 tests, typée sans erreur (`pnpm --filter desktop typecheck`). Il gère :
  - un onglet jamais dupliqué ;
  - un groupe vidé qui disparaît, et une fenêtre secondaire vide qui se ferme ;
  - l'arrachage d'un onglet hors de la fenêtre et son retour ;
  - les groupes liés par couleur, d'une fenêtre à l'autre ;
  - « +N −N » qui ouvre les modifications à côté ;
  - la sérialisation des dispositions.

## Reprise sur un autre poste

```bash
git fetch origin
git worktree add ../ledge-worktrees/ide-l0 poc/ide-l0      # ou : git switch poc/ide-l0
gh run list --branch poc/ide-l0 --limit 1                  # le dernier .exe compilé
gh run download <id> -n poc-ide-l0-windows -D <dossier Windows>
```

Pas besoin de Rust en local : la CI compile. Le développement du front se fait dans `poc/ide-l0` avec `npm ci`, puis `npm run dev` (navigateur) ou `npm run build`.

**Prochaines actions, dans l'ordre :**
1. Lancer la mesure sous Windows : bouton « Lancer la mesure (≈ 1 min) ». Les résultats arrivent dans `%USERPROFILE%\ledge-poc-l0-results.json`. Il y a deux profils, « réaliste » (6 flux au rythme d'un agent) et « charge max » (3 flux à pleine vitesse en plus). Il faut comparer au critère 4.2 : écho sous 50 ms, aucune image de plus de 100 ms.
2. Trancher le point 4 (un groupe par fenêtre, ou une grille imbriquée).
3. Lot 1 (la coque, derrière l'interrupteur « Interface IDE (aperçu) ») : partir de `origin/main`, reprendre `apps/desktop/src/workspace/` de cette branche, et appliquer les points 1, 2 et 5 ci-dessus.
4. Supprimer `poc/ide-l0/` et son workflow une fois les mesures relevées.

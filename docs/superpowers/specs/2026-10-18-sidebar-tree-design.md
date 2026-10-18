# Sidebar arbre (Nova)

Date : 2026-10-18 · Maquette : `docs/mockups/session-management/sidebar-tree.tsx` (+ `sidebar-tree.css`), visible dans `docs/mockups/ledge-session-management.html`.

Le plan session-management a livré l'archive, le menu et les messages daemon. Il a explicitement reporté **cette sidebar** ici.

## Intention

La sidebar actuelle ne montre que des projets (pastilles d'état) et des vues. Pour ouvrir un agent, il faut passer par l'atelier ou la Liste. L'utilisateur veut **voir, ouvrir et ranger ses agents depuis la barre**, comme dans l'explorateur d'un IDE : projet › branche › session › sous-agents, plus ce qui l'attend et ce qu'il a archivé.

## Objectifs

- Remplacer `apps/desktop/src/shell/Sidebar.tsx` par l'arbre de la maquette.
- **À toi** : les demandes et erreurs, plus ancienne d'abord, Oui / Non / Répondre / Voir sur place.
- **Arbre** projet › branche (si plusieurs) › session › sous-agents. Un seul enfant se fond dans le parent.
- **+N terminées** : les sessions `exited` / `idle` (pas hors ligne) se cachent derrière ce lien, d'où on les archive.
- **Archives** : section repliée, filtrable au-delà de 4, Relire / Remettre / Reprendre / Supprimer.
- Le **même menu de session** (`SessionMenu`) sur « … » et clic droit, y compris dans l'arbre et « À toi ».
- **Demander à Ledge** : champ + mascotte ; `/` y pose le focus ; Entrée ouvre le chat et envoie le texte.
- Supprimer la **vue Liste** (onglets Atelier / Liste). L'atelier reste la seule vue d'ensemble ; « +N à cette table » filtre l'atelier sur ce projet.

## Non-objectifs

- Le sélecteur « Archiver les terminées après 1 h / 1 j / 7 j » de la maquette : aucun message daemon ne le porte (plan session-management). Il n'apparaît pas.
- Un word mark « Ledge. » et un bouton Rechercher dans la sidebar : la barre de fenêtre les a déjà (`TitleBar`). Le test `titlebar.test.tsx` l'exige.
- Refaire la colonne « Agents du projet » de la page de session (`AgentsRail`).
- Un signal sidebar pour les messages inter-agents (spec agent-messages : cette zone lui appartient ; on n'y touche pas).
- Changer le délai d'archivage automatique du daemon (`retireMs`, 10 min).

## Anti-objectifs

- **Dupliquer la marque ou la recherche** dans la sidebar.
- **Envoyer** `session.archive|restore|resume|delete` à une machine dont `daemon.archive` n'est pas vrai (déjà `SessionActions.allowed`).
- **Perdre le fil d'une archive** en la listant hors de `FleetView.archived`.
- Laisser la Liste comme second endroit pour parcourir les agents une fois l'arbre livré.

## Décisions

1. **Pas de daemon nouveau.** L'arbre lit `Session.branch`, `Session.worktree`, `Session.repo`, `Session.helpers`, `Session.pending`, `FleetView.archived`. Les actions passent par `SessionActions` et `SessionMenu` déjà livrés.

2. **Branche absente = `main`.** Un projet qui n'a qu'une branche (ou « Sans projet ») n'a pas de rangée branche : les sessions s'accrochent sous le projet, et la ligne projet montre `repo · branche` à droite du nom.

3. **Terminées = `exited` ou `idle`, machine joignable.** Hors ligne reste visible (pastille « hors ligne »). Masquées par défaut (`hideDone: true`).

4. **Sous-agents = `Session.helpers`.** Ils n'ont pas de menu. Ils se déplient tout seuls si l'un d'eux attend (demande routée, `pending.helperId`). Le chevron force l'état inverse. La pastille « N sous-agents » de la page de session incrémente `revealCurrent` : l'arbre déplie et scrolle.

5. **« À toi » inclut les sous-agents.** Une demande dont `pending.helperId` est posé s'affiche sous le nom du sous-agent, avec `↳ Parent` et la pastille du projet. Au-delà de 4 cartes, « Voir les N autres ». Alt ↓ ouvre la suivante (cycle). Oui / Non appellent `decisions.decide` ; Répondre / Voir ouvrent la page (`focus: 'reply'` pour une question).

6. **Titlebar et sidebar se partagent le rôle, pas les widgets.**
   - Titlebar : marque, recherche (Ctrl K), pastille d'attente, DND, chat, boutons fenêtre.
   - Sidebar : **Session** (N), champ Demander à Ledge (/), Atelier (compteur des actifs), À toi, arbre, Archives, machines compactes, engrenage Réglages.
   - Le bouton « Chat Ledge » quitte la sidebar. `/` focus le champ ask ; mascotte ou Entrée vide ouvre le chat sans envoyer.

7. **Demander à Ledge envoie comme le chat.** Même `chat.ask` + `daemonStore.beginTurn`, même outil par défaut (`useDefaultTool`). Le chat s'ouvre et le champ de la sidebar se vide.

8. **Préférences** `desktop.sidebar` : `{ hideDone: true, dense: false }`. H et D depuis l'arbre (focus dans l'arbre). « Tout replier » n'est pas persisté.

9. **Révélation.** Une session ouverte est toujours dépliée jusqu'à elle et scrollée. Une archive ouverte déplie Archives. Un clic sur la pastille « Archivée » du fil d'Ariane incrémente `revealArchives`.

10. **Largeur 288 px** (256 px sous 1250 px, rail 64 px sous 850 px, cachée sous 540 px), comme la maquette. Plein écran : toujours cachée.

11. **Liste retirée.** `View` ne vaut plus que `'atelier'`. `desktop.overview.view: 'list'` se lit comme atelier. « +N à cette table » fait `home` sur ce projet (plus `view: 'list'`). Les e2e qui ouvraient une session par la Liste l'ouvrent par l'arbre. On garde `list/time.ts` (`spanOf`, `whenOf`, `trackWaits`) et `repoOf` / `bucketOf` : la page de session, la titlebar et les toasts s'en servent.

12. **Clavier de l'arbre** (focus dans l'arbre, pas pendant la saisie) : ↑ ↓ parcourir, ← replier ou parent, → déplier, E archiver le principal, Suppr supprimer le principal, H / D comme ci-dessus. Ctrl ⇧ E pose le focus sur la session ouverte, sinon la première rangée. Ces touches n'atteignent pas l'atelier (`stopPropagation`).

## Forme

```
[ Session N ]
[ ☺ Demander à Ledge…        / ]
Atelier                    n actifs

À toi  n                         Alt ↓
  [cartes : bot, nom, où, délai, Oui/Non|Répondre|Voir]

Projets          [œil] [compact] [replier] [+]
  ▼ Ledge    harness-assistant · desktop    1 2
      Otto     Câbler la sidebar     12 min  …
      +1 terminée                         Archiver
  ▼ Payment Service    payment · checkout
      Nova     Préparer la migration  7 min  …

▸ Archives  3
  (filtre si > 4)
  Nova   …   Remettre / Reprendre / Supprimer

Local 2    Dev SSH                      ⚙
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `apps/desktop/src/shell/sidebar/model.ts` | Arbre, « À toi », filtre d'archives : fonctions pures |
| `apps/desktop/src/shell/sidebar/prefs.ts` | `desktop.sidebar` |
| `apps/desktop/src/shell/sidebar/Sidebar.tsx` | Composition (remplace `shell/Sidebar.tsx`) |
| `apps/desktop/src/shell/sidebar/Attention.tsx` | Cartes « À toi » |
| `apps/desktop/src/shell/sidebar/Tree.tsx` | Projet › branche › session |
| `apps/desktop/src/shell/sidebar/Archives.tsx` | Section Archives |
| `apps/desktop/src/styles/sidebar.css` | Styles de la maquette, sans marque / recherche / sélecteur auto |

## Ce qui reste au constructeur

L'emplacement exact des petits helpers visuels (chevron, pastille wt) s'ils tiennent mieux dans `Tree.tsx` que dans un fichier à part. Les noms internes non listés ici.

# Gestion des sessions : terminer, archiver, reprendre, supprimer

Date : 2026-10-18 · Maquette : `docs/mockups/session-management/` (construite dans `docs/mockups/ledge-session-management.html`), sidebar de la session « Nova » incluse.

## Intention

Dans Ledge Desktop, on ne peut pas clôturer un agent : il reste assis à sa table même quand on n'en veut plus. L'utilisateur veut **le retirer pour l'archiver, et ne le retrouver plus tard que si besoin**. Il veut aussi pouvoir le supprimer pour de bon.

Aujourd'hui, le daemon sait tuer une session (`session.kill`) et l'oublier (`session.dismiss`), mais seule l'île le propose. De plus, toute session terminée disparaît d'elle-même 10 min après sa fin, ou au redémarrage du daemon, et son fil part avec elle.

## Objectifs

- **Terminer** une session vivante, depuis Desktop.
- **Archiver** une session. Elle quitte l'atelier, mais son fil reste lisible. Si elle tourne encore, Ledge l'arrête d'abord.
- **Retrouver** une archive dans la section Archives de la sidebar (plan de Nova), puis :
  - **Relire** : ouvrir la page de session, avec un bandeau « Session archivée » ;
  - **Reprendre** : relancer l'agent sur sa machine, dans la même conversation ;
  - **Remettre à la table** : la rendre visible, terminée, sans la relancer ;
  - **Supprimer** définitivement.
- **Supprimer** définitivement une session, archivée ou non.
- Le **même menu** partout où une session apparaît : siège de l'atelier, carte « Sans projet », en-tête de la page de session, et lignes de la sidebar de Nova. Il s'ouvre par un clic droit ou par « … », et contient :
  - Ouvrir (Entrée)
  - Terminal (T)
  - Renommer… (F2)
  - Ranger dans…
  - Terminer, ou Reprendre si la session est terminée
  - Archiver (E)
  - Supprimer… (Suppr)

## Non-objectifs

- La sidebar elle-même (arbre, section Archives, « +N terminées », recherche) : c'est le plan de Nova, qui consomme ce qui est livré ici.
- La suppression de la vue Liste : elle relève aussi du plan de Nova.
- Le réglage du délai d'archivage automatique : il n'est pas dans cette version, le délai est fixé à 10 min (voir Décisions).
- Effacer l'historique que l'outil de l'agent garde sur la machine (`~/.claude`, `~/.codex`, `~/.cursor`).

## Anti-objectifs

Échouer sur l'un de ces points est un échec, même si tout le reste marche :

- **Perdre un fil archivé** : au redémarrage du daemon, au nettoyage automatique ou à la mise à jour.
- **Arrêter un agent sans confirmation.** Terminer, Supprimer et « Terminer et archiver » demandent toujours confirmation. Archiver une session déjà terminée n'en demande pas, mais propose « Annuler » pendant 8 s, ou Ctrl Z.
- **Couper la liaison d'une machine distante** en lui envoyant un message qu'elle ne connaît pas.

## Décisions

1. **Une archive reste dans le store de son daemon.**
   - Une session archivée garde son entrée dans `~/.ledge/sessions.json`, avec un nouveau champ `archivedAt` (ISO).
   - Le snapshot, `session.updated`, le routage de la flotte (`machine:id`) et les fils (`~/.ledge/history/<id>.jsonl`) marchent donc sans changement.
   - Chaque machine archive ses propres sessions.
2. **Plus aucune session n'est oubliée automatiquement.**
   - Le poller archive une session terminée depuis plus de `retireMs` (10 min, comme aujourd'hui), au lieu de la retirer.
   - Au démarrage, une session dont le tmux a disparu devient `exited` (événement `PaneGone`) au lieu d'être retirée. Elle est ensuite archivée par la même règle.
3. **Les archives sont plafonnées à 200 par daemon** (`ARCHIVE_MAX`). Au-delà, la plus anciennement archivée est supprimée, avec son fil.
4. **Nouveaux messages client**, tous refusés par `error{id, request}` en cas de problème :
   - `session.archive{id}` :
     - session vivante lancée par Ledge : le daemon tue le tmux, applique `PaneGone`, puis archive ;
     - session `hook_only` (démarrée hors de Ledge) : le daemon l'archive sans pouvoir l'arrêter. Si elle envoie un nouveau hook, elle revient d'elle-même ;
     - session déjà archivée : sans effet.
   - `session.restore{id}` : le daemon retire `archivedAt`. La session revient à sa table, à l'état `exited`, sans être relancée.
   - `session.resume{id}` :
     - session terminée ou archivée seulement : une session vivante est refusée ;
     - le daemon relance l'outil dans un nouveau tmux, **avec le même id Ledge et le même nom**. Le fil continue et la session reprend sa place à la table ;
     - la session garde son sujet, son dépôt et sa branche, et perd `archivedAt`, `exitCode` et `exitedAt` ;
     - sans identifiant de conversation, la demande est refusée par `no conversation to resume`.
   - `session.delete{id}` : le daemon tue d'abord une session vivante lancée par Ledge, puis la retire. Le fil part avec elle, par le chemin existant `history.forget`.
   - `session.dismiss` reste tel quel pour l'île.
5. **L'identifiant de conversation de l'agent** (`agentSessionId`) suit les hooks, pour les trois outils :
   - **Claude et Codex** : `session_id` du payload ;
   - **Cursor** : `session_id` ou `conversation_id` de la session principale (jamais celui d'un sous-agent) ;
   - le dernier identifiant reçu gagne, ce qui suit `/clear` et `--resume`.

   Les commandes de reprise :
   - Claude : `claude --resume <id>`. Sans `agentSessionId`, l'identifiant est le nom du fichier `transcriptPath` ;
   - Codex : `codex resume <id>` ;
   - Cursor : `cursor-agent --resume <id>`.
6. **Compatibilité.**
   - Le daemon annonce `daemon.archive: true` dans son snapshot.
   - Desktop n'envoie les quatre nouveaux messages qu'aux machines qui l'annoncent. Ailleurs, les entrées du menu sont désactivées avec « Mettez Ledge à jour sur <machine> ».
   - Un daemon ancien rejette un message inconnu, et le pont SSH coupe alors la liaison : c'est pour l'éviter que Desktop vérifie d'abord.
7. **Côté client** (`@ledge/fleet`, `daemonStore`) :
   - `sessions` ne contient plus les archives, donc l'atelier, l'île, les compteurs et le chat ne changent pas ;
   - un nouveau champ `archived` les liste, de la plus récente à la plus ancienne ;
   - `byId` garde toutes les sessions ;
   - le contexte du chat Ledge, côté daemon, ignore aussi les archives.
8. **Rendu Desktop**, d'après la maquette :
   - confirmation en `alertdialog` ;
   - toast avec action (« Annuler », Ctrl Z) ;
   - bandeau « Session archivée » sur la page de session. Le champ de réponse y est remplacé par les actions Reprendre, Remettre à la table et Supprimer ;
   - « Archiver les terminées » dans le menu « … » d'une table ;
   - E et Suppr sur l'agent focalisé de l'atelier ;
   - les sous-agents n'ont pas de menu : ils suivent leur principal.

## Ce qui reste au constructeur

L'emplacement exact des styles, les petits détails de rendu, et les noms internes non listés dans le plan.

# Broadcast : écrire à plusieurs sessions d'un coup

## Intention

Guillaume veut pouvoir écrire en une fois à plusieurs sessions Ledge : à toutes celles d'un projet, ou à une liste nommée. Il veut pouvoir le faire lui-même depuis l'interface, et qu'une session (Claude ou Codex) puisse le faire aussi. Sur `main`, les équipes, les rôles et les sièges ont été retirés (c6081334), et OpenRig est intégré à leur place. Le broadcast ne dépend donc d'aucune notion d'équipe. Le travail sur les équipes reprendra plus tard ; la branche `feat/teams-two-engines` reste disponible pour ça.

## Ce qui est décidé (validé par Guillaume le 2 novembre 2026)

- **Cibles.**
  - **`@projet:<nom>`** : toutes les sessions vivantes du projet, sauf l'expéditeur. Le nom est celui du registre des projets, comparé sans tenir compte de la casse. L'id du projet est accepté aussi.
  - **Une liste `Pim,Nova`** : des sessions nommées, séparées par des virgules, deux au moins et huit au plus.
- **Expéditeurs.**
  - **Une session** : avec `ledge send <cible> "<message>"`, ou le `SendMessage` d'une session Claude, que le hook fait passer par Ledge.
  - **L'utilisateur** :
    - sur Desktop, un champ « Écrire à tout le projet », plus une sélection de plusieurs sessions pour leur écrire ;
    - dans le TUI et sur le téléphone, le même champ par projet (par groupe sur le téléphone).
- **Destinataires.** Seulement les sessions lancées par Ledge (`source: 'launcher'`), vivantes et non archivées. Les sièges OpenRig (`s.rig`) sont exclus : Ledge ne peut pas leur écrire.
- **Livraison.**
  - Chaque destinataire reçoit un message normal, dans sa file, à la fin de son tour. Il n'y a pas de priorité et rien ne passe devant.
  - Le message porte la mention de sa cible : « (à tout le projet billing) » ou « (à Pim, Nova) ».
- **Compte rendu à l'expéditeur.** Il dit à qui le message est parti et qui l'a refusé, avec la raison. Par exemple : « remis à 3 sessions (Pim, Nova, Otto) ; refusé : Zed (n'a pas été lancée par Ledge) ».

## Contraintes

- On part de `main`, sur la branche `feat/broadcast`. On ne pousse pas sur `main`. À la fin, on pousse la branche sans ouvrir de PR.
- **Compatibilité du fil.** Le protocole ne gagne que des champs optionnels ou de nouveaux types de message. Un daemon stable distant qui reçoit un nouveau message le refuse proprement. Les schémas du téléphone dans le sens téléphone → serveur restent stricts.
- **Tests.** Tout ce qui touche à la messagerie se teste contre le vrai daemon et la vraie mailbox, pas contre un faux qui répond toujours « remis ». C'est la leçon du lot C de la branche des équipes.
- **Messages Claude ↔ Claude.** Un `SendMessage` vers une seule session ne change pas.
- **Textes.** En français, avec l'anglais à côté dans les i18n de Desktop et du TUI.

## Laissé au constructeur

- Où placer le champ dans chaque interface, et le format exact de la mention dans le message reçu, dans l'esprit des exemples ci-dessus.
- Une seule carte « envoyé » dans le fil de l'expéditeur pour un broadcast, plutôt qu'une par destinataire. **[R]**

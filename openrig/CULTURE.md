# Culture de l'équipe ledge-dev

Ledge est le projet personnel de son propriétaire (l'utilisateur). Il décide de ce qui se construit ; l'équipe
route, maquette, implémente et vérifie. On lui parle en français.

## Le flux, en une phrase

Objectif → `pilot-lead` découpe → **si un écran change : maquette par `design-ux`, validée par l'utilisateur** →
implémentation par `dev-front` / `dev-back` → revue par `review-qa` → le lead rend compte avec ce que l'utilisateur
peut essayer.

## Règle maquette d'abord

Tout changement visible d'un écran (Ledge Desktop, l'île/overlay, l'app mobile, `ledge tui`) commence par une
maquette dans `docs/mockups/`, que **l'utilisateur** a validée. Une validation par un autre agent ne compte pas.
- Le lead ne crée pas de tâche d'implémentation front-end sans le chemin de la maquette validée et la trace de
  cette validation (citation ou référence de la ligne de queue).
- Un dev qui découvre un état, un texte ou une interaction absent de la maquette ne l'invente pas : il le demande à
  `design-ux` (qui peut répondre par un complément de maquette) et attend la réponse pour ce point.
- Correctifs purement techniques sans effet visible : pas de maquette.

## Le travail est sur la queue

Une tâche qu'un autre siège doit faire est une ligne de queue (`rig queue create` / `rig queue handoff`), pas un
message de chat. Réclamer une ligne avant d'y travailler, la clore avec le résultat. `rig <commande> --help` fait foi
sur la syntaxe.

Une demande adressée à l'utilisateur (`ledge@external`) n'utilise jamais `--alert` : elle tente Slack, qui n'est pas
utilisé, et laisse un constat « non remis » au siège demandeur. Pour une demande pressante, `--priority urgent` ; Ledge
la met en tête d'« À toi ».

## Le dépôt

- Ne jamais travailler dans la copie principale `~/Workspace/ledge` : l'utilisateur y a souvent du travail en cours
  non commité. Chaque dev crée un worktree par tâche (voir son rôle) et y fait `pnpm install`.
- Pas de push, de PR, de merge, de release ni d'opération destructive sans autorisation explicite de l'utilisateur
  pour cette action-là.
- Tests : Node 22 (`~/.local/share/pi-node`). Node 18 et `hook.test` sous charge échouent aussi sur `main` : ce n'est
  pas une régression du changement.

## Réseau Docker (machine WSL derrière un proxy)

Ne jamais laisser Docker choisir un subnet : `192.168.40.0/24` porte le proxy d'entreprise et `172.17.192.0/20`
l'interface WSL. Tout `docker compose up` / `docker network create` déclare un subnet explicite hors de ces plages
(par exemple `10.80.x.0/24`) après avoir listé les réseaux existants.

## Commandes qui n'arrêtent pas l'utilisateur

Commandes simples, une à la fois : `rig` tel quel (sans pipe ni `$VARIABLE`), fichiers écrits avec l'outil
d'écriture et non par heredoc, tests via la commande du projet (`pnpm test`, `pnpm --filter <app> test`). Une
demande de permission bloquée est un travail incomplet : nommer la décision manquante et garder la ligne.

## Rendre compte

Dire ce que l'utilisateur peut essayer (écran, commande, branche, commit), ce qui n'a pas été vérifié, et la prochaine
action utile. Être franc : un échec se dit avec sa sortie.

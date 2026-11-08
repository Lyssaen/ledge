# Lot 7d : questions pour design-ux

États absents de la maquette `docs/mockups/ledge-ide-rigs.html`. Ce fichier part dans la description de la PR, puis il est supprimé.

## La modale « Lancer un rig » (Task 3)

1. **Segment Machine.** La maquette le place après le nom, pour un rig existant comme pour un nouveau. En relance, il est remplacé par la machine en texte fixe (R2), comme le nom. Il reste dans les modes spec et rig vide : il y change la machine de toute la modale, et les cartes et les specs sont relues. Il est aussi au-dessus de l'avis « daemon arrêté », mais pas en mode operator. Il est grisé, comme les cartes, pendant qu'un lancement, une relance ou une demande à l'operator est en cours. Est-ce bien ça ?
2. **Daemon arrêté (R5).** La maquette ne dessine pas cet état. La modale montre le segment Machine, « Le daemon OpenRig est arrêté sur <machine>. », la commande (`rig start --last` avec les préférences par défaut), « Démarrer OpenRig » et « Annuler ». Aucune carte. `Ctrl+Entrée` ne fait rien ici : il ne démarre pas le daemon. Est-ce bien ça ?
3. **Carte d'un rig arrêté.** Son sous-titre reprend la carte `synapse-review` de la maquette : « Spec enregistrée · N sièges · arrêté ». Faut-il plutôt « Rig arrêté · N sièges » ?
4. **Carte d'une spec.** « Spec enregistrée · N sièges · intégrée » (ou « · à moi »), sans icône. Faut-il une icône, comme la pastille des rigs, le + du rig vide et la bulle de l'operator ?
5. **Rig vide sans la spec `factory`.** La carte est grisée avec « La spec factory manque sur cette machine » (texte nouveau).
6. **Rôles à 0 du rig vide.** « à compléter » s'affiche à côté du rôle, et son « − » est grisé.
7. **Ce qui bloque « Lancer ».** Le texte s'affiche en rouge à la place de « Ouvre la vue Rig de … », dès que le cas se présente. Textes nouveaux :
   - « Un rig de ce nom existe déjà sur <machine>. »
   - « Un nom de rig : lettres, chiffres, point, - et _, sans espace. »
   - « Choisis le dossier de travail. »
   - « Il faut au moins un siège. »
8. **Champ Dossier** (décision 2, absent de la maquette). C'est un champ texte avec la liste des dossiers des projets sur cette machine, placé après Machine.
9. **Relance : le nom et la machine.** Ils s'affichent en texte fixe, sans cadre de champ, avec le chemin de la spec quand Ledge le connaît. La maquette montre `~/.openrig/rigs/<nom>.yaml`, un chemin inventé.
10. **Relance : les sièges.** Ce sont des puces de rôle, avec le nombre de sièges quand il dépasse 1, sans ±.
11. **Relance sans snapshot.** La case est décochée et grisée, avec « Aucun snapshot ». La relance est alors un simple `rig up <rig> --existing`, qui démarre les sièges à neuf, et non `--fresh`. Pendant la lecture des snapshots, la case affiche « Reprendre le dernier snapshot (…) », grisée. Si le daemon ne sait pas relancer à neuf (`openrigFresh` absent), la case reste cochée et grisée, avec « Le Ledge de cette machine est trop ancien pour relancer les sièges à neuf. ».
12. **Relance : permissions mixtes ou daemon trop ancien.** Rig mixte : aucun niveau n'est coché, avec « Mixte : les sièges n'ont pas tous le même niveau. » Daemon sans `rig.policy` : le segment est grisé, avec la phrase « trop ancien ».
13. **Une carte grisée ou disparue après coup.** Une carte grisée depuis le choix (le kernel s'arrête pendant qu'on écrit à l'operator, ou le rig choisi est démarré ailleurs) reste choisie : son bouton est inactif et la raison s'affiche en rouge. Une carte disparue (un rig du nom de la spec apparaît) ne laisse aucune carte choisie, avec « Ce choix n'est plus proposé : choisis une carte. ». Dans les deux cas, la modale ne bascule pas sur une autre carte, et `Ctrl+Entrée` ne fait rien. Est-ce bien ça ?
14. **Refus de l'operator.** Le message s'affiche en rouge à côté du bouton. Il y a un texte nouveau par code : `no_operator`, `openrig_stopped`, `unreachable`, `uncertain`, `refused`, `offline`, `outdated`.
15. **« Plus d'options ».** Contenu : un tableau rôle / harnais / modèle / permission, puis le segment de délégation (sans libellé visible, seulement pour les lecteurs d'écran), puis le non-interruptif quand un siège est en YOLO, « Enregistrer dans mes specs sous … », « Vérifier », et enfin le résultat et le YAML. Rien de tout cela n'est dessiné. Faut-il un libellé « Qui délègue à qui » au-dessus du segment ?
16. **Permissions.** Pas d'aide sous le segment (l'ancien formulaire en avait une par niveau). YOLO coché passe en rouge. Les flèches, Début et Fin déplacent le focus ; Espace, Entrée ou un clic choisissent le niveau. C'est le même comportement partout, onglet Rig compris.
17. **Lectures en cours.** « Lecture d'OpenRig… » puis « Lecture des specs… » s'affichent sous le segment Machine, sans cartes.
18. **Échec d'un lancement ou d'une relance.** Le message s'affiche en rouge à la place de la note, et la modale reste ouverte.
19. **La commande ne commence jamais par le démarrage du daemon.** Un daemon arrêté remplace tout le formulaire par son avis (R5). La spec dit pourtant « Elle commence par le démarrage du daemon s'il est arrêté ». Est-ce bien ça ?
20. **La grille « Partir de » défile** à partir de trois rangées environ (R1). La carte « Composer avec l'operator », la dernière, se retrouve alors souvent cachée en bas. Faut-il la sortir de la grille, ou ne la faire défiler qu'au-delà de quatre rangées ?

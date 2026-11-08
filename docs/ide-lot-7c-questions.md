# Lot 7c : l’onglet Rig de l’IDE, questions pour la PR

La maquette (`docs/mockups/ledge-ide-rigs.html`, `topoPage()`) ne dessine que le cas « tout va bien ». Les états ci-dessous n’y sont pas : l’onglet reprend des textes qui existent déjà, sauf mention. À valider ou à redessiner.

1. **La machine du rig est hors ligne, ou son Ledge est trop ancien.** L’onglet n’affiche qu’une ligne : « Cette machine est hors ligne. » ou « Le Ledge de cette machine est trop ancien pour piloter OpenRig. Mettez-le à jour. » (textes de la page OpenRig), sans bouton. L’onglet reste fermable.
2. **Premier chargement.** « Lecture d’OpenRig… » (page OpenRig) tant que la machine n’a pas répondu. OpenRig absent de la machine : le titre et le texte « OpenRig n’est pas installé » de la page OpenRig.
3. **Le rig n’existe plus sur la machine** (supprimé pendant que l’onglet est ouvert). Texte **nouveau** : « Le rig « nom » n’existe plus sur cette machine. », sans action.
4. **La spec du rig est inconnue** (rig lancé hors de Ledge) : l’en-tête des réglages dit « Spec inconnue : rig lancé hors de Ledge ». Le niveau « Spec » est grisé quand la spec ne donne aucune politique connue (infobulle : « La spec de ce rig ne donne aucune politique connue. »). Si le daemon refuse tout de même, la ligne d’échec sous le segment dit pourquoi (`spec_unknown`, `spec_no_policy`, `spec_policy_unsupported` : textes nouveaux).
5. **Le daemon de la machine ne sait pas appliquer une politique** (`openrigPolicy` absent). Les six niveaux sont grisés, avec « Le Ledge de cette machine est trop ancien pour piloter OpenRig. Mettez-le à jour. » sous le segment.
6. **Aucun snapshot.** « Aucun snapshot » à la place de la date. La date est en heure locale ; une date d’OpenRig sans fuseau (`2026-11-08 14:54:01`) est lue comme de l’UTC.
7. **Sièges aux permissions mixtes ou illisibles.** Aucun niveau n’est actif ; une ligne « Mixte » liste le résumé de chaque siège. Un siège dont la politique n’est pas lisible (sélection native explicite, politique `none`) compte comme mixte.
8. **Les ± de sièges** : la maquette applique à chaque clic ; l’onglet garde un brouillon, montre le plan (sièges ajoutés ou retirés, ceux qui travaillent signalés) et applique avec « Appliquer » (retirer un siège arrête sa session). Un brouillon est abandonné quand les sièges du rig changent.
9. **Une ligne de la file qui attend une réponse** porte un « ! » (infobulle « À toi : cette ligne attend une réponse »). L’âge se lit « < 1 min », « N min », « N h », « N j ».
10. **« Parler à l’operator »** (kernel) est grisé, avec « Ledge ne suit pas encore la session de l’opérateur : elle apparaît dans quelques secondes. », tant que Ledge ne suit pas la session de l’operator.
11. **Le daemon OpenRig est arrêté.** L’en-tête dit « le daemon est arrêté » à la place des boutons (texte de la maquette).
12. **Échec d’une action de l’en-tête** (arrêt, redémarrage, démarrage) : le message de la page OpenRig, en rouge sous l’en-tête, jusqu’à la prochaine action.

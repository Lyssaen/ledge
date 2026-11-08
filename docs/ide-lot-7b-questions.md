# Lot 7b : la vue Rigs de l’IDE, questions pour la PR

La maquette (`docs/mockups/ledge-ide-rigs.html`) ne dessine que le cas « tout va bien » et le cas « daemon arrêté ». Les états ci-dessous n’y sont pas : la vue reprend des textes qui existent déjà. À valider ou à redessiner.

1. **OpenRig n’est pas installé sur la machine affichée.** La section Rigs montre le cadre pointillé de « Daemon arrêté », avec le titre et le texte de la page OpenRig (« OpenRig n’est pas installé » / « La commande rig est introuvable sur cette machine. Ledge n’installe rien lui-même. »), sans bouton. Le kernel est vide, la ligne du daemon n’a pas d’actions. Dans le menu des machines, la ligne dit « OpenRig n’est pas installé ».
2. **La machine affichée est hors ligne.** Un simple texte « Cette machine est hors ligne. » (celui de la page OpenRig) dans la section Rigs, sans aucun bouton d’action. Quand le Ledge de la machine est trop ancien, le texte est « Le Ledge de cette machine est trop ancien pour piloter OpenRig. Mettez-le à jour. » à la place. Dans le menu, la ligne dit « hors ligne » (le texte de la barre latérale).
3. **Premier chargement.** « Lecture d’OpenRig… » (celui de la page OpenRig) dans la section Rigs, le temps de la première réponse ; rien dans le kernel. Dans le menu, la ligne dit aussi « Lecture d’OpenRig… ».
4. **Le daemon tourne mais le kernel est absent de la liste.** La section Kernel montre « Absent » (l’état du kernel de la page OpenRig), sans bouton.
5. **Échec d’une action.** Le message (celui de la page OpenRig : « Une autre action OpenRig est en cours sur cette machine. », « Échec : … ») s’affiche en rouge sous la ligne concernée, jusqu’à la prochaine action.

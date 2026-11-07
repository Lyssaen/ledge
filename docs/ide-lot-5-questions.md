# Lot 5 : questions pour design-ux

1. **La Sortie vide : quel texte ?** Le panneau « Sortie » du bas n'a pas d'état vide dans la maquette. Texte provisoire : « Aucune commande rig lancée depuis l’ouverture de Ledge. » (anglais : « No rig command run since Ledge opened. »).

2. **Un `rig up --plan` dans la Sortie ?** Une vérification seule (`openrig.launched` avec `plan: true`) est journalisée comme un vrai lancement. La garder telle quelle, la marquer (« plan »), ou la masquer ?

3. **Le menu « + ▾ » sans aucun shell (navigateur, ou rien de détecté) : quoi montrer ?** La maquette suppose toujours des shells. Provisoire : le titre « Nouveau terminal » seul, sans ligne. Le shell « par défaut » est le dernier choisi tant que le menu le propose, sinon WSL (sinon la première ligne) ; le panneau affiché vide attend que Ledge sache quels shells existent avant d'en ouvrir un. Sans aucun shell, `Ctrl+J` et le « Terminal » du groupe vide ouvrent quand même WSL (ou le dernier choisi), qui s'affiche « indisponible » (question 6).

4. **Le `title` de l'onglet d'une tuile : « Glisser vers un groupe » seul ?** La maquette dit « Glisser vers un groupe, ou hors de la fenêtre » ; les fenêtres séparées sont le lot 9, donc provisoirement « Glisser vers un groupe » (anglais « Drag to a group »). À compléter au lot 9.

5. **Le bandeau d'un shell libre terminé.** Absent de la maquette. Repris du panneau de droite : « Shell terminé (code N) », « Shell terminé », « Shell terminé : connexion perdue » (SSH), avec « Rouvrir » (même type de shell, même dossier, même xterm). Faut-il autre chose, ou fermer la tuile d'elle-même ?

6. **Un shell libre indisponible.** Absent de la maquette. Repris : « Ce dossier ne peut pas être ouvert dans un shell. » (le texte du panneau de droite), qui parle d'un dossier alors que c'est souvent le shell lui-même qui manque (pas de pseudo-terminal, pas de WSL). Quel texte ?

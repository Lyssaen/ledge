# Ledge Desktop — l'Atelier et l'île sobre

Date : 2026-10-16 · Projet personnel, hors story Jira · Statut : **maquette figée**, validée par l'utilisateur.

Maquettes interactives (données simulées, vrais composants de l'overlay) :

- Ledge Desktop : sources `docs/mockups/desktop-observatory/`, page `docs/mockups/ledge-desktop-observatory.html`
  (`node docs/mockups/desktop-observatory/build.mjs`).
- Île sobre : sources `docs/mockups/island-sober/`, page `docs/mockups/ledge-island-sober.html`
  (`node docs/mockups/island-sober/build.mjs`).

Page de documentation avec captures (organisation) : https://claude.ai/artifact/8QJ1dc8x6te11tJ4VJ8Kr6. Les pages
HTML générées s'ouvrent directement dans un navigateur ; après une modification des sources, relancer le `build.mjs`
correspondant (il réutilise les composants de `apps/overlay`, donc `pnpm install` doit avoir été fait).

Ce document décrit ce que la maquette fixe. Son articulation avec l'app `apps/desktop` de `feat/desktop` est tranchée
dans `2026-10-16-ledge-desktop-atelier-build-design.md`.

## 1. Intention

Ledge a deux fronts sur le même daemon. **L'île** (overlay en haut de l'écran) prévient et permet d'agir d'un geste.
**Ledge Desktop** est l'endroit où l'on suit ses agents dans la durée, où l'on démarre les sessions, où l'on range ses
projets et où se font **tous les réglages**, y compris ceux de l'île.

Le cœur de Desktop est **l'Atelier** : une pièce où chaque projet a sa table, ses agents assis autour, leurs tâches
posées devant eux. On voit d'un coup d'œil qui travaille sur quoi, où, et qui attend une décision.

## 2. L'Atelier

### 2.1 Tables

- **Une table par projet ayant au moins un agent.** Un projet sans agent n'a pas de table ; il n'apparaît que dans la
  barre latérale, et sa vue propose « Nouvelle session ».
- **La table grandit avec ses agents** : les agents principaux s'assoient en quinconce (un en haut, un en bas), un pas
  de table par agent, jusqu'à 6. Au-delà (ou au-delà des places de sous-agents), une pastille **« +N à cette table »**
  avec les têtes des agents non assis se pose dans le coin bas droit du tapis, en miroir de l'étiquette ; elle ouvre la
  Liste du projet.
- **Sur la table** : une feuille par agent principal, devant sa place, avec sa tâche. Marques d'état sur la feuille :
  marque-page rouge (votre accord), orange (une question), tampon ✓ (terminé), pointillés grisés (hors ligne).
- **Sous-agents** : assis aux bouts de la table, du côté de leur parent, petits, avec « ↳ Parent » ; jusqu'à deux
  empilés à chaque bout (quatre par table). La tâche du premier est un post-it jaune à côté de la feuille du parent,
  avec « +N » quand le parent en a plusieurs.
- **Chaque agent** affiche son nom, sa **machine** (`PC local`, `Dev SSH`…) et son badge d'état. **Le harnais n'est
  jamais écrit** dans les vues d'ensemble : la forme du bot le dit.
- **Le tapis** porte la table, les agents et les plantes. Il est teinté de la couleur du projet. Son coin inférieur
  gauche porte **l'étiquette du projet** : pastille de couleur, nom, branche en dessous, menu « … » (Modifier, Nouvelle
  session, Isoler). Les noms réels (Paper Channel, Payment Service, Software Factory, Doccle Channel, UI Migration)
  tiennent sans troncature ; au-delà, troncature avec « … » et nom complet au survol.
- **Plantes** : au plus deux par table, cinq espèces (monstera, fougère, sansevieria, ficus, succulente), espèce et
  emplacement tirés de l'identifiant du projet (stables d'un chargement à l'autre), toujours sur le tapis.
- **Rejeté** : objets décoratifs sur les tables, mur et « coin des idées », thèmes de décor, robot aspirateur, cactus.

### 2.2 Le bureau de Ledge

Ledge a son petit bureau dans l'atelier (mascotte, bulle « Je veille sur N agents »). Un clic ouvre le chat.

### 2.3 Sans projet

Les agents que Ledge ne relie à aucun projet attendent dans une zone en pointillés « Sans projet » (nom, tâche, machine,
dossier, état). On les range **par glisser-déposer** sur une table ou sur un projet de la barre latérale (la cible
s'allume), ou par « Ranger dans… » (dont « Nouveau projet… »). Ledge mémorise la règle « dossier → projet ».

### 2.4 Disposition et navigation

- **Mosaïque ajustée** : le bureau de Ledge, les tables et « Sans projet » sont les tuiles d'une même mosaïque. L'app
  essaie 1, 2, 3… rangées et garde celle qui permet le plus grand zoom sans défilement ; les rangées sont centrées et
  réparties dans la hauteur. Marge de sol autour du contenu ; bande réservée en bas pour la légende et le zoom.
- **Le quadrillage du sol** remplit toute la zone et **ne zoome ni ne bouge** ; seul le contenu le fait.
- **Zoom** : Ctrl + molette (ou pincement) sous le pointeur, boutons − / +, touches + / −, clic sur le pourcentage =
  100 %, de 30 % à 250 %. **Ajuster** (ou 0, ou double-clic sur le sol) revient à la vue d'ensemble.
- **Déplacement** : glisser le sol, Espace + glisser partout, clic molette.
- **Double-clic sur une table** : zoom cadré sur elle.
- **Légende** fixe en bas à gauche, **barre de zoom** fixe en bas à droite ; elles se compactent quand le chat est ouvert.
- **Plein écran** : la barre latérale disparaît ; l'ajustement profite de toute la place.

### 2.5 Barre du haut et filtre de projet

- **Pas de titre de page** : le fil d'Ariane de la barre du haut dit où l'on est, et toute la hauteur revient à l'atelier.
- La barre du haut n'a **que des icônes** (info-bulle avec le raccourci), en quatre groupes séparés : **vue**
  (Atelier / Liste, flèches gauche-droite) · **affichage** (sous-agents affichés ou masqués, figer / animer) ·
  **outils** (rechercher Ctrl K, chat /, raccourcis ?) · **plein écran**. Les deux premiers groupes n'apparaissent que
  sur l'atelier et la liste.
- **Le thème** ne se règle que dans Réglages › Apparence (ni dans la barre du haut, ni dans la barre latérale).
- **Pied de page** : « Sessions locales et SSH » et **l'état de l'île** (« Île active » / « Île masquée »), qui ouvre
  Réglages › Île ; à droite, les rappels Ctrl K, / et ?.
- **Un projet sélectionné est un filtre** : le fil d'Ariane devient `Atelier / ● Payment Service ×`, pastille à la
  couleur du projet. On revient à tous les projets par la croix, **Échap**, « Atelier » dans le fil d'Ariane ou la
  barre latérale. Pas de sélecteur de projet séparé.
- **Supprimé** : la vue, le filtre et le panneau « À votre attention » (doublons de l'atelier et de la liste ; la mise
  en évidence reste). Les notifications sont le rôle de l'île.

### 2.6 Liste

La vue pour parcourir et agir vite (le fil d'Ariane dit « Liste ») ; elle sert aussi de cible au « +N ».

- **Barre d'outils** fixe en haut de la liste : filtre texte (nom, tâche, machine, dépôt, projet ; **F** pour y aller,
  Échap pour vider, ↓ ou Entrée vers la première ligne), pastilles d'état avec compteurs (Tous · À décider · En cours ·
  Terminés · Hors ligne), **Grouper par** Projet / Machine / État, densité. Groupement et densité sont mémorisés.
- **Groupes** à en-tête fixe : couleur du projet (ou point de la machine), nom (un clic filtre sur ce projet),
  branche, compteur (n/total sous filtre), « x à décider · y en cours… », chevron pour replier, pastille
  « + Nouvelle session » (discrète, plus marquée au survol du groupe).
  « Sans projet » ferme la liste ; ses lignes se glissent vers un groupe de projet ou passent par « Ranger dans… ».
- **Lignes en colonnes** : bot et nom, tâche avec le dépôt dessous, badge d'état, machine (le projet quand on groupe
  par machine), activité (« depuis 12 min » pour une attente, « il y a 3 min » sinon). **Ce qui attend une décision
  passe en tête du groupe**, avec un liseré rouge (accord) ou orange (question).
- **Sous-agents discrets** : un petit compteur à côté du nom du parent déplie des lignes indentées sur un trait
  d'arborescence, plus basses et plus pâles (texte atténué, sans dépôt, badge réduit) ; repliés par défaut sauf s'ils
  attendent une décision.
- **Actions rapides** au survol ou au focus : Autoriser / Refuser, Répondre (ouvre la session sur la réponse), Ouvrir.
- J / K suivent l'ordre affiché, Entrée ouvre ; états vides gérés ; sous 780 px de large, machine et activité passent
  sous la tâche.

### 2.7 Session

Ouverte depuis l'atelier, la liste, le chat ou la recherche. **Pas d'en-tête de session** : tout tient dans la barre du
haut, comme pour l'atelier.

- **Fil d'Ariane** `Liste / Ledge / [bot] Otto · Concevoir la navigation desktop` (ou `Atelier / …` selon la vue
  d'origine) ; sur un sous-agent, le parent s'intercale : `Liste / Ledge / Otto / [bot] Lya · tâche`, et un clic sur
  Otto ouvre sa conversation. La tâche fait office de titre, tronquée si besoin ; « Liste » ou « Ledge » ramène à la vue entière ou au
  projet filtré, Échap revient en arrière.
- **À droite** : le badge de statut de la session, puis l'icône **Terminal** (bascule, touche O).
- La machine et les dépôts passent dans l'en-tête de la conversation (`Conversation · PC local · application`).

- **Colonne « Agents du projet »** à gauche : tous les agents du même projet (ou de « Sans projet »), avec leur tâche
  et un point d'état ; l'agent ouvert est marqué ; un clic passe à un autre agent ; « Nouvelle session ici » en bas.
  Masquée sous 1000 px.
- **Sous-agents, à un seul endroit** : dans la colonne, regroupés sous leur parent derrière l'intitulé « Sous-agents · N »
  et un trait d'arborescence. Pas de liste au-dessus du champ de réponse. Sur un agent principal, l'en-tête de la conversation porte
  la pastille « 3 sous-agents », qui fait ressortir le groupe dans la colonne. Sur un sous-agent, c'est le fil d'Ariane
  qui mène au parent.
- **Conversation** au centre : consigne, réponses, documents, demande en cours, réponse.
- **Terminal optionnel** : masqué par défaut, icône Terminal de la barre du haut ou touche **O** ; le choix est
  mémorisé et suit d'un agent à l'autre.

### 2.8 Contenu d'une session

On ouvre une session pour trois choses, à égalité : comprendre ce que l'agent a fait, relire ses modifications, lui
répondre. L'en-tête du volet porte un sélecteur **Fil / Modifications (n)**, puis machine et dépôts.

- **Fil plat** : un seul fil continu, sans blocs ni repli par tour, et **aucune réponse coupée** : chaque échange (votre
  consigne, ce que l'agent a fait, sa réponse) reste lisible en entier. Les échanges ne sont séparés que par une
  discrète marque d'heure. Seules les actions d'outil se replient en une ligne de résumé (« 3 actions · icônes par type ·
  2 fichiers modifiés · 0,4 s ») qui se déplie en liste (type, cible, +/−, durée, sortie) ; une action en échec ou
  interrompue reste visible sans déplier ; une action en cours s'affiche en direct. Les décisions passées sont des
  pastilles (« ✓ Accordé · … », « ✕ Refusé · … ») ; les lancements de sous-agents, des cartes cliquables à l'endroit du
  lancement. Les messages sont en Markdown ; les documents s'ouvrent dans un lecteur. Marqueur « Nouveau » depuis la
  dernière visite, bouton « Aller au dernier message » quand on remonte.
- **Lecture** : une colonne centrée d'environ 72 caractères (760 px), dans le fil comme pour la demande épinglée et le
  champ de réponse. Vos consignes sont des bulles compactes à droite (une consigne venant d'un agent parent, à gauche,
  en pointillés) ; l'agent est nommé une seule fois en tête de sa partie de l'échange, et tout ce qu'il a fait (actions,
  décisions, sous-agents, messages) s'aligne sous son texte. Texte en 14 px, interligne 23 px ; pas d'étiquette
  « Réponse ».
- **Modifications** : fichiers touchés groupés par dossier (ajouté / modifié, +/−), diff unifié avec numéros de ligne et
  lignes inchangées repliées, fichier précédent / suivant (J / K), « Copier le chemin », « Ouvrir dans l'éditeur »,
  « Modifié par … tour 2 » qui renvoie à l'action dans le fil ; chaque action qui touche un fichier a « Voir la
  modification ».
- **Lecture côte à côte** : un document (README, Markdown) ou une modification s'ouvre dans un **panneau à droite**, le
  fil reste à gauche et utilisable (lecture, réponse, demande épinglée). Les cartes de document, les liens et « Voir la
  modification » y mènent ; plusieurs éléments ouverts deviennent des onglets fermables. En-tête du panneau : titre,
  chemin, Agrandir / Réduire (50 ↔ 65 %), × ; Échap ferme l'onglet, J / K parcourent les diffs, « Toutes les
  modifications » ouvre la vue pleine largeur. Séparateur déplaçable (largeur mémorisée), le fil ne descend jamais sous
  440 px. Sous 860 px de largeur de conversation (ou terminal ouvert), le panneau passe par-dessus le fil, au-dessus du
  champ de réponse, avec « Fermer ».
- **Plans** (mode plan de Claude Code) : un plan proposé est une carte dans le fil (titre, nombre d'étapes, début,
  « Lire le plan » qui l'ouvre à droite, étapes numérotées). Sa validation est la demande épinglée : « Approuver le
  plan » (**Y**), « Continuer à planifier » (**N**, avec une note dans le champ : un plan révisé revient), « Approuver
  et accepter les modifications automatiquement ». Après accord : « ✓ Plan approuvé » puis le travail démarre.
- **Liste de tâches** : la dernière liste de l'agent est une barre fixée en haut du fil (« Plan de travail · 3/7 », tâche
  en cours) qui se déplie en liste à cocher ; les mises à jour précédentes se fondent dans le résumé des actions.
- **Répondre** : la demande en cours est **épinglée au-dessus du champ de réponse**, dans les deux vues. Accord : ce qui
  va s'exécuter, Autoriser (**Y**), Refuser (**N**), « Toujours autoriser pour cette session » ; écrire un message refuse
  avec cette note. Question : choix numérotés (**1–9**) ou réponse libre (**R**). Une fois décidée, la demande devient
  une pastille dans le fil et l'agent repart. Sur un sous-agent, les réponses passent par le parent (bouton pour
  l'ouvrir) ; une machine hors ligne fige le fil avec un avis.

## 3. Barre latérale

En haut : Ledge, « Nouvelle session » (N), la recherche (Ctrl K). **Vues** : Atelier (nombre d'agents actifs),
Chat Ledge (/). **Projets** : pastille de couleur, nom, points d'état de ses agents (bleu au travail, rouge accord,
orange question, gris terminé, cercle vide hors ligne), « + » pour créer ; « Sans projet » avec son compteur ; chaque
ligne est une cible de dépôt. **Machines** : point d'état et nombre d'agents, « hors ligne » sinon ; ouvre Réglages ›
Machines. En bas : **Réglages** (Ctrl ,).

## 4. Chat Ledge

Ancré à droite ; l'atelier reste visible et se réajuste. C'est le chat de l'île (même composant). Survoler un nom
d'agent dans une réponse **allume cet agent à sa table**. Ledge peut **proposer une session** (« Lance un agent sur
Mobile pour… ») : la carte se lance d'un clic et l'agent arrive à sa table. Ledge peut **proposer un projet** : sa
réponse contient « Vérifier la proposition », qui ouvre l'éditeur de projet prérempli. Rien n'est créé sans clic.

## 5. Démarrer une session

Formulaire « Nouvelle session » (N, « + » d'une table, « Nouvelle session » d'un projet vide) :
consigne d'abord (avec suggestions), **agent choisi par la forme de son bot** (Claude Code, Codex, Cursor Agent, sans
défaut), projet, machine (une machine hors ligne n'est pas choisissable), dépôts du projet sur cette machine, branche
affichée. Aperçu « Néo rejoindra la table Atlas · Place 5 ». Ctrl ↵ lance ; l'agent apparaît à sa place en
« Démarrage » puis « Au travail ». Un champ manquant est nommé au lieu de bloquer en silence.

## 6. Projets

- **Éditeur** : nom, couleur (8), description, dépôts. Un dépôt = machine + chemin, branche détectée ou « Dossier sans
  Git ». Ajout par un explorateur de dossiers par machine (dépôts Git marqués, machine hors ligne grisée) ou en tapant
  le chemin. Validation : nom vide ou déjà pris, dépôt en double, chemin introuvable.
- **« Laisser Ledge faire »** : Ledge parcourt les machines et propose nom, couleur et dépôts cochables, chacun avec sa
  raison (même remote, dossiers ouverts par des agents, nommage commun). Une proposition qui recoupe un projet existant
  devient « ajouter à ». Réglages › Projets peut proposer plusieurs projets d'un coup.
- **Suppression** : confirmation qui dit ce que deviennent les agents et les règles ; « Sans projet » ou « Déplacer vers… ».
- **Points d'entrée** : « + » Projets, menu « … » du tapis, Réglages › Projets, « Ranger dans… › Nouveau projet… ».

## 7. Réglages

Page complète (Ctrl ,, Échap pour revenir), sections : **Général** (langue, démarrage avec Windows, harnais par défaut,
mises à jour), **Apparence** (thème, accent, échelle, mouvements réduits), **Île** (afficher, aperçu deux écrans,
écran, position, mode discret, taille, ce que l'île propose, raccourci), **Notifications** (Ne pas déranger, plage
horaire, grille événements × île / Windows / app, durée), **Sons**, **Machines** (liste partagée avec l'île : test,
reconnexion, ajout par alias SSH, modification, suppression), **Projets** (projets, règles dossier → projet,
propositions de Ledge), **Raccourcis**, **À propos**. Chaque changement confirme « Réglage enregistré ».

À valider plus tard, ajouts de la maquette sans équivalent existant : plage horaire de Ne pas déranger, grille
événements × canaux, durée des messages, section Projets, couleurs d'accent proposées.

## 8. L'île sobre

L'île **prévient et permet d'agir vite, sans consulter la session** :

- **Garde** : île compacte (mascotte et têtes des bots), demandes d'accord (Autoriser, Refuser, Plus tard), questions
  (choix ou réponse courte), avis brefs (terminé, erreur, machine hors ligne), bulle des bots, file de demandes
  (Entrée, Échap, O), **le chat Ledge**, sons, Ne pas déranger, pastille de mise à jour. Chaque carte a
  « Ouvrir dans Ledge ».
- **Part dans Desktop** : liste et vue des sessions, sous-agents, terminal, lecteur de documents, formulaire de
  session, relecture de diff et de plan, tous les réglages, aide des raccourcis.
- **Réglages** : plus d'engrenage sur l'île compacte ; une roue dentée dans l'en-tête du chat ouvre « Réglages dans
  Ledge Desktop », « Ne pas déranger », « Quitter Ledge ».
- Un clic sur un bot sans demande montre un aperçu d'une ligne avec « Ouvrir dans Ledge » ; Ctrl Alt L ouvre Desktop.

**Question ouverte** : garder dans le chat de l'île les cartes « Lancer la session » et « Envoyer l'instruction », ou
les réserver à Desktop.

## 9. Raccourcis

Ctrl K rechercher une session · N nouvelle session · / chat · Ctrl , réglages · + / − zoom · 0 ajuster · Ctrl + molette
zoom au pointeur · Espace + glisser déplacer · Alt 1…9 agents principaux · Alt ← / → session précédente / suivante ·
J / K parcourir · Entrée ouvrir · F filtrer la liste · R répondre · Y / N autoriser ou refuser · 1…9 choisir · O afficher ou masquer le terminal · ? aide · Échap revenir.

## 10. Prochaines étapes

1. ~~Décider l'articulation avec `apps/desktop` (feat/desktop)~~ : tranché, l'Atelier remplace Équipe et Réunion, voir
   `2026-10-16-ledge-desktop-atelier-build-design.md`.
2. Trancher la question ouverte de l'île (§ 8) : avec le plan de l'île sobre.
3. Écrire le plan d'implémentation par lots : en cours, un plan par lot.

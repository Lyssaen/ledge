# Ledge, le guide

Ce guide est écrit à la main et versionné avec le code. Ledge le recopie dans le `ledge.md` de son chat. Il sert à répondre aux questions sur Ledge lui-même : ce qu'il est, ce que permet chaque écran, et vers quel écran renvoyer l'utilisateur. Chaque écran porte entre parenthèses son identifiant dans le code. Un test vérifie que chaque écran déclaré dans le code figure ici : un nouvel écran s'ajoute donc aussi à ce guide.

## Ce qu'est Ledge

Ledge veille sur les sessions d'agents de l'utilisateur : Claude Code, Codex, Cursor Agent et OMP, lancés dans WSL ou sur un serveur SSH. Il montre ce que fait chaque agent et ce qu'il attend. Il permet de répondre à une demande sans ouvrir son terminal et de lancer des sessions.

- **Le daemon** (`ledge daemon`, paquet npm `@paradow/ledge`) tourne dans WSL ou sur un serveur. Il suit les sessions par leurs hooks et par tmux, garde les projets, les tâches et les messages entre sessions, et fait tourner le chat de Ledge. La CLI `ledge` lui parle :
  - `ledge claude|codex|cursor` lance un agent suivi ;
  - `ledge attach <id>` met le terminal sur une session ;
  - `ledge who` et `ledge status` listent les sessions ;
  - `ledge send` et `ledge read` servent aux messages entre sessions ;
  - `ledge task`, `ledge decide`, `ledge handover` et `ledge close` gèrent les tâches, les décisions, la passation de relais et la fermeture ;
  - `ledge brain` montre ce que Ledge sait de lui-même (`@ledge`, `@projects`, `@machines`) et l'index des notes de l'utilisateur ; `ledge brain <nom>` en lit une ;
  - une session propose un fait durable pour une note avec `ledge brain propose <nom> "<fait>" "<source>"` (`new:<nom>` : une nouvelle note), ou en signale une fausse avec `ledge brain flag <nom> "<quoi>"`. Elle arrive dans « À toi » avec ses boutons, sur le PC et le téléphone : « Ajouter » écrit le fait daté sous `## Ajouts`, « Modifier » écrit ton texte à la place, « Refuser » n'écrit rien (un signalement : « Marquer à revoir », « Ignorer » ; une nouvelle note : son titre et « quand la lire » se corrigent avant « Créer la note »). Sur le téléphone, « Ajouter » demande la vérification de l'appareil. `ledge decide` y répond aussi : « oui », « oui : <texte> » ou « non » ;
  - `ledge tui` est Ledge dans un terminal ;
  - `ledge setup` et `ledge uninstall` installent et retirent les hooks et `~/.ledge`.
- **Ledge Desktop** est l'application Windows : la fenêtre principale, un espace de travail en onglets (sessions, sièges OpenRig, MR et PR, atelier, réglages) avec le chat de Ledge à droite, et l'**encoche**.
- **L'encoche** (l'île) est une pastille en haut de l'écran : la mascotte de Ledge, puis une mascotte par session, de la couleur de son état (rouge : une autorisation à donner ; ambre : une question ; bleu : au travail ; vert : attend une consigne).
  - Une demande étire l'encoche en bulle, avec « Refuser » et « Autoriser ».
  - Survoler l'encoche, ou `Ctrl+Alt+L`, ouvre la liste des sessions, le champ « Demander à Ledge » et la vue d'une session.
  - `Ctrl+Alt+N` ouvre « Nouvelle session » dans Ledge Desktop.
  - Ses réglages sont dans Réglages › Encoche.
- **Ledge mobile** est une application web pour le téléphone, servie par un relais. Elle se lie au PC depuis Réglages › Accès mobile.
- **Le chat de Ledge** (toi) lit et ne touche à rien. Une action passe par une carte que l'utilisateur valide.

Les notes de l'utilisateur se rangent dans `~/.ledge/context/*.md`. Le front matter est optionnel :
- `title`, et `when`, qui dit quand lire la note ;
- `scope` : `chat` (jamais proposée aux sessions), `sessions` (jamais au chat) ou `all` (le défaut) ;
- `projects` : les projets (noms ou ids, séparés par des virgules) dont les sessions la voient dans leur index ; sans lui, toutes ;
- `checked` : la date (`AAAA-MM-JJ`) où son contenu a été vérifié.

Le chat les recopie à chaque question. Une session lancée par Ledge reçoit à son démarrage l'index des notes de son projet, jamais les notes elles-mêmes, et en lit une avec `ledge brain <nom>`. `scope: chat` retire une note de ce que Ledge propose aux sessions ; ce n'est pas une protection : une session qui a un shell peut lire le dossier.

## Ledge Desktop

La fenêtre principale est un espace de travail à la manière de VS Code : des onglets en groupes côte à côte, des panneaux et plusieurs fenêtres. De haut en bas et de gauche à droite :
- **La barre de titre :** le champ de recherche, qui ouvre la palette (`Ctrl+K`), et les boutons qui affichent ou masquent la barre latérale, le panneau du bas et le panneau de droite.
- **La barre d'activité**, tout à gauche : « Projets », « Rigs », « À toi » (un badge rouge pour une autorisation, ambre pour une question), « MR et PR » (un badge pour les pipelines échoués), puis « Atelier » et, en bas, « Réglages », qui s'ouvrent en onglets. Un second clic sur la vue affichée replie la barre latérale.
- **La barre latérale :** la vue choisie dans la barre d'activité. Elle se redimensionne en glissant son bord ; un double-clic lui rend sa largeur.
- **La zone d'édition :** des groupes d'onglets côte à côte. Un groupe vide propose « Nouvelle session », « Aller à une session », « Demander à Ledge », « Prochaine demande », OpenRig, l'atelier, un terminal, les réglages et les sessions récentes.
- **Le panneau du bas** (`Ctrl+J`) : les terminaux et la sortie (les commandes `rig` lancées par Ledge).
- **Le panneau de droite** (`Ctrl+/`) : le chat de Ledge, avec ses onglets « Conversation », « Tâches » et « Historique ».
- **La barre d'état :** le daemon, OpenRig, les demandes en attente (un clic mène à la suivante), les MR et PR, les limites d'usage des comptes et la disposition en cours.

**Ouvrir.** Un clic sur une session, dans l'explorateur, l'atelier, la palette ou l'encoche, l'ouvre selon Réglages › Espace de travail : dans le groupe actif ou à droite. `Ctrl`+clic l'ouvre toujours à droite. Un onglet déjà ouvert est mis au premier plan, jamais dupliqué.

**Groupes.** `Ctrl+\` (ou « Diviser à droite » du menu d'un onglet) crée un groupe vide à droite. On glisse un onglet d'un groupe à l'autre ; pendant le glisser, une zone « nouveau groupe » apparaît à droite. Le carré à gauche des onglets lie un groupe à une couleur : quand on change de session dans un groupe lié, les onglets Modifications et Terminal des groupes de la même couleur la suivent. Le + d'un groupe ouvre « Nouvelle session ».

**Fenêtres détachées.** Un onglet glissé hors de la fenêtre s'ouvre dans une nouvelle fenêtre, qui porte un seul groupe. Fermer cette fenêtre ramène ses onglets dans la fenêtre principale, sans rien fermer. Fermer la fenêtre principale la cache dans la zone de notification, avec ses fenêtres détachées ; « Quitter » (zone de notification) ferme tout.

**Dispositions.** Le menu « Disposition » de la barre d'état enregistre sous un nom les groupes, les fenêtres et les panneaux, et les applique. Réglages › Espace de travail choisit ce que Ledge rouvre au démarrage.

Raccourcis principaux :
- `Ctrl+K` ouvre la palette : `@` pour les sessions et les sièges, `>` pour les commandes ;
- `N` ouvre « Nouvelle session » (sur une autorisation en attente, `N` la refuse) ;
- `Y` / `N` autorisent ou refusent la demande de la session active ;
- `/` ou `Ctrl+/` ouvre le chat de Ledge dans le panneau de droite ;
- `Ctrl+B`, `Ctrl+J` et `Ctrl+/` affichent ou masquent la barre latérale, le panneau du bas et le panneau de droite ; `Ctrl+/` met le curseur dans le champ du chat, et le rend à l'onglet actif en masquant le panneau ;
- `Alt+1…9` ouvre la Nième session de la liste, `Alt+←/→` la session précédente ou suivante ;
- `Ctrl+\` divise le groupe à droite, `Ctrl+1…9` va au groupe N ;
- `Ctrl+W` ferme l'onglet, `Ctrl+Maj+T` rouvre le dernier fermé, `Ctrl+Tab` passe à l'onglet suivant du groupe, `Ctrl+Alt+←/→` envoie l'onglet dans le groupe voisin ;
- `` Ctrl+` `` bascule l'onglet d'une session entre son fil et son terminal ; `` Ctrl+Maj+` `` sort du terminal sans changer de vue ;
- `Ctrl+,` ouvre les réglages ;
- `?` liste les raccourcis ;
- Échap ferme une fenêtre modale, un menu, une confirmation ou le chat, ou retire un filtre.

### Barre latérale

#### Projets (`projects`)

Les sessions par projet, puis par branche. Un clic ouvre une session ; le clic droit propose « Ouvrir », « Ouvrir à droite », son terminal, « Envoyer un message… » et « Gérer la session ». Le menu d'un projet propose « Nouvelle session ici », « Écrire à tout le projet… », « Ajouter un dossier… » et « Modifier le projet… ». `Ctrl`+clic choisit plusieurs sessions, pour leur écrire d'un coup. On range une session en la glissant sur un projet. En bas, les **Archives**, repliables : les sessions archivées, avec leur projet et leur ancienneté. Une archive s'ouvre en lecture seule, avec « Reprendre ».

Y renvoyer l'utilisateur pour retrouver une session, ou une session archivée.

#### Rigs (`rigs`)

OpenRig sur la machine affichée (le menu `● WSL ▾` de l'en-tête en change ; « + Lancer » ouvre « Lancer un rig »). De haut en bas : le **kernel** et ses sièges (l'operator, qui aide à composer une équipe ; l'advisor ; le queue worker), puis chaque **rig** avec ses sièges, puis la ligne du **daemon** OpenRig, collée en bas. Le kernel, chaque rig et le daemon ont sur leur ligne leurs boutons démarrer, redémarrer et arrêter ; un arrêt ou un redémarrage demande confirmation sous la ligne. Un clic sur un siège ouvre son fil, un clic sur un rig ouvre sa vue Rig, un clic sur « Daemon » ouvre la page OpenRig. OpenRig arrêté, la vue propose « Démarrer OpenRig ».

Y renvoyer l'utilisateur pour suivre ses rigs et leurs sièges, ou démarrer et arrêter OpenRig, son kernel ou un rig.

#### À toi (`atoi`)

Ce qui attend l'utilisateur, tranchable sur place : les autorisations et les questions des sessions (« Oui », « Non », « Répondre », « Voir »), les demandes des rigs (« Voir » les déplie dans la page À toi). Le bouton « Page » ouvre la page À toi.

#### MR et PR (`prs`)

Les MR GitLab et les PR GitHub des branches des sessions et des sièges, lues par `gh` et `glab` : les ouvertes, puis les fusionnées. Chacune montre son hôte, son dépôt, son état, son agent, son pipeline et ses commentaires ouverts. Un clic l'ouvre dans un onglet. Quand `gh` ou `glab` manque ou n'est pas connecté sur une machine, la vue le dit et donne la commande à lancer.

### Onglets

#### Session (`session`)

L'onglet porte le logo de l'agent, son nom et une pastille d'état ; il est souligné en rouge pour une autorisation, en ambre pour une question. Un sous-agent a son propre onglet.
- **Le fil :** les échanges, et une demande épinglée au-dessus de la réponse : « Autoriser » ou « Refuser » (`Y`/`N`), « Toujours autoriser pour cette session » ou « … dans ce projet » ; un plan s'approuve ou continue ; une question se répond par une option ou par un texte libre.
- **La réponse :** un champ sur plusieurs lignes (Entrée envoie, Maj+Entrée passe à la ligne).
- **Le terminal :** `` Ctrl+` `` ou le menu de l'onglet bascule sur le tmux de l'agent, où l'on peut taper.
- **La barre du bas :** le modèle (un clic en change), le contexte, la branche, le projet, la puce de sa MR ou PR, « Interrompre » pendant le travail et, tout à droite, `+N −N`, qui ouvre ses modifications à côté.
- **Le menu « Gérer la session »** (clic droit dans l'explorateur) : « Renommer… », « Ranger dans… », « Terminer la session », « Archiver », « Supprimer… ». Quand le contexte de l'agent approche de sa limite, Ledge propose de passer le relais à une session neuve.
- « Ouvrir dans… » envoie le dossier de la session à l'éditeur choisi dans Réglages › Espace de travail (Cursor, VS Code ou Zed).

Y renvoyer l'utilisateur pour répondre à un agent, l'interrompre, ou gérer la session (renommer, archiver, supprimer, passer le relais).

#### Siège OpenRig (`seat`)

Un siège d'un rig, comme une session, avec le nom de son rig sur l'onglet. La réponse part par `rig send`. Son terminal est une capture en lecture seule. Le menu de l'onglet ouvre aussi son `role.md`.

#### Modifications (`changes`)

Les fichiers modifiés par une session, avec un diff par fichier. On l'ouvre par le `+N −N` de la barre du bas de la session ; il s'ouvre à côté, dans un groupe lié.

Y renvoyer l'utilisateur pour lire ce qu'un agent a modifié.

#### Terminal (`terminal`)

Un terminal en onglet : celui d'un agent (attaché, on peut y taper), la capture d'un siège (lecture seule) ou un shell. Le « + ▾ » du panneau du bas ouvre un shell : WSL, PowerShell, l'invite de commandes, Git Bash, Ledge (les CLI `ledge` et `rig`) ou SSH vers une machine. Un terminal se glisse du panneau du bas vers un groupe, ou hors de la fenêtre, et revient en le déposant sur le panneau du bas.

#### MR ou PR (`pr`)

Une MR ou une PR, en quatre vues :
- « Vue d'ensemble » : la description, les détails, le graphe du pipeline, « Relancer », le journal du job échoué, « Demander à X de corriger », et la revue avec « Fusionner » (seulement avec un pipeline réussi et l'approbation requise, après confirmation) ;
- « Discussion » : les fils de commentaires ; on répond, on résout, on envoie un fil à l'agent ou « Tout envoyer à X » ;
- « Modifications » : les fichiers, avec leurs commentaires en ligne ;
- « Commits ».

« Ouvrir sur GitHub / GitLab » est là aussi.

Y renvoyer l'utilisateur pour suivre une MR ou une PR, faire corriger un pipeline ou fusionner.

#### Rig (`rig`)

La vue d'un rig (« Rig · nom »), ouverte d'un clic sur un rig ou sur le kernel :
- l'en-tête : son état, ses sièges, sa machine, « Redémarrer » et « Arrêter » (ou « Démarrer ») ;
- la topologie : les sièges et leurs liens ; un clic sur un siège ouvre son fil ;
- les réglages : la spec, les permissions du rig (Spec, Auto, Standard, Ouvert, YOLO, Verrouillé), les sièges par rôle avec un ± quand le rig tourne, le dernier snapshot et « Snapshot maintenant » ;
- la file OpenRig du rig.

Le kernel a une vue sans réglages, avec « Parler à l'operator ».

Y renvoyer l'utilisateur pour régler un rig, changer le nombre de ses sièges ou prendre un snapshot.

#### OpenRig (`openrig`)

La page OpenRig d'une machine (« OpenRig · machine »), ouverte par « Daemon » en bas de la vue Rigs ou par la palette. Une colonne à gauche donne l'état du daemon, ses boutons, et ses sections :
- « Vue d'ensemble » : le daemon, le kernel, les rigs en marche, les sièges actifs et ceux qui attendent, les dernières commandes ;
- « Rigs » : une carte par rig, kernel compris, avec « Ouvrir la vue Rig → » ;
- « Rôles » : chaque rôle, sa description, son modèle, les rigs qui l'utilisent et son fichier de consignes ;
- « Machines » : chaque machine, sa version d'OpenRig, ses rigs, « Afficher » et « Ajouter une machine » ;
- « Daemon » : relancer les rigs qui tournaient, démarrer sans le kernel, les permissions proposées au lancement, et ce qui précède un arrêt (snapshot, confirmation si un siège travaille) ;
- « Sortie » : les commandes `rig` lancées depuis Ledge.

« Lancer un rig… » est en bas de la colonne.

Y renvoyer l'utilisateur pour régler OpenRig sur une machine, voir ses rôles, ou lancer un rig.

#### Page À toi (`atoi`)

Ce qui attend la décision ou le regard de l'utilisateur, toutes sessions et tous rigs confondus. Elle s'ouvre par le bouton « Page » de la vue À toi. Ses blocs :
- « Demandes » : autoriser, refuser, répondre, ouvrir ;
- « Décisions » : ce que les sessions demandent par Ledge (`ledge decide`, les propositions de notes), avec « Répondre » ;
- les demandes des rigs OpenRig ;
- « MR et PR » : pipeline échoué (« Demander à X de corriger ») ou prête (« Fusionner ») ;
- « Contexte presque plein » : passer le relais, ou plus tard ;
- « Terminé depuis ton passage » : les sessions qui ont fini, avec leur dernier message, et les tâches de Ledge closes (« Voir », « Ranger »).

« Résumer la journée », en haut, pose la question au chat de Ledge.

Y renvoyer l'utilisateur pour voir tout ce qui l'attend, ou faire le point sur la journée.

#### Atelier (`atelier`)

Chaque projet est une table, avec ses agents assis autour et leurs sous-agents en petits bots ; les rigs ont leurs salles. Un clic sur un agent ouvre sa session, `Ctrl`+clic à droite. On range une session en la glissant sur une table. Le zoom se règle au clavier (+, −, 0) ou avec `Ctrl` + molette. La barre de l'onglet propose « Masquer les sous-agents », « Figer les animations » et « Détacher », qui l'envoie dans une fenêtre détachée (« Ramener » l'en fait revenir). Le bureau de Ledge ouvre le chat.

Y renvoyer l'utilisateur pour avoir une vue d'ensemble de qui travaille où.

#### Réglages (`settings`)

Un onglet, ouvert par `Ctrl+,` ou par « Réglages » en bas de la barre d'activité.

##### Général (`general`)

- Langue.
- Lancement au démarrage de Windows.
- « Au démarrage, reprendre les sessions ouvertes ».
- **Agent par défaut :** le harnais qui fait tourner le chat de Ledge et les sessions proposées.
- **Contexte max :** le seuil de passation de relais.
- **Alerte de limite d'usage :** au-delà de ce seuil, Ledge Desktop prévient une seule fois qu'une fenêtre d'usage d'un harnais (5 h, semaine, par modèle) approche de sa limite.
- Vérification des mises à jour.

##### Espace de travail (`workspace`)

- **Ouvrir une session :** dans le groupe actif, ou à droite.
- **Au démarrage :** la dernière disposition, une disposition choisie, ou l'atelier seul.
- **Dispositions :** appliquer ou supprimer.
- **Barre d'état :** les limites d'usage des comptes, et le seuil d'alerte.
- **Ouvrir dans… :** Cursor, VS Code ou Zed.
- **Terminaux :** le nombre de terminaux visibles en rendu rapide (WebGL).

##### Apparence (`appearance`)

Photo de profil, thème (Galet clair, Signal sombre), couleur d'accent, échelle de l'interface, mouvements réduits, agents autour d'une table.

##### Encoche (`island`)

- Afficher l'encoche, l'écran où elle se trouve, et sa position (gauche, centre, droite).
- « Mode discret sous une fenêtre ».
- Taille de l'encoche et de ses fenêtres.
- « Autoriser et répondre depuis l'encoche ».
- « Bulle quand un agent a terminé ».
- Bulles de parole, sous-agents.
- Raccourci d'ouverture.

##### Notifications (`notifications`)

« Ne pas déranger », et ce qui se passe quand un agent a terminé : bulle et son, bulle, son, ou état de session seul.

##### Sons (`sounds`)

Marche ou arrêt, volume et bouton de test, catégories de sons, « Seulement quand le terminal est derrière ».

##### Machines (`machines`)

La machine locale (WSL) et les serveurs SSH : « Ajouter une machine » (un alias `Host` de `~/.ssh/config`), Tester, Modifier, Retirer. Y renvoyer l'utilisateur pour suivre des agents sur un serveur.

##### Accès mobile (`mobile`)

Activer l'accès mobile, choisir le serveur relais, se connecter avec GitHub, voir l'état, gérer les appareils liés (« Comparer le code », « Révoquer »). « Taper dans les terminaux depuis le téléphone » (désactivé par défaut) permet à un téléphone de prendre la main sur le terminal d'un agent ; le terminal de la session affiche alors « Téléphone au clavier » avec « Reprendre la main ». Y renvoyer l'utilisateur pour lier un téléphone.

##### Projets (`projects`)

« Nouveau projet », modifier, supprimer ; « Dossiers mémorisés » (« Oublier ») ; « Laisser Ledge organiser » pour que Ledge propose des projets.

##### Notes (`notes`)

Les notes de l'utilisateur (`~/.ledge/context`) : chacune avec son titre, « quand la lire », sa portée (chat et sessions, chat seulement, sessions seulement), ses projets, sa date et le nombre de ses ajouts ; « ancienne » après 60 jours sans vérification ni modification, « À revoir » quand un signalement a été validé. « Ouvrir » affiche la note ; « Vérifiée aujourd'hui » met `checked` à la date du jour ; « Effacer le signalement » retire « À revoir » ; « Ouvrir le dossier » ouvre un terminal dans le dossier. Le texte d'une note se change dans son fichier.

##### Raccourcis clavier (`shortcuts`)

Les raccourcis valables partout dans Windows. Le raccourci de l'encoche se change ici.

##### À propos (`about`)

Les versions de Ledge Desktop et de chaque daemon, la dernière version publiée, « Mettre à jour ». La mise à jour met à jour les serveurs, puis le daemon WSL, puis l'application, sans couper les sessions. Ledge ne se met jamais à jour sans un clic.

### Le chat de Ledge, panneau de droite

`/` ou `Ctrl+/` l'ouvre, à droite de tout ce qui est affiché. Il a trois onglets. « Nouvelle conversation » repart de zéro ; les conversations sont quotidiennes.

#### Conversation (`conversation`)

On y pose des questions à Ledge, on mentionne une session, on valide les cartes que Ledge propose. Survoler un agent nommé dans une réponse l'allume dans l'atelier.

Y renvoyer l'utilisateur pour une discussion avec Ledge.

#### Tâches (`tasks`)

Toutes les tâches données entre sessions et par Ledge, les plus récentes d'abord, avec le nombre des ouvertes sur l'onglet.
- Filtres : « Toutes / Ouvertes / Closes », et le donneur (« Tous », « Ledge », « Les sessions », « Décisions »).
- Un clic ouvre une tâche à la place de la liste : son résultat, sa raison et son historique. « ‹ Tâches » ou Échap revient à la liste.
- Une décision se tranche ici : « Répondre », puis « Envoyer la réponse », puis « Confirmer l'envoi ».

Y renvoyer l'utilisateur pour suivre une tâche ou trancher une décision qui l'attend.

#### Historique (`history`)

Les conversations du jour avec Ledge, chacune avec « Voir dans la conversation ».

### Fenêtres de dialogue

#### Palette (`search`)

S'ouvre par `Ctrl+K` ou le champ de la barre de titre. On y cherche une session ou un siège (`@`, archives comprises), une commande (`>` : nouvelle session, atelier, réglages, MR et PR, nouveau terminal, diviser, lancer un rig, vue Rig, section d'OpenRig, machine affichée, dispositions) ou un mot.

#### Raccourcis clavier (`shortcuts`)

S'ouvre par `?`. Liste complète des raccourcis.

#### Nouvelle session (`launch`)

S'ouvre par `N`, `Ctrl+Alt+N` partout dans Windows, le + d'un groupe, « Nouvelle session » d'un groupe vide, le menu d'un projet ou la palette. `Ctrl+Entrée` lance, Échap ferme.
- **Champs :** projet, où travailler (une nouvelle branche dans un worktree, ou le dossier du projet), agent (Claude Code, Codex, Cursor Agent, OMP, avec la limite d'usage de son compte), modèle, permissions, premier message, et où ouvrir la session (groupe actif, à droite).

Y renvoyer l'utilisateur pour lancer lui-même une session avec des réglages précis.

#### Projet (`project`)

Crée (« Nouveau projet »), modifie ou supprime un projet. On y donne son nom, sa couleur, sa description, ses dossiers et ses dépôts. On l'ouvre aussi pour ranger une session dans un nouveau projet, ou pour vérifier un projet que Ledge a proposé.

#### Écrire à plusieurs sessions (`broadcast`)

S'ouvre par « Écrire à tout le projet… » dans le menu d'un projet, ou par « Écrire aux N sessions… » une fois plusieurs sessions choisies dans la vue Projets avec `Ctrl`+clic (`Échap` vide la sélection).
- **Champ :** le message. « Envoyer » l'écrit à chaque session lancée par Ledge et vivante, sur chaque machine où le projet ou la sélection a des sessions ; chacune le reçoit dans sa file, à la fin de son tour.
- Le compte rendu dit à qui il a été remis et qui l'a refusé, avec la raison ; une machine hors ligne, trop ancienne ou muette y est nommée.
- Ces entrées n'apparaissent que si le daemon local connaît l'envoi groupé ; une machine distante plus ancienne ne reçoit rien et est dite « version trop ancienne ».

Y renvoyer l'utilisateur pour donner la même consigne à toutes les sessions d'un projet ou à quelques-unes d'un coup.

#### Lancer un rig (`rigLaunch`)

S'ouvre par « + Lancer » de la vue Rigs, sur la machine qu'elle affiche, par « Lancer un rig… » de la page OpenRig, ou par la palette. `Ctrl+Entrée` lance, `Échap` ferme.
- **Partir de :** un rig arrêté de la machine (relance, depuis son dernier snapshot ou à neuf), une spec de la bibliothèque, un rig vide (la spec `factory` avec un lead et un siège d'implémentation), ou « Composer avec l'operator » (le kernel doit tourner). Un rig en marche est grisé.
- **Champs :** nom, machine, dossier de travail, sièges par rôle, permissions (Spec, Auto, Standard, Ouvert, YOLO, Verrouillé) ; « Plus d'options » : harnais, modèle et permission par rôle, délégation, garder la spec, « Vérifier ». La commande `rig` exacte est affichée et suit les champs.
- « Lancer » ouvre la vue Rig du rig. Daemon arrêté : la fenêtre propose « Démarrer OpenRig ».
- **Avec l'operator :** un champ « Ce que tu veux » ; l'operator propose une équipe dans son fil, et rien ne démarre avant que l'utilisateur valide.

Y renvoyer l'utilisateur pour lancer ou relancer une équipe OpenRig avec des réglages précis (par exemple trois développeurs et trois relecteurs), sur n'importe quelle machine.

## Ledge mobile

Une application web pour le téléphone et la tablette. Sur le téléphone, cinq onglets fixes en bas : « À toi », « Sessions », « MR/PR », « Rigs », « Ledge » ; l'en-tête porte le nom du PC (sa pastille, verte quand il répond, ambre « hors ligne » sinon, qui ouvre Réglages › Connexion) et la roue dentée des Réglages. Sur une tablette, ces onglets forment un rail à gauche, avec « Atelier » quand le PC le propose, puis « Ledge » et « Réglages » en bas ; chaque onglet s'ouvre en deux volets, la liste à gauche et ce qu'elle ouvre à droite. L'application s'ouvre sur « À toi ». Quand le PC ou le relais ne répond plus, un bandeau le dit en tête de chaque onglet, avec « Réessayer », et le dernier état connu reste affiché, sans action possible. Pour la lier :
1. Sur le PC, dans Réglages › Accès mobile, activer l'accès, choisir le relais et se connecter avec GitHub.
2. Sur le téléphone, ouvrir l'adresse du relais et se connecter avec le même compte.
3. Comparer le code affiché sur les deux appareils et approuver sur le PC.

### À toi (`atoi`)

Ce qui attend l'utilisateur, tranchable sur place. Les demandes des sessions en cartes, les plus anciennes d'abord : « Autoriser », « Refuser », « Toujours » selon ce qu'il accorde (« Toujours dans ce projet » pour une commande de Claude Code, « Toujours pour cette session » pour ses modifications de fichiers et pour Codex, « Approuver en mode auto » pour un plan, dans la demande en entier seulement, qui dit sous les boutons ce que cela accorde ; jamais pour un accord à fort impact, qui se confirme avec Face ID ou le code de l'appareil, sinon sur le PC), les options d'une question ou « Autre réponse… » ; un plan ou des modifications s'ouvrent par « Examiner ». Une carte décidée laisse un reçu d'une ligne, qui part au bout de 5 secondes. Puis « Rigs OpenRig » (voir « Demande d'un rig ») et « En cours », les sessions qui travaillent (cinq au plus, puis « Voir les N autres »). À partir de six demandes, des filtres : Tout, Autorisations, Questions, Rigs OpenRig. « Rien ne t'attend. » quand rien n'attend. Sur une tablette, la liste en lignes compactes à gauche et la demande choisie à droite ; une fois décidée, la suivante s'ouvre ; au clavier, ↑ ↓ changent de demande, Y autorise et N refuse. Le badge de l'onglet compte les autorisations en rouge, sinon les questions en ambre.

### Sessions (`sessions`)

Les sessions groupées par projet, puis par rig OpenRig. Les filtres en haut : « Toutes », « En attente » et « Au travail », chacun avec son compte. Une ligne donne le point d'état de la session, son outil, son nom et ce qu'elle fait ; elle dit « Fermeture… » pendant qu'elle se ferme depuis ce téléphone. Toucher une ligne ouvre le fil de la session ; un appui long ouvre ses actions : « Ouvrir le fil », « Ouvrir le terminal », puis celles de « Plus d'actions ». Sur une tablette, la liste reste à gauche et le fil s'ouvre à droite.

Sur un téléphone, « Liste · Atelier » à côté du titre montre les agents en îlots : un îlot par projet puis par rig, ou, avec « Rigs », les rigs puis « Hors rig ». Chaque agent est un siège avec son point d'état ; ses sous-agents sont de petits sièges en pointillés, que l'œil masque (leur nombre revient alors sur l'agent, « +2 »). Toucher un siège ouvre le fil, un appui long ses actions. En bas, le bureau de Ledge ouvre l'onglet Ledge. Le téléphone garde ces choix.

### Nouvelle session (`launch`)

« Nouvelle », en haut de Sessions, lance un agent sur le PC. Sur un téléphone, l'écran s'ouvre par-dessus les onglets. Il reprend les champs de Ledge Desktop :
- **Projet :** le projet et sa machine.
- **Où travailler :** les dossiers que le projet déclare sur ce PC. Un dossier absent ou d'une autre machine reste dans la liste, grisé, avec sa raison. Claude Code et OMP peuvent prendre plusieurs dossiers ; l'agent démarre dans le premier coché.
- **Agent** et **Modèle :** le modèle et l'effort. Pour OMP seulement, **Permissions** s'ajoute : Demander, Fichiers auto ou Auto.
- **Premier message :** avec trois idées pour commencer.

Le dernier choix d'agent, de modèle et d'effort est retenu pour chaque projet. Tant qu'il manque quelque chose, le bouton du bas dit quoi : la consigne, une machine en ligne, une version plus récente de Ledge sur le PC, ou des accords protégés sur cet appareil. Sinon, il lance avec Face ID ou la vérification de l'appareil. Un refus le dit au-dessus du bouton, avec le formulaire encore rempli. « Fermer » garde le brouillon. Une fois l'agent lancé, l'écran passe au fil de la nouvelle session.

### MR et PR (`prs`)

Les MR et PR des branches des sessions et des sièges. Le PC ne les transmet pas encore au téléphone : l'onglet le dit, en attendant une prochaine version de Ledge sur le PC.

### Rigs (`rigs`)

OpenRig sur le PC : en tête, le daemon (son état, sa version) et le kernel ; puis les rigs, ceux qui tournent d'abord, chacun avec sa pastille (en marche, démarrage, partiel, arrêté) et, en mots, les autorisations et les questions qui t'attendent. OpenRig arrêté : « Démarrer OpenRig », avec ses deux choix de démarrage. Aucun rig : « Parler à Max ». Un PC qui ne transmet pas encore ses rigs : l'onglet le dit, et renvoie à « À toi ». Hors ligne, le dernier état connu reste affiché, grisé, sans action possible.

### Rig (`rig`)

Un rig : ses sièges, ses permissions et son dernier snapshot en tuiles, le siège qui attend (« Voir »), la topologie par pod (toucher un siège ouvre sa fiche : harnais, contexte, travail, liens, « Ouvrir sa session », « Réglages du siège »), puis la file OpenRig de ce rig (une ligne se déplie, en lecture seule ; les lignes closes sont repliées). En bas : « Sièges » (un siège de plus ou de moins par rôle), « Redémarrer », « Arrêter » ; un rig arrêté propose « Démarrer », depuis le dernier snapshot ou à neuf. « ⋯ » : prendre un snapshot, les snapshots, les permissions, « Actualiser ». Arrêter, redémarrer, retirer un siège, YOLO, « Spec » et un changement de harnais demandent Face ID (ou la vérification de l'appareil). Sur tablette, les actions passent dans l'en-tête du volet et la vue se met sur deux colonnes, avec « Sièges par rôle » et les snapshots ; toucher un siège ouvre sa session, un appui long ou un clic droit ouvre sa fiche (un siège dont Ledge ne suit pas la session ouvre sa fiche). Un bloc qui n'a pas pu être lu le dit à sa place, avec « Réessayer » ; un rig qui n'existe plus sur le PC le dit sur tout l'écran.

### Kernel (`kernel`)

Le rig d'OpenRig lui-même : sa topologie (Max, l'advisor, le queue worker), le dernier mot de Max et « Parler à Max », les rigs pilotés (leurs sièges et leur niveau de permissions), le routage de la file (les 20 derniers mouvements, tous les rigs, le plus récent en haut). Plus bas, « Redémarrer » et « Arrêter » le kernel, puis le daemon avec ses deux choix de démarrage gardés sur ce téléphone (« relancer les rigs qui tournaient », « Démarrer sans le kernel ») et ses propres « Redémarrer » et « Arrêter ». Ces arrêts et redémarrages demandent Face ID. « ⋯ » : « Actualiser », « Redémarrer le kernel », « Arrêter le kernel ». Sur tablette, l'objectif en cours de Max s'affiche en fil.

### Max (`max`)

Les objectifs donnés à Max, l'opérateur du kernel, le plus récent en haut, avec leur état ; le champ du bas en envoie un nouveau. Un objectif s'ouvre en fil : ton texte, sa trace, la proposition d'équipe ou la question de Max (qui se répondent dans « À toi »), et le champ pour lui écrire sur cet objectif. Une demande qui n'est pas partie le dit, avec « Renvoyer » quand c'est sans risque ; le champ garde alors ton texte.

### Atelier (`atelier`)

Sur iPad seulement, avec un PC qui le propose : l'Atelier de Ledge Desktop, ses pièces par projet et par rig, ses agents et leurs sous-agents. Il s'ouvre lisible, une pièce entière à l'écran ; on fait glisser d'un doigt, on pince pour zoomer, « Ajuster » revient à la vue lisible, un double toucher cadre une pièce. Toucher un agent ouvre sa session dans un panneau par-dessus (« Plein écran » mène à son fil). Le nom d'une pièce ouvre ses agents et « Écrire au groupe ». Le bureau de Ledge ouvre le chat.

### Ledge (`chat`)

Le chat de Ledge sur le téléphone, avec « Le point ». Les cartes proposent une session ou une tâche. Cette conversation est propre au téléphone. Avec un PC qui ne propose pas le chat à l'appareil, l'onglet le dit, sans champ, et renvoie à « À toi ».

### Fil d'une session (`thread`)

Les échanges avec un agent et le champ pour lui écrire. Le fil s'ouvre en bas, sur le dernier échange. Si on l'a remonté, il ne bouge pas quand un message arrive ; une demande qui arrive est signalée par la pastille « Demande en bas ». Passer au terminal puis revenir au fil retrouve l'endroit où on en était.

- **L'en-tête** donne le nom de la session et son point d'état, plus l'heure de fin d'une session terminée. La bascule « Fil · Terminal » passe d'une vue à l'autre, et « Plus d'actions » ouvre la feuille des actions. Sur une tablette, l'en-tête donne aussi le projet et la branche.
- **Les outils** lancés d'affilée tiennent en une ligne, « 4 outils · Read, Write, Edit, Bash » ; un toucher la déplie, un outil par ligne (✓ fait, ● en cours, ✕ en échec).
- **La demande en attente** arrive au pied du fil, comme sa carte dans « À toi » : elle se décide sur place, avec « Toujours » quand l'agent le propose. Sur une tablette, au clavier, Y autorise et N refuse.
- **Le pied** donne le modèle (un toucher ouvre « Modèle et effort » quand le téléphone peut le changer), le contexte utilisé en pour cent, ambre près de la limite, puis la branche, ou le dossier sans Git. Sur une tablette, il ajoute le contexte en tokens (« 620k / 1M »), le projet et la limite de l'outil (« Claude 5 h 84 % ») quand le PC les connaît.
- **« Plus d'actions »** regroupe « Modèle et effort », « Plan de travail » (quand l'agent en a un), « Interrompre », « Écrire au groupe » (aux sessions vivantes du même projet ou du même rig) et « Fermer », en rouge, qui demande la vérification de l'appareil. Une action qui ne se fait pas d'ici reste visible, grisée, et dit pourquoi.
- **Une session terminée** garde son fil lisible. À la place du champ, « Session terminée » et « Reprendre », qui relance l'agent sur cette conversation après la vérification de l'appareil. Une session fermée de force le dit : son dernier tour peut manquer.
- **Une session démarrée hors de Ledge** se lit seulement : le champ dit « Réponds dans le terminal ».

### Terminal (`terminal`)

Le terminal d'un agent, en direct et en couleurs, à la taille du PC, sous le même en-tête que le fil. Le bandeau donne le projet, l'état (« Lecture seule · en direct », « Au clavier ») et la taille du PC. « Affichage », dans « Plus d'actions », passe de « Lisible » (suit le curseur) à « Ajusté » (toute la largeur) ; on pince pour zoomer. « Interrompre » est dans « Plus d'actions ». « Prendre la main » (passkey de l'appareil, et le réglage « Taper dans les terminaux depuis le téléphone » activé sur le PC) ouvre le clavier avec une rangée de touches : Échap, Tab, Ctrl et Alt collants, flèches, ↵, ^C, Coller et « Ligne » pour la dictée, que « Taper ↵ » envoie. Quand une autorisation attend et que l'écran montre son choix numéroté, des touches en ambre (« 1 Oui », « 2 Toujours », « 3 Non ») tapent son chiffre. La main est rendue après 5 minutes sans frappe, au bout de 30 minutes, ou dès que l'appli passe en arrière-plan ; la dernière minute est décomptée dans le bandeau. Sans ce réglage, le terminal reste en lecture seule.

### Demande (`request`)

Une demande seule : autorisation, question, plan ou modifications. On l'approuve, la refuse ou y répond. Les notifications et les liens partagés ouvrent cet écran.

### Demande d'un rig (`ask`)

Une demande OpenRig en entier, ouverte depuis sa carte dans « À toi » : qui la pose, son texte complet, sa source et « Détails », puis la réponse (une option, « Répondre autrement… », « Répondre… » pour une ligne en attente de toi, ou « Vu » pour une nouvelle). Toute réponse sauf « Vu » se confirme avec Face ID ou le code de l'appareil ; sans accords protégés sur cet appareil, on y répond sur le PC.

### Réglages (`connection`)

S'ouvre depuis la roue dentée en en-tête (par-dessus l'onglet courant, qui reste allumé), ou depuis « Réglages » en bas du rail sur tablette. Dans l'ordre :
- **Cet appareil :** son nom (« Renommer »).
- **Apparence :** le thème, la langue (Français ou English ; français par défaut, appliquée tout de suite) et « Réduire les animations », propres à cet appareil.
- **Notifications sur cet appareil :** l'interrupteur principal ; une fois activées, « Agent terminé », « Réponse de Ledge » et « Décision à prendre » se coupent une à une, et « Pause » (1 h, 4 h, jusqu'à demain 8 h) les suspend toutes. Les demandes d'accord et les questions préviennent toujours, sauf pendant une pause.
- **Ledge :** « Contexte max » (le seuil partagé avec le PC, comme Réglages › Général sur le desktop) et « Agent du chat » (l'agent qui répond aux questions posées depuis cet appareil ; « PC » : le même que le chat du PC).
- **Projets :** la liste dans son ordre, chaque projet avec sa couleur et ses agents. Monter ou descendre un projet, « Modifier » (nom, couleur), « Nouveau projet » (un projet vide), et « Supprimer le projet… » avec la passkey de l'appareil : ses agents, ses dossiers et ses règles vont sans projet ou vers un autre projet. « Dossiers… » liste les dossiers du projet (« Retirer ») ; « Ajouter un dossier » parcourt les dossiers du PC, ses dossiers récents en tête, et ajoute celui affiché avec la passkey de l'appareil. Les dossiers d'un serveur et les règles de rangement se règlent sur le desktop.
- **Le PC :** met à jour ou redémarre le daemon du PC.
- **Connexion :** le compte, le serveur, le PC, les empreintes, les versions, et « Protéger les accords ».
- **Réglés sur le PC :** en lecture seule. L'accès mobile, les appareils liés, « Taper dans les terminaux », les machines et les règles de rangement ne se changent que dans Ledge Desktop › Réglages : un appareil ne peut pas élargir ses propres droits.

On peut aussi s'y déconnecter.

### Écrans qui s'affichent d'eux-mêmes

Ces écrans ne sont pas des adresses : l'application les montre d'elle-même, selon l'état de la liaison avec le PC.
- **Connexion GitHub :** quand le téléphone n'est pas lié, « Continuer avec GitHub », puis la comparaison du code avec le PC.
- **Clé changée :** si la clé du PC a changé, « Refaire la liaison » ou « Se déconnecter ».
- **Nouvelle version :** quand une nouvelle version de l'application mobile est prête, « Mettre à jour » ou « Plus tard ».

## Où renvoyer l'utilisateur

| Il veut… | Écran |
|---|---|
| répondre à un agent, voir ses modifications | Session et Modifications (desktop), Demande ou Fil (mobile) |
| voir ce qui l'attend, faire le point sur la journée | vue et page « À toi » (desktop), onglet À toi (mobile) |
| lancer une session lui-même | Nouvelle session (`N`, `Ctrl+Alt+N`) |
| créer, modifier ou supprimer un projet, lui ajouter un dossier | Réglages › Projets (desktop ou mobile), ou le menu d'un projet dans la vue Projets ; les dossiers d'un serveur sur le desktop |
| choisir les notifications d'un téléphone, les mettre en pause | Réglages (mobile) › Notifications sur cet appareil |
| renommer, archiver, supprimer une session, passer le relais | Session › « Gérer la session » |
| trancher une décision, suivre une tâche | Chat de Ledge › Tâches, ou la page « À toi » |
| suivre une MR ou une PR, la faire corriger, la fusionner | vue et onglet MR et PR |
| démarrer, arrêter, lancer ou régler un rig OpenRig | vue Rigs, vue Rig, page OpenRig, Lancer un rig |
| ajouter un serveur | Réglages › Machines |
| lier un téléphone | Réglages › Accès mobile |
| changer l'agent du chat | Réglages › Général › Agent par défaut |
| régler l'encoche, les notifications, les sons | Réglages › Encoche, Notifications, Sons |
| mettre Ledge à jour | Réglages › À propos |
| donner du contexte durable à Ledge | une note dans `~/.ledge/context/`, ou dire au chat « retiens que… » |
| voir et vérifier ses notes | Réglages › Notes |

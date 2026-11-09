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
- **Ledge Desktop** est l'application Windows : la fenêtre principale (accueil, atelier, sessions, réglages) et l'**encoche**.
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

La fenêtre principale a une barre latérale :
- « Accueil » ;
- « À toi » : les demandes en attente, avec « Oui », « Non », « Répondre » et « Voir » ;
- « Projets » : l'arbre des sessions par branche ;
- « Machines » ;
- « Archives » ;
- « Réglages ».

Raccourcis principaux :
- `/` ouvre l'accueil ;
- `Ctrl+/` ouvre le chat ancré ;
- `Ctrl+K` ouvre « Aller à une session » ;
- `N` ouvre « Nouvelle session » (depuis l'atelier) ;
- `Ctrl+,` ouvre les réglages ;
- `?` liste les raccourcis ;
- Échap revient en arrière.

### Accueil (`home`)

L'application s'ouvre ici. On y vient aussi par `/` ou par l'entrée « Accueil » de la barre latérale. C'est la vue de Ledge, l'opérateur, en lecture seule. Elle a quatre onglets.

#### Conversation (`conversation`)

C'est la conversation avec Ledge, en pleine largeur.
- On y pose des questions et on mentionne une session.
- On y valide les cartes que Ledge propose.
- Le panneau « Le point » résume deux sections : « À toi » et « Confiées par Ledge ». Le bouton « Résumer la journée » est là aussi.

Y renvoyer l'utilisateur pour une longue discussion avec Ledge, ou pour faire le point sur la journée.

#### Tâches (`tasks`)

Toutes les tâches données entre sessions et par Ledge.
- Filtres : « Toutes / Ouvertes / Closes », donneur, « Décisions ».
- Une tâche ouverte montre son résultat, sa raison et son historique.
- Une décision se tranche ici : « Répondre », puis « Envoyer la réponse », puis « Confirmer l'envoi ».

Y renvoyer l'utilisateur pour suivre une tâche ou trancher une décision qui l'attend.

#### Historique (`history`)

Les conversations du jour avec Ledge, chacune avec « Voir dans la conversation ».

### Atelier (`overview`)

On y vient par Échap depuis l'accueil ou une session, par « Retour à l'atelier », ou par la vue « Atelier » de la barre latérale. Chaque projet est une table, avec ses agents assis autour et leurs sous-agents en petits bots.
- Le menu d'une table propose « Nouvelle session », « Modifier le projet » et « Isoler cette table ».
- On range une session en la glissant sur une table.
- Le zoom se règle au clavier (+, −, 0) ou avec `Ctrl` + molette.
- Le bureau « Parler à Ledge » ouvre le chat ancré.
- La barre du haut propose « Masquer les sous-agents », « Figer les animations », « Plein écran » et « Détacher l'Atelier », qui ouvre l'atelier dans sa propre fenêtre.

Y renvoyer l'utilisateur pour avoir une vue d'ensemble de qui travaille où, ou pour ranger une session dans un projet.

### OpenRig (`openrig`)

On y vient par « OpenRig » dans la barre latérale, sous « Atelier ». La page pilote OpenRig sur une machine ; les puces du haut changent de machine.
- **Daemon :** « Démarrer », « Arrêter », « Redémarrer ». La case « Au démarrage, relancer les rigs qui tournaient » lance `rig start --last` ; « Sans le kernel » ajoute `--no-kernel`.
- **Kernel :** l'opérateur d'OpenRig (le rig nommé `kernel`), avec « Démarrer », « Arrêter », « Redémarrer ».
- **Rigs :** chaque rig montre son état, ses sièges et son dernier snapshot ; un clic sur son nom déplie ses sièges. « Démarrer » lance `rig up <rig> --existing`, « Arrêter » `rig down <rig>`, « Redémarrer » les deux avec un snapshot.
- **Permissions au lancement** : « Celle de la spec », « Auto » (mode auto de Claude), « Standard », « Ouvert », « YOLO » (aucune demande) ou « Verrouillé », pour tout le rig ; la colonne « Permissions » de la table change un rôle. Avec YOLO, « Accepter les avertissements de premier lancement » (`--non-interruptive`) évite qu'un siège s'arrête sur l'avertissement de Claude.
- **± Sièges** (rig en marche) : un compteur par rôle ajoute des copies du premier siège du rôle (`build-2`, `build-3`) ou retire les dernières, sans arrêter le rig. Les sièges ajoutés sont reliés par paires ou chacun à tous (OpenRig 0.7 et plus), puis un snapshot garde la nouvelle taille pour un redémarrage.
- Tout arrêt ou redémarrage demande confirmation, nomme les sièges qui travaillent et montre la commande `rig` lancée.
- **Lancer un rig…** : choisir une spec (« mes specs » ou celles d'OpenRig), le dossier de travail et le nom, le nombre de sièges par rôle avec leur harnais et leur modèle, puis comment les sièges ajoutés délèguent (par paires ou chacun à tous). « Vérifier » montre ce que `rig up --plan` conclut et la spec qui sera lancée ; « Lancer » la lance. Une spec modifiée est écrite dans `~/.ledge/rigs/<nom>/`, et « Enregistrer dans mes specs » la garde dans la bibliothèque OpenRig.

Y renvoyer l'utilisateur pour démarrer, arrêter ou redémarrer OpenRig, son kernel ou un rig, ou pour lancer un rig (par exemple trois développeurs et trois relecteurs), sur n'importe quelle machine.

### Session (`session`)

On l'ouvre en cliquant sur un siège, sur une ligne de la barre latérale ou sur un élément « À toi ». On y accède aussi par `Alt+1…9`, par `Alt+←/→`, ou par `Ctrl+K`. Un sous-agent a sa propre page.
- **Vues :** « Fil » (les échanges) et « Modifications » (les fichiers modifiés, avec un diff par fichier).
- **Demandes :** une demande épinglée se tranche par « Autoriser » ou « Refuser » (`Y`/`N`). On peut aussi choisir « Toujours autoriser pour cette session » ou « … dans ce projet ». Un plan s'approuve ou continue. Une question se répond par une option ou par un texte libre.
- **Échanges :** `R` répond, « Interrompre » coupe le tour en cours, « Arrêter » stoppe l'agent.
- **Terminal :** `O` l'affiche. Il a un onglet « Nouveau shell » et le bouton « Ouvrir dans un terminal externe ».
- **Menu « Gérer la session »** (clic droit) : « Renommer… », « Ranger dans… », « Terminer la session », « Archiver », « Supprimer… ». Une session archivée offre « Reprendre ».
- **Passer le relais :** quand le contexte de l'agent approche de sa limite, ce menu propose de passer le relais à une session neuve.

Y renvoyer l'utilisateur pour répondre à un agent, lire ses modifications, l'interrompre, ou gérer la session (renommer, archiver, supprimer, passer le relais).

### Réglages (`settings`)

On y vient par `Ctrl+,` ou par « Réglages » dans la barre latérale.

#### Général (`general`)

- Langue.
- Lancement au démarrage de Windows.
- **Agent par défaut :** le harnais qui fait tourner le chat de Ledge et les sessions proposées.
- **Contexte max :** le seuil de passation de relais.
- Vérification des mises à jour.

#### Espace de travail (`workspace`)

Visible seulement quand l'interface IDE (aperçu) est activée dans Général.

- **Ouvrir une session :** dans le groupe actif, ou à droite (un nouveau groupe). Vaut pour un clic dans l'explorateur, l'atelier, la palette et l'encoche. `Ctrl`+clic (ou `⌘`+clic) ouvre toujours à droite.

#### Apparence (`appearance`)

Photo de profil, thème (Galet clair, Signal sombre), couleur d'accent, échelle de l'interface, mouvements réduits, agents autour d'une table.

#### Encoche (`island`)

- Afficher l'encoche, l'écran où elle se trouve, et sa position (gauche, centre, droite).
- « Mode discret sous une fenêtre ».
- Taille de l'encoche et de ses fenêtres.
- « Autoriser et répondre depuis l'encoche ».
- « Bulle quand un agent a terminé ».
- Bulles de parole, sous-agents.
- Raccourci d'ouverture.

#### Notifications (`notifications`)

« Ne pas déranger », et ce qui se passe quand un agent a terminé : bulle et son, bulle, son, ou état de session seul.

#### Sons (`sounds`)

Marche ou arrêt, volume et bouton de test, catégories de sons, « Seulement quand le terminal est derrière ».

#### Machines (`machines`)

La machine locale (WSL) et les serveurs SSH : « Ajouter une machine » (un alias `Host` de `~/.ssh/config`), Tester, Modifier, Retirer. Y renvoyer l'utilisateur pour suivre des agents sur un serveur.

#### Accès mobile (`mobile`)

Activer l'accès mobile, choisir le serveur relais, se connecter avec GitHub, voir l'état, gérer les appareils liés (« Comparer le code », « Révoquer »). « Taper dans les terminaux depuis le téléphone » (désactivé par défaut) permet à un téléphone de prendre la main sur le terminal d'un agent ; le panneau terminal de la session affiche alors « Téléphone au clavier » avec « Reprendre la main ». Y renvoyer l'utilisateur pour lier un téléphone.

#### Projets (`projects`)

« Nouveau projet », modifier, supprimer ; « Dossiers mémorisés » (« Oublier ») ; « Laisser Ledge organiser » pour que Ledge propose des projets.

#### Notes (`notes`)

Les notes de l'utilisateur (`~/.ledge/context`) : chacune avec son titre, « quand la lire », sa portée (chat et sessions, chat seulement, sessions seulement), ses projets, sa date et le nombre de ses ajouts ; « ancienne » après 60 jours sans vérification ni modification, « À revoir » quand un signalement a été validé. « Ouvrir » affiche la note ; « Vérifiée aujourd'hui » met `checked` à la date du jour ; « Effacer le signalement » retire « À revoir » ; « Ouvrir le dossier » ouvre un terminal dans le dossier. Le texte d'une note se change dans son fichier.

#### Raccourcis clavier (`shortcuts`)

Les raccourcis valables partout dans Windows. Le raccourci de l'encoche se change ici.

#### À propos (`about`)

Les versions de Ledge Desktop et de chaque daemon, la dernière version publiée, « Mettre à jour ». La mise à jour met à jour les serveurs, puis le daemon WSL, puis l'application, sans couper les sessions. Ledge ne se met jamais à jour sans un clic.

### Fenêtres de dialogue

#### Aller à une session (`search`)

S'ouvre par `Ctrl+K`. On y cherche une session par agent, tâche, projet ou machine.

#### Raccourcis clavier (`shortcuts`)

S'ouvre par `?`. Liste complète des raccourcis.

#### Nouvelle session (`launch`)

S'ouvre par `N` dans l'atelier, `Ctrl+Alt+N` partout, « Nouvelle session » dans la barre latérale ou un menu de table.
- **Champs :** consigne, agent (Claude Code, Codex, Cursor Agent, OMP), modèle et effort, projet, machine, dossiers et dépôts.

Y renvoyer l'utilisateur pour lancer lui-même une session avec des réglages précis.

#### Projet (`project`)

Crée (« Nouveau projet »), modifie ou supprime un projet. On y donne son nom, sa couleur, sa description, ses dossiers et ses dépôts. On l'ouvre aussi pour ranger une session dans un nouveau projet, ou pour vérifier un projet que Ledge a proposé.

#### Écrire à plusieurs sessions (`broadcast`)

S'ouvre par « Écrire à tout le projet… » dans le menu de la plaque d'un projet de l'atelier, par le ✉ de la ligne d'un projet dans la barre latérale, ou par « Écrire aux N sessions… » une fois plusieurs sessions choisies dans la barre latérale avec `Ctrl`+clic (`Échap` vide la sélection).
- **Champ :** le message. « Envoyer » l'écrit à chaque session lancée par Ledge et vivante, sur chaque machine où le projet ou la sélection a des sessions ; chacune le reçoit dans sa file, à la fin de son tour.
- Le compte rendu dit à qui il a été remis et qui l'a refusé, avec la raison ; une machine hors ligne, trop ancienne ou muette y est nommée.
- Ces entrées n'apparaissent que si le daemon local connaît l'envoi groupé ; une machine distante plus ancienne ne reçoit rien et est dite « version trop ancienne ».

Y renvoyer l'utilisateur pour donner la même consigne à toutes les sessions d'un projet ou à quelques-unes d'un coup.

#### Lancer un rig (`rigLaunch`)

Interface IDE seulement. S'ouvre par « + Lancer » de la vue Rigs, sur la machine qu'elle affiche. `Ctrl+Entrée` lance, `Échap` ferme.
- **Partir de :** un rig arrêté de la machine (relance, depuis son dernier snapshot ou à neuf), une spec de la bibliothèque, un rig vide (la spec `factory` avec un lead et un siège d'implémentation), ou « Composer avec l'operator » (le kernel doit tourner). Un rig en marche est grisé.
- **Champs :** nom, machine, dossier de travail, sièges par rôle, permissions (Spec, Auto, Standard, Ouvert, YOLO, Verrouillé) ; « Plus d'options » : harnais, modèle et permission par rôle, délégation, garder la spec, « Vérifier ». La commande `rig` exacte est affichée et suit les champs.
- « Lancer » ouvre l'onglet Rig du rig. Daemon arrêté : la fenêtre propose « Démarrer OpenRig ».

Y renvoyer l'utilisateur pour lancer ou relancer une équipe OpenRig avec des réglages précis.

### Chat ancré

`Ctrl+/` ouvre le chat de Ledge à droite de la vue courante. On y pose les mêmes questions et on y valide les mêmes cartes que dans la conversation de l'accueil. « Nouvelle conversation » repart de zéro. Les conversations sont quotidiennes.

## Ledge mobile

Une application web pour le téléphone, avec trois onglets en bas : « À traiter », « Agents », « Ledge ». Pour la lier :
1. Sur le PC, dans Réglages › Accès mobile, activer l'accès, choisir le relais et se connecter avec GitHub.
2. Sur le téléphone, ouvrir l'adresse du relais et se connecter avec le même compte.
3. Comparer le code affiché sur les deux appareils et approuver sur le PC.

### À traiter (`inbox`)

Les demandes en attente, les plus anciennes d'abord, filtrées par type (autorisations, questions, tâches). « Examiner » ouvre une demande. « Vous êtes à jour » quand rien n'attend.

### Agents (`agents`)

Les sessions par projet. Une session ouvre son fil.

### Atelier (`atelier`)

Sur iPad seulement, avec un PC qui le propose : l'Atelier de Ledge Desktop, ses pièces par projet et par rig, ses agents et leurs sous-agents. Il s'ouvre lisible, une pièce entière à l'écran ; on fait glisser d'un doigt, on pince pour zoomer, « Ajuster » revient à la vue lisible, un double toucher cadre une pièce. Toucher un agent ouvre sa session dans un panneau par-dessus (« Plein écran » mène à son fil). Le nom d'une pièce ouvre ses agents et « Écrire au groupe ». Le bureau de Ledge ouvre le chat.

### Ledge (`chat`)

Le chat de Ledge sur le téléphone, avec « Le point ». Les cartes proposent une session ou une tâche. Cette conversation est propre au téléphone.

### Fil d'une session (`thread`)

Les échanges avec un agent et le champ pour lui écrire. « Examiner la demande » quand une décision attend. Un bouton ouvre son terminal.

### Terminal (`terminal`)

Le terminal d'un agent, en direct et en couleurs, à la taille du PC : « Lisible » (suit le curseur) ou « Ajusté » (toute la largeur), pincer pour zoomer. « Interrompre » reste là. « Prendre la main » (passkey de l'appareil, et le réglage « Taper dans les terminaux depuis le téléphone » activé sur le PC) ouvre le clavier avec une rangée de touches : Échap, Tab, Ctrl et Alt collants, flèches, ↵, ^C, Coller et « Ligne » pour la dictée. La main est rendue après 5 minutes sans frappe, au bout de 30 minutes, ou dès que l'appli passe en arrière-plan. Sans ce réglage, le terminal reste en lecture seule.

### Demande (`request`)

Une demande seule : autorisation, question, plan ou modifications. On l'approuve, la refuse ou y répond. Les notifications et les liens partagés ouvrent cet écran.

### Réglages (`connection`)

S'ouvre depuis la roue dentée en en-tête. Dans l'ordre :
- **Cet appareil :** son nom (« Renommer »).
- **Apparence :** le thème, et « Réduire les animations », propres à cet appareil.
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
| répondre à un agent, voir ses modifications | Session (desktop), Demande ou Fil (mobile) |
| voir ce qui l'attend | « À toi » (desktop), À traiter (mobile) |
| lancer une session lui-même | Nouvelle session (`N`, `Ctrl+Alt+N`) |
| créer, modifier ou supprimer un projet, lui ajouter un dossier | Réglages › Projets (desktop ou mobile), ou le menu d'une table ; les dossiers d'un serveur sur le desktop |
| choisir les notifications d'un téléphone, les mettre en pause | Réglages (mobile) › Notifications sur cet appareil |
| renommer, archiver, supprimer une session, passer le relais | Session › « Gérer la session » |
| trancher une décision, suivre une tâche | Accueil › Tâches |
| ajouter un serveur | Réglages › Machines |
| lier un téléphone | Réglages › Accès mobile |
| changer l'agent du chat | Réglages › Général › Agent par défaut |
| régler l'encoche, les notifications, les sons | Réglages › Encoche, Notifications, Sons |
| mettre Ledge à jour | Réglages › À propos |
| donner du contexte durable à Ledge | une note dans `~/.ledge/context/`, ou dire au chat « retiens que… » |
| voir et vérifier ses notes | Réglages › Notes |

# Ledge, le guide

Ce guide est écrit à la main et versionné avec le code. Ledge le recopie dans le `ledge.md` de son chat. Il sert à répondre aux questions sur Ledge lui-même : ce qu'il est, ce que permet chaque écran, et vers quel écran renvoyer l'utilisateur. Chaque écran porte entre parenthèses son identifiant dans le code. Un test vérifie que chaque écran déclaré dans le code figure ici : un nouvel écran s'ajoute donc aussi à ce guide.

## Ce qu'est Ledge

Ledge veille sur les sessions d'agents de l'utilisateur : Claude Code, Codex, Cursor Agent et OMP, lancés dans WSL ou sur un serveur SSH. Il montre ce que fait chaque agent et ce qu'il attend. Il permet de répondre à une demande sans ouvrir son terminal, de lancer des sessions et de monter des équipes.

- **Le daemon** (`ledge daemon`, paquet npm `@paradow/ledge`) tourne dans WSL ou sur un serveur. Il suit les sessions par leurs hooks et par tmux, garde les projets, les équipes, les tâches et les messages entre sessions, et fait tourner le chat de Ledge. La CLI `ledge` lui parle :
  - `ledge claude|codex|cursor` lance un agent suivi ;
  - `ledge attach <id>` met le terminal sur une session ;
  - `ledge who` et `ledge status` listent les sessions ;
  - `ledge send` et `ledge read` servent aux messages entre sessions ;
  - `ledge task`, `ledge decide`, `ledge team`, `ledge handover` et `ledge close` gèrent les tâches, les décisions, les équipes, la passation de relais et la fermeture ;
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

Les notes de l'utilisateur se rangent dans `~/.ledge/context/*.md`. Le front matter est optionnel : `title`, et `when`, qui dit quand lire la note. Ledge les recopie à chaque question.

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
- On y pose des questions et on mentionne une session ou une équipe.
- On y valide les cartes que Ledge propose.
- Le panneau « Le point » résume trois sections : « À toi », « Équipes » et « Confiées par Ledge ». Le bouton « Résumer la journée » est là aussi.

Y renvoyer l'utilisateur pour une longue discussion avec Ledge, ou pour faire le point sur la journée.

#### Équipes (`teams`)

Le catalogue a trois parties : « En cours » (les équipes actives), « Modèles » et « Rôles ».
- Les boutons « Lancer une session », « Monter une équipe… » et « Lancer cette équipe… » sont ici.
- Les rôles et les modèles se lisent ici mais se modifient dans leurs fichiers : `~/.ledge/roles/<id>.md` et `~/.ledge/teams/<id>.yaml`, ou les mêmes sous `<dépôt>/.ledge/`.

Y renvoyer l'utilisateur pour voir ou monter une équipe, ou pour consulter un rôle.

#### Tâches (`tasks`)

Toutes les tâches données entre sessions et par Ledge.
- Filtres : « Toutes / Ouvertes / Closes », donneur, équipe, « Décisions ».
- Une tâche ouverte montre son résultat, sa raison et son historique.
- Une décision se tranche ici : « Répondre », puis « Envoyer la réponse », puis « Confirmer l'envoi ».

Y renvoyer l'utilisateur pour suivre une tâche ou trancher une décision qui l'attend.

#### Historique (`history`)

Les conversations du jour avec Ledge, chacune avec « Voir dans la conversation ».

### Atelier (`overview`)

On y vient par Échap depuis l'accueil ou une session, par « Retour à l'atelier », ou par la vue « Atelier » de la barre latérale. Chaque projet est une table, avec ses agents assis autour et leurs sous-agents en petits bots. Une équipe a sa pièce.
- Le menu d'une table propose « Nouvelle session », « Modifier le projet » et « Isoler cette table ».
- Le menu d'une pièce propose « Nouvelle équipe ici… ».
- Le menu d'une équipe propose « Voir les tâches » et « Dissoudre l'équipe ».
- On range une session en la glissant sur une table.
- Le zoom se règle au clavier (+, −, 0) ou avec `Ctrl` + molette.
- Le bureau « Parler à Ledge » ouvre le chat ancré.
- La barre du haut propose « Masquer les sous-agents », « Figer les animations », « Plein écran » et « Détacher l'Atelier », qui ouvre l'atelier dans sa propre fenêtre.

Y renvoyer l'utilisateur pour avoir une vue d'ensemble de qui travaille où, ou pour ranger une session dans un projet.

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

Activer l'accès mobile, choisir le serveur relais, se connecter avec GitHub, voir l'état, gérer les appareils liés (« Comparer le code », « Révoquer »). Y renvoyer l'utilisateur pour lier un téléphone.

#### Projets (`projects`)

« Nouveau projet », modifier, supprimer ; « Dossiers mémorisés » (« Oublier ») ; « Laisser Ledge organiser » pour que Ledge propose des projets.

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
- **Champs :** consigne, agent (Claude Code, Codex, Cursor Agent, OMP), modèle et effort, projet, machine, dossiers et dépôts, rôle éventuel.
- **Mode équipe :** « Nouvelle équipe ». On choisit un modèle, ou des sièges un par un, et le nom de l'équipe.

Y renvoyer l'utilisateur pour lancer lui-même une session ou une équipe avec des réglages précis.

#### Projet (`project`)

Crée (« Nouveau projet »), modifie ou supprime un projet. On y donne son nom, sa couleur, sa description, ses dossiers et ses dépôts. On l'ouvre aussi pour ranger une session dans un nouveau projet, ou pour vérifier un projet que Ledge a proposé.

### Chat ancré

`Ctrl+/` ouvre le chat de Ledge à droite de la vue courante. On y pose les mêmes questions et on y valide les mêmes cartes que dans la conversation de l'accueil. « Nouvelle conversation » repart de zéro. Les conversations sont quotidiennes.

## Ledge mobile

Une application web pour le téléphone, avec quatre onglets en bas : « À traiter », « Agents », « Ledge », « Équipes ». Pour la lier :
1. Sur le PC, dans Réglages › Accès mobile, activer l'accès, choisir le relais et se connecter avec GitHub.
2. Sur le téléphone, ouvrir l'adresse du relais et se connecter avec le même compte.
3. Comparer le code affiché sur les deux appareils et approuver sur le PC.

### À traiter (`inbox`)

Les demandes en attente, les plus anciennes d'abord, filtrées par type (autorisations, questions, tâches). « Examiner » ouvre une demande. « Vous êtes à jour » quand rien n'attend.

### Agents (`agents`)

Les sessions par projet et par table, avec les tables d'équipe. Une session ouvre son fil, l'en-tête d'une équipe ouvre l'équipe en cours.

### Ledge (`chat`)

Le chat de Ledge sur le téléphone, avec « Le point ». Les cartes proposent une session, une équipe ou une tâche. Cette conversation est propre au téléphone.

### Fil d'une session (`thread`)

Les échanges avec un agent et le champ pour lui écrire. « Examiner la demande » quand une décision attend. Un bouton ouvre son terminal.

### Terminal (`terminal`)

Le terminal d'un agent, en direct et en lecture seule, avec « Interrompre ».

### Demande (`request`)

Une demande seule : autorisation, question, plan ou modifications. On l'approuve, la refuse ou y répond. Les notifications et les liens partagés ouvrent cet écran.

### Connexion (`connection`)

S'ouvre depuis l'état de la liaison en en-tête. On y voit le PC, le compte, le serveur et les empreintes, et on y règle l'apparence. « Le PC » met à jour ou redémarre le daemon du PC. On peut aussi s'y déconnecter.

### Équipes (`teams`)

Les équipes et les rôles. « Nouvelle équipe », « Nouveau rôle ». « Lever » lance une équipe dans un projet, après confirmation par passkey.

### Éditeur d'équipe (`team`)

Les sièges d'une équipe, où la ranger (maison ou dépôt), Enregistrer ou Supprimer.

### Copier une équipe (`team-copy`)

Enregistre la composition d'une équipe en cours comme nouvelle équipe.

### Éditeur de rôle (`role`)

Identifiant, libellé, consigne, et les valeurs par défaut : outil, modèle, effort, autonomie.

### Équipe en cours (`live`)

La fiche d'une équipe active : ses sièges, sa consigne, « Modifier la composition », « Enregistrer comme équipe », « Dissoudre l'équipe ».

### Composition (`compose`)

Modifier les sièges d'une équipe en cours, puis « Appliquer ».

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
| lancer une session ou une équipe lui-même | Nouvelle session (`N`, `Ctrl+Alt+N`) |
| créer, modifier ou supprimer un projet | Réglages › Projets, ou le menu d'une table |
| renommer, archiver, supprimer une session, passer le relais | Session › « Gérer la session » |
| trancher une décision, suivre une tâche | Accueil › Tâches |
| écrire un rôle ou un modèle d'équipe | Ses fichiers `.ledge/roles` et `.ledge/teams`, ou Équipes (mobile) |
| ajouter un serveur | Réglages › Machines |
| lier un téléphone | Réglages › Accès mobile |
| changer l'agent du chat | Réglages › Général › Agent par défaut |
| régler l'encoche, les notifications, les sons | Réglages › Encoche, Notifications, Sons |
| mettre Ledge à jour | Réglages › À propos |
| donner du contexte durable à Ledge | une note dans `~/.ledge/context/` |

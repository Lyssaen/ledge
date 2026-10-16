# Ledge Desktop — construire l'Atelier

Date : 2026-10-16 · Projet personnel, hors story Jira · Statut : **cadrage validé**, à planifier.

Ce document dit **comment** on passe de la maquette figée à l'application. Le **quoi** (chaque écran, chaque geste,
chaque raccourci) est dans `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` (la « spec Atelier ») et
dans la maquette interactive `docs/mockups/ledge-desktop-observatory.html` (sources `docs/mockups/desktop-observatory/`).
Ce document ne les répète pas : en cas de doute sur un écran, la maquette fait foi.

## 1. Intention

Ledge Desktop existe déjà sur la branche `origin/feat/desktop` (spec du 2026-10-14, sept lots), mais ses écrans
(Équipe, Réunion, regroupement par story Jira) ne correspondent plus à ce qu'on veut. La maquette Atelier les remplace.
On garde ce qui, sur cette branche, ne dépend pas des écrans, et on refait le front d'après la maquette.

**Succès** : Ledge Desktop fait tout ce que montre la maquette, sur le vrai daemon et les vraies machines (local et
SSH), et l'utilisateur s'en sert à la place de l'île pour suivre ses agents. Il n'y a **pas de jalon intermédiaire
d'usage** : l'utilisateur adopte Desktop quand l'ensemble est fini. Le travail se fait sur **une longue branche
fusionnée dans `main` à la fin** (§ 3) ; chaque lot y laisse néanmoins un état testé et construit.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

- Toute la spec Atelier §§ 2 à 7 et 9 : Atelier, Liste, Session (fil, modifications, lecture côte à côte, plans, liste
  de tâches, demande épinglée), Nouvelle session, Projets (éditeur, suppression, « Sans projet », rangement),
  barre latérale, Chat Ledge, Réglages, raccourcis.
- Les projets comme donnée du daemon local (§ 5).
- Les propositions de Ledge (« Laisser Ledge faire », proposer une session, proposer un projet), **en dernier lot**.

**Non-objectifs (hors de ce plan)**

- **L'île sobre** (spec Atelier § 8) : plan séparé, plus tard, une fois que Desktop couvre ce que l'île perd. Sa
  question ouverte (cartes « Lancer la session » / « Envoyer l'instruction » dans le chat de l'île) est tranchée là.
  Dans ce plan, l'overlay ne change que si une fondation l'exige (§ 3).
- **Les réglages de l'île dans Desktop** : la section Réglages › Île et l'état de l'île dans le pied de page
  (« Île active » / « Île masquée ») arrivent avec le plan de l'île sobre, qui partagera ces réglages par le daemon.
  Aujourd'hui ils vivent dans le stockage propre de l'île. Dans ce plan, le pied de page n'a que « Sessions locales et
  SSH » et les rappels de raccourcis.
- **Les ajouts de Réglages « à valider plus tard »** (spec Atelier § 7) : plage horaire de Ne pas déranger, grille
  événements × île / Windows / app, durée des messages, couleurs d'accent proposées. Le lot Réglages reprend ce que
  faisait `feat/desktop` (affichage, notifications, sons, machines, à propos), réorganisé selon les sections de la
  maquette, **plus la section Projets**. Les contrôles de la maquette sans équivalent existant ne sont pas construits.
- Le regroupement par story Jira, les vues Équipe et Réunion, le filtre « À votre attention » : supprimés.

**Anti-objectifs (échec même si ça « marche »)**

- Un Atelier qui ne ressemble pas à la maquette : tables en quinconce, feuilles et post-its, mosaïque ajustée, sol
  fixe sous un contenu qui zoome. Ce sont les décisions validées, pas des suggestions.
- Le harnais écrit en toutes lettres dans les vues d'ensemble (la forme du bot le dit).
- Créer quelque chose (projet, session, règle) sans un clic de l'utilisateur, y compris sur proposition de Ledge.
- Des réponses d'agent tronquées dans le fil.
- Recopier les écrans de `feat/desktop` : le front repart de zéro (§ 3).

## 3. Base de départ

**On garde de `origin/feat/desktop`** :

1. **Les fondations, lots 1 et 2**, du commit `b9cd3dc` à `bf2f734` inclus : `packages/ui` (`@ledge/ui` : mascottes,
   tokens, styles de base, motion, accent, échelle, sons, i18n générique), `packages/fleet` (`@ledge/fleet` : client
   daemon, store, machines, `keepStale`, `Session.offline`), `crates/ledge-native` et le workspace Cargo racine, la
   liste des machines partagée par le daemon local (`machines` / `machines.set`, `machines.json`), l'origine dev de
   Desktop autorisée par le daemon. L'overlay passe déjà sur ces packages dans ces lots.
2. **La tuyauterie des lots 3 à 7**, qui ne dépend pas des écrans :
   - `apps/desktop/src-tauri/` : fenêtre et état de fenêtre, tray (Nouvelle session, Ne pas déranger, libellés),
     instance unique, updater, autostart, toasts Windows, zoom WebView, icônes, `windows/hooks.nsh`.
   - La release en versions alignées : script de version racine, second installeur `Ledge Desktop` et
     `latest-desktop.json` dans `.github/workflows/release.yml`.
   - Les mises en commun faites pendant ces lots dans les packages partagés : helpers du fil (`7799ea1`),
     `groupSessions` (`d9f17cb`), règle des sons et comparaison de versions (`b839b17`), corrections fleet et daemon
     (`6a6c055`, `6e8d4d8`, `0d16ef0`…).
   - Le côté non-React des fonctions existantes : envoi de `session.launch` avec délai, mise à jour du daemon local,
     lecture du journal du daemon, test et reconnexion des machines. Ce sont des appels au daemon et des commandes
     Tauri ; leur logique pure peut être reprise, leurs écrans non.
3. **Les décisions non visuelles de la spec du 2026-10-14** restent valables sauf contradiction avec la spec Atelier :
   § 3 (où vit le code, réglage partagé, lockstep), § 5 (machines partagées), § 6 (connexions, machine déconnectée),
   § 7 (le daemon est la source de vérité ; clés locales préfixées `desktop.`, validées champ par champ — la liste
   des clés est à refaire pour les nouveaux écrans), § 10 (toasts activés et sons désactivés par défaut sur Desktop),
   § 11 (release, packaging, updater), § 12 (méthode de vérification).

**On refait** tout `apps/desktop/src/` (React), ses tests unitaires et ses scénarios Playwright, d'après la maquette.
Le faux daemon en page de `apps/desktop/e2e/daemon.ts` peut être repris comme outil de test.

**Branche** : une longue branche, `feat/desktop-atelier`, partie de `origin/feat/desktop` (qui a déjà fusionné
`main` jusqu'à 0.5.4 ; `main` n'a ajouté depuis que la maquette et sa spec). Le premier lot y retire les écrans de
`apps/desktop/src` et leurs tests, en gardant la tuyauterie ci-dessus ; c'est moins coûteux que de fusionner `bf2f734`
dans une branche neuve et de reprendre la tuyauterie à la main. La branche fusionne `main` régulièrement et n'est
fusionnée dans `main` qu'une fois les onze lots finis ; d'ici là aucune release ne part de cette branche, donc aucun
installeur Desktop incomplet n'est publié.

## 4. Composants visuels

La maquette est construite avec les vrais composants de l'overlay (`Bot`, `ResidentMascot`, `Button`, `Badge`, `Tabs`,
`Icon`, le lecteur Markdown) et ses propres CSS. Une fois les fondations en place, ces composants vivent dans
`@ledge/ui`. L'app les réutilise ; ce que la maquette a dessiné pour elle seule (tables, tapis, plantes, feuilles,
post-its, mosaïque, liste, session, réglages) devient du code de `apps/desktop`. Les CSS de la maquette sont le point
de départ du style ; les données simulées de `sessions-data.ts` peuvent servir de jeux de test.

## 5. Projets dans le daemon

Les projets n'existent nulle part aujourd'hui : `Session.project` est un nom dérivé du dossier, pas une entité.

- **Stockage** : le daemon **local** (celui du PC) les possède et les persiste dans un fichier à côté de
  `machines.json`, comme la liste des machines : même schéma de lecture, de validation et de diffusion. Les daemons
  distants ne les connaissent pas.
- **Contenu** (spec Atelier § 6) : identifiant stable, nom, couleur parmi 8, description, dépôts (machine + chemin,
  branche détectée ou « Dossier sans Git »), et les **règles « dossier → projet »** mémorisées quand on range un agent.
- **Rattachement d'une session à un projet** (choix du cadrage) : le daemon local ne voit pas les sessions des
  machines SSH (il ne fait que relayer leur WebSocket), donc il **stocke et diffuse** projets et règles, et le
  rattachement est **une fonction pure partagée dans `@ledge/fleet`**, appliquée par chaque front sur les sessions de
  toutes les machines à partir des dépôts et des règles. Une session sans correspondance est « Sans projet ». Desktop,
  puis l'île, voient ainsi le même rattachement ; le chat Ledge le reçoit dans le contexte que lui envoie le front.
- **Messages** : lister, créer, modifier, supprimer un projet (avec le sort des agents et des règles : « Sans projet »
  ou « Déplacer vers… »), ajouter une règle (ranger un agent). Validation : nom vide ou déjà pris et dépôt en double
  par le daemon local ; chemin introuvable et branche par **le daemon de la machine du dépôt** (le front le lui demande
  directement, comme l'explorateur de dossiers aujourd'hui).
- L'identifiant du projet sert aussi à tirer l'espèce et la place des plantes (spec Atelier § 2.1), stables d'un
  chargement à l'autre.

## 6. Ce que le daemon doit encore apprendre

Lecture du protocole actuel ; le plan vérifie chaque point et ajoute ce qui manque, dans le lot qui en a besoin.

- **Explorateur de dossiers** pour l'éditeur de projets et la nouvelle session : marquer les dépôts Git et donner leur
  branche (`folder.listing` ne donne que des noms aujourd'hui).
- **« Toujours autoriser pour cette session »** : `session.decide` ne connaît que `accept` / `deny`.
- **Les trois réponses à un plan** : approuver, continuer à planifier avec une note, approuver et accepter les
  modifications automatiquement.
- **La liste de tâches** de l'agent (barre « Plan de travail · 3/7 ») : tirée des actions d'outil du fil
  (`TodoWrite` chez Claude Code, équivalents chez Codex et Cursor quand ils existent).
- **Marqueur « Nouveau »** et position de lecture : locaux à Desktop, sans protocole.
- Le fil (`session.thread`, `session.thread.item`), les fichiers touchés avec leur diff, les sous-agents, les demandes
  et le terminal (`session.preview`) existent déjà.

- **« Ouvrir dans l'éditeur »** (choix du cadrage) : ouvre le fichier dans VS Code par une commande Tauri, en mode
  distant pour une machine SSH (`--remote ssh-remote+<alias>`) ou WSL ; l'action est masquée quand VS Code est
  introuvable. Rien n'ouvre d'éditeur aujourd'hui.

Une fonction de la maquette qu'un harnais ne permet pas (par exemple une action de plan absente chez Cursor) est
masquée pour ce harnais plutôt que simulée.

## 7. Ordre des lots

Un plan d'implémentation par lot, dans cet ordre. Chaque lot laisse la branche livrable, testée et construite.

1. **Fondations** : branche `feat/desktop-atelier` depuis `origin/feat/desktop`, retrait des écrans et de leurs tests,
   tuyauterie Tauri et release conservées, app React vide qui démarre sur le fleet réel.
2. **Projets dans le daemon** : protocole, fichier, rattachement, règles, validation.
3. **Squelette** : barre latérale, barre du haut (fil d'Ariane, groupes d'icônes, plein écran), pied de page,
   navigation, filtre de projet, Échap, persistance de la vue, raccourcis globaux, recherche Ctrl K.
4. **Atelier** : tables, agents, feuilles, post-its, plantes, bureau de Ledge, Sans projet et glisser-déposer,
   mosaïque ajustée, zoom et déplacement, légende.
5. **Liste** : barre d'outils, groupes, lignes, sous-agents, actions rapides, J / K.
6. **Session** : fil plat, actions repliées, demande épinglée et décisions, modifications et diff, lecture côte à côte,
   plans, liste de tâches, colonne des agents, terminal, sous-agents.
7. **Nouvelle session** : formulaire, choix par la forme du bot, projet, machine, dépôts, aperçu de la place, démarrage.
8. **Projets dans l'app** : éditeur, explorateur de dossiers, suppression, « Ranger dans… ».
9. **Chat Ledge** : panneau ancré, survol d'un nom qui allume l'agent à sa table, cartes de session.
10. **Réglages et notifications** : sections de la maquette sur le contenu existant, section Projets, toasts, sons,
    Ne pas déranger, mises à jour.
11. **Propositions de Ledge** : « Laisser Ledge faire », proposition de projet dans le chat, propositions multiples
    dans Réglages › Projets. Le mécanisme (balayage déterministe des machines, chat LLM avec un bloc comme
    ` ```ledge-session `, ou les deux) se décide au plan de ce lot ; les lots 2 et 8 n'anticipent rien pour lui.

## 8. Laissé au constructeur

- Le découpage fin des lots et des tâches, la structure des dossiers de `apps/desktop/src`, la gestion d'état.
- Le format exact des messages de projets et du fichier, tant qu'il suit le modèle de `machines.json`.
- Les noms et la liste des clés `desktop.*` du stockage local.
- Le détail du retrait des écrans de `feat/desktop` (ce qui est écran, ce qui est logique réutilisable).
- Les choix de bibliothèques pour le zoom, le glisser-déposer et le diff, à condition de rester dans les dépendances
  déjà présentes quand c'est raisonnable.

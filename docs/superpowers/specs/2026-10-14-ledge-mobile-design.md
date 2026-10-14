# Ledge sur le téléphone — design

Date : 2026-10-14 · Projet personnel, hors story Jira · Auteur initial : Joffrey Desantoine avec Claude Code

**Validation utilisateur : 2026-10-14, après revue et ouverture de la V2 révisée dans Chrome.**

Maquette : [galerie locale révisée](../../mockups/ledge-mobile/index.html), [parcours interactif](../../mockups/ledge-mobile/Inbox.html) et [capture de l’accueil](../../mockups/ledge-mobile-inbox.png). La **V2 révisée après revue** est la référence ; la V1 reste accessible dans la galerie pour comparaison. Les fichiers `source/` et le [canevas initial](https://claude.ai/artifact/XSzdHf2f77gjDrdafH89xF) conservent l’état antérieur à cette révision.

La maquette utilise `mobile.css` et `mobile.js`, partagés entre les écrans HTML. Elle simule les décisions et messages dans le stockage de l’onglet. Aucun daemon, appairage, push, contrôle du risque ou mécanisme WebAuthn n’est implémenté. Le lien « Essayer le parcours » réinitialise la démonstration.

**Statut : design visuel et parcours de la V2 révisée validés.** Cette version devient la référence pour la future application mobile. La maquette interactive existe ; la PWA et son raccordement au daemon restent à implémenter. Les détails techniques encore ouverts sont recensés en section 11 et ne sont pas considérés comme vérifiés par la validation visuelle.

Cette spec s'ajoute à la [spec de design](2026-10-09-ledge-design.md) et aux specs suivantes. Elle ne change rien à l'overlay Windows.

## 1. Objectif

Suivre et faire avancer les sessions d'agents loin du PC, depuis le téléphone, sans ouvrir de terminal. L'application est une PWA installée sur l'écran d'accueil. Elle parle au même daemon que l'overlay.

Le téléphone ne reprend pas l'overlay en plus petit. Il se présente comme une messagerie avec les agents, précédée d'une boîte de tri pour ce qui attend une décision.

Succès :

- Identifier la tâche, la branche et l’effet de la demande avant de décider. Une notification ouvre directement le détail ; l’inbox permet de choisir la demande à examiner.
- Écrire à un agent au repos et voir que le terminal a pris le message.
- Une demande interceptée et classée à impact élevé ne peut pas être autorisée depuis le téléphone sans vérification de l’utilisateur. Cette garantie ne couvre pas les commandes que l’agent exécute sans demander de permission à Ledge.
- Rien n'est exposé sur internet. Un téléphone perdu se retire depuis le PC.

Hors périmètre du MVP : un terminal interactif complet (SSH avec `tmux -L ledge attach` le fait déjà), lancer une session depuis le téléphone, Android et iOS en application native, plusieurs PC. « V1 » et « V2 » désignent les générations de maquettes, pas les lots de livraison.

### 1.1. Décisions retenues et raisons

| Décision validée | Raison |
| --- | --- |
| Deux onglets : À traiter et Agents | Séparer les décisions attendues du suivi des conversations. Le chat global « Demander à Ledge » est différé. |
| Liste de demandes avec filtres, plutôt qu’une pile | Comparer et choisir sans devoir traiter la première carte. Le parcours reste utilisable avec dix demandes. |
| Détail avant décision | Montrer la tâche, le dépôt, la branche, le motif et la commande avant de donner un accord. |
| Titre de tâche prioritaire, mascotte et prénom en soutien | Distinguer plusieurs sessions du même dépôt sans devoir mémoriser les bots. |
| Pas de swipe pour autoriser ni d’annulation après transmission | Éviter une décision accidentelle et une promesse de réversibilité que le terminal ne garantit pas. |
| Conséquence répétée dans la confirmation à impact élevé | Garder l’effet de l’opération visible au moment de confirmer. La vérification d’identité ne remplace pas cette information. |
| Décisions attendues distinctes des suggestions dans le fil | Une carte structurée ouvre la demande à traiter ; une suggestion textuelle ne crée pas une permission implicite. |
| Réponses rapides qui remplissent le brouillon | L’utilisateur peut relire et modifier avant d’envoyer. |
| Dernier état lisible hors connexion, réception incertaine explicitée | Consulter reste possible ; une coupure ne doit pas déclencher un renvoi automatique. |
| Notifications qui ouvrent le détail | Le parcours principal reste cohérent avec la cible iPhone et donne accès au contexte avant décision. |

La V1 et le canevas exporté sont des archives de comparaison. Ils ne constituent plus des alternatives à choisir avant l’implémentation.

## 2. Parcours de la maquette

| Écran | Ce que montre la maquette révisée |
| --- | --- |
| À traiter | Liste de demandes, de la plus ancienne à la plus récente. Filtres Tout / Autorisations / Questions. Chaque ligne montre tâche, agent, dépôt, branche, ancienneté et type. Toucher une ligne ouvre le détail. Pas de rangée de mascottes supplémentaire, pas de pile ni de swipe. |
| Détail d’une demande | Identité de la tâche et de l’agent, raison, commande exacte, dossier et branche, contexte du terminal dépliable. Refuser et Autoriser une fois restent accessibles en bas. Les scripts du dépôt ne portent aucune promesse « reste sur le PC ». |
| Commande à impact élevé | Conséquence et destination visibles dans le détail, puis répétées dans la confirmation. « Vérifier et autoriser » ouvre un panneau avec la commande, l’impact sur `origin/main` et « Confirmer avec mon appareil ». Fermer le panneau laisse la demande en attente. |
| Une question | Choix explicites sans présélection, option de réponse libre pour illustrer un adaptateur capable, puis bouton Envoyer. Le choix seul n’envoie rien. |
| Décision transmise | « Transmission au PC… », puis confirmation du terminal. Aucune annulation après transmission. Retour aux demandes ou au fil de l’agent. Le nombre de demandes diminue après confirmation. |
| Réception incertaine | Si la connexion coupe pendant l’envoi : « Réception non confirmée ». Une décision a peut-être été reçue ; reconnecter et vérifier son état avant toute nouvelle tentative. Aucun renvoi automatique. |
| Demande déjà traitée | « Déjà traitée sur le PC ». Aucune action d’autorisation disponible ; accès au fil et retour aux demandes. |
| Fil d’un agent | En-tête centré sur la tâche, dépôt et branche. Une véritable décision attendue est une carte liée à la même demande que l’inbox. Une suggestion de l’agent est explicitement distincte. Les réponses rapides remplissent le brouillon sans l’envoyer. Envoi, confirmation et échec sont visibles ; le brouillon est conservé après un échec. |
| Terminal | Écran de lecture seule depuis le fil, taille du texte réglable et défilement horizontal. Interrompre est distinct d’annuler les effets d’une commande. Retour vers la même session. |
| Agents | Liste groupée par dépôt. Titre de tâche avant nom du bot, branche, dernier message et état textuel. Point bleu pour le non-lu. Deux sessions du même dépôt gardent des titres et branches distincts. Aucun bouton de lancement hors périmètre. |
| Connexion perdue | Dernier état connu conservé et lisible. Aucun diagnostic de veille présumé. Détails consultables mais décisions désactivées, puis Reconnecter et actualiser. |
| Notification | Aperçu du parcours iPhone : toucher la notification ouvre la demande. Aucun bouton Autoriser/Refuser dans la notification du MVP. La commande complète est consultée dans Ledge. |
| Connecter le téléphone | Quatre étapes : prérequis Tailscale et QR ouvert avec la caméra système ; installation sur l’écran d’accueil ; code saisi dans l’application installée ; confirmation et proposition de notifications. Les contrôles de la maquette simulent ces étapes. |

Navigation : deux onglets, « À traiter » avec le nombre de demandes et « Agents ». « Demander à Ledge » est différé jusqu’à validation d’un usage mobile distinct des fils. L’en-tête, la navigation et les actions restent accessibles ; le contenu central défile. Les écrans de détail et de conversation utilisent un retour explicite.

La galerie donne accès aux variantes : dix demandes simultanées, commande longue, demande traitée sur le PC, coupure après autorisation, échec d’envoi avec brouillon conservé et décision attendue dans un fil. Les états sont simulés pour éprouver les parcours ; ils ne démontrent aucune garantie du backend.

### 2.1. États et règles d’interaction

| Situation | Comportement retenu |
| --- | --- |
| Demande en attente, connexion active | Consultation du contexte, refus ou autorisation explicite. La question exige une sélection ou une réponse libre non vide avant l’envoi. |
| Confirmation à impact élevé ouverte | Commande, destination et conséquence sont lisibles ensemble. Fermer ou revenir à la demande n’envoie aucune décision. |
| Transmission engagée | Afficher « Transmission au PC… » et bloquer un second envoi pendant l’attente. |
| Terminal ayant confirmé la décision | Retirer la demande de la liste, mettre à jour le compteur et conserver la décision dans le fil. Autorisation prise en compte ne signifie pas commande terminée. |
| Demande résolue sur le PC | Afficher « Déjà traitée sur le PC » et proposer le retour aux demandes ou au fil. Une demande suivante dans la même session reste indépendante. |
| Coupure pendant une décision | Afficher « Réception non confirmée ». Reconnecter puis consulter le résultat avant de proposer une nouvelle action. |
| Agent disponible | Autoriser le brouillon, les suggestions de réponse et l’envoi d’une consigne. |
| Agent au travail ou attendant une décision | Désactiver la saisie libre ; orienter vers le terminal ou la carte de demande. Aucune consigne n’est mise en attente pour plus tard. |
| Message non envoyé | Conserver le brouillon et proposer de reconnecter. Après reconnexion, l’utilisateur choisit explicitement de l’envoyer. |
| Liste vide | Afficher « Vous êtes à jour », un résumé de l’activité et un accès aux agents. Un filtre vide n’est pas présenté comme une absence globale de demandes. |

Le statut « Pris par le terminal » confirme la prise en compte de la consigne, pas son exécution complète. L’interruption du terminal n’annule pas les effets des actions déjà exécutées.

## 3. Accès réseau et sécurité

Aujourd'hui le daemon écoute sur `127.0.0.1:47831`, accepte toute connexion sans en-tête `Origin` et les seules origines Tauri et Vite. Il n'a aucune authentification (README, section sécurité). Le téléphone change ce modèle : un client distant peut décider à la place de l'utilisateur.

### Transport

- **Tailscale sur Windows**, avec `tailscale serve` qui publie en HTTPS sur le tailnet le port local du daemon. WSL2 expose déjà son loopback à Windows, donc le daemon reste lié à `127.0.0.1` et rien ne change côté WSL.
- Le daemon sert aussi les fichiers de la PWA sur le même port, sous `/m/`. Une seule origine HTTPS, sur le nom du tailnet, pour la page et le WebSocket.
- Aucune ouverture de port sur le routeur ni exposition publique du daemon. L’accès privé dépend de Tailscale ; les notifications dépendent des services Web Push.

### Authentification

- Tout accès par l’entrée distante exige un **jeton d’appareil**, même si `Origin` est absent ou correspond à l’overlay. `Origin` ne permet pas d’identifier un client local. Avant toute exposition via Serve, isoler l’entrée distante de l’accès local privilégié et limiter les messages autorisés pour un téléphone. Le mécanisme précis de séparation reste à définir dans le plan technique.
- **Appairage** : l'overlay demande un code au daemon (`pair.begin`), l'affiche en QR code et en six chiffres pendant deux minutes. Le téléphone l'échange contre un jeton (`pair.complete`). Le jeton est conservé dans le stockage de la PWA.
- **Révocation** : Réglages › Mobile dans l'overlay liste les appareils (nom, dernière connexion) et retire un appareil d'un clic.
- Le premier message d'une connexion distante est `auth { token }`. Sans lui, ou avec un jeton inconnu, la connexion est fermée et l'essai est écrit dans `daemon.log`.

Ce jeton est aussi une occasion de durcir l'accès local, déjà noté comme dette dans les [pistes du 11 octobre](../../ideas/2026-10-11-next-steps.md). Cette spec ne le rend pas obligatoire pour l'overlay.

## 4. Approbation selon le risque

Le daemon classe chaque demande en attente et ajoute `risk: 'low' | 'high'` à `pending`.

- **Élevé** : la commande sort du PC ou détruit. Première liste : `git push` (surtout `--force`), `rm -r`, `git reset --hard`, `git clean`, un déploiement (`deploy`, `terraform apply`, `kubectl apply|delete`), `npm publish`, `curl … | sh`, une écriture hors du dossier de la session. Toute demande que le classeur ne sait pas lire est élevée.
- **Faible** : uniquement lorsque le contexte permet de justifier cette classification. Le nom d’un test, d’un build ou d’un script ne suffit pas à garantir ses effets. La politique doit être validée avant toute décision distante ; un cas non compris est élevé. Les exemples de la maquette illustrent l’interface et ne constituent pas cette politique.
- Le classeur est une fonction pure, testée sur des cas réels comme les adaptateurs.

Sur le téléphone, une demande à risque élevé exige une **assertion WebAuthn** avec vérification de l'utilisateur. Le daemon la vérifie avant d'injecter la décision. La clé doit être enregistrée avant la première autorisation nécessitant cette vérification. Le parcours d’enregistrement WebAuthn reste à détailler ; la maquette ne le simule pas. L’identifiant de partie de confiance doit correspondre au domaine HTTPS retenu. L'overlay sur le PC n'est pas concerné : il décide comme aujourd'hui.

Le libellé « Confirmer avec mon appareil » ne promet pas exclusivement Face ID : WebAuthn peut utiliser d’autres moyens de vérification de l’utilisateur, notamment un code. Le défi serveur doit être à usage unique et lié à la demande, à sa version et à la décision. [Référence WebAuthn](https://www.w3.org/TR/webauthn-3/).

Une décision n’est jamais mise en file hors connexion. Une transmission déjà engagée peut toutefois avoir été reçue avant une coupure : le client affiche alors une réception incertaine et vérifie l’état après reconnexion. Il ne renvoie pas automatiquement. Une décision obsolète est refusée, même si une nouvelle demande est déjà apparue dans la même session.

## 5. Protocole

Ajouts envisagés à `packages/protocol`, validés par zod des deux côtés. Le plan technique doit définir la compatibilité avec les clients locaux ; les garanties distantes ne peuvent pas reposer uniquement sur le protocole actuel.

| Message | Sens | Rôle |
| --- | --- | --- |
| `auth { token }` | client → daemon | Premier message d'une connexion distante. |
| `pair.begin` / `pair.code { code, expiresAt }` | overlay ↔ daemon | Ouvre une fenêtre d'appairage. |
| `pair.complete { code, deviceName, webauthn }` / `pair.done { token }` | téléphone ↔ daemon | Échange le code contre un jeton et enregistre la clé WebAuthn. |
| `devices` / `device.revoke { id }` | overlay ↔ daemon | Liste et retire les appareils. |
| `session.decide { …, pendingId, pendingVersion, operationId, remember?, note?, assertion? }` | client → daemon | Désigne la demande exacte et une opération unique. `assertion` exigée pour un impact élevé. `remember` et `note` sont différés. |
| `session.reply { id, text, operationId, pendingId?, pendingVersion?, other? }` | client → daemon | Une réponse à une question désigne sa demande exacte ; une consigne à un agent disponible ne porte pas de demande. |
| `session.history { id }` / `session.turns { id, turns }` | client ↔ daemon | Le fil d'une session. |
| `push.subscribe { subscription }` | téléphone → daemon | Abonnement Web Push de l'appareil. |

`Session.pending` gagne une identité, une version et `risk`. `Session` gagne `unread` par appareil, calculé par le daemon à partir du dernier tour lu.

Il reste à spécifier les acquittements par `operationId`, la consultation d’une opération après reconnexion, l’idempotence et les échanges de défis WebAuthn. La simulation « Reconnecter et vérifier » représente ce résultat attendu, pas un protocole déjà implémenté.

## 6. Daemon

- **Historique des tours.** Aujourd'hui seule `lastReply` est gardée. Le fil a besoin, par session : les prompts de l'utilisateur (`UserPromptSubmit`), les réponses de fin de tour (`Stop`, `afterAgentResponse`), les décisions et leur source (PC ou téléphone). Stockage dans `~/.ledge/history/<id>.jsonl`, 200 tours au plus par session, effacé avec la session.
- **Web Push.** Clés VAPID générées au premier appairage dans `~/.ledge`. Le daemon envoie lui-même aux services de push : demande en attente, question, fin de tour. Le contenu par défaut affiche le titre de tâche et le motif de demande, pas la commande complète. Toucher la notification ouvre le détail de la demande ; aucune autorisation directe dans le MVP. Les actions de notification ne sont pas une capacité portable sur Safari/iOS. [Compatibilité](https://developer.mozilla.org/en-US/docs/Web/API/Notification/actions#browser_compatibility).
- **Badge.** Le nombre de demandes en attente part avec chaque push. La PWA le pose avec l'API Badging.
- **Fichiers de la PWA** servis sous `/m/` avec le manifeste et le service worker.

## 7. L'application

- Nouveau paquet `apps/mobile` : Vite, React 19, Tailwind 4, comme l'overlay. Il réutilise `@ledge/protocol`, le client WebSocket et `reply/parse.ts` de l'overlay. Ce code est à extraire dans un paquet partagé plutôt qu'à copier.
- Thème sombre par défaut et mascottes de `apps/overlay/src/bots`. Actions ordinaires claires et neutres, ambre pour une décision attendue, rouge pour un impact élevé, bleu pour le non-lu et vert pour une confirmation. Les états portent aussi un libellé.
- Cibles tactiles de 44 px au moins, actions principales dans le tiers inférieur, `env(safe-area-inset-*)` pour l'encoche et la barre d'accueil.
- Aucun geste de glissement pour décider. Choix et confirmation explicites. Les commandes longues reviennent à la ligne ; le terminal conserve son défilement horizontal.
- Mouvement réduit respecté. Largeurs de revue : 320, 390 et 430 px. Le clavier logiciel et l’agrandissement du texte restent à tester sur appareils réels.

### 7.1. Référence visuelle validée

Les valeurs ci-dessous sont celles de [mobile.css](../../mockups/ledge-mobile/mobile.css). Elles documentent la maquette approuvée, sans imposer de recopier son HTML dans React.

| Élément | Référence |
| --- | --- |
| Fond principal | `#0c0d0e` |
| Cartes et surfaces | `#17191b`, surface relevée `#202326` |
| Texte principal et action ordinaire | `#f2f1ed` ; texte secondaire `#a2a6ab` |
| Attention / décision attendue | Ambre `#edc479` |
| Confirmation / disponibilité | Vert `#a6d6bf` |
| Activité / non-lu | Bleu `#a6c8f0` |
| Impact élevé | Texte `#f4a5a3`, fond `#301b1d`, bouton de confirmation `#8f3037` |
| Typographie | Geist pour l’interface, Geist Mono pour les commandes, chemins et branches ; polices système de repli |
| Hiérarchie | Titre d’accueil 29 px, titre de demande 25 px, titres de carte 16 px, saisie 16 px |
| Espacement et formes | Marges latérales 18 px, cartes arrondies à 16 px, champs et boutons à 12 px |
| Dimensions tactiles | Cibles d’au moins 44 × 44 px ; boutons principaux généralement hauts de 48 px |
| Adaptation à l’écran | Largeur fluide, maquette plafonnée à 480 px, hauteur dynamique et zones de sécurité ; contenu central défilant |

La couleur complète toujours un libellé ou un symbole. Le focus clavier reste visible ; la confirmation utilise un dialogue modal nommé. Les commandes reviennent à la ligne dans le détail, alors que le terminal préserve ses lignes et autorise le défilement horizontal. La rangée de réponses rapides peut défiler horizontalement.

Le bandeau « Maquette interactive », les indications de simulation, le code d’appairage de démonstration et les contrôles de scénario appartiennent au prototype, pas à l’interface de production.

## 8. Réponses étendues par adaptateur

La V1 montrait trois réponses étendues. La V2 ne conserve que la réponse libre à titre de démonstration ; « ne plus demander » et « refuser avec une consigne » sont différés. Chaque capacité réelle demande son plan de touches et un dialogue capturé dans `test/fixtures/panes`.

| Réponse | Claude Code | Codex | Cursor Agent |
| --- | --- | --- | --- |
| Ne plus demander | Option « Yes, and don't ask again » du dialogue de permission. | À vérifier sur 0.162. | À vérifier. |
| Refuser avec une consigne | Option « No, and tell Claude what to do differently », puis le texte. | À vérifier. | À vérifier. |
| Réponse libre à une question | Option « Other » de `AskUserQuestion`, puis le texte. Aujourd'hui refusée (README, limites connues). | `request_user_input` : à vérifier. | AskQuestion : « Other » non couvert aujourd'hui. |

Tant qu'un adaptateur ne sait pas donner une réponse, le téléphone la masque pour cet outil.

## 9. Découpage

1. **Accès en lecture** : authentification de l’entrée distante, appairage, révocation, `tailscale serve` documenté. Liste des demandes et contexte, décisions encore désactivées.
2. **Décisions** : identité/version de demande, opérations idempotentes, confirmation de réception et reconnexion ; politique de risque, WebAuthn et panneau de confirmation. Aucune décision distante avant validation de ces garanties.
3. **Fil** : historique des tours, onglet Agents, fil, réponse à une session disponible, terminal en lecture seule.
4. **Push** : Web Push ouvrant le détail d’une demande et badge.
5. **Réponses étendues** : réponse libre, puis les autres capacités uniquement si leur utilité est confirmée, outil par outil.

Chaque lot se livre seul dans les limites ci-dessus. La maquette permet d’examiner la cible complète, sans représenter un ordre d’implémentation déjà réalisé.

## 10. Acceptation

- Un téléphone non appairé ne reçoit ni instantané ni session. Un jeton retiré ferme la connexion ouverte.
- Un `git push --force` en attente ne s'autorise ni par glissement, ni depuis une notification, ni sans assertion valide. Le daemon le refuse s'il manque l'assertion.
- Une décision prise sur le téléphone puis sur le PC n’est injectée qu’une fois. Si A a été traitée puis remplacée par B, une autorisation tardive de A ne traite jamais B. Le téléphone affiche la demande comme déjà traitée.
- Connexion perdue : décisions et envoi de messages désactivés, dernier état lisible, aucun envoi différé. Une coupure pendant la transmission conserve un état incertain jusqu’à vérification ; un message non envoyé garde son brouillon.
- Le fil d'une session montre les prompts, les réponses et les décisions dans l'ordre, après un redémarrage du daemon.
- Sur iPhone avec la PWA installée et les notifications autorisées, toucher une notification ouvre la bonne demande, y compris si elle a déjà été traitée. Mesurer le délai de livraison sur appareil réel ; ne pas garantir un délai indépendant du système et du réseau.
- Tests de la future application : politique de risque, vérification WebAuthn, appairage et révocation, identité des demandes, idempotence et historique. Parcours Playwright à 320, 390 et 430 px ; complément sur iPhone réel pour clavier, installation, authentification et push.

## 11. Points ouverts

Ces points concernent la réalisation et les extensions ; ils ne remettent pas la V2 visuelle en concurrence avec la V1.

| Sujet | À préciser avant réalisation |
| --- | --- |
| Entrée distante et droits | Séparation de l’accès local privilégié, authentification de chaque client distant et liste des opérations autorisées au téléphone. |
| Identité des demandes et résultat des envois | Identifiants et versions, idempotence, acquittements et consultation après reconnexion. |
| Classification du risque | Règles permettant de justifier une classification faible, traitement des scripts et cas inconnus ; éventuelle configuration depuis le PC. |
| WebAuthn | Enregistrement de la clé, défis liés à l’action, domaine retenu, refus/échec de vérification et renouvellement d’appareil. |
| Appairage sur iPhone | Passage du navigateur à l’application installée, expiration du code, reprise du parcours et révocation. Le schéma de protocole reste indicatif. |
| Adaptateurs | Capacité réelle à répondre librement, à refuser avec une consigne et à mémoriser une permission ; ces deux dernières actions restent hors MVP. |
| Notifications | Autorisations système, arrivée PWA fermée, ouverture d’une demande obsolète, délai observé et confidentialité de l’aperçu verrouillé. |
| Usage sur appareil réel | Clavier logiciel, zones de sécurité, taille de texte et reprise après suspension. |

Tailscale reste le prérequis du MVP. Une autre solution d’accès, le lancement de sessions depuis le téléphone, le chat global et le multi-PC sont des évolutions distinctes, sans écran supplémentaire à réaliser dans le périmètre validé.

## 12. Consulter et vérifier le prototype validé

### Fichiers de référence

- [Galerie](../../mockups/ledge-mobile/index.html) : dix vues de la V2, variantes et V1 repliée pour comparaison.
- [Accueil interactif](../../mockups/ledge-mobile/Inbox.html) : entrée du parcours, puis détail de demande, fil et agents.
- [Styles partagés](../../mockups/ledge-mobile/mobile.css) et [interactions simulées](../../mockups/ledge-mobile/mobile.js) : sources de la version validée.
- [Capture de l’accueil](../../mockups/ledge-mobile-inbox.png) et [capture de la galerie](../../mockups/ledge-mobile.png) : aperçus statiques.
- [Canevas exporté](../../mockups/ledge-mobile/source/canvas.json) : archive avant révision, à ne pas utiliser comme référence d’implémentation.

### Lancement local

Depuis la racine du dépôt, servir le dossier `docs` pour conserver les liens entre galerie, captures et spécification :

```bash
python3 -m http.server 8766 --bind 127.0.0.1 --directory docs
```

Ouvrir ensuite `http://localhost:8766/mockups/ledge-mobile/index.html`. Le serveur ne sert que des fichiers statiques ; il ne se connecte pas au daemon. Les pages peuvent aussi s’ouvrir directement dans un navigateur, mais le serveur local donne une origine commune aux écrans pour le stockage de la démonstration.

« Essayer le parcours » ouvre l’accueil avec `reset=1` et efface les décisions, messages et brouillons de démonstration de cet onglet. Les données utilisent `sessionStorage` ; leur persistance ne représente pas l’historique durable attendu du produit. Le code d’appairage de démonstration est `481203` ; l’expiration affichée et la vérification d’appareil sont simulées.

### Scénarios de revue

| Entrée depuis la galerie | Vérification visée |
| --- | --- |
| Parcours standard | Choisir librement l’une des trois demandes, examiner son contexte, décider, voir la confirmation puis retrouver sa trace dans le fil. |
| Dix demandes simultanées | Consulter toute la liste, filtrer et traiter une demande située en fin de liste sans devoir traiter les précédentes. |
| Commande longue | Lire l’intégralité de la commande sans débordement horizontal de la page. |
| Déjà traitée sur le PC | Voir un résultat obsolète sans bouton d’autorisation disponible. |
| Coupure après autorisation | Observer la réception incertaine puis « Reconnecter et vérifier ». La démo suppose une réception réussie ; elle ne teste pas les autres résultats possibles d’une reconnexion réelle. |
| Message non envoyé | Remplir un brouillon, envoyer, constater l’échec, reconnecter et retrouver le texte avant un nouvel envoi explicite. |
| Décision attendue dans un fil | Ouvrir le détail de la même demande depuis le fil ; la saisie libre reste désactivée. |
| Connexion perdue | Parcourir demandes, agents et terminal en gardant l’état hors ligne et les actions d’écriture désactivées. |
| Appairage | Parcourir les quatre étapes, vérifier l’erreur sur un mauvais code et la réussite avec le code de démonstration. |

### Vérification effectuée lors de la revue du 2026-10-14

Les parcours ont été exercés dans Chromium avec Playwright : traitement des demandes, filtres, réponse libre, fermeture de confirmation sans décision, liste vide, dix demandes, obsolescence, coupure, conservation du brouillon et des messages, navigation hors ligne et appairage simulé.

Les neuf pages d’entrée de la V2 ont été contrôlées à 320, 390 et 430 px : aucun débordement horizontal de page ni erreur JavaScript constaté, et dimensions tactiles des contrôles vérifiées. La confirmation a été examinée à 320 × 568 ; le champ de saisie reste accessible avec une fenêtre réduite à 390 × 400. Cette réduction de hauteur ne constitue pas un test de clavier iOS. Les captures de contrôle utilisent les polices de repli, les requêtes de polices distantes ayant été bloquées pendant la vérification.

La validation utilisateur porte sur le design présenté dans Chrome. L’installation PWA, WebAuthn, le push et le comportement sur un vrai iPhone restent à vérifier lors de l’implémentation. Les vérifications du prototype ne sont pas des tests du daemon ni de la future application mobile.

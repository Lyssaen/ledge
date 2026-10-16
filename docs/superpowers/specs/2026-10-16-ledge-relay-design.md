# Ledge mobile via un relais Railway — design

Date : 2026-10-16. Remplace l'intégration « PWA sur Tailscale » (PR Lyssaen/ledge#8, abandonnée ; état complet sur le tag `archive/ledge-mobile`, commit 5e2d0b7). Base de travail : branche `mobile-ui` (UI mobile + maquettes, sur origin/main 0.5.4).

## Intention

Piloter ses agents Ledge depuis son téléphone (lire, approuver, répondre, écrire) sans Tailscale ni port ouvert, en passant par un serveur que l'utilisateur héberge sur Railway. Ce serveur doit pouvoir servir aussi un collègue : chacun relie son propre PC, et l'administrateur du serveur (l'utilisateur) **ne doit rien pouvoir voir ni faire** sur le PC d'un autre. Le serveur ne garde que des logs utiles au diagnostic.

## Objectifs

- Comptes via GitHub, restreints à une liste d'autorisés gérée par l'admin.
- Un compte = un PC + des appareils (téléphones). Isolation stricte entre comptes ; aucun partage de sessions entre utilisateurs.
- Le daemon, quand on l'active depuis l'overlay, ouvre une websocket **sortante** vers Railway et la maintient ; le téléphone se connecte au même serveur ; le serveur route.
- Chiffrement de bout en bout téléphone ↔ PC : le serveur ne peut ni lire, ni modifier, ni forger un message (prompt, sortie terminal, demande, décision, réponse).
- Un nouvel appareil n'obtient l'accès qu'après confirmation sur le PC d'un code dérivé des clés des deux appareils (style « appareils liés » de Signal/WhatsApp).
- Un appareil approuvé a tous les droits : lire, approuver, écrire. Révocation depuis l'overlay.
- Notifications push quand une demande, une question ou une fin de tour attend.
- La PWA est servie par le serveur Railway en HTTPS et s'installe via « Ajouter à l'écran d'accueil ».
- Fonctionnalités téléphone = celles de l'UI conservée : boîte de réception, détail et décision, questions (dont réponse libre), fil par agent, terminal en lecture avec interruption, envoi de message.

## Non-objectifs

- Plusieurs PC par compte (un seul suffit).
- Partage ou délégation entre utilisateurs.
- Droits fins par appareil (lecture seule, etc.).
- Chemin Tailscale / réseau local : abandonné, Railway est le seul chemin. *(mon choix)*
- File d'attente côté serveur quand le PC est hors ligne : le téléphone affiche « PC hors ligne » et son cache. *(mon choix)*
- App native.

## Anti-objectifs (échec même si « ça marche »)

- Le serveur, ou l'admin, peut lire un contenu, ou ajouter un appareil à un compte sans que le PC le confirme.
- Un compte GitHub volé suffit à lire les sessions de quelqu'un.
- Les logs serveur contiennent du contenu (prompts, commandes, sorties, noms de fichiers).
- L'UI mobile s'éloigne de la maquette `docs/mockups/ledge-mobile`.

## Contraintes et menace assumée

- Limite connue et acceptée par l'utilisateur : la PWA étant servie par le serveur, un serveur compromis pourrait servir un code modifié. Atténuation retenue *(mon choix entre les deux options présentées)* : le service worker fige la version installée ; une nouvelle version n'est appliquée qu'après accord explicite de l'utilisateur, avec l'empreinte du build affichée, comparable à celle publiée dans les releases GitHub du repo. Niveau visé : **au mieux**, pas une garantie. Un serveur compromis peut toujours servir un `sw.js` qui force sa propre mise à jour ; ce mécanisme protège contre les mises à jour silencieuses ou accidentelles et rend une substitution visible, rien de plus. Pas de build reproductible ni de vérificateur séparé. *(mon choix, conforme au « c'est ok » de l'utilisateur sur ce niveau)* L'empreinte est calculée et publiée par le workflow de release existant (`.github/workflows/release.yml`).
- Monorepo pnpm TypeScript existant (`apps/*`, `packages/*` dans le workspace). `apps/mobile` sur `mobile-ui` ne compile pas tant que `@ledge/client` et les ajouts mobiles de `@ledge/protocol` ne sont pas réintroduits — à faire en premier pour que `pnpm install` repasse.
- L'historique des conversations reste servi depuis `~/.ledge/history` (Turn.id, session.read{at}) ; pas de second magasin dans ce dossier.
- Domaine fixe et définitif : un sous-domaine du DNS de l'utilisateur sous `ledge.paradow.dev` (exemple donné : `server.ledge.paradow.dev`), pointé sur Railway en domaine personnalisé. Il sert de RP ID WebAuthn, d'origine des clés du navigateur et du service worker, et d'URL de retour OAuth. Le daemon et l'overlay l'ont par défaut et permettent de le changer (un collègue peut viser le même serveur). Le domaine est mis en place avant toute mise en service.
- Origin/main avance souvent : `git fetch` et partir d'origin/main à jour.

## Décisions de conception

### Composants

1. **`apps/relay`** *(mon choix)* — serveur Node/TypeScript déployé sur Railway, avec Postgres Railway. Rôles : OAuth GitHub, liste d'autorisés, registre des appareils, routage websocket, envoi des push, service des fichiers statiques de la PWA. Il ne stocke aucun contenu.
2. **Daemon (`packages/ledge`)** — nouveau client relais : websocket sortante, reconnexion avec backoff, chiffrement/déchiffrement, vérification des appareils approuvés. Il expose au téléphone les mêmes opérations que l'archive.
3. **PWA (`apps/mobile`)** — UI conservée ; on remplace la couche connexion (`connection/pair.ts`, `remoteClient.ts`, `verify.ts`) par connexion GitHub + websocket relais + chiffrement.
4. **Overlay (`apps/overlay`)** — section réglages « Accès mobile » *(ma supposition, acceptée)* : interrupteur, « Se connecter avec GitHub », liste des appareils (Approuver / Révoquer), popup de confirmation du code quand un appareil demande l'accès.

### Comptes et connexion

- GitHub OAuth App créée par l'admin ; identifiant/secret en variables d'environnement Railway ; URL de retour sur le domaine Railway.
- Téléphone : flux web classique (redirection GitHub → serveur), le serveur délivre sa propre session.
- PC : **device flow** GitHub (l'overlay affiche un code, ouvre github.com/login/device).
- Le serveur rattache tout à l'identifiant GitHub numérique et refuse les comptes hors liste. Gestion de la liste : laissée au builder (variable d'environnement ou petite commande admin).

### Liaison d'un appareil (le cœur de la sécurité)

- Chaque appareil (PC compris) génère une paire de clés locale ; la clé privée ne quitte jamais l'appareil (non extractible côté navigateur).
- Après connexion GitHub, le téléphone apparaît « en attente » dans le compte, avec sa clé publique.
- Le PC et le téléphone affichent un même code court calculé à partir des deux clés publiques ; l'utilisateur le compare et confirme **sur le PC et sur le téléphone** *(mon choix, nécessaire : sans confirmation côté téléphone, un relais malveillant peut faire croire au téléphone qu'il parle au PC et lire ce qu'on y tape)*. Le PC enregistre alors la clé de l'appareil comme approuvée (localement, c'est la source de vérité ; l'état serveur n'est qu'indicatif pour le routage), et le téléphone épingle la clé du PC. Si la clé du PC change ensuite, le téléphone l'affiche comme une alerte et exige une nouvelle liaison.
- Le daemon ignore tout message qui ne provient pas d'une clé qu'il a lui-même approuvée. Le téléphone ne fait confiance qu'à la clé du PC vue lors de la confirmation.
- Révocation depuis l'overlay : le PC retire la clé localement et le serveur ferme les sockets de l'appareil.
- Choix cryptographiques (courbe, échange de clés, format des messages, dérivation du code, rotation) : laissés au builder, en primitives standard (WebCrypto côté navigateur, `node:crypto` côté daemon), sans crypto maison.

### Décisions à fort impact

L'archive exigeait une confirmation WebAuthn (Face ID) pour les demandes à haut risque (`risk.ts`, `challenges.ts`). *(mon choix)* On garde cette politique de risque et cette confirmation, avec le domaine Railway comme RP ID ; la clé WebAuthn est enregistrée au moment de la liaison et vérifiée par le daemon, jamais par le serveur.

### Notifications push

- Web Push depuis le serveur (VAPID côté serveur).
- *(mon choix)* Le PC chiffre le contenu de la notification pour l'abonnement du téléphone ; le serveur ne fait que la transmettre. Repli si c'est impraticable sur iOS : push générique « Une demande attend » qui ouvre l'app.
- Garder les règles de l'archive : au plus un push « tour terminé » par minute et par session, aucun push quand l'accès mobile est désactivé.

### Logs serveur

Connexions et déconnexions, identifiant de compte et d'appareil, erreurs, tailles, latences. Jamais le contenu ni les métadonnées de contenu.

## Maquette d'abord

Première étape, avant tout code : mettre à jour `docs/mockups/ledge-mobile` et la faire valider. Écrans à ajouter ou remplacer : connexion GitHub, attente d'approbation, comparaison et confirmation du code (téléphone), alerte « clé du PC changée », validation d'une mise à jour avec son empreinte, « PC hors ligne ». Côté overlay : section « Accès mobile » et popup de confirmation du code. L'écran `Pairing` actuel (saisie d'un code) est remplacé.

Mascotte : sur les écrans de compte et de liaison, c'est la mascotte de Ledge lui-même (le « resident » de l'overlay, `apps/overlay/src/bots/ResidentMascot.tsx`, avec son halo), pas un bot d'agent. Elle sert aussi d'icône à la PWA : icônes d'écran d'accueil (180, 192, 512, plus une version maskable) sur fond `#0c0d0e`, et **favicon** SVG (mascotte seule, sans halo) avec un repli PNG 32 px, déclaré dans `apps/mobile/index.html` et le manifeste.

## Réutilisation depuis `archive/ledge-mobile`

**À reprendre** : `packages/protocol` (history, operations, thread, capabilities, push ; `remote.ts` à adapter), `packages/client`, côté daemon `history.ts`, `turns.ts`, `operations.ts`, `decisions.ts`, `risk.ts`, `challenges.ts`, `identify.ts`, `remote/project.ts` (projection par liste blanche), `push/triggers.ts`, les réponses libres dans `adapters/*`, et `MobileSettings.tsx` de l'overlay comme point de départ ; les tests associés.

**À remplacer** : `pairing.ts`, `devices.ts` (stockage à revoir pour les clés), `webauthn.ts` (à adapter au RP ID Railway), `remote/listener.ts` et `remote/static.ts` (serveur HTTPS local), `push/sender.ts` et `push/vapid.ts` (le push part du serveur), `mobile/config.ts` et `cli/mobile.ts` (config Tailscale), `apps/mobile/src/connection/*`.

## Réussite

Un collègue se connecte avec GitHub sur son téléphone et dans son overlay, confirme le code sur son PC, reçoit une notification, approuve une demande et envoie un message depuis son téléphone. L'admin, avec un accès complet au serveur et à la base, ne voit que des lignes de connexion.

## Laissé au builder

Framework HTTP/websocket du relais, schéma Postgres, détails crypto (dans les limites ci-dessus), format des enveloppes chiffrées, stratégie de reconnexion, gestion de la liste d'autorisés, découpage en lots, configuration Railway (le serveur MCP Railway n'était pas connecté pendant la conception ; le déploiement initial pourra se faire à la main).

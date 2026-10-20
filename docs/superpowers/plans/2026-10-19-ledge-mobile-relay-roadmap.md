# Ledge mobile via le relais Railway — feuille de route

Spec : `docs/superpowers/specs/2026-10-16-ledge-relay-design.md`. Base : origin/main 0.9.1 (21ca369).

## Ce qui a changé depuis la spec

La spec part de `mobile-ui` (0.5.4) et de l'archive `origin/ledge-mobile` (le tag `archive/ledge-mobile` et le commit 5e2d0b7 cités n'existent pas dans ce dépôt ; `origin/ledge-mobile`, 883656f, en tient lieu). Depuis, `main` a avancé de 0.5.4 à 0.9.1 :

- `packages/client` n'existe plus : le client du daemon vit dans `@ledge/fleet`, l'UI partagée (bots, chat, styles) dans `@ledge/ui`. « Réintroduire `@ledge/client` » devient « brancher `apps/mobile` sur `@ledge/fleet` et `@ledge/ui` ».
- Le modèle de décision a changé : `DecisionSchema` (`accept | deny | always`), une note de refus, et `pendingKey()` (empreinte de la demande) à la place des `pendingId` / `pendingVersion` de l'archive. Les ajouts mobiles de l'archive (`operations`, `risk`, `challenges`, `decisions`) se réconcilient avec ce modèle ; ils ne se recopient pas.
- Le fil a de nouveaux éléments (`sent`, `received`, `notice`) ; la `note` de l'archive est à réintégrer.
- Les réglages sont dans `apps/desktop/src/settings/` : la section « Accès mobile » va là.
- Le daemon a un jeton d'accès local (`packages/ledge/src/auth.ts`, sous-protocole `ledge.<token>`).

## Lots

Chaque lot a son plan, écrit au moment de le commencer, sur le code de ce moment.

| Lot | Contenu | Infra nécessaire |
| --- | --- | --- |
| 1 | `@ledge/seal` (chiffrement de bout en bout, code de liaison) et `apps/relay` qui route en local, sans comptes réels | aucune |
| 2 | Comptes GitHub (OAuth web côté téléphone, device flow côté PC), liste d'autorisés, magasin Postgres, configuration Railway | GitHub OAuth App de dev, Postgres local (Docker) |
| 3 | Daemon : client relais (websocket sortante, reconnexion), clé du PC, liaison d'un appareil, appareils approuvés et révocation ; desktop : section « Accès mobile » | lot 2 |
| 4 | Protocole mobile réconcilié avec `main` (identité des demandes, risque, historique, opérations idempotentes, réponses libres, capacités) et liste blanche côté daemon | aucune |
| 5 | PWA portée sur `main` (écrans de `mobile-ui`, `@ledge/fleet` + `@ledge/ui`), connexion relais + `@ledge/seal`, clés dans IndexedDB, service worker à version figée avec empreinte | lot 2 |
| 6 | Confirmation WebAuthn des demandes à haut risque, Web Push (VAPID serveur, contenu chiffré par le PC), chat multi-fil | domaine définitif |
| 7 | Mise en service : domaine sous `ledge.paradow.dev`, déploiement Railway, empreinte du build dans `release.yml` | Railway, DNS |

## Reporté par la revue du lot 1

Chaque plan de lot reprend ces points à son début.

- **Lot 2** :
  - l'authentificateur valide `Who.peer` contre `RelayPeerSchema` ;
  - les jetons de session n'utilisent que les caractères de jeton RFC 7230, car ils voyagent en sous-protocole ;
  - si le téléphone s'authentifie par cookie à l'upgrade, l'authentificateur vérifie `Origin` (détournement de websocket entre sites) ;
  - un délai maximal sur `authenticate` (par exemple 10 s → 503) et un plafond d'upgrades en attente ;
  - les lignes `refused` sont agrégées par intervalle, pour qu'un client anonyme ne puisse pas inonder les logs.
- **Lot 3** :
  - un canal vit le temps d'une paire de sockets : chaque `welcome` et chaque `hello` reçu en cours de session ouvre un canal neuf ;
  - toute `error` du relais sur un corps scellé (`offline`, `too_large`, fermeture 4008) et toute `SealError` `gap` imposent une nouvelle poignée de main avec ce pair ;
  - une confirmation de clé, ou l'empreinte des clés statiques dans le `hello`, pour distinguer « clé du PC changée » d'une altération ;
  - la longueur des clés et des nonces est validée à la révélation du code de liaison ;
  - la clé publique est dérivée du PKCS8 stocké, pas lue d'une copie.
- **Lot 4** (décidé) : chaque message téléphone ↔ PC est bourré avant d'être scellé, par paliers `PAD_TIERS` (1 Ko, 4 Ko, 16 Ko, 64 Ko, 256 Ko, 640 Ko) mesurés en octets UTF-8 du JSON clair. Le bourrage ajoute des espaces en fin de JSON, que `JSON.parse` ignore. Un message plus grand que `PLAIN_MAX` (640 Ko) n'est pas envoyé : le téléphone reçoit `error { code: 'too_large' }`. `PLAIN_MAX` reste sous `SEALED_MAX` (1 Mio) une fois scellé et passé en base64. Le relais ne voit donc qu'un palier, jamais la longueur exacte.
- **Lot 5** : un test qui vérifie que le WebCrypto de Safari et de Chrome rejette un point hors courbe, et un vecteur de test de dérivation de clés commun au navigateur et au daemon.

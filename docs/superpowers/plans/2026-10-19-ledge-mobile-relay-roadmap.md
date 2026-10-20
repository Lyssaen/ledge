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
| 5 | **Fait.** PWA portée sur `main` (écrans de `mobile-ui`, `@ledge/fleet` + `@ledge/ui`), connexion relais + `@ledge/seal`, clés dans IndexedDB, service worker à version figée avec empreinte | lot 2 |
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
- **Lot 4** (décidé) : chaque message PC → téléphone est bourré avant d'être scellé (dans la file d'envoi), par paliers `PAD_TIERS` (1 Ko, 4 Ko, 16 Ko, 64 Ko, 256 Ko, 640 Ko) mesurés en octets UTF-8 du JSON clair. Le bourrage ajoute des espaces en fin de JSON, que `JSON.parse` ignore. Un message plus grand que `PLAIN_MAX` (640 Ko) n'est pas envoyé : le téléphone reçoit `error { code: 'too_large' }`. `PLAIN_MAX` reste sous `SEALED_MAX` (1 Mio) une fois scellé et passé en base64. Le relais ne voit donc qu'un palier, jamais la longueur exacte, pour ce sens. Le sens téléphone → PC n'est pas bourré dans ce lot : la PWA (lot 5) bourrera ses messages aux mêmes paliers.
- **Lot 5** (fait) : un test qui vérifie que le WebCrypto de Safari et de Chrome rejette un point hors courbe, et un vecteur de test de dérivation de clés commun au navigateur et au daemon (`apps/mobile/e2e/crypto.spec.ts` ; Safari seulement là où WebKit est installé).
- **Lot 6a** (fait) : la confirmation d'un accord à impact élevé par l'appareil (passkey WebAuthn), de bout en bout dans `apps/mobile/e2e/confirm.spec.ts` (Chromium, authentificateur virtuel CDP ; WebKit ignoré comme au lot 5).
- **Lot 6b** (fait) : Web Push. Le téléphone active les notifications à l'étape de liaison (« Être prévenu quand un agent attend ») ou à la ligne « Notifications » de Connexion ; le PC garde l'abonnement et notifie par le relais. De bout en bout dans `apps/mobile/e2e/push.spec.ts` (Chromium ; WebKit ignoré comme au lot 5).
- **Lot 6c** (fait) : le chat « Demander à Ledge » sur le téléphone, de bout en bout dans `apps/mobile/e2e/chat.spec.ts` (Chromium, authentificateur virtuel CDP ; le faux PC de `harness.ts` joue un chat scripté ; WebKit ignoré comme au lot 5).

## Décidé au lot 5

- **PWA servie par le relais** : le relais sert le build de `apps/mobile/dist` (`LEDGE_RELAY_WEB_DIR`) sur la même origine que `/ws` et `/auth`. Le téléphone s'authentifie par le cookie de session, jamais par un sous-protocole.
- **Clés dans IndexedDB** : l'identité du téléphone (non extractible) et la clé épinglée du PC. Oublier le PC (nouvelle liaison, appareil refusé) efface l'identité, l'épingle et tout `ledge.mobile.*` ; une nouvelle liaison repart d'une boîte vide.
- **Bourrage dans les deux sens** : le téléphone bourre ses messages aux mêmes paliers `PAD_TIERS` que le PC. La confirmation de clé, premier message scellé de chaque sens, ne l'est pas.
- **Bodies à la demande** : le snapshot et les mises à jour portent un body raccourci (`cut`) ; le body entier (jusqu'à `PENDING_BODY_MAX`) vient avec `session.pending`, le fil avec `session.thread`.
- **Format de l'empreinte** : `build.json` = `{ version, fingerprint }`, où `fingerprint` est le SHA-256 des lignes `<chemin> <sha256>\n`, triées par chemin, de tous les fichiers du build sauf `build.json`. Le téléphone calcule la même. Elle s'affiche en 6 groupes de 4 caractères hexadécimaux, 2 dans sa forme courte.
- **Service worker figé** : il sert le build accepté jusqu'à « Mettre à jour », même après la fermeture de toutes les pages. Seul le script du worker lui-même ne peut pas être figé : le navigateur l'active seul.
- **Opérations renvoyées** : une décision sans réponse repart avec le même `op` une fois le canal revenu, et le PC répond le même `applied` sans rien retaper. Une opération sans `expect` n'est plus renvoyée après 5 min.
- **Réponses libres** : un seul chiffre de 1 à 9 est refusé sur le téléphone, car le PC le lirait comme un numéro d'option. Une demande à haut risque reste « À accepter sur le PC » (WebAuthn au lot 6).
- **Bout en bout** : `apps/mobile/e2e/phone.spec.ts` joue le téléphone contre le vrai relais (comptes, PGlite) et un faux PC scellé ; `pnpm --filter @ledge/mobile serve:local` lance le même monde à la main.

## Décidé au lot 6a

- **Vérification sans bibliothèque** : le daemon vérifie l'enregistrement et les assertions avec `node:crypto` seul (`packages/ledge/src/mobile/webauthn.ts`, `challenges.ts`), ES256 et RS256 ; ni `@simplewebauthn/*` ni `cbor-x`. Ces deux modules n'importent rien d'autre, pour que le faux PC de l'e2e les utilise tels quels.
- **Confiance par le canal scellé** : l'attestation est `none`. La clé publique arrive sur le canal scellé et apparié, qui est déjà la racine de confiance ; un téléphone qui perd sa passkey en enregistre une nouvelle sans se re-lier.
- **RP = hôte de `relayUrl`** : `rpId` est le nom d'hôte, `origin` l'origine ; pas de RP hors `https:` et hors `localhost`. Un credential d'un autre `rpId` compte comme absent.
- **Boot id** : le snapshot porte `daemon.boot`, un identifiant de démarrage. Une opération reçue d'un autre démarrage n'est jamais renvoyée en silence : elle reste incertaine.
- **Ordre des contrôles** : session inconnue, puis `stale`, puis capacité, puis assertion, puis `untypable`. Une demande changée n'use jamais un défi ; un défi est à usage unique, lié à l'appareil, à l'usage et à `session:clé`.
- **Une demande OMP est toujours `high`** (jamais lue comme `low`, son texte n'est pas interprété) : on y répond par une passkey, sans Autoriser/Refuser. Un téléphone qui ne peut pas confirmer voit ses options désactivées, avec « À accepter sur le PC ». Un `ask` à plusieurs questions se répond depuis le téléphone (`session.answer`), et une option par sa position.
- **Se déconnecter** envoie `device.forget` : le PC retire le téléphone, et les révocations qui échouent sont retentées.
- **Navigateur** : si l'appareil ne vérifie pas son utilisateur (`userVerification: 'required'`), Chromium ne signe rien : le téléphone dit « Vérification annulée » et n'envoie rien. `assertion_invalid` vient donc d'un défi remplacé ou d'une signature fausse, pas de ce cas.

## Décidé au lot 6b

- **Relais sans état** : il garde l'abonnement nulle part. Le PC lui envoie l'endpoint et un corps déjà chiffré, il les transmet au service push (`redirect: 'manual'`, hôtes autorisés seulement) et répond `sent`, `gone` ou `failed`. Il ne journalise ni l'endpoint ni le corps, seulement l'hôte et le résultat.
- **Chiffrement par le PC** : le PC chiffre le payload en `aes128gcm` avec les clés de l'abonnement ; le relais ne voit jamais le contenu d'une notification. Seule la signature VAPID est de son ressort.
- **Bourrage à 1 024 octets** : le texte clair est complété jusqu'à 1 024 octets avant chiffrement (un seul enregistrement), pour que sa longueur ne trahisse rien.
- **Aucune notification vers une app visible** : le téléphone dit au PC si l'app est au premier plan (`presence`) ; un appareil en ligne et visible n'est pas notifié. Jamais non plus si le mobile est désactivé, et au plus une notification « tour terminé » par minute et par session.
- **Service worker** : il valide le payload à la main (sans zod, pour garder le worker léger) ; un payload illisible affiche le repli « Ledge » / « Une demande attend », car Safari retire l'abonnement d'un site qui reste muet. Toucher la notification ouvre la demande ; les boutons Autoriser et Refuser n'y sont pas (iOS ne les gère pas, et un accord `high` exige l'appareil).
- **CSP** : `style-src 'self'`, sans `'unsafe-inline'`. React pose ses styles par le CSSOM, que la CSP n'interdit pas ; l'e2e parcourt chaque écran sans `securitypolicyviolation` ni erreur de console.
- **Bout en bout** : Chromium sans réseau n'a pas de service push, et son mode headless n'a pas de service de notifications (`showNotification` y est refusé). Le test remplace donc `pushManager.subscribe` par un abonnement factice, livre les pushes avec `ServiceWorker.deliverPushMessage`, et relève les appels du worker à `showNotification` plutôt que `getNotifications()`.

## Décidé au lot 6c

- **Un fil par appareil** : un téléphone ne voit ni le fil du PC ni celui d'un autre appareil, et le PC ne voit pas ceux des téléphones. Le retrait d'un appareil annule sa question en cours et supprime son dossier.
- **Au plus 3 questions en même temps**, tous fils confondus (PC compris) ; au-delà, `chat.error { code: 'busy' }`. Une question à la fois par fil.
- **Flux en texte entier** : `chat.delta` porte tout le texte jusque-là, au plus un toutes les 250 ms par question, avec une clé de coalescence : une perte en route ne laisse pas de trou.
- **Lancement sous vérification de l'appareil** : `chat.launch` exige l'assertion (`purpose: 'launch'`, liée au `qid`), et il est refusé depuis le téléphone dans un dossier trop large.
- **Consigne sans vérification de l'appareil** : `chat.relay` est une écriture sans assertion, comme `session.reply` sans dialogue OMP ; c'est un risque accepté, comme sur le PC.
- **Une carte n'est jamais coupée** : une consigne ou un prompt de plus de `TOOL_TEXT_MAX` n'est pas montré au téléphone, et la gateway refuse d'agir dessus. Le téléphone ne confirme jamais un texte différent de celui que le PC exécute.
- **Notification sans le texte de la réponse** : « Ledge a répondu » / « Touchez pour lire la réponse. », urgence normale, vers l'appareil de la question seul et seulement s'il n'est pas visible ; en cas d'erreur, le corps est la phrase du code (le daemon en garde sa propre copie).

### Pour plus tard

- **Historique conservé au redémarrage du daemon** : les tours restent en mémoire, comme sur le PC.
- **Limite de fréquence des questions par appareil** : le plafond de 3 et « une à la fois » bornent déjà la charge.
- **Hors lot** : le routage multi-machines (`chat.route`), la carte « projet proposé », le choix de l'outil depuis le téléphone, et l'essai sur un vrai iPhone (lot 7).

## Reporté par le lot 5

- **Lot 6** : WebAuthn (fait au lot 6a) ; Web Push (fait au lot 6b) ; le chat « Demander à Ledge », multi-fil (lot 6c), qui réutilise `challenges.ts` (`purpose: 'launch'`) et la carte de confirmation.
- **Lot 7** : le domaine `app.kl-ledge.dev` ; le déploiement Railway, avec `LEDGE_RELAY_WEB_DIR` qui pointe sur le build ; la publication de `build.json` dans `release.yml` ; la version de la PWA tamponnée par `scripts/set-version.mjs` ; un essai sur un vrai iPhone (Face ID, passkey iCloud ; PWA ajoutée à l'écran d'accueil, iOS 16.4 ou plus, pour les notifications) ; les clés VAPID de production, générées par `pnpm --filter @ledge/relay vapid-keys` et posées dans Railway (`LEDGE_RELAY_VAPID_PUBLIC_KEY`, `LEDGE_RELAY_VAPID_PRIVATE_KEY`, `LEDGE_RELAY_VAPID_SUBJECT`, les trois ou aucune).
- **Restent ouverts** : la `Max-Age` du cookie, jamais prolongée par l'usage (la session expire 90 jours après la connexion, et le téléphone revient à l'écran de connexion) ; les tests WebKit, là où son navigateur n'est pas installé ; le drapeau `other` pour les réponses libres sur plusieurs lignes.

# Ledge mobile, lot 6b : les notifications push — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le téléphone reçoit une notification quand une demande, une question ou une fin de tour l'attend, même app fermée. Le contenu est chiffré par le PC pour l'abonnement du téléphone : le relais ne fait que transmettre.

**Architecture:**
- **Relais, sans état :** il détient la paire VAPID (variables d'environnement). Il publie sa clé publique (`GET /push/key`) et envoie au service push (Apple, Google, Mozilla, Microsoft) un message déjà chiffré, sur appel du PC seulement (`POST /push/send`, Bearer PC). Il ne garde aucun abonnement.
- **PC :**
  - il reçoit l'abonnement du téléphone par le canal scellé et le range dans `devices.json` ;
  - il décide quand notifier (déclencheurs portés de l'ancien `pushFor`) ;
  - il chiffre (RFC 8291, `aes128gcm`) avec `node:crypto`, puis appelle le relais.
- **Téléphone :**
  - le service worker affiche la notification, et ouvre la bonne page au toucher ;
  - Connection active et coupe les notifications ;
  - l'app signale si elle est visible (`presence`), pour ne pas notifier un écran ouvert.

**Tech Stack:** `node:crypto` (ECDH P-256, HKDF, AES-128-GCM, ECDSA `ieee-p1363`), Push API et Notifications API du navigateur, React 19, vitest 4, Playwright 1.64.1 (CDP `ServiceWorker.deliverPushMessage`), zod 3.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md` (l. 17, 50, 84-86). Autres références :
- RFC 8030 (Web Push), RFC 8291 (chiffrement, vecteur de l'annexe A), RFC 8292 (VAPID), RFC 8188 (`aes128gcm`) ;
- lot 6a : `docs/superpowers/plans/2026-10-20-ledge-mobile-relay-lot6a-device-confirmation.md` (`snapshot.device`, opérations) ;
- ancienne implémentation, à lire et non à copier (elle utilisait `web-push`) : `git show 883656f:packages/ledge/src/daemon/push/triggers.ts`, `883656f:packages/protocol/src/push.ts`, `883656f:apps/mobile/src/push/` et `883656f:apps/mobile/src/copy.ts` (`notifications.*`) ;
- maquette : `docs/mockups/ledge-mobile/source/Notification.dc.html`, et l'étape 4 de la liaison (`docs/mockups/ledge-mobile/mobile.js`, `renderPairing`, `step === 3`).

## Global Constraints

- **Dépendances :** aucune nouvelle (ni `web-push`, ni `http_ece`).
- **Le relais ne voit jamais le contenu.** Il reçoit un corps déjà chiffré en `aes128gcm` et ne le déchiffre pas. Il ne journalise ni l'endpoint (c'est une URL secrète), ni le corps : seulement l'hôte du service et le résultat.
- **Hôtes push autorisés :** `PUSH_HOSTS = ['*.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', '*.notify.windows.com']`. Un endpoint est accepté seulement en `https:`, sans port, sans identifiants, sur un de ces hôtes. Le contrôle est fait par le téléphone, par le PC et par le relais. Le relais ne suit pas les redirections (`redirect: 'manual'`).
- **VAPID :** `LEDGE_RELAY_VAPID_PUBLIC_KEY` (point P-256 non compressé, 65 octets, base64url), `LEDGE_RELAY_VAPID_PRIVATE_KEY` (scalaire de 32 octets, base64url), `LEDGE_RELAY_VAPID_SUBJECT` (`mailto:` ou `https:`). Les trois ou aucune. Sans elles, le push est désactivé. JWT ES256 (`dsaEncoding: 'ieee-p1363'`), `aud` = origine de l'endpoint, `exp` = maintenant + 12 h, `sub` = le sujet. En-tête `Authorization: vapid t=<jwt>, k=<clé publique>`.
- **Envoi :** `Content-Encoding: aes128gcm`, `TTL: 3600`, `Urgency: high` pour une demande ou une question et `normal` pour une fin de tour, `Topic` = l'étiquette (`[A-Za-z0-9_-]`, 32 caractères au plus). Délai d'attente 10 s. Une réponse 404 ou 410 donne `gone`, et le PC retire l'abonnement.
- **Taille :** le texte clair (le JSON de `PushPayload`) est complété jusqu'à 1 024 octets avant chiffrement (`rs = 4096`, un seul enregistrement), pour que sa longueur ne trahisse rien. Un payload qui dépasse est coupé dans son `body`.
- **Quand notifier :** jamais si `mobile.state().enabled` est faux ; jamais vers un appareil en ligne dont l'app est visible ; au plus une notification « tour terminé » par minute et par session.
- **Textes des notifications :** ceux de la maquette `Notification.dc.html` :
  - demande : titre `` `${name} attend votre accord` ``, corps = texte de la demande ;
  - question : `` `${name} a une question` ``, corps = la question ;
  - fin de tour : `` `${name} a terminé` ``, corps = `lastReply`.
  Corps coupé à 120 caractères et titre à 80. Repli du service worker si le payload est illisible : titre `Ledge`, corps `Une demande attend`.
- **iOS :** la permission est demandée **dans le geste** de l'utilisateur, avant toute autre attente. Chaque `push` reçu affiche une notification (sinon Safari retire l'abonnement).
- **Textes de l'app :** `notifications.*` de `883656f:apps/mobile/src/copy.ts`, dans `apps/mobile/src/copy.ts`.
- **Compatibilité :** nouveaux champs optionnels, `PHONE_PROTOCOL` reste 1. Sans `snapshot.device.push`, le téléphone n'offre pas les notifications.
- **Imports :** relatifs sans extension dans `apps/mobile`, en `.js` dans les paquets NodeNext.

## Reporté

| Origine | Point | Tâche |
| --- | --- | --- |
| lot 5 | Web Push | Tasks 1 à 7 |
| lot 5 | course du service worker : `prune()` d'un worker actif efface le cache d'un worker en cours d'installation (`sw.ts` l. 64-67) | Task 6 |
| lot 5 | `style-src 'unsafe-inline'` dans la CSP du relais | Task 8 |

## Review Focus

1. **Le téléphone est sur l'écran de la session, app au premier plan, quand l'agent finit.** Attendu : aucune notification. L'app passe ensuite en arrière-plan et l'agent finit un nouveau tour : une notification, car le délai d'une minute par session ne compte que les notifications envoyées (Tasks 4 et 5).
2. **L'abonnement a expiré côté Apple** (réponse 410). Attendu : le PC retire l'abonnement, le snapshot suivant dit `push: 'off'`, et Connection affiche « Désactivées », sans erreur en boucle (Tasks 1, 5 et 7).
3. **Les clés VAPID du relais changent** (nouveau déploiement). Attendu : le PC voit une clé différente de celle de l'abonnement, le snapshot dit `push: 'stale'`, et Connection affiche le message `notifications.stale` avec un bouton pour réactiver (Tasks 5 et 7).
4. **L'utilisateur refuse la permission, ou ouvre la PWA dans Safari sans l'avoir ajoutée à l'écran d'accueil.** Attendu : `notifications.denied` ou `notifications.unsupported`. Aucun abonnement n'est envoyé, et l'interrupteur reste désactivé (Task 7).
5. **Une notification est touchée alors que l'app est déjà ouverte sur une autre page.** Attendu : l'app existante passe au premier plan et va à la demande (`#/request/<sid>/<key>`), sans ouvrir de second onglet. Si la demande a disparu entre-temps, l'écran « Gone » du lot 5 s'affiche (Tasks 6 et 7).

---

### Task 1: le relais envoie les push

**Files:**
- Create : `apps/relay/src/push.ts`, `apps/relay/scripts/vapid-keys.mjs`
- Modify : `apps/relay/src/{config.ts,routes.ts,log.ts,app.ts}`, `packages/protocol/src/{push.ts,index.ts}`, `apps/relay/package.json` (script `vapid-keys`)
- Test : `apps/relay/test/{push,config,app}.test.ts`

**Interfaces:**
- Produces, dans `@ledge/protocol` (fichier `push.ts`, exporté par l'index) :
  - `PUSH_HOSTS` ;
  - `pushEndpointAllowed(url: string): boolean` ;
  - `PushSendSchema = { endpoint: z.string().url().max(1_024), body: B64U.max(5_462), ttl: z.number().int().min(0).max(86_400), urgency: z.enum(['normal', 'high']), topic: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/) }`. 5 462 caractères base64url valent 4 096 octets ;
  - `PushSendResult = { result: 'sent' | 'gone' | 'failed'; status?: number }`.
- Config : `vapid?: { publicKey: string; privateKey: KeyObject; subject: string }`. Une config partielle ou une clé invalide lève `ConfigError`.
- Routes :
  - `GET /push/key` → `200 { publicKey }`, ou `404` sans VAPID ;
  - `POST /push/send` → même contrôle que `/auth/devices/revoke` (`401` si le jeton est absent, vient d'un cookie, ou n'est pas `kind: 'pc'`), puis `PushSendSchema` (sinon `400`), puis `pushEndpointAllowed` (sinon `400`), puis la limite de débit (`429`), puis l'envoi. Réponse `200 PushSendResult`.
- `sendPush(fetch, vapid, msg, now): Promise<PushSendResult>` : 2xx → `sent` ; 404 et 410 → `gone` ; autre statut, erreur ou délai dépassé → `failed`.
- Limite de débit : 120 envois par minute et par compte, puis 429.
- Log : `{ ev: 'push'; account: string; host: string; result: 'sent' | 'gone' | 'failed' | 'refused'; status?: number }`.
- `vapid-keys.mjs` affiche les trois lignes `LEDGE_RELAY_VAPID_*=…`, avec `node:crypto` (`generateKeyPairSync('ec', { namedCurve: 'P-256' })`, export JWK → base64url). Le sujet est `mailto:` suivi du premier argument.

- [ ] **Step 1 : tests qui échouent.**
  - **config :** les trois variables → `vapid` défini ; deux sur trois → `ConfigError` ; une clé publique de 64 octets → `ConfigError` ;
  - **routes :**
    - `/push/key` sans VAPID → 404 ; avec → la clé ;
    - `/push/send` avec un cookie d'appareil → 401 ; avec un jeton d'appareil en Bearer → 401 ;
    - endpoint `http://fcm.googleapis.com/…`, `https://fcm.googleapis.com:8443/…`, `https://evil.example/…` ou `https://u:p@web.push.apple.com/…` → 400 ;
    - le 121e envoi de la minute → 429 ;
  - **envoi**, avec un `fetch` simulé :
    - la requête porte `Content-Encoding: aes128gcm`, `TTL`, `Urgency` et `Topic`, plus un `Authorization: vapid t=…, k=…` dont le JWT se vérifie avec la clé publique, avec `aud` = origine de l'endpoint et `exp` ≤ maintenant + 12 h ;
    - le corps envoyé est exactement celui reçu ;
    - 410 → `gone` ; 500 → `failed` ; délai dépassé → `failed` ; une redirection 301 → `failed`, et elle n'est pas suivie ;
  - **log :** il contient l'hôte, jamais le chemin de l'endpoint ni le corps.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/relay test` et `pnpm --filter @ledge/protocol test` → PASS.
- [ ] **Step 4 :** commit `feat(relay): forward PC-encrypted web push messages with its VAPID key`.

### Task 2: protocole du téléphone

**Files:**
- Modify : `packages/protocol/src/{phone.ts,push.ts}`
- Test : `packages/protocol/test/{phone,push}.test.ts`

**Interfaces:**
- Produces :
  - `PushSubscriptionSchema = { endpoint: z.string().url().max(1_024).refine(pushEndpointAllowed), keys: { p256dh: B64U.length(87), auth: B64U.length(22) } }` ;
  - `PushPayloadSchema = { v: z.literal(1), kind: z.enum(['request', 'question', 'finished']), title: z.string().max(80), body: z.string().max(120), url: z.string().regex(/^\/#\/[A-Za-z0-9/%._~-]*$/).max(300), badge: z.number().int().min(0).max(999), tag: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/) }`.
- Le client gagne :
  - `{ type: 'push.subscribe', op, subscription: PushSubscriptionSchema, key: B64U.length(87) }`, où `key` est la clé VAPID utilisée pour l'abonnement ;
  - `{ type: 'push.unsubscribe', op }` ;
  - `{ type: 'presence', visible: z.boolean() }`.
- `snapshot.device` gagne `push: z.enum(['on', 'off', 'stale', 'unavailable']).optional()`. `unavailable` signifie que le relais n'a pas de VAPID.

- [ ] **Step 1 : tests qui échouent.**
  - un abonnement Apple typique passe ; un endpoint hors de `PUSH_HOSTS` est refusé ;
  - un payload avec `url: 'https://evil.example'` ou `'/#/x"><script'` est refusé ;
  - un snapshot du lot 6a (sans `push`) passe.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/protocol test` → PASS.
- [ ] **Step 4 :** commit `feat(protocol): push subscription, payload and presence for the phone`.

### Task 3: le chiffrement RFC 8291

**Files:**
- Create : `packages/ledge/src/mobile/push/encrypt.ts`
- Test : `packages/ledge/test/mobile/push-encrypt.test.ts`

**Interfaces:**
- Produces : `encryptPush(plain: Uint8Array, sub: { p256dh: string; auth: string }, opts?: { padTo?: number; salt?: Uint8Array; ephemeralPrivateKey?: Uint8Array }): Uint8Array`. C'est le corps `aes128gcm` complet : en-tête (`salt`, `rs = 4096`, `idlen = 65`, `keyid` = clé publique éphémère), puis un seul enregistrement chiffré.
- Algorithme (RFC 8291 §3.4, RFC 8188 §2) :
  - `ecdh_secret = ECDH(eph, ua_public)` ;
  - `PRK_key = HMAC-SHA-256(auth_secret, ecdh_secret)` ;
  - `IKM = HMAC-SHA-256(PRK_key, "WebPush: info\0" || ua_public || as_public || 0x01)` ;
  - `PRK = HMAC-SHA-256(salt, IKM)` ;
  - `CEK = HMAC(PRK, "Content-Encoding: aes128gcm\0" || 0x01)[0..16]` ;
  - `NONCE = HMAC(PRK, "Content-Encoding: nonce\0" || 0x01)[0..12]` ;
  - l'enregistrement chiffré est `plain || 0x02 || 0x00 × (padTo − |plain| − 1)`.
- Avec `crypto.hkdfSync('sha256', …)` pour les deux extractions et expansions, et `createECDH('prime256v1')`.

- [ ] **Step 1 : tests qui échouent.**
  - **le vecteur de l'annexe A de la RFC 8291**, sans bourrage : `plaintext` « When I grow up, I want to be a watermelon », `as_private`, `salt`, `ua_public` et `auth_secret` de l'annexe → le corps est **octet pour octet** celui de l'annexe ;
  - avec `padTo: 1024` : deux textes de 10 et 900 octets donnent des corps de même longueur ;
  - le déchiffrement de test (fonction inverse écrite dans le test, avec la clé privée de l'agent utilisateur) retrouve le texte ;
  - une clé `p256dh` qui n'est pas un point de la courbe → exception.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** vitest du fichier → PASS.
- [ ] **Step 4 :** commit `feat(mobile): encrypt web push payloads (RFC 8291) with node:crypto`.

### Task 4: quand notifier

**Files:**
- Create : `packages/ledge/src/mobile/push/triggers.ts`
- Modify : `packages/ledge/src/daemon/store.ts` (`apply()`, l. ~120)
- Test : `packages/ledge/test/mobile/push-triggers.test.ts`, `packages/ledge/test/store.test.ts`

**Interfaces:**
- Produces :
  - `Store.onApply(fn: (before: Session | undefined, after: Session) => void): () => void`, appelé après chaque `apply` qui change la session ;
  - `pushFor(before: Session | undefined, after: Session, all: readonly Session[]): PushPayload | null`, porté de `883656f:…/push/triggers.ts`, avec les textes des Global Constraints.
- Règles de `pushFor` :
  - **nouvelle demande** (`pendingKey` différente de celle d'avant, `kind !== 'question'`) → `request`, url `/#/request/<sid>/<key>` ;
  - **nouvelle question** → `question`, même url ;
  - **passage de `working` à `idle` sans demande** → `finished`, url `/#/thread/<sid>` ;
  - **autre changement** → null ;
  - `badge` = nombre de sessions avec `pending` dans `all` ;
  - `tag = safeTag(sid)` (`[^A-Za-z0-9_-]` → `_`, 32 caractères au plus) ;
  - texte de demande Codex « Allow the requested shell command? » → le corps prend la commande (`body`) à la place.
- Le délai d'une minute pour les fins de tour est dans le notifieur (Task 5), pas dans `pushFor`.

- [ ] **Step 1 : tests qui échouent.**
  - une demande puis la même demande (même clé) → un seul payload ;
  - une demande remplacée par une autre → deux payloads ;
  - `working` → `idle` avec une demande → pas de `finished` ;
  - `idle` → `idle` → null ;
  - un nom de 200 caractères → titre coupé à 80, et le payload passe `PushPayloadSchema` ;
  - un id de session `a/b:c` → `tag` `a_b_c`, et l'url encodée passe le schéma ;
  - `onApply` reçoit `before` et `after`, et ne se déclenche pas quand `apply` ne change rien.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge exec vitest run test/mobile/push-triggers.test.ts test/store.test.ts` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): decide which session changes deserve a notification`.

### Task 5: le notifieur du PC

**Files:**
- Create : `packages/ledge/src/mobile/push/notifier.ts`
- Modify : `packages/ledge/src/mobile/{files.ts,service.ts,gateway.ts}`, `packages/ledge/src/daemon/server.ts` (câblage)
- Test : `packages/ledge/test/mobile/{push-notifier,gateway,service}.test.ts`

**Interfaces:**
- Consumes : `encryptPush` (Task 3), `pushFor` et `Store.onApply` (Task 4), schémas de Task 2.
- Produces :
  - `ApprovedDeviceSchema` gagne `push: { endpoint, p256dh, auth, key }.optional()` ;
  - `MobileService` gagne `setPush(deviceId, p | null)`, `relayPushKey(): string | null | undefined` (`undefined` = pas encore lu ; lu par `GET /push/key` à chaque passage du lien à `online`) et `sendPush(msg: PushSend): Promise<PushSendResult>` (`POST /push/send`, Bearer PC, 10 s) ;
  - `createNotifier(deps: { mobile; presence: (deviceId: string) => boolean; now?: () => number; log })` → `{ notify(p: PushPayload, sessionId: string): Promise<void> }` ;
  - la gateway : `push.subscribe` et `push.unsubscribe` sont des écritures. `presence` est une lecture, qui met `visible` dans le suivi de l'appareil. L'appareil n'est plus visible quand son canal tombe. La gateway expose `visible(deviceId): boolean`.
- `snapshot.device.push` :
  - `unavailable` si `relayPushKey() === null` ;
  - `off` sans abonnement ;
  - `stale` si `push.key !== relayPushKey()` (et qu'elle est connue) ;
  - `on` sinon.
- `notify` :
  - rien si `enabled` est faux ;
  - pour chaque appareil avec `push` non `stale` et non visible : `JSON` → `encryptPush(…, { padTo: 1024 })` → `sendPush` ;
  - `gone` → `setPush(id, null)` et un snapshot à l'appareil s'il est en ligne ;
  - `failed` → journalisé, sans nouvel essai ;
  - `finished` : au plus un par minute et par session, tous appareils confondus. Seul un envoi réel compte : une fin de tour non notifiée parce que l'appareil était visible ne démarre pas le délai ;
  - `fingerprint(m)` (operations.ts, lot 6a) gagne `m.subscription?.endpoint ?? null` et `m.key ?? null`, pour que deux abonnements différents sous le même `op` soient un `conflict`.

- [ ] **Step 1 : tests qui échouent.**
  - **gateway :**
    - `push.subscribe` → `applied`, et le snapshot suivant dit `push: 'on'` ;
    - un endpoint hors liste → `rejected invalid` ;
    - `push.unsubscribe` → `push: 'off'` ;
    - `presence { visible: true }` puis déconnexion → `visible()` passe à false ;
  - **notifieur :**
    - appareil en ligne et visible → aucun envoi ;
    - en ligne et caché → un envoi ;
    - deux `finished` à 30 s d'écart pour la même session → un seul envoi, et à 61 s → deux ; un premier `finished` non notifié (appareil visible), puis un second à 30 s, appareil caché → un envoi ;
    - `enabled: false` → aucun envoi ;
    - `gone` → l'abonnement est retiré du fichier ;
    - la clé du relais change → `stale`, et plus d'envoi vers cet appareil ;
    - le corps envoyé fait toujours la même taille ;
    - aucun log ne contient l'endpoint ni le texte.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** vitest `test/mobile` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): the PC notifies a hidden phone through the relay`.

### Task 6: le service worker

**Files:**
- Modify : `apps/mobile/src/sw/sw.ts`
- Test : `apps/mobile/test/sw/sw.test.ts`

**Interfaces:**
- `WorkerScope` gagne `registration.showNotification`, `registration.setAppBadge?` et `clients.openWindow`.
- `push` : `event.data?.json()` validé par `PushPayloadSchema`. Valide → `showNotification(title, { body, tag, data: { url }, icon: '/icon-192.png' })` et `setAppBadge?.(badge)`. Invalide ou absent → `showNotification('Ledge', { body: 'Une demande attend', tag: 'ledge' })`. Toujours dans `event.waitUntil`.
- `notificationclick` : `notification.close()`. Puis `clients.matchAll({ type: 'window', includeUncontrolled: true })` : une fenêtre trouvée → `focus()` et `postMessage({ type: 'ledge.open', url })` ; aucune → `openWindow(url)`. L'url vient de `data.url`, revalidée par la regex du schéma, sinon `/#/`.
- `NETWORK` devient `/^\/(auth(\/.*)?|ws|healthz|push\/key)$/`.
- **Course install/prune :** au début de `install`, le worker inscrit `/pending/<OWN>` dans `META` (valeur = l'heure). `prune()` garde aussi tout cache dont l'inscription a moins de 24 h. `activate`, ou un abandon de l'installation, retire l'inscription.

- [ ] **Step 1 : tests qui échouent.**
  - un push valide → la notification porte le titre, le corps et l'url, et le badge est posé ;
  - un push illisible, ou avec `url: 'https://evil.example'` → la notification de repli ;
  - un clic avec une fenêtre ouverte → `focus` et `postMessage`, sans `openWindow` ; sans fenêtre → `openWindow('/#/request/s1/k1')` ;
  - `GET /push/key` passe au réseau ;
  - un worker B en cours d'installation, puis `accept()` du worker A → le cache de B est gardé ; une inscription de B vieille de 25 h ne le protège plus.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): the service worker shows notifications and opens the right page`.

### Task 7: activer les notifications sur le téléphone

**Files:**
- Create : `apps/mobile/src/push/{subscribe.ts,presence.ts}`
- Modify : `apps/mobile/src/state/store.ts`, `apps/mobile/src/screens/{Connection.tsx,Compare.tsx}`, `apps/mobile/src/App.tsx` (message `ledge.open` → routeur), `apps/mobile/src/copy.ts`
- Test : `apps/mobile/test/push/{subscribe,presence}.test.ts`, `apps/mobile/test/screens/{app,connection}.test.tsx`

**Interfaces:**
- Produces :
  - `pushSupport(): 'ok' | 'unsupported' | 'denied'`. `unsupported` couvre l'absence de `PushManager` ou de `Notification`, et iOS hors écran d'accueil (`navigator.standalone !== true`) ;
  - `enablePush(store): Promise<'on' | 'denied' | 'unsupported' | 'unavailable' | 'failed'>`, dans cet ordre :
    1. `Notification.requestPermission()` en premier, dans le geste ;
    2. `fetch('/push/key')` (404 → `unavailable`) ;
    3. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, après un `unsubscribe()` de l'abonnement existant s'il est fait avec une autre clé ;
    4. `push.subscribe` → attendre `applied` (sinon `failed`) ;
  - `disablePush(store)` : `push.unsubscribe`, puis `subscription.unsubscribe()` ;
  - `startPresence(store)` : envoie `presence` à chaque `visibilitychange` et après chaque `ready`.
- **Connection :** la ligne « Notifications » montre « Activées » ou « Désactivées » (d'après `snapshot.device.push`), avec un interrupteur. `stale` → le message `notifications.stale` et le bouton « Activer les notifications ». `unavailable` → `notifications.noPush`.
- **Liaison :** l'étape « Être prévenu quand un agent attend » (étape 4 de la maquette) suit « Protéger les accords » (6a). Elle a les boutons « Activer les notifications » et « Plus tard ».

- [ ] **Step 1 : tests qui échouent**, avec `Notification`, `PushManager` et `fetch` simulés.
  - permission refusée → `denied`, et aucun `push.subscribe` envoyé ;
  - `requestPermission` est appelée avant le `fetch` (ordre des appels) ;
  - iOS hors écran d'accueil → `unsupported` et le texte `notifications.unsupported` ;
  - clé du relais différente de celle de l'abonnement existant → `unsubscribe`, puis un nouvel abonnement ;
  - `push.subscribe` rejeté → `failed`, et le message `notifications.failed` ;
  - `visibilitychange` vers `hidden` → `presence { visible: false }` ;
  - un message `ledge.open` du service worker → le routeur va à l'url ;
  - snapshot `push: 'stale'` → Connection montre `notifications.stale`.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): turn notifications on from the phone`.

### Task 8: CSP, de bout en bout, et feuille de route

**Files:**
- Create : `apps/mobile/e2e/push.spec.ts`
- Modify : `apps/relay/src/static.ts` (l. 33), `apps/mobile/test/fakePc.ts`, `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md`
- Test : `apps/relay/test/static.test.ts`, `apps/mobile/e2e/push.spec.ts`

**Interfaces:**
- CSP : `style-src 'self'`, sans `'unsafe-inline'`. React pose les styles par le CSSOM, que la CSP n'interdit pas. Si l'e2e relève une violation (`securitypolicyviolation`), on garde `'unsafe-inline'` et on note la cause dans la feuille de route.
- Le faux PC répond `push.subscribe` → `applied`, et le snapshot dit `push: 'on'`.

- [ ] **Step 1 : tests qui échouent.**
  - **static :** la CSP ne contient plus `'unsafe-inline'` ;
  - **`push.spec.ts`, avec Chromium**, permission `notifications` accordée par le contexte ; `pushManager.subscribe` est remplacé par un `addInitScript` qui rend un abonnement factice, car Chromium sans réseau n'a pas de service push :
    1. lier le téléphone, puis activer les notifications à l'étape de liaison → le faux PC reçoit `push.subscribe` ;
    2. livrer un push avec CDP `ServiceWorker.deliverPushMessage` (payload JSON valide) → une notification est affichée (`registration.getNotifications()` la rend) ;
    3. livrer un payload illisible → la notification de repli ;
    4. passer sur chaque écran de l'app sans aucun événement `securitypolicyviolation` ni erreur dans la console.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** feuille de route : le lot 6b est inscrit comme fait, avec ses décisions :
  - le relais sans état ;
  - le chiffrement par le PC ;
  - le bourrage à 1 024 octets ;
  - aucune notification vers une app visible.
  Y ajouter, pour le lot 7, la génération des clés VAPID en production (`pnpm --filter @ledge/relay vapid-keys`).
- [ ] **Step 4 :** suite complète `pnpm -r test`, `pnpm -r typecheck`, `pnpm --filter @ledge/mobile build` et `test:e2e`. Les échecs connus restent ceux du lot 5.
- [ ] **Step 5 :** commit `test(mobile): push end to end and a stricter CSP; roadmap updated`.

## Hors de ce lot

- **Les boutons Autoriser et Refuser dans la notification** (maquette `Notification.dc.html`). Ils ne marchent pas sur iOS, et une acceptation `high` exige la vérification de l'appareil dans l'app. La notification ouvre la demande.
- **Lot 6c :** la notification « Ledge a répondu » du chat.
- **Lot 7 :** les clés VAPID de production dans Railway, et un essai sur un vrai iPhone (PWA ajoutée à l'écran d'accueil, iOS 16.4 ou plus).
- **Restent ouverts :** la `Max-Age` du cookie, WebKit en local.

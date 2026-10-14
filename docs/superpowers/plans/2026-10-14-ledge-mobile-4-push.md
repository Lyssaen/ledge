# Ledge mobile — lot 4 : notifications push — plan d'implémentation

> **Pour les agents d'exécution :** SOUS-SKILL REQUIS : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour réaliser ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** prévenir l'iPhone, application fermée, quand une demande, une question ou une fin de tour arrive. Toucher la notification ouvre le détail, y compris pour une demande déjà traitée. Chaque push porte le nombre de demandes en attente pour le badge.

**Architecture :** clés VAPID créées au premier appairage. Le daemon envoie lui-même aux services Web Push, avec le proxy éventuel du shell de connexion. Une fonction pure décide quoi notifier à partir des changements du store, sans jamais inclure la commande ni le texte de la question. Le service worker affiche la notification, pose le badge et ouvre l'URL du détail.

**Pile technique :** voir le [plan directeur](2026-10-14-ledge-mobile.md). Ce lot ajoute `web-push` au daemon.

**Spec :** §1 (succès 1), §1.1 (notifications qui ouvrent le détail), §2 (Notification, Connecter le téléphone, étape 4), §6 (Web Push, Badge), §10 (notification sur iPhone).

**Prérequis :** lot 1 terminé. L'écran « Déjà traitée » du lot 2 (`outcomeFor`) est réutilisé ; sans le lot 2, le lien ouvre l'écran `Gone` du lot 1.

## Global Constraints

Celles du [plan directeur](2026-10-14-ledge-mobile.md#global-constraints), plus :
- « Aucune autorisation directe dans le MVP. Les actions de notification ne sont pas une capacité portable sur Safari/iOS. »
- « Mesurer le délai de livraison sur appareil réel ; ne pas garantir un délai indépendant du système et du réseau. »

## Review Focus

En plus du [plan directeur](2026-10-14-ledge-mobile.md#review-focus) :
- **Une commande ou une question qui fuit à l'écran verrouillé** : aucun champ de la charge utile ne contient `pending.text`, `options` ni `lastReply`. → Tâche 3, test `the payload never carries the command, the question or the reply`.
- **Un appareil appairé qui fournit un point de terminaison arbitraire** (le daemon ferait des POST vers une URL de son choix) : seuls les services push connus sont acceptés. → Tâche 2, test `refuses a subscription outside the known push services`.

---

### Task 1: Protocole du push

**Fichiers :**
- Créer : `packages/protocol/src/push.ts`
- Modifier : `packages/protocol/src/messages.ts` (`push.subscribe`, `push.unsubscribe` ; `auth.ok` + `vapidPublicKey?: string`), `packages/protocol/src/index.ts`
- Test : `packages/protocol/test/push.test.ts`

**Interfaces :**
- Produit : `PushSubscriptionSchema = z.object({ endpoint: z.string().url().startsWith('https://'), expirationTime: z.number().nullable().optional(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) })` ; `PushPayloadSchema = z.object({ v: z.literal(1), kind: z.enum(['request', 'question', 'finished']), title: z.string().max(80), body: z.string().max(120), url: z.string().startsWith('/m/#/'), badge: z.number().int().nonnegative(), tag: z.string().max(32) })`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('refuses a non-https endpoint', () => expect(() => PushSubscriptionSchema.parse({ endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } })).toThrow());
it('a payload url stays inside the app', () => expect(() => PushPayloadSchema.parse({ ...ok, url: 'https://evil/' })).toThrow());
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @ledge/protocol exec vitest run test/push.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @ledge/protocol test && pnpm -r typecheck`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): push subscription and notification payload"
```

### Task 2: Clés VAPID et abonnements

**Fichiers :**
- Créer : `packages/ledge/src/daemon/push/vapid.ts`
- Modifier : `packages/ledge/package.json` (dépendance `web-push`), `packages/ledge/src/daemon/devices.ts` (`push?: PushSubscription`, `setPush(id, sub | null)`), `packages/ledge/src/daemon/pairing.ts` (`complete` appelle `ensureVapid()`), `packages/ledge/src/daemon/remote/listener.ts` (`auth.ok.vapidPublicKey`), `packages/ledge/src/daemon/server.ts` (`push.subscribe`, `push.unsubscribe`), `packages/ledge/src/daemon/remote/rights.ts` (`MOBILE_COMMANDS` + `push.subscribe`, `push.unsubscribe`)
- Test : `packages/ledge/test/push-vapid.test.ts`

**Interfaces :**
- Produit : `interface Vapid { publicKey: string; privateKey: string; subject: string }` ; `loadVapid(path = paths().vapid): Promise<Vapid | null>` ; `ensureVapid(subject: string, path?): Promise<Vapid>` (`webpush.generateVAPIDKeys()` au premier appel, fichier 0600 ; `subject` = l'origine HTTPS configurée).
- Produit : `PUSH_HOSTS: readonly RegExp[] = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/]` ; `pushEndpointAllowed(endpoint: string): boolean`. Un `push.subscribe` dont l'hôte est hors liste reçoit `error { message: 'unsupported push service' }` et rien n'est enregistré.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('creates the VAPID keys once, at the first pairing, readable by the owner only', async () => { /* … */ });
it('auth.ok carries the public key once keys exist', async () => { /* … */ });
it('stores the subscription on the device and removes it on unsubscribe', async () => { /* … */ });
it('refuses a subscription outside the known push services', async () => { /* endpoint https://attacker.example/x */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/push-vapid.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier, y compris le bundle (H10)**

Exécuter : `pnpm --filter @paradow/ledge test && pnpm --filter @paradow/ledge build && node packages/ledge/dist/cli/index.js mobile status`
Attendu : PASS ; le CLI démarre. En cas d'échec de bundle, `web-push` passe en `external`.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge pnpm-lock.yaml
git commit -m "feat(daemon): VAPID keys at first pairing and per-device push subscriptions"
```

### Task 3: Déclencheurs et envoi

**Fichiers :**
- Créer : `packages/ledge/src/daemon/push/triggers.ts`, `packages/ledge/src/daemon/push/sender.ts`
- Modifier : `packages/ledge/src/daemon/index.ts` (abonne l'envoi aux changements du store)
- Test : `packages/ledge/test/push-triggers.test.ts`, `packages/ledge/test/push-sender.test.ts`

**Interfaces :**
- Produit : `pushFor(before: Session | undefined, after: Session, all: Session[]): PushPayload | null` (pur).
  - Nouvelle demande (`after.pending.id` différent de celui de `before`), de type `permission`, `plan` ou `diff` : `kind: 'request'`, titre « Votre accord est demandé », corps « <tâche> · <Bot> ».
  - Nouvelle question : `kind: 'question'`, titre « <Bot> a une question », corps « <tâche> ».
  - Dans ces deux cas : `url: /m/#/request/<sid>/<pid>`, `tag: req-<pid>` (tronqué à 32).
  - Fin de tour (`working` → `idle`, sans demande) : `kind: 'finished'`, titre « <Bot> a terminé », corps « <tâche> », `url: /m/#/thread/<sid>`, `tag: fin-<sid>`.
  - `badge` = nombre de sessions de `all` qui ont une demande identifiée. Une simple montée de version ou tout autre changement → `null`. `<tâche>` = `topic ?? project`, coupé à 120 caractères.
- Produit : `createPushSender(o: { devices: DeviceStore; vapid: () => Promise<Vapid | null>; env: () => Promise<NodeJS.ProcessEnv>; send?: typeof webpush.sendNotification }): { notify(p: PushPayload): Promise<void> }`. Pour chaque appareil abonné : `send(sub, JSON.stringify(p), { vapidDetails, TTL: 3600, urgency: p.kind === 'finished' ? 'normal' : 'high', topic: p.tag, proxy: env.HTTPS_PROXY ?? env.https_proxy })`. 404 ou 410 → `setPush(id, null)` et une ligne de log. Toute autre erreur → une ligne de log, sans nouvel essai. `env` est l'environnement du shell de connexion, comme `agentEnv` dans `server.ts`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('a new permission request notifies with the task and the bot, opening its detail', () => {
  expect(pushFor(before, after, all)).toEqual({ v: 1, kind: 'request', title: 'Votre accord est demandé', body: 'Badge d’attente · Otto', url: `/m/#/request/a/${pid}`, badge: 1, tag: `req-${pid}`.slice(0, 32) });
});
it('a version bump of the same request does not notify again', () => { /* … */ });
it('the payload never carries the command, the question or the reply', () => {
  const p = JSON.stringify(pushFor(b, withPending('git push --force origin main', ['Oui, en prod']), all));
  expect(p).not.toMatch(/push --force|en prod/);
});
it('a finished turn notifies and opens the thread', () => { /* … */ });
it('the badge counts every session waiting for a decision', () => { /* … */ });
// sender
it('drops a subscription the push service says is gone (410)', async () => { /* … */ });
it('uses the login shell proxy when there is one', async () => { /* fake send receives proxy */ });
it('no subscription, no call', async () => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/push-triggers.test.ts test/push-sender.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge
git commit -m "feat(daemon): web push for requests, questions and finished turns"
```

### Task 4: Notifications, badge et liens profonds côté mobile

Référence visuelle : `Notification.html` (`renderNotification`) et l'étape 4 de `Pairing.html`.

**Fichiers :**
- Créer : `apps/mobile/src/push/handlers.ts`, `apps/mobile/src/push/subscribe.ts`
- Modifier : `apps/mobile/src/sw.ts` (événements `push` et `notificationclick`), `apps/mobile/src/screens/Pairing.tsx` (étape 4 : « Activer les notifications » et « Plus tard » ; l'icône Réglages de l'en-tête rouvre cette étape une fois appairé), `apps/mobile/src/state/store.ts` (badge posé à chaque instantané), `apps/mobile/src/App.tsx` (message du service worker → navigation)
- Test : `apps/mobile/test/push-handlers.test.ts`, `apps/mobile/e2e/notifications.spec.ts`

**Interfaces :**
- Produit : `notificationFrom(data: unknown): { title: string; options: NotificationOptions } | null` (valide avec `PushPayloadSchema` ; `options = { body, tag, data: { url }, icon: '/m/icons/192.png' }`) ; `badgeFrom(data: unknown): number | null` ; `openTarget(url: string, clients: Clients): Promise<void>`. Si une fenêtre de l'app existe, `postMessage({ type: 'open', url })` puis `focus()` ; sinon `openWindow(url)`.
- Produit : `enableNotifications(o: { vapidPublicKey: string; send(m: ClientMessage): void; reg?: ServiceWorkerRegistration }): Promise<'granted' | 'denied' | 'unsupported'>`. Appelée **depuis le geste** du bouton : `Notification.requestPermission()`, puis `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, puis `push.subscribe`.
- Le service worker appelle `setAppBadge(n)`, ou `clearAppBadge()` à 0, quand l'API existe. L'app fait de même à chaque instantané (H7).
- Lien vers une demande qui n'attend plus : l'écran « Déjà traitée sur le PC » du lot 2 (`outcomeFor`). Lien vers un fil : le fil.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('builds the notification from a valid payload and ignores anything else', () => { /* … */ });
it('focuses an open window and sends it the url; opens one otherwise', async () => { /* fake clients */ });
it('reads the badge count', () => expect(badgeFrom(ok)).toBe(1));
// e2e
test('step 4 asks permission from the tap and sends push.subscribe', async ({ page }) => { /* stub Notification and pushManager via addInitScript */ });
test('a deep link to a handled request shows Déjà traitée sur le PC', async ({ page }) => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec vitest run test/push-handlers.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter mobile test && pnpm --filter mobile test:e2e`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): push notifications that open the request, and the app badge"
```

### Task 5: Documentation et validation du lot 4

**Fichiers :**
- Modifier : `README.md` (Files : `vapid.json` ; Security : contenu des notifications, services push contactés), `docs/mobile.md` (activer et couper les notifications, confidentialité à l'écran verrouillé), `docs/spikes/2026-10-14-ledge-mobile-feasibility.md` (R6 avec délais relevés, R9)

- [ ] **Étape 1 : rédiger la documentation**

- [ ] **Étape 2 : passer toute la suite**

Exécuter : `pnpm -r typecheck && pnpm -r test && pnpm --filter mobile test:e2e`
Attendu : PASS.

- [ ] **Étape 3 : valider sur l'iPhone (R6 et R9 du plan directeur)**

Attendu : conditions cochées dans le rapport. Délai médian et maximal relevés, présentés comme des mesures, pas comme une garantie.

- [ ] **Étape 4 : commit**

```bash
git add README.md docs/mobile.md docs/spikes/2026-10-14-ledge-mobile-feasibility.md
git commit -m "docs(mobile): push notifications"
```

# Ledge mobile, lot 7 : la mise en service — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le relais et la PWA tournent en production sur `https://app.kl-ledge.dev` (Railway + Postgres Railway). Un vrai iPhone s'y lie, confirme par passkey, reçoit un push et discute avec Ledge. L'empreinte du build servi est celle que publie la release GitHub.

**Architecture:**
- **Une image, un hôte.** Une image Docker construit le relais et la PWA (`apps/mobile/dist`), et le relais sert les deux sur la même origine (`LEDGE_RELAY_WEB_DIR`, décidé au lot 5). Railway la construit depuis `apps/relay/Dockerfile` (`railway.json`), avec une seule réplique, car le routage des sockets vit en mémoire.
- **Échec tôt.** En production, le relais refuse de démarrer s'il manque une variable, le build de la PWA ou les clés VAPID. Il le dit en une ligne qui nomme les variables, jamais leurs valeurs.
- **Empreinte publiée.** Le workflow de release construit la PWA de la même façon et publie `build.json` avec la release. L'écran « Mise à jour » du téléphone pointe déjà sur cette release (`apps/mobile/src/screens/Update.tsx:7`).
- **Humain.** Le DNS, le projet Railway, l'OAuth App GitHub, les clés VAPID et l'essai sur iPhone se font à la main, d'après le runbook du README du relais.

**Tech Stack:** Docker (image `node:22-bookworm-slim`, pnpm 10.12.1 par corepack), Railway (config-as-code `railway.json`, builder `DOCKERFILE`), GitHub Actions, vitest 4, zod 3.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md` (l. 18, 40, 43, 57, 104-106). Autres références :
- feuille de route : `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md`, ligne du lot 7 et « Reporté par le lot 5 » ;
- runbook actuel : `apps/relay/README.md`, « Deploy on Railway » ;
- format de l'empreinte : `apps/mobile/scripts/fingerprint.mjs`, et son affichage `apps/mobile/src/sw/fingerprint.ts:22` (6 groupes de 4).

## Global Constraints

- **Domaine :** `https://app.kl-ledge.dev`. Il remplace `server.ledge.paradow.dev` partout : `DEFAULT_RELAY_URL`, tests, commentaires, maquettes, spec. Les plans des lots passés restent tels quels, car ce sont des comptes rendus. Il sert de RP ID WebAuthn (`app.kl-ledge.dev`), d'origine de la PWA et du service worker, et d'URL de retour OAuth (`https://app.kl-ledge.dev/auth/github/callback`).
- **Hébergement :** Railway, un service (le relais) et un Postgres Railway. HTTPS est fourni par Railway. DNS : `CNAME app` → le domaine Railway du service.
- **Une seule réplique.** Le hub (`apps/relay/src/hub.ts`) route en mémoire : deux répliques couperaient un PC de son téléphone.
- **Secrets :** ni commités, ni journalisés, ni affichés dans un message d'erreur. Les clés VAPID sont générées par `pnpm --filter @ledge/relay vapid-keys <contact>` et posées dans Railway.
- **Dépendances :** aucune nouvelle dans le workspace.
- **`.github/workflows/release.yml` :** il n'est modifié qu'avec l'accord explicite de l'utilisateur au moment de l'exécution (Task 4). Sans cet accord, la Task 4 est sautée et notée comme reportée.
- **Builds identiques :** la PWA construite dans l'image Railway et celle du workflow de release partent du même commit, avec Node 22, `pnpm install --frozen-lockfile` et `pnpm --filter @ledge/mobile build`. Leur `build.json` doit être identique octet pour octet.
- **Version :** `fingerprint.mjs` lit la version dans `packages/ledge/package.json` (`apps/mobile/scripts/fingerprint.mjs:11`), que `scripts/set-version.mjs` tamponne déjà. Il n'y a rien à ajouter pour la version de la PWA.
- **Langue :** texte du README en anglais, comme l'existant ; messages de commit en anglais.

## Déjà fait (ne pas refaire)

| Point | Où |
| --- | --- |
| Migrations au démarrage, idempotentes | `apps/relay/src/store.ts:16-66`, appelées par `apps/relay/src/app.ts:23` avant l'écoute |
| `GET /healthz` → `ok` | `apps/relay/src/server.ts:63` ; `/healthz` est servi seulement une fois les migrations faites |
| Arrêt propre sur SIGTERM | `apps/relay/src/main.ts:170-172`, `server.ts:161-168` |
| Base injoignable au démarrage → sortie 1 avec un message | `apps/relay/src/main.ts:196-204` |
| Validation des variables, sans jamais citer une valeur | `apps/relay/src/config.ts:7-142` |
| Cookies `Secure` dès que l'URL publique est https | `apps/relay/src/routes.ts:173` |
| CSP sans `'unsafe-inline'`, avec `connect-src` = `wss://<hôte public>` | `apps/relay/src/static.ts:18-35` |
| Script des clés VAPID | `apps/relay/scripts/vapid-keys.mjs` |
| `railway.json` (build Railpack, `/healthz`, redémarrage sur échec) | `apps/relay/railway.json`, remplacé à la Task 3 |

## Reporté des lots précédents : tri

| Point | Décision |
| --- | --- |
| Registre des opérations du PC en mémoire | Fait au lot 6a : `daemon.boot` dans le snapshot (`packages/protocol/src/phone.ts:168`, `packages/ledge/src/mobile/gateway.ts:63,104`). |
| `revokeOnRelay` sans nouvel essai | Fait au lot 6a (d734f3f) : la révocation est notée avant l'appel et retentée (`packages/ledge/src/mobile/service.ts:303-306`). |
| Course installation / `prune` du service worker | Fait au lot 6b, Task 6 (`apps/mobile/src/sw/sw.ts:56-96`, marque `/pending/<cache>`). |
| La déconnexion du téléphone ne prévient pas le PC | Fait au lot 6a : `device.forget` (d734f3f, 85ad7b0). |
| `style-src 'unsafe-inline'` | Retiré au lot 6b (`apps/relay/src/static.ts:33`). |
| e2e WebKit jamais lancé en local | Remplacé par l'essai sur un vrai iPhone (Task 6). |
| Drapeau `other` des réponses libres sur plusieurs lignes | Hors de ce lot. |
| Historique du chat perdu au redémarrage du daemon | Hors de ce lot. |

## Review Focus

1. **L'empreinte servie diffère de celle de la release.** Cela arrive si Railway construit un autre commit que le tag, ou si un chemin absolu ou un horodatage se glisse dans le build. Attendu : à un commit de release, `/build.json` en production est identique à l'asset de la release. La Task 3 compare le build de l'image à celui de l'hôte. Le runbook (Task 5) ne déploie que des commits de release.
2. **Une variable manque ou est mal saisie dans Railway.** Attendu : le processus sort avec le code 1. Il affiche une seule ligne qui nomme toutes les variables manquantes, sans aucune valeur. Le healthcheck échoue, et Railway garde le déploiement précédent. Testé par la Task 2.
3. **Un PC a activé l'accès mobile avant le lot 7.** `~/.ledge/mobile.json` contient `https://server.ledge.paradow.dev`, un domaine qui n'a jamais servi. Attendu : il est lu comme `https://app.kl-ledge.dev`, sans action de l'utilisateur. Une URL choisie à la main n'est pas touchée. Testé par la Task 1.
4. **Un redéploiement pendant une session.** Railway envoie SIGTERM, et toutes les sockets se ferment. Attendu : le PC et le téléphone se reconnectent seuls. Le téléphone montre « PC hors ligne » quelques secondes, et une décision en vol repart avec le même `op` (lot 5). Le smoke test de la Task 3 vérifie la sortie 0 sur SIGTERM, et la Task 6 vérifie la reconnexion sur l'iPhone.
5. **Postgres Railway pas encore prêt au démarrage.** Attendu : `ledge-relay: cannot start: the database is unreachable or its migration failed (…)`, sortie 1, puis redémarrage par Railway (`ON_FAILURE`). Le smoke test de la Task 3 lance l'image sans base joignable.

---

### Task 1: le domaine `app.kl-ledge.dev`

**Files:**
- Modify :
  - `packages/protocol/src/mobile.ts:4` ;
  - `packages/ledge/src/mobile/files.ts:50-54` ;
  - `apps/desktop/src/settings/Mobile.tsx:19` (commentaire) ;
  - les maquettes `docs/mockups/ledge-mobile/source/{AppIcon,Login,OverlayMobile}.dc.html`, `docs/mockups/mobile-access/main.tsx`, `docs/mockups/ledge-mobile-access.html` (bundle construit : remplacement de la chaîne seulement) ;
  - la spec, l. 43 : le domaine retenu, avec la date de la décision ;
  - la feuille de route, ligne du lot 7 : « domaine `app.kl-ledge.dev` ».
- Test :
  - `packages/protocol/test/messages.test.ts:385` ;
  - `apps/desktop/test/settings-mobile.test.tsx:85-87` ;
  - `packages/ledge/test/mobile-files.test.ts`.

**Interfaces:**
- Produces :
  - `DEFAULT_RELAY_URL = 'https://app.kl-ledge.dev'` ;
  - `LEGACY_RELAY_URL = 'https://server.ledge.paradow.dev'`, non exporté par `@ledge/protocol` et local à `files.ts` ;
  - `readMobileConfig()` rend `relayUrl: DEFAULT_RELAY_URL` quand le fichier porte `LEGACY_RELAY_URL`. Il ne réécrit pas le fichier.

- [ ] **Step 1 : tests qui échouent.**
  - `mobile-files.test.ts` :
    - un `mobile.json` `{ enabled: true, relayUrl: 'https://server.ledge.paradow.dev' }` se lit `{ enabled: true, relayUrl: 'https://app.kl-ledge.dev' }` ;
    - `https://relay.example` reste tel quel ;
    - sans fichier, la config par défaut porte `https://app.kl-ledge.dev` ;
  - mettre `app.kl-ledge.dev` dans les attentes de `settings-mobile.test.tsx` et de `messages.test.ts`.
- [ ] **Step 2 :** `pnpm --filter @paradow/ledge test mobile-files` → FAIL.
- [ ] **Step 3 :** implémenter, puis remplacer le domaine dans les fichiers listés.
- [ ] **Step 4 :** `pnpm --filter @ledge/protocol test`, `pnpm --filter @paradow/ledge test mobile-files` et `pnpm --filter desktop test settings-mobile` → PASS. Ensuite, `grep -rn "server.ledge.paradow.dev" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git .` ne doit trouver que `LEGACY_RELAY_URL`, son test et les plans `docs/superpowers/plans/2026-10-19-*`.
- [ ] **Step 5 :** commit `feat(mobile): the default relay is app.kl-ledge.dev`.

### Task 2: la production refuse de démarrer incomplète

**Files:**
- Modify : `apps/relay/src/config.ts:110-142`, `apps/relay/README.md` (tableau « Accounts mode »)
- Test : `apps/relay/test/config.test.ts`

**Interfaces:**
- Consumes : `loadConfig(env)` et `ConfigError` (`config.ts:8,111`), inchangés.
- Produces, quand `NODE_ENV=production` et `DATABASE_URL` est posée :
  - **Variables manquantes :** elles sont relevées toutes à la fois, dans l'ordre `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `LEDGE_RELAY_ALLOWED_GITHUB_IDS`, `LEDGE_RELAY_PUBLIC_URL`, `LEDGE_RELAY_WEB_DIR`, `LEDGE_RELAY_VAPID_PUBLIC_KEY`, `LEDGE_RELAY_VAPID_PRIVATE_KEY`, `LEDGE_RELAY_VAPID_SUBJECT`. Elles donnent une seule `ConfigError` : `` `missing in production: ${names.join(', ')}` ``. Hors production, `required()` reste tel quel : la première absente est signalée, et `LEDGE_RELAY_WEB_DIR` et VAPID restent facultatives.
  - **Push obligatoire en production :** les trois `LEDGE_RELAY_VAPID_*` le sont. La règle « les trois ou aucune » ne vaut plus qu'hors production.
  - **Build de la PWA :** `LEDGE_RELAY_WEB_DIR` doit contenir `index.html`, `sw.js`, `build.json` et `manifest.webmanifest` (`existsSync`). Sinon : `` `LEDGE_RELAY_WEB_DIR has no ${file}: build @ledge/mobile into it` ``, avec le premier fichier absent.
- Les messages existants (https, liste d'autorisés, VAPID invalides) ne changent pas.

- [ ] **Step 1 : tests qui échouent** (un dossier temporaire tient lieu de build) :
  - production sans `GITHUB_CLIENT_SECRET` ni `LEDGE_RELAY_WEB_DIR` → message exact `missing in production: GITHUB_CLIENT_SECRET, LEDGE_RELAY_WEB_DIR, LEDGE_RELAY_VAPID_PUBLIC_KEY, LEDGE_RELAY_VAPID_PRIVATE_KEY, LEDGE_RELAY_VAPID_SUBJECT` quand VAPID est aussi absent ;
  - production avec tout, mais un dossier sans `build.json` → `LEDGE_RELAY_WEB_DIR has no build.json: build @ledge/mobile into it` ;
  - production complète → `mode: 'accounts'`, avec `webDir` et `vapid` ;
  - aucun message d'erreur ne contient une valeur passée (secret, ids, chemin du dossier) ;
  - hors production, sans VAPID ni dossier → accepté, comme aujourd'hui ;
  - les tests de production existants (l. 61-70) reçoivent le dossier et VAPID dans leur fixture.
- [ ] **Step 2 :** `pnpm --filter @ledge/relay test config` → FAIL.
- [ ] **Step 3 :** implémenter. Ajouter au tableau du README les lignes `LEDGE_RELAY_WEB_DIR` et `LEDGE_RELAY_VAPID_*` (absentes aujourd'hui), avec « required in production ».
- [ ] **Step 4 :** `pnpm --filter @ledge/relay test` et `pnpm --filter @ledge/relay typecheck` → PASS. Les e2e du téléphone ne sont pas en production et ne changent pas.
- [ ] **Step 5 :** commit `feat(relay): production refuses to start without its variables, the phone app or push`.

### Task 3: l'image Docker et `railway.json`

**Files:**
- Create : `apps/relay/Dockerfile`, `.dockerignore` (racine)
- Modify : `apps/relay/railway.json`, `apps/relay/README.md` (« Deploy on Railway » réécrit en runbook de production)

**Interfaces:**
- Consumes : la Task 2 (`LEDGE_RELAY_WEB_DIR` vérifié au démarrage).
- Produces :
  - **Dockerfile** (contexte = racine du dépôt), en deux étapes :
    - `build` : `node:22-bookworm-slim`, `corepack enable`, copie du dépôt, puis `pnpm install --frozen-lockfile --filter @ledge/relay... --filter @ledge/mobile...`, puis `pnpm --filter @ledge/relay build`, puis `pnpm --filter @ledge/mobile build` ;
    - `runtime` : `node:22-bookworm-slim`, avec `apps/relay/dist`, les dépendances de production du relais (`pg`, `ws`, `zod`) et `apps/mobile/dist`. Le moyen d'y amener les dépendances est au choix de l'implémenteur ; le smoke test tranche. `ENV NODE_ENV=production`, `ENV LEDGE_RELAY_WEB_DIR=/app/apps/mobile/dist`, `USER node`, `CMD ["node", "apps/relay/dist/main.js"]` (forme exec, pour que SIGTERM arrive à Node).
  - **`.dockerignore`** : `**/node_modules`, `**/dist`, `target`, `.git`, `.claude`, `.playwright-mcp`, `**/test-results`, `.env`.
  - **`railway.json`** : `build.builder = "DOCKERFILE"`, `build.dockerfilePath = "apps/relay/Dockerfile"`, `deploy.numReplicas = 1`, `deploy.healthcheckPath = "/healthz"`, `deploy.healthcheckTimeout = 120`, `deploy.restartPolicyType = "ON_FAILURE"`, `deploy.restartPolicyMaxRetries = 5`. Plus de `buildCommand` ni de `startCommand`.
  - **Runbook du README**, en anglais, avec les mêmes points que la Task 5 : variables, OAuth App, DNS, déploiement d'un commit de release, contrôle de l'empreinte.

- [ ] **Step 1 :** `docker build -f apps/relay/Dockerfile -t ledge-relay:lot7 .` → succès.
- [ ] **Step 2 : smoke test sans base.** `docker run --rm -e DATABASE_URL=postgres://x:y@127.0.0.1:1/z` avec les autres variables factices (VAPID tirées de `pnpm --filter @ledge/relay vapid-keys test@example.com`, `LEDGE_RELAY_PUBLIC_URL=https://app.kl-ledge.dev`).
  Attendu : sortie 1 et `ledge-relay: cannot start: the database is unreachable…`.
- [ ] **Step 3 : smoke test complet.** Postgres dans Docker (`postgres:16`, réseau Docker commun), puis l'image avec `DATABASE_URL` vers lui. Vérifier :
  - `GET /healthz` → `ok` ;
  - `GET /` → 200, avec une CSP qui contient `connect-src 'self' wss://app.kl-ledge.dev` ;
  - `GET /sw.js` et `GET /manifest.webmanifest` → 200 ;
  - `docker stop` → arrêt avant 10 s, code 0.
- [ ] **Step 4 : même empreinte.** Comparer le `GET /build.json` de l'image au `apps/mobile/dist/build.json` d'un `pnpm --filter @ledge/mobile build` sur l'hôte, au même commit. Les deux doivent être identiques. S'ils diffèrent, trouver le fichier en cause (comparer les listes `<chemin> <sha256>`) et rendre le build déterministe avant d'aller plus loin. C'est le premier point de la Review Focus.
- [ ] **Step 5 :** sans `LEDGE_RELAY_VAPID_SUBJECT` → sortie 1, `missing in production: LEDGE_RELAY_VAPID_SUBJECT`.
- [ ] **Step 6 :** arrêter et supprimer les conteneurs et le réseau du test. Commit `build(relay): a Docker image with the phone app, deployed on Railway as one replica`.

### Task 4: la release publie l'empreinte de la PWA (accord de l'utilisateur requis)

> Cette tâche modifie `.github/workflows/release.yml`. Le contrôleur demande l'accord de l'utilisateur avant de la confier. Sans accord, elle est sautée et reportée dans la feuille de route. La spec l'exige (l. 40), et le téléphone renvoie déjà vers la release (`Update.tsx:7`).

**Files:**
- Create : `scripts/pwa-notes.mjs`, `test/pwa-notes.test.ts`
- Modify : `.github/workflows/release.yml` (job `npm` l. 27-62, étape « Publish » l. 101-144, étape de simulation l. 145-157)

**Interfaces:**
- Produces :
  - `scripts/pwa-notes.mjs <build.json>` imprime le bloc de notes :
    ```
    **Phone app** <version>
    Fingerprint: `xxxx xxxx xxxx xxxx xxxx xxxx` (full: `<64 hex>`)
    ```
    Les 6 groupes sont les 24 premiers caractères, comme `formatFingerprint`. Un `build.json` illisible ou sans `fingerprint` de 64 hexadécimaux donne une sortie 1.
  - **Job `npm`**, après « Stamp the version » : `pnpm --filter @ledge/mobile build`, puis `actions/upload-artifact@v4` (`name: pwa-build`, `path: apps/mobile/dist/build.json`).
  - **Job `windows-installer`** : `actions/download-artifact@v4` (`pwa-build`). Le fichier est publié comme asset `ledge-mobile-build.json`, et la sortie de `pwa-notes.mjs` est ajoutée à `notes.md` avant le bloc « Install ». Elle n'est pas ajoutée à `release-notes.md`, que lit l'updater. En simulation, l'étape « Show the updater manifest » imprime aussi ce bloc.

- [ ] **Step 1 : tests qui échouent.** Un `build.json` `{ version: '0.14.0', fingerprint: 'ab'.repeat(32) }` → le bloc exact. Un fingerprint de 63 caractères → sortie 1.
- [ ] **Step 2 :** `pnpm exec vitest run --config vitest.scripts.config.ts test/pwa-notes.test.ts` → FAIL, puis implémenter, puis PASS.
- [ ] **Step 3 :** modifier `release.yml`. Le valider avec `actionlint` s'il est installé ; sinon, relire le YAML (`node -e` avec un parseur YAML déjà présent dans `node_modules`, sinon à l'œil). Il ne doit pas y avoir de nouveau secret ni de nouvelle permission.
- [ ] **Step 4 :** commit `ci(release): publish the phone app's build.json and fingerprint with each release`. Le premier essai réel est un `workflow_dispatch`, lancé par l'utilisateur.

### Task 5: mise en service (humain, runbook)

Rien n'est automatisé ici. L'implémenteur ne fait aucun appel réseau vers Railway, GitHub ou le DNS. Le contrôleur remet cette liste à l'utilisateur et attend son retour.

- [ ] **Clés VAPID**, en local : `pnpm --filter @ledge/relay vapid-keys <contact email>`. Les trois lignes vont dans Railway, nulle part ailleurs.
- [ ] **OAuth App GitHub** (Settings → Developer settings → OAuth Apps → New) :
  - Homepage `https://app.kl-ledge.dev` ;
  - Authorization callback URL `https://app.kl-ledge.dev/auth/github/callback` ;
  - cocher « Enable Device Flow » ;
  - générer un client secret.
- [ ] **Railway**, depuis la racine du dépôt :
  - créer le projet, puis un service relié au dépôt, avec le config file `apps/relay/railway.json` ;
  - ajouter un Postgres ;
  - la branche de déploiement est l'objet de la question ouverte 1.
- [ ] **Variables du service** :

  | Variable | Valeur ou forme |
  | --- | --- |
  | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (référence Railway, réseau privé) |
  | `GITHUB_CLIENT_ID` | l'id de l'OAuth App |
  | `GITHUB_CLIENT_SECRET` | son secret |
  | `LEDGE_RELAY_ALLOWED_GITHUB_IDS` | id(s) GitHub numérique(s), séparés par des virgules (`https://api.github.com/users/<login>`, champ `id`) |
  | `LEDGE_RELAY_PUBLIC_URL` | `https://app.kl-ledge.dev` (sans `/` final) |
  | `LEDGE_RELAY_VAPID_PUBLIC_KEY` | 87 caractères base64url |
  | `LEDGE_RELAY_VAPID_PRIVATE_KEY` | 43 caractères base64url |
  | `LEDGE_RELAY_VAPID_SUBJECT` | `mailto:<contact>` |

  `NODE_ENV`, `LEDGE_RELAY_WEB_DIR` et `PORT` ne se posent pas : l'image fixe les deux premiers, et Railway fournit `PORT`.
- [ ] **Domaine :**
  - dans Railway, Settings → Networking → Custom Domain `app.kl-ledge.dev` ;
  - chez le DNS, `CNAME app` → la cible affichée par Railway, plus le `TXT` de vérification s'il en demande un. Chez Cloudflare, l'enregistrement est en « DNS only » ;
  - attendre le certificat.
- [ ] **Premier déploiement** d'un commit de release. Vérifier :
  - `https://app.kl-ledge.dev/healthz` → `ok` ;
  - les logs montrent `{"ev":"listening",…,"mode":"accounts"}` ;
  - `https://app.kl-ledge.dev/build.json` est identique à l'asset `ledge-mobile-build.json` de la release (si la Task 4 est faite).
- [ ] **PC :** Ledge Desktop → Réglages → Accès mobile → activer. Le relais affiché est `app.kl-ledge.dev`. Se connecter avec GitHub (device flow).

### Task 6: essai sur un vrai iPhone (humain, liste de contrôle)

L'iPhone est sous iOS 16.4 ou plus, Safari, avec Face ID et le trousseau iCloud actifs. Chaque ligne est cochée par l'utilisateur, ou notée avec ce qu'il a vu.

- [ ] **Installer.** Ouvrir `https://app.kl-ledge.dev` dans Safari, puis Partager → « Sur l'écran d'accueil ». L'icône est la mascotte, et l'app s'ouvre sans barre Safari.
- [ ] **Se connecter avec GitHub** depuis l'app installée. Retour dans l'app, écran de liaison.
- [ ] **Lier.** Le même code s'affiche sur le PC et sur le téléphone. Confirmer des deux côtés, puis enregistrer la passkey (Face ID).
- [ ] **Notifications.** À l'étape « Être prévenu quand un agent attend », accepter. Connexion → Notifications dit « Activées ».
- [ ] **Push.** App fermée, déclencher une demande d'un agent sur le PC. La notification « <agent> attend votre accord » arrive, et la toucher ouvre la demande. Une fin de tour, app en arrière-plan, notifie aussi. App au premier plan : rien.
- [ ] **Demande à haut risque.** Autoriser depuis le téléphone avec Face ID : le PC applique. Annuler Face ID : « Vérification annulée », rien n'est envoyé.
- [ ] **Question et réponse libre** depuis le téléphone : le PC la reçoit.
- [ ] **Chat** (« Demander à Ledge ») : une question reçoit une réponse en flux. Le fil du téléphone est distinct de celui de l'overlay.
- [ ] **Redéploiement** pendant que l'app est ouverte : « PC hors ligne » quelques secondes, puis retour seul.
- [ ] **Mise à jour.** Après un nouveau déploiement, l'app propose la mise à jour avec une empreinte, la même que celle de la release liée.
- [ ] **Révoquer** le téléphone depuis le PC : le téléphone revient à l'écran de liaison.
- [ ] **Logs Railway :** des lignes de connexion seulement, sans contenu, sans endpoint push ni corps (spec l. 106).
- [ ] Le contrôleur consigne le résultat dans la feuille de route (lot 7 « Fait », points ouverts) et commit `docs(roadmap): lot 7 in production`.

## Questions ouvertes (à l'utilisateur)

1. **Quel commit Railway déploie-t-il ?** Proposé : une branche `production`, que l'utilisateur avance sur chaque tag de release (`git push origin vX.Y.Z^{commit}:refs/heads/production`), avec l'auto-déploiement de Railway sur cette branche. Sinon, `main` est déployé à chaque push, mais l'empreinte servie ne correspond à une release qu'au commit du tag.
2. **Accord pour modifier `release.yml`** (Task 4).
3. **Offre et région Railway** (Hobby ou Pro ; une région proche, par exemple `europe-west4`).
4. **Le DNS de `kl-ledge.dev`** : chez quel fournisseur, et le domaine est-il déjà enregistré ?

## Hors de ce lot

- **Le drapeau `other` des réponses libres sur plusieurs lignes :** il change le protocole des réponses, et la mise en service n'en dépend pas.
- **L'historique du chat gardé au redémarrage du daemon :** écarté au lot 6c, et une perte n'affecte que le confort.
- **La `Max-Age` du cookie, jamais prolongée :** le téléphone revient à la connexion GitHub après 90 jours, un défaut connu et sans risque.
- **Plusieurs répliques du relais :** il faudrait un bus entre instances, inutile pour un compte ou deux.
- **Un healthcheck qui interroge Postgres :** une base perdue fait déjà échouer les appels (`main.ts:184-186`), et Railway ne consulte `/healthz` qu'au déploiement.
- **Le déploiement Railway lancé par `release.yml`** (jeton Railway en secret) : il dépend de la réponse à la question 1.

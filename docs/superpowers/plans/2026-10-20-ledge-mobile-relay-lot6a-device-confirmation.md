# Ledge mobile, lot 6a : accepter depuis le téléphone (WebAuthn, OMP, opérations) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une demande à impact élevé s'accepte depuis le téléphone après une vérification de l'appareil (Face ID), vérifiée par le daemon et jamais par le relais. Une demande OMP se traite depuis le téléphone avec ses propres réponses. Les opérations ne sont plus rejouées après un redémarrage du PC, et un téléphone qui se déconnecte est retiré du PC.

**Architecture:**
- **Clé d'appareil :** un credential WebAuthn (passkey de plateforme, `userVerification: 'required'`, attestation `none`) est créé sur le téléphone, puis envoyé au PC **par le canal scellé** déjà lié. La confiance vient de ce canal, pas d'une attestation. Le PC range sa clé publique (SPKI) dans `devices.json`.
- **Vérification sans bibliothèque :** `packages/ledge/src/mobile/webauthn.ts` vérifie `clientDataJSON`, `authenticatorData` et la signature avec `node:crypto` seulement. Pas de CBOR : la clé vient de `getPublicKey()` côté navigateur.
- **Défis :** `challenges.ts` émet un défi lié à `{ deviceId, purpose, subject }`, à usage unique, valable 60 s, gardé en mémoire.
- **Gateway :** une acceptation non `low` exige une assertion fraîche, liée à la demande vue (`expect.key`). Sinon : `confirm_required`.
- **OMP :** le téléphone ne propose plus Autoriser/Refuser sur une demande OMP. Il répond avec les options du dialogue, et à un `ask` à plusieurs questions par `session.answer`.
- **Boot id :** le snapshot porte un uuid par démarrage du daemon. Une opération sans `expect` déjà reçue par un autre démarrage n'est plus renvoyée.

**Tech Stack:** TypeScript strict, `node:crypto` (daemon), WebAuthn L2 du navigateur (`navigator.credentials`), React 19, vitest 4, Playwright 1.64.1 (authentificateur virtuel CDP), zod 3, `@ledge/seal` (`b64u`, `fromB64u`).

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md` (l. 43, 73 : RP ID = domaine, clé enregistrée à la liaison, vérifiée par le daemon). Autres références :
- feuille de route : `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md`, section « Reporté par le lot 5 » ;
- lot 5 : `docs/superpowers/plans/2026-10-20-ledge-mobile-relay-lot5-pwa.md` ;
- ancienne implémentation, à lire et non à copier (elle utilisait `@simplewebauthn`) : `git show 883656f:packages/ledge/src/daemon/challenges.ts`, `883656f:packages/ledge/test/soft-authenticator.ts`, `883656f:apps/mobile/e2e/risk.spec.ts`, et `883656f:apps/mobile/src/copy.ts` (`confirm.*`) ;
- maquette : `docs/mockups/ledge-mobile/source/Risk.dc.html`.

## Global Constraints

- **Dépendances :** aucune nouvelle. Ni `@simplewebauthn/*`, ni `cbor-x`. Daemon : `node:crypto`. Téléphone : l'API du navigateur, et `b64u` / `fromB64u` de `@ledge/seal`.
- **`webauthn.ts` n'importe que `node:crypto`**, pour que le faux PC de l'e2e puisse l'importer par chemin relatif.
- **RP :** `rpId = new URL(relayUrl).hostname`, `origin = new URL(relayUrl).origin`, avec `relayUrl` lu dans `readMobileConfig()`. Pas de RP si `relayUrl` n'est ni en `https:` ni sur `localhost`. Un credential dont le `rpId` diffère du RP courant compte comme absent.
- **Algorithmes :** `-7` (ES256) et `-257` (RS256), et rien d'autre. `pubKeyCredParams` dans cet ordre.
- **Drapeaux :** UP (`0x01`) et UV (`0x04`) sont exigés à l'enregistrement comme à l'assertion. AT (`0x40`) est exigé à l'enregistrement.
- **Défi :** 32 octets aléatoires en base64url, TTL `60_000` ms, usage unique. `consume` est synchrone et passe **avant tout `await`** du traitement.
- **Compteur :** il doit croître strictement, sauf s'il vaut 0 avant et après (authentificateurs sans compteur). Il est persisté après chaque assertion acceptée.
- **Ce qui exige une assertion :** `session.decide` avec `accept` ou `always` sur une demande dont le risque n'est pas `low` ; `session.reply` qui répond à une demande OMP (`source: 'rpc'`) dont le risque n'est pas `low`. Un refus (`deny`) n'en exige jamais.
- **Ordre des contrôles dans la gateway :** session inconnue → `stale` → capacité → assertion → `untypable`. Une demande changée n'use jamais un défi.
- **Idempotence :** l'assertion reste hors de l'empreinte d'opération. Un renvoi du même `op` rend le résultat enregistré. Chaque nouvelle tentative de vérification prend un nouvel `op`.
- **Compatibilité :** `PHONE_PROTOCOL` reste `1`. Tout nouveau champ est optionnel. Le téléphone n'offre une fonction que si le snapshot l'annonce (`snapshot.device` présent, capacité présente). Face à un daemon du lot 5, il garde « À accepter sur le PC ».
- **Textes :** en français, dans `apps/mobile/src/copy.ts`. Ceux de la confirmation reprennent `883656f:apps/mobile/src/copy.ts` (`confirm.*`). Le bouton suit `Risk.dc.html` : « Autoriser avec Face ID » sur iPhone et iPad, « Confirmer avec mon appareil » ailleurs.
- **Logs :** jamais de challenge, de signature, de clé ni de `clientDataJSON` dans un log. On journalise seulement le résultat (`assertion_invalid`…) et l'id de l'appareil.
- **Imports :** relatifs sans extension dans `apps/mobile`, en `.js` dans les paquets NodeNext.

## Reporté

| Origine | Point | Tâche |
| --- | --- | --- |
| lot 5 | une acceptation `high` reçoit `confirm_required` : WebAuthn | Tasks 2 à 5, 8, 9 |
| lot 5 | l'`OperationRegistry` du PC est en mémoire : un boot id dans le snapshot | Task 6 |
| lot 5 | `revokeOnRelay` n'est jamais réessayé | Task 11 |
| lot 5 | la déconnexion du téléphone ne prévient pas le PC | Task 11 |
| merge main (OMP) | le téléphone propose Autoriser/Refuser sur une demande OMP, refusée `not_offered` | Tasks 7, 10 |
| merge main (OMP) | un `ask` OMP à plusieurs questions n'est pas joignable depuis le téléphone | Tasks 7, 10 |

## Review Focus

1. **Le téléphone confirme avec Face ID, mais la demande change sur le PC pendant le geste.** Attendu : `stale`, et le défi n'est pas consommé. L'écran montre la nouvelle demande et une nouvelle confirmation repart d'un nouveau défi (Tasks 5 et 9).
2. **Le relais coupe juste après l'envoi d'un accord confirmé, puis le PC redémarre.** Attendu : l'accord (avec `expect`) est renvoyé avec le même `op`. Le nouveau démarrage refait les contrôles, l'assertion a expiré ou son défi est inconnu, la réponse est `assertion_invalid` ou `assertion_expired`, et rien n'est tapé. Le téléphone propose de reconfirmer (Tasks 5, 6 et 9).
3. **Le domaine du relais change** (`relayUrl` passe de `localhost` à `ledge.paradow.dev`). Attendu : le snapshot dit `device.confirm: false`, l'accord `high` redevient « À accepter sur le PC », et Connection propose « Protéger les accords » (Tasks 4 et 9).
4. **Une session OMP attend sur un dialogue `high`** (« Allow? » / « Deny »). Attendu : aucun bouton Autoriser/Refuser. Les options du dialogue s'affichent, et toute option exige la vérification de l'appareil, puisque le PC ne sait pas laquelle refuse (Tasks 5, 7 et 10).
5. **L'utilisateur annule Face ID, ou l'appareil n'a pas de verrouillage biométrique.** Attendu : « Vérification annulée. Rien n'a été envoyé. ». Aucun `op` n'est créé, le bouton Refuser reste disponible, et sans authentificateur de plateforme le téléphone garde « À accepter sur le PC » (Tasks 8 et 9).

---

### Task 1: protocole

**Files:**
- Modify : `packages/protocol/src/phone.ts`
- Test : `packages/protocol/test/phone.test.ts`

**Interfaces:**
- Produces, dans `phone.ts` :
  - `B64U = z.string().regex(/^[A-Za-z0-9_-]*$/)` ;
  - `CredentialSchema = { id: B64U.max(1_366), publicKey: B64U.max(2_048), alg: z.union([z.literal(-7), z.literal(-257)]), clientDataJSON: B64U.max(4_096), authenticatorData: B64U.max(4_096), transports: z.array(z.string().max(20)).max(8).optional() }` ;
  - `AssertionSchema = { id: B64U.max(1_366), clientDataJSON: B64U.max(4_096), authenticatorData: B64U.max(4_096), signature: B64U.max(1_024) }` ;
  - `ConfirmPurposeSchema = z.enum(['register', 'decide'])`. Le lot 6c y ajoutera `'launch'`.
- Le client gagne :
  - `{ type: 'confirm.prepare', purpose: ConfirmPurposeSchema, id: sessionId.optional(), expect: PhoneExpectSchema.optional() }`. Un seul objet, car `discriminatedUnion('type')` n'accepte pas deux entrées de même `type` : c'est la gateway qui refuse un `decide` sans `id` ni `expect` (`error invalid`, Task 5) ;
  - `{ type: 'credential.register', op, credential: CredentialSchema }` ;
  - `session.decide` et `session.reply` gagnent `assertion: AssertionSchema.optional()` ;
  - `{ type: 'session.answer', op, id, requestId: z.string().min(1).max(200), answers: [{ id: z.string().max(200), selected: z.array(z.string().max(2_000)).max(100), text: z.string().max(20_000).optional() }].max(50), cancel: z.literal(true).optional(), expect: PhoneExpect }`. Les bornes sont celles de `messages.ts:168` ;
  - `{ type: 'device.forget', op }`.
- Le serveur gagne `{ type: 'confirm.challenge', purpose, challenge: B64U.max(64), rpId: z.string().max(253), credentialId: B64U.max(1_366).optional(), expiresInMs: z.number().int().positive() }`.
- `snapshot` gagne `device: z.object({ confirm: z.boolean() }).optional()`, et `daemon` gagne `boot: z.string().uuid().optional()`.
- `CapabilitiesSchema` gagne `decide: z.boolean().optional()` (absent = `true`) et `questions: z.boolean().optional()` (absent = `false`).
- `OperationReasonSchema` gagne `'assertion_invalid'` et `'assertion_expired'`.

- [ ] **Step 1 : tests qui échouent.**
  - chaque nouveau message client et serveur passe `safeParse` avec des valeurs typiques ;
  - `alg: -8` est refusé, un `clientDataJSON` contenant `+` ou `=` aussi ;
  - un snapshot du lot 5 (sans `device`, sans `boot`, capacités sans `decide`) passe toujours ;
  - `session.answer` avec 51 réponses est refusé.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/protocol test` et `pnpm -r typecheck` → PASS.
- [ ] **Step 4 :** commit `feat(protocol): device confirmation, OMP answers and device forget for the phone`.

### Task 2: vérification WebAuthn et authentificateur logiciel

**Files:**
- Create : `packages/ledge/src/mobile/webauthn.ts`, `packages/ledge/test/mobile/soft-authenticator.ts`
- Test : `packages/ledge/test/mobile/webauthn.test.ts`

**Interfaces:**
- Produces, dans `webauthn.ts` (n'importe que `node:crypto`) :
  - `type Rp = { rpId: string; origin: string }` ;
  - `type DeviceCredential = { id: string; publicKey: string; alg: -7 | -257; counter: number; rpId: string; transports?: string[] }`. Les chaînes sont en base64url ;
  - `challengeOf(clientDataJSON: string): string | null` : le champ `challenge` du JSON décodé, ou null ;
  - `verifyRegistration(c: Credential, rp: Rp, challenge: string): { ok: true; credential: DeviceCredential } | { ok: false; why: string }` ;
  - `verifyAssertion(a: Assertion, cred: DeviceCredential, rp: Rp, challenge: string): { ok: true; counter: number } | { ok: false; why: string }`.
- Produces, dans `soft-authenticator.ts` : `softAuthenticator({ alg?: -7 | -257, uv?: boolean, up?: boolean })`, qui rend `{ create(rp, challenge): Credential; get(rp, challenge, opts?: { counter?: number }): Assertion }`. Il construit `clientDataJSON`, `authenticatorData` et la signature avec `node:crypto`. Le COSE de l'attested credential data peut être un octet fictif : le vérificateur ne le lit pas.
- `why` est un mot court (`type`, `challenge`, `origin`, `rp`, `flags`, `credential`, `signature`, `counter`, `alg`, `malformed`), destiné aux tests et aux logs.

- [ ] **Step 1 : tests qui échouent.**
  - **Enregistrement accepté :** ES256 et RS256 ; `credential.rpId === rp.rpId` et `counter` lu dans `authenticatorData`.
  - **Enregistrement refusé :**
    - `type` vaut `webauthn.get` ;
    - autre challenge, autre origine, `crossOrigin: true` ;
    - `rpIdHash` d'un autre domaine ;
    - UV absent, AT absent ;
    - l'id du credential dans `authenticatorData` diffère de `credential.id` ;
    - `authenticatorData` tronqué (< 37 octets, ou longueur d'id qui dépasse) → `malformed`, sans exception.
  - **Assertion acceptée :** signature valide, compteur 5 après 4 ; compteur 0 après 0.
  - **Assertion refusée :**
    - signature d'une autre clé ;
    - compteur 4 après 4, et 0 après 3 ;
    - `type` vaut `webauthn.create` ;
    - UP absent ;
    - `assertion.id` différent de `cred.id`.
  - `challengeOf` rend null sur un JSON invalide.
- [ ] **Step 2 :** implémenter.
  - Vérification de la signature : `crypto.verify('sha256', concat(authData, sha256(clientDataJSON)), { key: der(publicKey), format: 'der', type: 'spki' }, sig)`. Pour ES256, la signature est en DER (encodage par défaut de Node) ; pour RS256, en PKCS#1 v1.5.
  - Dans `authenticatorData` : `rpIdHash` occupe les octets 0 à 31, les drapeaux l'octet 32, le compteur les octets 33 à 36 (uint32 big-endian). À l'enregistrement suivent l'AAGUID (16 octets), la longueur de l'id (uint16 big-endian), puis l'id.
  - La comparaison du challenge et du `rpIdHash` passe par `timingSafeEqual`.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge exec vitest run test/mobile/webauthn.test.ts` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): verify WebAuthn registrations and assertions with node:crypto`.

### Task 3: les défis

**Files:**
- Create : `packages/ledge/src/mobile/challenges.ts`
- Test : `packages/ledge/test/mobile/challenges.test.ts`

**Interfaces:**
- Produces :
  - `type ChallengeBinding = { deviceId: string; purpose: 'register' | 'decide' | 'launch'; subject: string }`. `subject` vaut `''` pour `register`, `` `${sessionId}:${expectKey}` `` pour `decide`, et le `qid` pour `launch` (lot 6c) ;
  - `createChallengeStore(opts?: { now?: () => number; ttlMs?: number; max?: number })`, qui rend `{ issue(b: ChallengeBinding): string; consume(challenge: string, b: ChallengeBinding): 'ok' | 'expired' | 'mismatch' | 'unknown' }` ;
  - les valeurs par défaut : `CHALLENGE_TTL_MS = 60_000` et `max = 1_000`.

- [ ] **Step 1 : tests qui échouent.**
  - `issue` puis `consume` → `ok`. Un second `consume` → `unknown` ;
  - après 60 001 ms → `expired`, et le défi est retiré ;
  - lié à un autre appareil, à un autre `subject` ou à un autre `purpose` → `mismatch`, et le défi est retiré quand même ;
  - un second `issue` pour le même `deviceId`, `purpose` et `subject` évince le premier, qui donne alors `unknown` ;
  - au-delà de `max`, le plus ancien est évincé ;
  - un défi fait 43 caractères base64url (32 octets).
- [ ] **Step 2 :** implémenter (`randomBytes(32)`, une `Map`).
- [ ] **Step 3 :** vitest du fichier → PASS.
- [ ] **Step 4 :** commit `feat(mobile): single-use device challenges`.

### Task 4: la clé de l'appareil, enregistrée par le canal scellé

**Files:**
- Modify : `packages/ledge/src/mobile/{files.ts,service.ts,gateway.ts,operations.ts}`, `packages/ledge/src/daemon/server.ts` (câblage de la gateway, l. ~862)
- Test : `packages/ledge/test/mobile/{files,service,gateway,operations}.test.ts`

**Interfaces:**
- Consumes : `verifyRegistration`, `DeviceCredential`, `Rp` (Task 2) ; `createChallengeStore` (Task 3).
- Produces :
  - `ApprovedDeviceSchema` gagne `credential: DeviceCredentialSchema.optional()` (zod, mêmes champs que `DeviceCredential`) ;
  - `rpOf(relayUrl: string): Rp | null`, dans `webauthn.ts` ou dans `files.ts` ;
  - `MobileService` gagne `credential(deviceId: string): DeviceCredential | null` (null si le `rpId` diffère du RP courant) et `setCredential(deviceId: string, c: DeviceCredential): void` (persisté par `saveDevices`) ;
  - les deps de `createPhoneGateway` gagnent `rp: () => Rp | null`, `challenges: ChallengeStore`, `credential` et `setCredential`, ces deux derniers venant du service ;
  - `fingerprint(m)` (operations.ts) accepte un message sans `id`. Il devient `JSON.stringify([m.type, m.id ?? null, m.decision ?? null, m.note ?? null, m.text ?? null, m.expect?.key ?? null, m.credential?.id ?? null, m.requestId ?? null, m.answers ?? null])`.
- Comportement de la gateway :
  - `confirm.prepare` `register` : c'est une lecture. Avec un RP, elle rend `confirm.challenge { purpose: 'register', challenge, rpId, expiresInMs: 60_000 }`. Sans RP : `error invalid` avec `request: 'confirm.prepare'` ;
  - `credential.register` : c'est une écriture (registre d'opérations). On lit `challengeOf` puis `consume({ deviceId, 'register', '' })` : `expired` → `rejected assertion_expired` ; autre résultat que `ok` → `rejected assertion_invalid`. Ensuite `verifyRegistration` : échec → `assertion_invalid` ; succès → `setCredential`, puis `applied`, puis un nouveau snapshot à cet appareil ;
  - le snapshot porte `device: { confirm: credential(deviceId) !== null }`.

- [ ] **Step 1 : tests qui échouent.**
  - **files :** un `devices.json` du lot 5 se lit toujours ; un appareil avec `credential` fait l'aller-retour sans perte ;
  - **service :** `credential()` rend null quand `relayUrl` passe de `http://localhost:5173` à `https://ledge.paradow.dev` ;
  - **gateway :**
    - `confirm.prepare register`, puis `credential.register` signé par `softAuthenticator` → `applied`, et le snapshot suivant dit `device.confirm: true` ;
    - le même `op` renvoyé → même `applied`, et `setCredential` n'est appelé qu'une fois ;
    - un défi d'un autre appareil → `assertion_invalid` ;
    - le défi expiré → `assertion_expired` ;
    - `relayUrl` en `http://192.168.1.10` → `confirm.prepare` rend `error invalid`, et `device.confirm` vaut false ;
  - **operations :** l'empreinte d'un `credential.register` dépend de `credential.id`, pas de la signature.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge exec vitest run test/mobile` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): a device registers its passkey through the sealed channel`.

### Task 5: accepter avec une assertion

**Files:**
- Modify : `packages/ledge/src/mobile/gateway.ts` (`precheck`, l. ~97-118 ; lectures)
- Test : `packages/ledge/test/mobile/gateway.test.ts`

**Interfaces:**
- Consumes : Tasks 2 à 4.
- `confirm.prepare` `decide` : une lecture. Sans `id` ou sans `expect` : `error invalid`. La session doit exister (sinon `error unknown_session`). Elle rend `confirm.challenge { purpose: 'decide', challenge, rpId, credentialId, expiresInMs }`, lié à `` `${id}:${expect.key}` ``. Sans credential : `error invalid`.
- `needsAssertion(msg, s)` : vrai pour `session.decide` avec `decision !== 'deny'` sur une demande `riskOf(s)?.risk !== 'low'`, et pour `session.reply` dont l'`expect` désigne une demande `source: 'rpc'` non `low`.
- Dans `precheck`, après `stale` et avant `untypable` :
  - pas de credential → `confirm_required` ;
  - pas d'assertion → `confirm_required` ;
  - `consume(challengeOf(clientDataJSON), { deviceId, 'decide', id:key })` : `expired` → `assertion_expired`, autre résultat que `ok` → `assertion_invalid` ;
  - `verifyAssertion` échoue → `assertion_invalid` ;
  - sinon `setCredential({ ...cred, counter })`, avant l'envoi au front local.

- [ ] **Step 1 : tests qui échouent.**
  - `confirm.prepare` `decide` sans `expect` → `error invalid` ;
  - accept `high` avec assertion valide → `applied`, et le front local reçoit `session.decide` **sans** champ `assertion` ;
  - `always` `high` sans assertion → `confirm_required` ;
  - `deny` `high` sans assertion → `applied` ;
  - accept `low` sans assertion → `applied` (inchangé) ;
  - `expect.key` périmée avec une assertion valide → `stale`, et le défi reste utilisable ensuite ;
  - assertion liée à une autre demande (autre `expect.key`) → `assertion_invalid` ;
  - la même assertion rejouée sous un nouvel `op` → `assertion_invalid` (défi consommé) ;
  - renvoi du même `op` après `applied` → `applied` rejoué, et `verifyAssertion` n'est pas rappelée ;
  - compteur rejoué → `assertion_invalid`, et le compteur persisté ne bouge pas ;
  - `session.reply` à une demande OMP `rpc` `high` sans assertion → `confirm_required` ; avec assertion → transmis ;
  - aucun log ne contient le challenge ni la signature.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** vitest `test/mobile` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): a high-impact accept from the phone carries a fresh device assertion`.

### Task 6: boot id et renvoi des opérations

**Files:**
- Modify : `packages/ledge/src/mobile/gateway.ts` (deps `boot: string`), `packages/ledge/src/daemon/server.ts` (`randomUUID()` au démarrage), `apps/mobile/src/state/{operations.ts,store.ts}`
- Test : `packages/ledge/test/mobile/gateway.test.ts`, `apps/mobile/test/state/{operations,store}.test.ts`

**Interfaces:**
- Produces :
  - `snapshot.daemon.boot` ;
  - `Op` gagne `boot?: string`, la valeur du boot connu quand l'op a reçu `received` ou un statut final ;
  - `resendable(op: Op, boot: string | null, now: number): boolean`.
- Règles de `resendable` :
  - une op finie ne repart jamais ;
  - une op avec `expect` repart toujours ;
  - une op sans `expect` jamais reçue repart si elle a moins de `RESEND_MAX_MS` ;
  - une op sans `expect` reçue repart seulement si `op.boot === boot` et qu'elle a moins de `RESEND_MAX_MS`. Sinon elle reste `uncertain`.
- `store.onReady()` ne renvoie que les ops avec `expect`. Les autres partent à la réception du snapshot suivant, qui donne `boot`.

- [ ] **Step 1 : tests qui échouent.**
  - **daemon :** deux gateways créées avec des boots différents annoncent chacune le sien ;
  - **téléphone :**
    - `session.interrupt` reçu sous le boot A, puis un snapshot sous le boot B → l'op n'est pas renvoyée et reste `uncertain` ;
    - même cas sous le boot A → elle est renvoyée ;
    - `session.decide` avec `expect` reçu sous A, snapshot sous B → renvoyée ;
    - un snapshot sans `boot` (daemon du lot 5) → comportement du lot 5.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge exec vitest run test/mobile` et `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `fix(mobile): never replay an operation the restarted PC may already have applied`.

### Task 7: OMP côté daemon

**Files:**
- Modify : `packages/ledge/src/mobile/{gateway.ts,project.ts}` (capacités)
- Test : `packages/ledge/test/mobile/{gateway,project}.test.ts`

**Interfaces:**
- Capacités du snapshot : `omp: { freeTextAnswer: false, decide: false, questions: true }`. Les autres outils : `decide: true`, `questions: false`.
- `session.answer` entre dans la liste blanche comme écriture :
  - `precheck` : session inconnue → `unknown_session` ; `backendOf(s) !== 'omp-rpc'` → `not_offered` ; `stale` si `pendingKey ≠ expect.key` ; `pending.requestId !== msg.requestId` → `stale` ;
  - `local()` construit `{ type: 'session.answer', id, requestId, answers, cancel }` champ par champ, sans `expect` ni `op`.
- `session.decide` sur une session OMP est refusée `not_offered` dans `precheck`, avant le défi.

- [ ] **Step 1 : tests qui échouent.**
  - le snapshot annonce les capacités ci-dessus ;
  - `session.answer` sur une session OMP qui attend un `ask` de 2 questions → le front local reçoit le message, sans champ inconnu ;
  - `requestId` d'un `ask` précédent → `stale` ;
  - `session.answer` sur une session Claude → `not_offered` ;
  - `session.decide` accept sur OMP → `not_offered`, sans `confirm_required` ;
  - l'empreinte change quand une réponse change.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** vitest `test/mobile` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): OMP requests are answered from the phone with their own options and questions`.

### Task 8: WebAuthn côté téléphone

**Files:**
- Create : `apps/mobile/src/link/webauthn.ts`
- Modify : `apps/mobile/src/state/store.ts`
- Test : `apps/mobile/test/link/webauthn.test.ts`, `apps/mobile/test/state/store.test.ts`

**Interfaces:**
- Produces, dans `webauthn.ts` :
  - `platformAvailable(): Promise<boolean>` : `PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable()`, false en cas d'erreur ;
  - `createCredential(ch: { challenge: string; rpId: string }, user: { label: string }): Promise<Credential | 'cancelled' | 'unsupported'>`. Paramètres : `rp: { id: rpId, name: 'Ledge' }`, `user.id` = 16 octets aléatoires, `user.name` = label, `pubKeyCredParams` −7 puis −257, `authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' }`, `attestation: 'none'`, `timeout: 60_000`. `getPublicKey()` ou `getPublicKeyAlgorithm()` absent ou null → `'unsupported'` ;
  - `getAssertion(ch: { challenge: string; rpId: string; credentialId: string }): Promise<Assertion | 'cancelled'>`, avec `allowCredentials: [{ type: 'public-key', id }]` et `userVerification: 'required'`. `NotAllowedError` ou `AbortError` → `'cancelled'`.
- Le store gagne :
  - `prepareConfirm(req: { purpose: 'register' } | { purpose: 'decide'; id: string; expect: PhoneExpect }): Promise<ConfirmChallenge>`. La promesse se résout sur le `confirm.challenge` suivant, et elle est rejetée sur `error` ou après 10 s ;
  - `registerCredential(c: Credential): OperationId` ;
  - `decide(id, decision, opts)` et `reply(id, text, opts)` acceptent `opts.assertion` ;
  - l'état gagne `device: { confirm: boolean } | null` (null = daemon du lot 5) et `capabilities` avec les nouveaux champs.

- [ ] **Step 1 : tests qui échouent**, avec un `navigator.credentials` simulé.
  - `createCredential` convertit les `ArrayBuffer` en base64url, et `getPublicKey() === null` → `'unsupported'` ;
  - un `NotAllowedError` → `'cancelled'`, sans exception ;
  - `prepareConfirm` se résout sur le bon `confirm.challenge`, et rejette après 10 s sans réponse ;
  - `decide` avec assertion envoie le champ `assertion` ; un renvoi après reconnexion renvoie le même message, assertion comprise ;
  - un snapshot avec `device` le met dans l'état ; sans `device`, l'état vaut `null`.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): the phone creates its passkey and signs high-impact accepts`.

### Task 9: écrans de confirmation

**Files:**
- Modify : `apps/mobile/src/screens/{DecisionFooter.tsx,RiskConfirm.tsx,Connection.tsx,Compare.tsx}`, `apps/mobile/src/copy.ts`
- Test : `apps/mobile/test/screens/{risk,request-detail,app}.test.tsx`

**Interfaces:**
- Consumes : Task 8.
- **Liaison :** après l'approbation (écran Compare réussi) et quand `state.device?.confirm === false` et `platformAvailable()`, une étape « Protéger les accords » propose un bouton. `createCredential` est appelé **dans le gestionnaire du tap**, après un `prepareConfirm` lancé dès l'affichage de l'étape (le défi est prêt avant le tap). « Plus tard » mène à l'inbox.
- **Connection :** une ligne « Accords à impact élevé » montre « Protégés par cet appareil » ou un bouton « Protéger les accords », selon le même mécanisme.
- **DecisionFooter :** si `item.risk === 'high'` et `state.device?.confirm` :
  - `RiskConfirm` devient la carte de `Risk.dc.html` : titre « Confirmer l'autorisation », note `confirm.note`, bouton « Autoriser avec Face ID » (iPhone/iPad) ou « Confirmer avec mon appareil », puis Refuser ;
  - le défi est préparé à l'ouverture de la carte. Le tap appelle `getAssertion`, puis `decide(…, { assertion })` avec un nouvel `op` ;
  - `confirm_required`, `assertion_invalid` ou `assertion_expired` reçus → message `confirm.expired` ou `confirm.failed`, et bouton `confirm.retry`, qui prépare un nouveau défi.
- Sans `device` (daemon du lot 5), ou sans authentificateur de plateforme : on garde `onPc` / `onPcHint` du lot 5.
- Textes : `confirm.*` de `883656f`, plus `confirm.goApple: 'Autoriser avec Face ID'`, `confirm.heading: 'Confirmer l'autorisation'`, `enroll.title: 'Protéger les accords'`, `enroll.body: 'Face ID ou le code de ce téléphone sera demandé pour autoriser une commande à impact élevé.'`, `enroll.go: 'Protéger les accords'`, `enroll.later: 'Plus tard'`, `enroll.done: 'Protégés par cet appareil'`, `enroll.row: 'Accords à impact élevé'`.

- [ ] **Step 1 : tests qui échouent.**
  - demande `high` avec `device.confirm` → bouton « Confirmer avec mon appareil ». Le tap envoie `session.decide` avec `assertion` ;
  - l'annulation de la vérification → « Vérification annulée. Rien n'a été envoyé. », et aucune op créée ;
  - `assertion_expired` → « La vérification a expiré. Recommencez. », et « Réessayer » redemande un défi ;
  - `device: null` → « À accepter sur le PC » (lot 5) ;
  - UA iPhone → « Autoriser avec Face ID » ;
  - Connection sans credential → « Protéger les accords » ; avec credential → « Protégés par cet appareil » ;
  - le défi arrive après le tap → le bouton reste désactivé avec `confirm.preparing`, puis le tap suivant marche.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): confirm a high-impact accept with the device, and protect accepts at pairing`.

### Task 10: répondre à une demande OMP

**Files:**
- Modify : `apps/mobile/src/screens/{RequestDetail.tsx,QuestionForm.tsx,DecisionFooter.tsx}`, `apps/mobile/src/model/requests.ts`, `apps/mobile/src/state/store.ts`, `apps/mobile/src/copy.ts`
- Test : `apps/mobile/test/screens/request-detail.test.tsx`, `apps/mobile/test/model/requests.test.ts`

**Interfaces:**
- Consumes : capacités `decide` et `questions` (Task 7) ; le store gagne `answer(id: string, requestId: string, answers: Answer[], opts: { expect: PhoneExpect; cancel?: boolean }): OperationId`.
- `capabilities[tool].decide === false` → pas d'Autoriser/Refuser. Une demande avec `options` montre une liste d'options. Chaque option envoie `session.reply` avec son libellé et `expect`. Si la demande est `high`, la carte de confirmation (Task 9) passe d'abord.
- `pending.questions` présent et `capabilities[tool].questions` → `QuestionForm` en mode multi-questions :
  - une section par question (`header` ou `question`), choix unique ou multiple selon `multi` ;
  - le bouton « Envoyer les réponses » n'est actif que si chaque question a un choix ;
  - « Annuler la demande » envoie `cancel: true`.
- Textes : `answers.send: 'Envoyer les réponses'`, `answers.cancel: 'Annuler la demande'`, `answers.missing: (n: number) => \`${n} question${n > 1 ? 's' : ''} sans réponse\``.

- [ ] **Step 1 : tests qui échouent.**
  - session OMP avec dialogue à options → aucun bouton « Autoriser », et le tap sur une option envoie `session.reply` avec `expect` ;
  - dialogue OMP `high` → l'option passe par la confirmation ;
  - `ask` de 2 questions (dont une `multi`) → envoi désactivé tant qu'une question est sans choix, puis `session.answer` avec `requestId`, les bons `selected` et `expect` ;
  - `stale` → le formulaire garde les choix et montre `decide.changed` ;
  - une session Claude est inchangée.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): answer OMP dialogs and multi-question asks from the phone`.

### Task 11: cycle de vie de l'appareil

**Files:**
- Modify : `packages/ledge/src/mobile/{gateway.ts,service.ts,files.ts}`, `apps/mobile/src/state/store.ts`, `apps/mobile/src/screens/Connection.tsx`, `apps/mobile/src/copy.ts`
- Test : `packages/ledge/test/mobile/{gateway,service}.test.ts`, `apps/mobile/test/screens/app.test.tsx`

**Interfaces:**
- `device.forget` : une écriture. La gateway répond `applied`, puis appelle `revoke(deviceId)` du service. L'ordre compte : la réponse part avant que le canal soit fermé.
- Téléphone : « Se déconnecter » et « Refaire la liaison » envoient d'abord `device.forget`, attendent `applied` au plus 5 s, puis effacent l'état local. Sans `applied` : effacement quand même, et une note `forget.pending: 'Le PC n'a pas confirmé. Retirez ce téléphone dans Ledge sur le PC, section Accès mobile.'`.
- PC : `revokeOnRelay` met le pair dans `mobile/revocations.json` (0600, `{ peer, at }[]`) avant l'appel. Il l'en retire sur une réponse 2xx ou 404, le garde sur 401, 429, 5xx et sur une erreur réseau. Il réessaie toute la liste à chaque passage du lien à `online`. Une entrée de plus de 30 jours est abandonnée et journalisée.

- [ ] **Step 1 : tests qui échouent.**
  - **gateway :** `device.forget` → `applied` envoyé, puis l'appareil disparaît de `devices.json`. Un renvoi du même `op` ne lève rien ;
  - **service :**
    - relais en 503 → l'entrée reste ; le lien repasse `online` → nouvel essai, réponse 200 → l'entrée est retirée ;
    - une entrée de 31 jours est abandonnée ;
    - un daemon redémarré relit le fichier ;
  - **téléphone :** « Se déconnecter » en ligne → `device.forget` puis l'écran de connexion. Hors ligne → la note `forget.pending`.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** vitest `test/mobile` et `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `fix(mobile): a phone that signs out is removed from the PC, and relay revocations are retried`.

### Task 12: de bout en bout, et feuille de route

**Files:**
- Create : `apps/mobile/e2e/confirm.spec.ts`
- Modify : `apps/mobile/test/fakePc.ts` (il importe `../../../packages/ledge/src/mobile/webauthn.ts` et `challenges.ts`), `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md`
- Test : `apps/mobile/e2e/confirm.spec.ts`

**Interfaces:**
- Consumes : le harnais du lot 5 (`e2e/harness.ts`, `PUBLIC_URL = http://localhost:<port>`, donc `rpId = 'localhost'`).
- Le faux PC sert `confirm.prepare`, `credential.register` et `session.decide` avec assertion, avec les vrais `verifyRegistration` et `verifyAssertion`.

- [ ] **Step 1 : `confirm.spec.ts`, avec Chromium**, et un authentificateur virtuel CDP (`WebAuthn.enable`, puis `WebAuthn.addVirtualAuthenticator` avec `{ protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true }`).
  1. Lier le téléphone. L'étape « Protéger les accords » enregistre la passkey, et le faux PC la range.
  2. Une demande `high` → « Confirmer avec mon appareil ». Le faux PC reçoit une assertion valide → `applied`.
  3. Le point 1 du Review Focus : la demande change entre la préparation et le tap → `stale`, puis une reconfirmation réussit.
  4. `isUserVerified: false` (`WebAuthn.setUserVerified`) → `assertion_invalid` → « Réessayer ».
  5. Aucune erreur dans la console.
  - WebKit : ignoré comme au lot 5 (`webkit.ts`).
- [ ] **Step 2 :** feuille de route : le lot 6a est inscrit comme fait, avec ses décisions :
  - la vérification sans bibliothèque ;
  - la confiance par le canal scellé (attestation `none`) ;
  - le RP = hôte de `relayUrl` ;
  - le boot id ;
  - OMP sans Autoriser/Refuser.
- [ ] **Step 3 :** suite complète `pnpm -r test`, `pnpm -r typecheck`, `pnpm --filter @ledge/mobile build` et `test:e2e`. Les échecs connus restent les 2 tests tmux et les instabilités de charge de l'overlay et du desktop, qui passent seuls.
- [ ] **Step 4 :** commit `test(mobile): device confirmation end to end with a virtual authenticator; roadmap updated`.

## Hors de ce lot

- **Lot 6b :** Web Push.
- **Lot 6c :** le chat « Demander à Ledge » multi-fil. Il réutilise `challenges.ts` (`purpose: 'launch'`) et la carte de confirmation.
- **Lot 7 :** le domaine, Railway, `LEDGE_RELAY_WEB_DIR`, `build.json` dans `release.yml`, `scripts/set-version.mjs`, et un essai sur un vrai iPhone (Face ID, passkey iCloud).
- **Restent ouverts :** la `Max-Age` du cookie, WebKit en local, et le drapeau `other` pour les réponses libres sur plusieurs lignes.

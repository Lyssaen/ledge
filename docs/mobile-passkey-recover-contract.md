# Contrat : reconnexion par passkey après une réinstallation

Ce contrat décrit le protocole et le daemon pour dev-front, côté téléphone (`apps/mobile`) et côté Desktop.

Sources :
- conception validée le 2026-11-10 : `missions/passkey-reinstall/CONCEPTION.md` (règles 1 et 2, §4) ;
- maquette validée le même jour : `docs/mockups/ledge-mobile-passkey/passkey-reinstall.html`, branche `design/passkey-reinstall`, avec les questions P1 à P15 de `QUESTIONS.md`.

Les écrans cités (1 a, 2 b, 6 d…) sont ceux de la maquette. Ce contrat ne crée aucun texte : les textes et leurs clés sont dans la fiche de passation de la maquette.

## 1. Vue d'ensemble

Une app réinstallée a perdu sa clé d'appareil, mais sa passkey a survécu dans le trousseau iCloud. Elle se reconnecte ainsi :
1. Elle crée une nouvelle clé d'appareil.
2. Elle prouve, avec la passkey, qu'elle est l'appareil que le PC connaît.
3. Le PC la remet à la place de l'ancienne entrée : même nom, mêmes réglages, même passkey, même historique de chat. Il n'y a ni code, ni validation sur le PC. Desktop est prévenu après coup.

Le relais voit passer ces trames, mais elles ne lui permettent rien :
- le défi signé lie la clé du PC et la nouvelle clé (règle 1) ;
- le téléphone vérifie dans le `userHandle` l'empreinte de la clé du PC avant d'envoyer quoi que ce soit (règle 2).

## 2. Les trames

Ce sont des trames `SealedFrameSchema` de `packages/protocol/src/relay.ts`. Elles sont **non scellées**, comme celles de l'appairage, et passent par `send` / `deliver` vers `pc`.

| Trame | Sens | Champs |
|---|---|---|
| `recover_start` | téléphone → PC | `d` : la nouvelle clé d'appareil (comme `pair_reveal.d`).<br>`n` : un nonce de 32 octets (`randomNonce()`).<br>`model?` : `iPhone`, `iPad`… (40 car. au plus, P14). |
| `recover_offer` | PC → téléphone | `pc` : la clé du PC.<br>`n` : son nonce, à usage unique, valable 60 s.<br>`name?` : le nom du PC (`WSL`), pour les écrans 1 c et 1 d. |
| `recover_proof` | téléphone → PC | `assertion { id, clientDataJSON, authenticatorData, signature }` : en base64url, aux mêmes bornes que `AssertionSchema`.<br>`userHandle` : en base64url. |
| `recover_ok` | PC → téléphone | `name?` : le nom que l'appareil garde sur le PC. |
| `recover_no` | PC → téléphone | `why` : la raison du refus.<br>`device?` : le nom de l'appareil visé (`revoked`, `connected`).<br>`revokedAt?` : la date de révocation, ISO.<br>`retryInMs?` : le délai avant un nouvel essai (`rate`). |

Constante `RECOVER_TTL_MS = 60_000` : c'est la durée du nonce du PC. Le téléphone attend la réponse aussi longtemps, puis affiche 2 i.

## 3. Le parcours du téléphone

1. **Avant tout, le téléphone vérifie que le PC est en ligne sur le relais**, comme le fait aujourd'hui l'écran Compare.
   - S'il n'y est pas : écran 2 d, sans Face ID.
2. **Il envoie** `recover_start { d, n, model }` et attend `recover_offer` pendant au plus `RECOVER_TTL_MS`.
   - Un `recover_no` à ce moment peut valoir `rate`, `blocked` ou `failed`.
3. **Il calcule le défi** `c = recoverChallenge({ pcPublicKey: offer.pc, devicePublicKey: d, pcNonce: offer.n, deviceNonce: n })`, exporté par `@ledge/seal`.
4. **Il lance** `navigator.credentials.get()` découvrable, avec :
   - `challenge` : `c`, décodé en octets ;
   - `rpId` : l'hôte du relais ;
   - `userVerification: 'required'` ;
   - pas d'`allowCredentials`.
   - S'il reçoit `NotAllowedError` : écran 2 a.
5. **Il lit `response.userHandle`** et appelle `userHandleMatches(userHandle, offer.pc)` :
   - `'old'` : la passkey a été créée avant la reconnexion, son `user.id` ne commence pas par « L1 ». Écran 2 c ; **rien n'est envoyé**.
   - `'other'` : la passkey a été créée pour une autre clé de PC. Écran 2 e ; rien n'est envoyé.
     - Les deux empreintes affichées sont `digestTag(userHandleDigest(userHandle))` pour celle de la passkey, et `digestTag(await keyDigest(offer.pc))` pour celle de la clé reçue.
   - `'ok'` : il continue.
6. **Il envoie** `recover_proof { assertion, userHandle }` et attend `recover_ok` ou `recover_no` pendant au plus `RECOVER_TTL_MS`.
7. **Sur `recover_ok`** :
   - il garde sa nouvelle clé ;
   - il épingle `offer.pc` comme après un appairage (`PinnedPc`) ;
   - il envoie le `hello` habituel ;
   - il affiche 1 d, puis l'étape des notifications : le push est à refaire.
8. **Rien n'est épinglé** tant que `recover_ok` n'est pas reçu. Un « Annuler » abandonne sans rien garder.

| `why` reçu | Écran | Données |
|---|---|---|
| `revoked` | 2 b | `revokedAt` pour « le 3 nov. » ; absent si la révocation date de plus de 90 jours, ou si la passkey est inconnue du PC. |
| `connected` | 2 f | `device`, pour « celle de l'iPad ». |
| `rate` | 2 g | `retryInMs`, pour « dans 42 min ». |
| `blocked` | 2 h | Aucune. |
| `failed` | 2 i | Aucune. Ce refus couvre un nonce périmé ou réutilisé et une preuve qui ne se vérifie pas. |
| délai dépassé | 2 i | Aucune. |

Les raisons `none`, `old`, `offline`, `otherPc` et `timeout` existent dans `RecoverWhySchema` pour nommer les écrans du téléphone. **Le PC ne les envoie jamais** : `RecoverRefusalSchema` ne garde que `revoked`, `connected`, `rate`, `blocked` et `failed`.

## 4. Ce que fait le PC

Le code est dans `packages/ledge/src/mobile/recover.ts`, branché dans `service.ts`.

**À la réception de `recover_start`**, le PC vérifie, dans cet ordre :
1. que la reconnexion n'est pas bloquée. Sinon : `blocked` ;
2. qu'il n'y a pas déjà eu 5 `recover_start` dans l'heure sur le compte. Sinon : `rate`, avec `retryInMs` ;
3. qu'il n'y a pas déjà 3 reconnexions en attente d'une preuve. Sinon : `failed`. Il y en a au plus une par pair : un nouveau `recover_start` remplace la précédente ;
4. que le nonce `n` fait 32 octets. Sinon : `failed`.

Ces contrôles ne laissent rien attendre : l'essai est alors compté et sa place prise **avant** la lecture de la clé, si bien que des `recover_start` livrés ensemble se voient les uns les autres et ne dépassent ni les 5 par heure ni les 3 en attente.

5. Le PC vérifie enfin que la clé `d` est un point P-256.

Si un `recover_start` plus récent du même pair, un nouveau `welcome` ou l'arrêt du service a pris la place pendant cette lecture, cette demande ne reçoit **aucune** réponse, ni offre ni refus : seul le plus récent répond. Sinon, une clé illisible reçoit `failed` (l'essai reste compté), et une clé valide `recover_offer`.

**À la réception de `recover_proof`** :
1. Le nonce est consommé **avant toute vérification**. S'il est absent, ou si les 60 s sont passées : `failed`. Ce cas n'est pas compté comme un échec.
2. Si la reconnexion est bloquée : `blocked`.
3. Le PC cherche l'appareil par l'id du credential, pour le relais courant.
   - Il ne le trouve pas : `revoked`. Le refus porte `device` et `revokedAt` si une pierre tombale de moins de 90 jours existe, sinon il est nu. **Ce cas n'est pas compté comme un échec** : le relais ne peut pas bloquer le compte en envoyant n'importe quoi.
4. Le PC **recalcule le défi avec sa propre clé** et vérifie l'assertion : signature, origine, `rpId`, drapeaux UP et UV, compteur. Il vérifie ensuite que le `userHandle` porte l'empreinte de sa clé.
   - Sinon : le PC **compte un échec**. Au 3e échec, il bloque la reconnexion pour **tout le compte** (P12) et répond `blocked` ; avant le 3e, il répond `failed`.
   - Le `userHandle` n'est pas signé par WebAuthn : côté PC, c'est un contrôle de cohérence. C'est le défi signé qui lie la clé du PC.
5. Ces vérifications attendent la cryptographie. Après la dernière attente, **sans plus rien attendre jusqu'à la remise en place**, le PC relit :
   - le blocage, qu'une autre preuve a pu poser entre-temps : `blocked` ;
   - la passkey de l'appareil, qu'une réinscription a pu changer entre-temps. Si l'appareil ou sa passkey n'est plus celle qui a signé : `failed`, sans compter d'échec.
6. Si l'appareil visé est **connecté** à ce moment : `connected`, avec `device`. Desktop est prévenu (voir § 5).
   - Ce refus n'est donné qu'à une preuve valide : sans la passkey, personne ne peut faire apparaître une alerte sur le PC.
7. Sinon, le PC remet l'appareil en place et répond `recover_ok { name }`. Les échecs passés sont oubliés.

**La remise en place, dans `~/.ledge/devices.json`** :
- La nouvelle entrée prend comme id l'empreinte de la nouvelle clé, et `lastPeer` / `peers` sont le pair de la nouvelle app.
- Elle **hérite** de l'ancienne :
  - `label`, `name`, `kind`, `prefs`, `approvedAt` ;
  - le credential, avec son compteur mis à jour.
- Elle **n'hérite pas** de `push`, ni des anciens pairs, ni de `lastSeenAt`, ni de `refused`.
- Elle porte `recovering { at, model? }`, que le PC garde pour lui. Au premier `hello` de la nouvelle clé, il devient
  `recovered { at, model?, pending: true }` et Desktop est prévenu (§ 5). Un téléphone qui n'a pas su garder la clé du PC
  (écran 2 j) ne dit jamais `hello` : Desktop n'annonce donc pas un appareil qui n'est pas relié.
- L'historique du chat `~/.ledge/mobile/chat/<ancien id>` est **renommé** vers le nouvel id, avant l'écriture de la liste :
  - si le dossier ne peut pas être déplacé, ou si le nouvel id en a déjà un, rien ne change et la réponse est `failed` ;
  - si la liste ne peut pas être écrite, le dossier est remis sous l'ancien id, l'ancien appareil reste approuvé, et la réponse est `failed`.
  - Aucun de ces cas ne compte comme un échec.
- L'ancienne entrée disparaît :
  - ses pairs reçoivent `denied` et sont révoqués sur le relais, comme pour une révocation ;
  - **aucune pierre tombale n'est créée** : la passkey vit dans la nouvelle entrée.

**« Réessayer » après un `recover_ok` que le téléphone n'a pas pu garder (2 j)** :
- Chaque `recover_start` compte dans les 5 essais par heure, « Réessayer » compris : 2 g s'applique au-delà.
- Le téléphone refait une clé d'appareil et recommence. L'appareil, remis sous la première nouvelle clé mais jamais relié,
  n'est pas connecté : il est remis en place une seconde fois, sous la nouvelle clé, avec son historique. Le pair de l'app
  n'est pas révoqué, puisqu'il est celui de la nouvelle entrée. Desktop n'est prévenu qu'une fois, au `hello`.
- Une question encore en cours pour l'ancien id au moment de la remise en place est arrêtée, comme à un redémarrage du
  daemon : la conversation suit l'appareil, mais la réponse de cette question est perdue.

**Mémoire de la reconnexion** : `~/.ledge/recovery.json`, en mode 0600. Il contient :
- les pierres tombales `{ credentialId, device, revokedAt }`, gardées 90 jours ;
- les heures des essais et des échecs ;
- le blocage `{ since, failures }`.

Révoquer un appareil qui avait une passkey crée sa pierre tombale.

## 5. Desktop : ce qui change dans `mobile` et les nouveaux messages

Dans `MobileStateSchema` (`packages/protocol/src/mobile.ts`), chaque appareil gagne trois champs :

| Champ | Sens | Écran |
|---|---|---|
| `recover?: true` | Sa passkey peut le ramener sans code. | — |
| `recovered?: { at, model?, pending? }` | Il est revenu avec sa passkey.<br>- Avec `pending` : l'étiquette « Reconnecté », l'encadré, et le point sur l'onglet (P10).<br>- Sans `pending` : seulement la trace « reconnecté avec sa passkey le … ». | 6 a, 6 c |
| `refused?: { at, model? }` | Un autre appareil a tenté de prendre sa place pendant qu'il était connecté. Le champ reste jusqu'à « Compris ». | 6 d |

Au niveau de l'état entier, `recovery?: { blocked?: { since, failures } }` porte le bloc « Reconnexion par passkey bloquée » (écran 6 e).

`model` permet à Desktop d'écrire « maintenant un iPhone » quand le modèle diffère de l'appareil (P14). Ce cas n'est pas dessiné tant que P14 n'est pas tranché.

**Messages du daemon vers les fronts locaux** (`ServerMessageSchema`) :
- `mobile.recovery { event: 'recovered' | 'refused' | 'blocked', id?, at }` arrive pour le toast (5 a, 5 b) : `refused` et
  `blocked` au moment même, `recovered` au premier `hello` de l'appareil remis en place (`at` reste l'heure de la remise en
  place). Il n'y a pas de toast dessiné pour `blocked` : seul l'encadré 6 e existe.
- La trace durable, elle, arrive avec le `mobile` qui suit.

**Messages des fronts locaux vers le daemon** (`ClientMessageSchema`) :

| Message | Bouton |
|---|---|
| `mobile.device.ack { id, what: 'recovered' }` | « C'était bien moi » : `pending` tombe, `recovered` reste. |
| `mobile.device.ack { id, what: 'refused' }` | « Compris » : `refused` tombe. |
| `mobile.recovery.unblock` | « Débloquer » : le blocage et les échecs sont oubliés. |
| `mobile.device.revoke` (inchangé) | « Révoquer » : crée aussi la pierre tombale. |

## 6. Réinscription (« Mettre à jour la passkey », écran 4)

Le message existant `credential.register` gagne `userId?`, en base64url. C'est le `user.id` que le téléphone a donné à `create()`.

**Le téléphone :**
1. Il demande le défi `confirm.prepare { purpose: 'register' }`, comme aujourd'hui.
2. Il appelle `create()` avec :
   - `user.id = await recoveryUserId(clé du PC épinglée)`, exporté par `@ledge/seal`, soit 34 octets : « L1 », l'empreinte, puis de l'aléa ;
   - `residentKey: 'required'` (décision 7).
3. Il envoie `credential.register { op, credential, userId: b64u(user.id) }`.

**Le PC :**
- Il remplace la passkey de l'appareil, comme aujourd'hui.
- Il la marque `recover` si `userId` porte l'empreinte de **sa** clé. Sinon il l'enregistre sans la marque et note la différence dans son journal.

Le snapshot du téléphone porte `device.recover: true` quand la passkey enregistrée est marquée. Le téléphone en déduit :
- `confirm && !recover` : la carte 4 a, et la ligne « Reconnexion sans code » de 4 g (« à mettre à jour ») ;
- `recover` : la ligne « Prête » de 4 h.

**Point de sécurité, pour le lead.** Remplacer une passkey ne demande aujourd'hui aucune assertion de l'ancienne : il suffit d'un canal scellé de l'appareil. C'était déjà le cas avant ce changement, et ce changement ne le modifie pas. L'exiger coûterait un deuxième Face ID et contredirait l'écran 4 validé.

## 7. Réponses à P3, P6, P8, P12 et P14

- **P3, aucune passkey ou Face ID annulé.**
  - Côté code : WebAuthn rend `NotAllowedError` dans les deux cas. C'est voulu par la spécification, pour ne pas révéler la présence d'une passkey. Un seul écran, 2 a, suffit donc.
  - **À vérifier sur l'iPad** : que la PWA installée reçoit bien `NotAllowedError`, et non une autre erreur, quand il n'existe aucune passkey.
- **P6, passkey ancienne.**
  - Oui : `userHandleMatches` rend `'old'` pour un `userHandle` sans « L1 ». Le téléphone le voit avant d'envoyer quoi que ce soit (écran 2 c).
  - Après un appairage par code, le snapshot dit `device.recover` absent, ce qui permet de proposer 4 i.
  - **À vérifier sur l'iPad** : que `get()` découvrable rend bien un `userHandle` dans la PWA installée (§ 7 de la conception).
- **P8, l'ancienne passkey après la mise à jour.**
  - Ce comportement dépend d'iOS. Les deux passkeys ont le même `rpId` mais des `user.id` différents, donc iOS en gardera probablement **deux**.
  - **À vérifier sur l'iPad.** Si les deux restent, choisir l'ancienne mène à 2 c, sans dommage : rien n'est envoyé.
- **P12, ce que couvre le blocage.**
  - Il couvre **tout le compte**, pas un appareil. Une attaque peut viser n'importe quel credential, alors qu'un blocage par appareil se contournerait en changeant de cible.
  - Les appareils liés continuent de marcher, et l'appairage par code aussi.
  - Seule une preuve qui ne se vérifie pas, pour une passkey connue, compte comme un échec.
- **P14, un iPhone prend la place d'un iPad hors ligne.**
  - Le PC ne peut pas l'empêcher : la passkey synchronisée est valide.
  - `recover_start.model` arrive jusqu'à `recovered.model` et `refused.model`, pour que Desktop puisse le montrer. Le texte reste à trancher (maquette).

## 8. Ce qui n'est pas dans ce contrat

- Les écrans du téléphone et de Desktop : c'est la part de dev-front, d'après la maquette.
- `signalUnknownCredential`, pour cacher l'ancienne passkey : son support iOS est incertain (§ 7 de la conception).
- Un relais qui modifie le JS servi n'est pas couvert (décision 8).

# Several mobile devices on one account (phone + iPad)

Date: 2026-11-03. Status: plan approved by the user (2026-11-03), mockup to approve before any UI code.

Mockup: <https://claude.ai/artifact/GdxRoPUpEDhNTfXBMEiUhQ> (private to the author), local copy
[docs/mockups/mobile-multi-device.html](../../mockups/mobile-multi-device.html).

Builds on [the relay](2026-10-16-ledge-relay-design.md), which already meant « un compte = un PC + des appareils ».

## 1. Where we are

Several devices already work. Checked in the code, by a run of the real relay with two sign-ins, and live on
2026-11-03 (an iPad linked next to the Android on the same account; both online together):

- Relay: each browser sign-in gets its own `d_…` peer, its own session and socket (`apps/relay/src/hub.ts:46`); only the
  same peer (same cookie: another tab) is replaced. One PC per account (`routes.ts:159`).
- Daemon: `devices.json` is a list; one sealed channel per peer (`mobile/channels.ts`), one follower per device
  (`mobile/gateway.ts`), one passkey and one push subscription per device, one chat thread per device.
- Two answers to one request: the first wins, the other gets `busy` or `stale` (`daemon/server.ts:1307`), then
  « Déjà traitée ».

What is wrong or missing with two devices:

1. **Who decided.** A decision taken on the iPad shows on the phone as « depuis le PC » (`apps/mobile/src/model/thread.ts:38`,
   `decidedHere` only knows this device's ops); `Gone` says « Déjà traitée sur le PC » whoever answered.
2. **Revocation.** Only `lastPeer` is denied and revoked on the relay (`mobile/service.ts:309`): an older relay session of
   the same device stays valid.
3. **Stale notifications.** A request answered on one device leaves its notification on the others (`sw/sw.ts`).
4. **Names.** A device is « iPhone », « iPad », « Android »: two iPhones look the same; nothing renames a device; the PC
   shows a phone glyph for all.
5. **Duplicates.** Reinstalling the app (new key) adds a new entry; the old one stays until revoked by hand.
6. **Layout.** The app is a 480 px column (`styles.css:66`); an iPad leaves two thirds of the screen empty.
7. **Wording.** « téléphone » in the singular across `apps/mobile/src/copy.ts` and `apps/desktop/src/i18n/fr.ts`.

## 2. Decisions

- Chat stays one thread per device (relay spec choice). Read marks stay per device (out of scope).
- Push presence stays per device: the iPad in front does not mute the phone.
- A device name is chosen by the user, sealed: it never goes through the relay in clear (`pair_commit.label` keeps the
  kind only, as today).
- Silent pushes are not an option: Safari drops a subscription that stays silent (`sw.ts`). A resolved request
  **replaces** its notification (same `tag`, no renotify) instead of adding one, and the app prunes on open.

## 3. Design

### 3.1 Data (daemon, `packages/ledge/src/mobile/files.ts`)

`ApprovedDevice` gains, all optional so an older `devices.json` reads unchanged:

- `kind: 'phone' | 'tablet'` — from the pairing label (`iPad` → tablet; Android tablet → tablet, see 3.4).
- `name: string` (1–40) — user-chosen; absent means the default name (3.4).
- `peers: string[]` — every relay peer that confirmed a channel for this device (at most 8, newest last). `lastPeer`
  stays for compatibility, = last of `peers`.

`MobileState.devices[]` gains `kind` and `name` (both optional in the schema for an older daemon).

### 3.2 Revocation of every peer

`revoke(id)` sends `denied` to and revokes on the relay **every** peer in `peers` (+ `lastPeer`), through the existing
`revocations.json` retry queue. `onConfirmed` appends the peer and removes it from every other device.

A peer that another approved device now uses is **never** denied or revoked: a browser that lost its keys and paired
again keeps its cookie, so its new key comes in on the old peer. Seen live on 2026-11-03: revoking the old iPad entry
revoked `d_ADF3…` on the relay, which the newly paired iPad was using, and signed it out.

### 3.3 Who decided

- `Decided` (`packages/protocol/src/messages.ts`) gains `by?: { kind: 'pc' } | { kind: 'device', id: string, name: string }`.
- `session.decide`, `session.answer`, `session.reply` gain an optional `by` **set only by the gateway** (it overwrites
  whatever a device sent); a local front sends none, which means `pc`.
- History (`daemon/history.ts`) keeps `by` on the permission item; `PermissionItem` (`protocol/src/thread.ts:27`) gains
  `by?` with the same shape (name copied at the time of the decision).
- Mobile: `eventLabel` says « depuis ce téléphone/cet iPad » when `by.id` is this device, « depuis <name> » for another
  device, « depuis le PC » for `pc`, and falls back to today's rule when `by` is absent (older daemon).
- `Gone` names who answered when the thread knows it: « Déjà traitée sur <name> » / « sur le PC » / « ailleurs ».

### 3.4 Names and kinds

- Default name: the model the label gives and the browser, `iPad · Safari`, `Android · Chrome`; a second one with the
  same default gets ` 2`, ` 3`.
- Kind: `iPad` (including iPadOS presenting as a Mac with touch, `screens/device.ts`) and Android without `Mobile` in
  the user agent → `tablet`; else `phone`. The phone sends it in `pair_commit.label` as today (`iPad`, `Android tablette`).
- Rename from the PC: `mobile.device.rename { id, name }` (local front). Rename from the device itself:
  `device.rename { op, name }` in the phone whitelist (`protocol/src/phone.ts`), applied to the sender only.
- The phone learns its own name from the snapshot: `device.name`, `device.kind`.

### 3.5 Duplicates on relink

The pairing dialog on the PC, when an approved device has the same kind and default name and is offline, offers
« Remplace <name> (vu il y a …) », checked by default. Approving with it revokes the old one (3.2) in the same step.
`mobile.pairing.approve` gains `replaces?: string`.

### 3.6 Notifications across devices

- The notifier remembers, per device, the tags it pushed for open requests (memory only).
- When a request leaves `pending` (decided anywhere, answered in the terminal, session ended), each device that got its
  push and is not visible gets one replacing push: same tag, kind `resolved`, title « <agent> · traitée »,
  body « sur <name> » / « sur le PC », `renotify: false`, badge updated.
- `PushPayloadSchema.kind` gains `resolved`; the service worker shows it with `renotify: false`. A device's
  `push.subscribe` gains `resolved?: true` (its service worker knows the kind); the daemon keeps it with the
  subscription and sends `resolved` only to those.
- On open and on each snapshot, the app closes the notifications whose tag is not a pending request
  (`registration.getNotifications()`), and sets the badge.

### 3.7 iPad layout (mobile app)

- Breakpoint: width ≥ 768 px **and** height > 500 px (an iPad in either orientation, not a phone on its side).
- The tab bar becomes the left rail already used by a phone on its side (`TabBar.tsx`).
- Two panes: list (360 px) | detail (rest, content at most 720 px):
  - Inbox | the selected request (decision footer in the detail pane).
  - Agents | the selected agent's thread or terminal.
  - Chat and settings: one pane, at most 720 px, centred.
- Nothing selected: the detail pane shows an empty state (« Choisissez une demande »).
- Sheets (`Dialog.tsx`) stay at most 480 px, centred in the window instead of at the bottom.
- Below 768 px wide (Split View, Slide Over) or ≤ 500 px high: unchanged.

### 3.8 Wording

`téléphone` → `appareil` where it means any device; « ce téléphone » → « cet appareil » (or the device's kind when the
sentence is about the hardware: Face ID, home screen). Desktop: `relayHint`, `emptyBefore`, `terminalInput`, pairing
`check` / `approved.rest`; device glyph by kind (phone / tablet).

## 4. Tests

- Relay: two devices of one account stay connected together (the check run on 2026-11-03, kept as a test).
- Daemon: revoke denies every peer; `by` reaches the thread for a gateway decision and is absent for a local one; a
  device cannot forge `by`; rename from PC and from device; replace on approve; resolved push only to devices that got
  the request push.
- Mobile unit: `eventLabel` with `by` (this device / other / pc / absent); `Gone` wording.
- e2e (`apps/mobile/e2e`): two pages, one fake PC: a decision on page A shows « depuis iPad · Safari » on page B; iPad
  profile (1024×1366 and 1366×1024): two panes; `landscape.spec.ts` keeps its phone assertions.

## 5. Order

1. Lot 1 (no UI change needed beyond copy): 3.1, 3.2, 3.3 daemon + protocol, 3.6 daemon + sw.
2. Mockup approved → lot 2 (3.3 mobile copy, 3.4, 3.5, 3.8) and lot 3 (3.7).

Compatibility: every new field is optional; an older PWA ignores `by`, `name`, `kind`, `resolved` (a `resolved` push
to an older service worker fails its payload check and shows « Une demande attend »: the daemon sends `resolved`
only to devices whose `push.subscribe` carried `resolved: true`, kept with the subscription in `devices.json`).

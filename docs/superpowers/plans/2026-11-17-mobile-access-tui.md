# Mobile access in `ledge tui` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ledge tui` everything Desktop's Réglages › Accès mobile does: a « Réglages › Accès mobile » screen, a
pairing alert line and badge on every screen, the « Lier un appareil » dialog, and the matching toasts.

**Architecture:** The TUI reads the local daemon's mobile state through `@ledge/fleet` (`useMobile`, `useMobileError`,
`fleet.onMachineMessage`) and acts with `fleet.sendMobile(msg)`, exactly as Desktop does. There is no daemon or protocol
change. The pure decisions go in a TUI model file; the screen, the dialog and the alert line are Ink components; texts go
in the TUI catalogue.

**Tech Stack:** TypeScript, React 18 + Ink, vitest + ink-testing-library, `@ledge/fleet`, `@ledge/protocol`.

**Spec:** `docs/superpowers/specs/2026-11-17-mobile-access-tui-design.md`. **Mockup (approved):**
`docs/mockups/ledge-mobile-access-tui.html`. Its `T.fr` / `T.en` objects are the copy source, and its `?st=` states are
the screens.

## Global Constraints

- Follow the approved mockup exactly. A state, text or interaction it does not show is asked for, not invented (root
  `AGENTS.md`).
- Every visible text goes through `packages/ledge/src/tui/i18n/fr.ts` and `en.ts`, in a new `mobile` section. `en`
  must type-check against `Messages = typeof fr`.
- Read only through `useMobile(tui.client)`, `useMobileError(tui.client)` and `tui.fleet.onMachineMessage`. Act only
  with `tui.client.fleet?.sendMobile(msg)`. The screen shows the daemon's broadcast; never draw an optimistic local copy.
- Message shapes come from `@ledge/protocol` `MobileClientMessage`: `mobile.set {enabled, relayUrl}`, `mobile.signin`,
  `mobile.signin.cancel`, `mobile.signout`, `mobile.retry`, `mobile.terminal {input}`,
  `mobile.device.rename {id, name}`, `mobile.device.revoke {id}`, `mobile.device.ack {id, what: 'recovered'|'refused'}`,
  `mobile.pairing.approve {id, replaces?}`, `mobile.pairing.deny {id}`, `mobile.recovery.unblock`.
- Keys:
  - On the Mobile screen: `j k` / `↑ ↓` move, `↵` or space does the row's action, `r` renames, `x` revokes, `esc` goes
    back to Réglages.
  - Global: `L` opens « Lier un appareil » (never `m` or `x`, which are taken).
  - In the dialog: `y` approves, `n` denies, `r` toggles « Remplacer », `esc` closes.
  - A field or a confirmation open takes every key (`tui.setEditing(true)` while a text field is open).
- Toasts go through `tui.toast({ text, tone })`.
- Comments are prose: one full sentence saying what a thing is for or why. Relative imports end in `.js`.
- Tests: `corepack pnpm --filter @paradow/ledge test <file>` (env:
  `export PATH=$HOME/.local/share/nvm/v24.10.0/bin:$PATH`). Never run the root `pnpm test`: the machine has about
  10 GB of RAM. A full-package run uses `-- --maxWorkers=2`.

## Review Focus

1. **The daemon's state changes while a field or the dialog is open** (the pairing expires, the device is revoked
   elsewhere). Expected: the dialog follows the new state (expired), and a rename field whose device has vanished
   closes without sending. Test: Task 4 (rename) and Task 5 (expiry while open).
2. **Typing `L`, `r`, `x`, `y` or `n` inside a text field** (relay URL, device name). Expected: the letter is text, no
   action fires. Test: Task 3 (relay field) and Task 5 (`L` in the Ask composer).
3. **Several pairings waiting at once.** Expected: the badge counts all of them, `L` opens the oldest by `expiresAt`, and
   the next one is offered after it is decided. Test: Task 5.
4. **The daemon never speaks of mobile** (too old), or the fleet throws on send (offline). Expected: the outdated or
   offline screen, and a toast on a send; never a crash. Test: Task 3 (screen), Task 6 (throwing send).
5. **A long relay URL or device name at 72 columns.** Expected: truncated with `…` inside the box; the box border never
   breaks. Test: Task 4 (a 40-character name).

---

### Task 1: Shared helpers and the TUI mobile model

**Files:**
- Modify: `packages/fleet/src/machines.ts`: export `replaceable`, moved from Desktop.
- Modify: `apps/desktop/src/settings/PairingDialog.tsx`: import `replaceable` from `@ledge/fleet`; remove the local
  copy. Behaviour unchanged.
- Create: `packages/ledge/src/tui/model/mobile.ts`
- Modify: `packages/ledge/src/tui/clipboard.ts`: add `copyText`.
- Test: `packages/ledge/test/tui-mobile-model.test.ts`, and the existing Desktop PairingDialog tests stay green.

**Interfaces:**
- Produces:
  - `@ledge/fleet`: `export function replaceable(m: MobileState | undefined, label: string): MobileState['devices'][number] | null`,
    the same logic as Desktop's: the same label, offline, the one seen last.
  - `model/mobile.ts`:
    - `export function waitingPairings(m: MobileState | undefined): MobilePairing[]`: the pairings in state `confirm`,
      oldest `expiresAt` first.
    - `export type MobileSummary = { kind: 'online'; devices: number; requests: number } | { kind: 'off' } | { kind: 'offline' } | { kind: 'signedOut' } | { kind: 'unavailable' } | { kind: 'absent' }`
    - `export function mobileSummary(m: MobileState | undefined): MobileSummary`. `absent` when `m` is undefined.
      `unavailable` when `link.state === 'unavailable'`. `off` when `!enabled`. `signedOut` when `account === null`.
      `offline` when `link.state` is `offline` or `signed_out`. Otherwise `online`.
    - `export function deviceGlyph(kind: 'phone' | 'tablet' | undefined, g: Glyphs): string`: `▯` for a phone, `▭` for
      a tablet. The kind comes from `deviceKindOf(label)` of `@ledge/protocol` when absent. Add the two glyphs to
      `glyphs.ts` with ASCII fallbacks `[]` and `[=]`.
    - `export function deviceName(d: MobileState['devices'][number]): string`: `d.name ?? d.label`.
    - `export function deviceWord(d: MobileState['devices'][number] | undefined): { text: string; named: boolean } | null`,
      ported from Desktop's `settings/recovery.ts` for the French articles.
  - `clipboard.ts`: `export function copyText(text: string, write: (s: string) => void): void`. It writes the OSC 52
    sequence `\x1b]52;c;<base64>\x07`, which works over SSH.

- [ ] **Step 1: Write the failing tests** (`tui-mobile-model.test.ts`):
  - `waitingPairings` keeps only `confirm` and sorts by `expiresAt`.
  - `mobileSummary`: one case per kind, in the order of the rules above (`unavailable` wins over `off`).
  - `deviceGlyph('tablet')` is `▭`, and `deviceGlyph(undefined)` for the label `iPad` is `▭`.
  - `deviceName` prefers `name`.
  - `copyText('WDJB-MJHT', w)` writes exactly `'\x1b]52;c;' + Buffer.from('WDJB-MJHT').toString('base64') + '\x07'`.
  - `replaceable`: the same label and offline gives the device seen last; an online device or another label gives `null`.
- [ ] **Step 2: Run** `corepack pnpm --filter @paradow/ledge test tui-mobile-model` → FAIL.
- [ ] **Step 3: Implement.** Move `replaceable`, then run `corepack pnpm --filter desktop typecheck` and
  `corepack pnpm --filter desktop test PairingDialog` (or the file that covers it) → PASS.
- [ ] **Step 4: Run** the model test plus `corepack pnpm --filter @ledge/fleet typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(tui): the mobile model, with replaceable shared from @ledge/fleet`.

### Task 2: Catalogue, Réglages row and the screen's routing

**Files:**
- Modify: `packages/ledge/src/tui/i18n/fr.ts`, `en.ts`: a `mobile` section holding every text of the mockup's `T.fr` /
  `T.en` that the TUI shows. Use the same wording; functions where the mockup interpolates. Leave out the mockup-only
  `page`, `states` and `notes`.
- Modify: `packages/ledge/src/tui/context.tsx`: add `'mobile'` to `Screen`, but not to `SCREENS`.
- Modify: `packages/ledge/src/tui/App.tsx`: route `mobile`. `esc` on `mobile` goes to `settings`, and `settings` keeps
  its own back.
- Modify: `packages/ledge/src/tui/screens/Settings.tsx`: a fifth row `mobile`. Its value is the summary, and `↵` (or
  `→` or space) does `go('mobile')`.
- Create: `packages/ledge/src/tui/screens/Mobile.tsx` (a frame with the title and an empty body for now).
- Test: `packages/ledge/test/tui-mobile.test.tsx` (new). Extend `test/tui-fixture.tsx` with an option
  `mobile?: MobileState` that the mock daemon pushes as `{ type: 'mobile', state }`. Check the exact message shape
  `fleet.ts` reads at the `m.type === 'mobile'` branch. Also record the `mobile.*` messages the TUI sends, as `sent()`.

**Interfaces:**
- Produces: `Screen` includes `'mobile'`; `t.mobile.*` keys; fixture `startTui({ mobile })` and `.sentMobile()`.
- Summary texts:
  - online: `● ${t.mobile.sumOnline(devices, requests)}`, as in the mockup: « En ligne · 2 appareils · 1 demande »;
  - off: `t.mobile.offW`;
  - offline: `t.mobile.sumOffline`;
  - signedOut: `t.mobile.idle`;
  - unavailable or absent: `t.mobile.sumUnavailable`, which is « indisponible » / « unavailable ».

- [ ] **Step 1: Write the failing tests**:
  - Settings shows `Accès mobile` and `En ligne · 2 appareils · 1 demande` for a state with 2 devices and 1 `confirm`
    pairing.
  - `,` then `j` ×4 then `↵` shows `RÉGLAGES › ACCÈS MOBILE`.
  - `esc` there returns to `RÉGLAGES`.
  - In English, the same flow shows `Online · 2 devices · 1 request`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tui-mobile` and `tui-screens` → PASS. Run `corepack pnpm --filter @paradow/ledge typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(tui): Réglages › Accès mobile, its row and its screen`.

### Task 3: The access box

**Files:**
- Modify: `packages/ledge/src/tui/screens/Mobile.tsx`; create `packages/ledge/src/tui/ui/MobileAccess.tsx` if
  `Mobile.tsx` passes about 250 lines.
- Test: `packages/ledge/test/tui-mobile.test.tsx`

**Interfaces:**
- Consumes: Task 1 model; Task 2 catalogue and fixture.
- Produces: the screen's row model, `type MobileRow = { id: string; action?: () => void }`. Task 4 appends the device
  rows to the same list, so `j k` runs over both boxes.

Rows, texts and colours as in the mockup states `off`, `signin`, `flow`, `copied`, `ended`, `refused`, `connecting`,
`online`, `offline`, `signedout`, `unavailable`, `outdated`, `relay`:
- **Accès:** ↵ or space sends `mobile.set {enabled: !enabled, relayUrl}`.
- **Relais:** ↵ opens a `TextInput` holding the current URL. ↵ checks it with `RelayUrlSchema.safeParse`. When the check
  fails, it shows `t.mobile.relayBad` under the field and stays open. When it passes, it sends `mobile.set` and closes.
  `esc` cancels.
- **Compte GitHub:**
  - not signed in: ↵ sends `mobile.signin`;
  - `signin` set: `verificationUri` and `userCode`, plus the minutes before `expiresAt`. `c` runs `copyText` and toasts
    `t.mobile.copiedT` with tone `ok`. `esc` sends `mobile.signin.cancel`;
  - `signinError` `not_allowed`: the two refusal lines, and ↵ sends `mobile.signin`;
  - `signinError` `failed`, `expired` or `denied`: its line, and ↵ sends `mobile.signin`;
  - `link.state === 'signed_out'`: the reason's two lines, and ↵ sends `mobile.signin`;
  - signed in: `@login · se déconnecter`, and ↵ sends `mobile.signout`.
- **État:**
  - online: `● Connecté au relais`;
  - connecting: `◌ Connexion…`;
  - offline: `Hors ligne · nouvel essai dans N s`, from `link.retryAt`, then the two « unreachable » lines, and ↵ sends
    `mobile.retry`;
  - off or idle: `○ …`.
- **Taper dans les term.:** shown only when `terminalInput !== undefined`. ↵ or space sends
  `mobile.terminal {input: !terminalInput}`.
- **Access off:** only « Accès » takes the cursor, and the other rows are dim.
- **`link.state === 'unavailable'`:** the box holds only the two `unavailableL` lines, with `link.error` as the second.
- **State absent:** only `t.mobile.outdatedL`. The keys are `esc` alone.

- [ ] **Step 1: Write the failing tests**, one per behaviour above. Each sets a mobile state, opens the screen, asserts
  the frame's text, presses the key, and asserts `sentMobile()`. Among them:
  - Accès toggles to `{type:'mobile.set', enabled:false, relayUrl:'https://app.kl-ledge.dev'}`.
  - Relais: typing `http://relais.example/ledge` then ↵ shows the refusal and sends nothing. Typing `L`, `x`, `r` in the
    field adds them to the text and sends nothing. `https://relay.example` then ↵ sends `mobile.set` with it.
  - Signing in: the code and `github.com/login/device` are shown, and `c` writes the OSC 52 sequence (assert on the
    fixture's `written()`) and toasts `Copié`.
  - `esc` while signing in sends `mobile.signin.cancel`.
  - `signinError: 'expired'` shows `Le code a expiré. Recommence la connexion.`, and ↵ sends `mobile.signin`.
  - Offline: ↵ on État sends `mobile.retry`.
  - Access off: `j` stays on Accès, so ↵ still toggles.
  - Unavailable shows the error. Absent shows `trop ancien`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tui-mobile` → PASS.
- [ ] **Step 5: Commit** `feat(tui): mobile access, the access box`.

### Task 4: The devices box

**Files:**
- Modify: `packages/ledge/src/tui/screens/Mobile.tsx`; create `packages/ledge/src/tui/ui/MobileDevices.tsx`.
- Test: `packages/ledge/test/tui-mobile.test.tsx`

**Interfaces:**
- Consumes: `MobileRow` (Task 3); `waitingPairings`, `deviceGlyph`, `deviceName`, `deviceWord` (Task 1).
- Produces: `openPairing(id: string)`, through a small store or context that Task 5's dialog also opens. Name it
  `usePairingDialog(): { open(id: string): void; close(): void; id: string | null }` in
  `packages/ledge/src/tui/ui/pairingDialog.ts`.

Order and rendering as in the mockup states `online`, `empty`, `rename`, `revoke`, `revoked`, `recovered`, `attempt`,
`blocked`, `off`:
1. **`recovery.blocked`:** its well (failures, since). ↵ sends `mobile.recovery.unblock`.
2. **Each waiting pairing:** « ! <label> demande l'accès ↵ comparer le code ». ↵ opens the dialog.
3. **Each device:** glyph, `deviceName`, and a hint. The hint is « <label> · lié le … · vu … » when a name is set,
   otherwise « lié le … · vu … ».
   - `r` opens a `TextInput` with the name. ↵ sends `mobile.device.rename` after `DeviceNameSchema` (empty or invalid:
     nothing sent, field stays). `esc` cancels.
   - `x` turns the row into « Révoquer <name> ? … y / n ». `y` sends `mobile.device.revoke` and toasts `« <name> est
     révoqué. »` (tone `ok`). `n` or `esc` cancels.
   - `recovered.pending`: the tag and well. ↵ sends `mobile.device.ack {what:'recovered'}`.
   - `refused`: the « Tentative refusée » tag and well. ↵ sends `mobile.device.ack {what:'refused'}`.
- **Box title:** `APPAREILS · N`, where N counts approved devices.
- **No device:** the three `empty` lines, with the relay's host.
- **Access off:** the box is dim, with `offWell` first, and no device row takes the cursor.

- [ ] **Step 1: Write the failing tests**, one per behaviour, asserting the frame and `sentMobile()`. Plus:
  - A 40-character device name at 72 columns: every line of the frame is at most 72 cells wide, and the box's right
    border `│` sits in column 72.
  - The renamed device vanishes from the state while its field is open: the field closes and nothing is sent.
  - `x` then `n`: nothing is sent.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tui-mobile` → PASS.
- [ ] **Step 5: Commit** `feat(tui): mobile access, the devices box`.

### Task 5: The alert line, the badge and « Lier un appareil »

**Files:**
- Create: `packages/ledge/src/tui/ui/PairingDialog.tsx`, `packages/ledge/src/tui/ui/PairingAlert.tsx`.
- Modify: `packages/ledge/src/tui/ui/Frame.tsx`:
  - the badge `▯ N` in the status bar, in yellow bold, when N > 0;
  - `<PairingAlert/>` under the status bar, except when `screen === 'mobile'`;
  - the dialog drawn over the body while open.
- Modify: `packages/ledge/src/tui/App.tsx`: global `L` (after the screen's keys, and never while `editing`) opens the
  oldest waiting pairing. The dialog takes the keys while open.
- Modify: `packages/ledge/src/tui/i18n/*`, help screen (`help` rows): add `L` « lier un appareil » / « link a device ».
- Test: `packages/ledge/test/tui-mobile-pairing.test.tsx`

**Interfaces:**
- Consumes: `usePairingDialog` (Task 4), `waitingPairings`, `replaceable` (Task 1).
- Dialog content, as in the mockup states `pair`, `replace`, `approved`, `linked`, `expired`:
  - intro with `@login`, the code spaced in groups of three, the check and warning lines, « expire dans m:ss »;
  - `[x] Remplacer l'ancien « <name> »` with its hint, when `replaceable(m, label)` is not null; ticked by default, and
    `r` toggles it;
  - `y` sends `{type:'mobile.pairing.approve', id, replaces?: old.id}` (only while ticked), and `n` sends
    `mobile.pairing.deny`;
  - it then follows the pairing's state: approved, linked or expired, each with `esc` to close. A pairing gone from the
    state closes the dialog.

- [ ] **Step 1: Write the failing tests**:
  - On Overview with one `confirm` pairing, the frame contains `Pixel 8 demande à se lier à ton PC` and `▯ 1`.
  - On the Mobile screen, the alert line is absent but the badge is shown.
  - `L` opens `LIER UN APPAREIL` with the code; `y` sends `mobile.pairing.approve` without `replaces`.
  - With an offline `iPhone perso` of the same label: `[x] Remplacer`; `y` sends `replaces`; `r` then `y` sends none.
  - `n` sends `mobile.pairing.deny`.
  - Pushing the pairing's state `approved`, then `linked`, then `expired` changes the dialog's text each time.
  - Two pairings: `▯ 2`; `L` opens the one with the earlier `expiresAt`.
  - In the Ask composer, typing `L` puts `L` in the draft and opens no dialog.
  - `esc` closes the dialog and the alert line stays.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tui-mobile-pairing`, `tui-mobile` and `tui-screens` → PASS.
- [ ] **Step 5: Commit** `feat(tui): pairing alert, badge and « Lier un appareil »`.

### Task 6: Recovery toasts, daemon refusals, docs

**Files:**
- Create: `packages/ledge/src/tui/model/mobileToasts.ts` (a hook), used once in `App.tsx`.
- Modify: `docs/ledge-guide.md`: in « Ledge mobile », and in the `ledge tui` section, the PC side can be done from
  `ledge tui` › Réglages › Accès mobile (French, one or two lines). The help screen lines added in Task 5 cover the key.
- Test: `packages/ledge/test/tui-mobile-pairing.test.tsx` (or `tui-mobile.test.tsx`)

**Interfaces:**
- `export function useMobileToasts(tui: Pick<Tui, 'fleet' | 'client' | 't' | 'toast'>): void`:
  - subscribes to `fleet.onMachineMessage`. On `machine === 'local'` and `mobile.recovery` with event `recovered` or
    `refused` and an `id`, it toasts `t.mobile.recToast(word)` or `t.mobile.refusedToast(word)`, with tone `ok` or
    `info`;
  - watches `useMobileError`, and toasts each new refusal's message with tone `error`.
- A `sendMobile` that throws is caught where it is called (one helper, `sendMobile(tui, msg)` in `model/mobile.ts` or
  next to it). It toasts `t.mobile.refusedOffline` or `t.mobile.refusedOutdated` (by `error.name === 'DaemonOutdated'`).
  Tasks 3–5 already call through this helper; if they do not, switch them to it here.

- [ ] **Step 1: Write the failing tests**:
  - The mock daemon pushes `{type:'mobile.recovery', event:'recovered', id:'d1', at}`: the frame shows
    `L’iPhone s’est reconnecté avec sa passkey`.
  - A `refused` event shows the refused toast.
  - A `blocked` event shows no toast.
  - A `mobile.error` from the daemon (use its real message type) shows its message.
  - A fleet whose `sendMobile` throws `DaemonOutdated` toasts the outdated text.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**, and edit the guide.
- [ ] **Step 4: Run** `corepack pnpm --filter @paradow/ledge test -- --maxWorkers=2`,
  `corepack pnpm --filter @paradow/ledge typecheck` and `corepack pnpm --filter desktop typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(tui): recovery toasts and daemon refusals; guide`.

### Task 7: Visual check against the mockup

- [ ] **Step 1:** In the worktree, run the TUI against a mock daemon pushing each mockup state. Reuse the fixture through
  a small script, or the tests' `frame()` output. Compare each frame, at 72 and 100 columns, with the mockup state of the
  same name (`?st=`), in FR and EN: rows, order, texts, keys, colours as far as the frame shows them.
- [ ] **Step 2:** Fix every difference in the task's files, with a test where a text or an order was wrong.
- [ ] **Step 3: Commit** `fix(tui): mobile access matches the mockup` (only if something changed).

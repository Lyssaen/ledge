# Mobile access in `ledge tui` — design

Date: 2026-11-17. Status: approved by the owner (2026-11-17).
Mockup (approved by the owner): `docs/mockups/ledge-mobile-access-tui.html` (`?st=<state>&theme=&lang=&w=`).

## Intent

Ledge is shared as open source, and the relay can now be self-hosted (`@paradow/ledge-relay`). Someone without Ledge
Desktop (Linux or macOS, or a server reached over SSH) still cannot enable mobile access, sign in with GitHub, link a phone
or manage their devices: all of that lives only in Desktop › Réglages › Accès mobile. This project gives `ledge tui` the
same capabilities, so the phone app works on a PC that has only the `ledge` CLI.

## Goals

- Everything Desktop's mobile access does, from `ledge tui`:
  - turn access on or off and choose the relay;
  - sign in with GitHub through the device flow, and sign out;
  - see the link's state and retry;
  - turn « Taper dans les terminaux » on or off;
  - for each device: rename it, revoke it, acknowledge a passkey recovery;
  - compare the code of a pairing, then approve or deny it;
  - unblock passkey recovery.
- A pairing that waits is noticed from any TUI screen, without interrupting what the user is doing.
- Every state Desktop handles has a TUI counterpart:
  - sign-in failed, expired or denied;
  - « Connexion… »;
  - the service not started, or the daemon too old or offline;
  - a refused passkey attempt;
  - « Remplacer l'ancien » in the pairing dialog;
  - the toasts.

## Non-goals

- `ledge mobile …` CLI commands (the owner chose the TUI). One may come later, for example `ledge mobile pair`.
- Managing another machine's mobile access. Like Desktop, the TUI manages the local daemon's.
- Any daemon, protocol or relay change: the daemon already exposes the whole state and accepts every action.
- Changing Desktop.

## Anti-goals

- Anything Desktop can do that the TUI cannot. A Desktop-less user must never be stuck, for example on a blocked
  recovery or a refused account.
- An interruption: a pairing request never takes the screen over (the owner chose the alert line, not a modal).
- A token, device code or key shown or logged. The daemon's state carries none; the GitHub user code is meant to be
  shown.

## Constraints

- **Screens:** follow the approved mockup exactly. A state, text or interaction it does not show is asked for, not
  invented (root `AGENTS.md`).
- **Texts:** every visible text goes through the TUI's i18n catalogue (`packages/ledge/src/tui/i18n`), in French and
  English. Wording follows the mockup, which follows Desktop's `settings.mobile` and `pairing` copy.
- **Data:** the TUI reads the mobile state through `@ledge/fleet` (`useMobile`, `useMobileError`) and acts through
  `fleet.sendMobile(msg)` with the `MobileClientMessage` messages of `@ledge/protocol` (`mobile.set`, `mobile.signin`,
  `mobile.signin.cancel`, `mobile.signout`, `mobile.retry`, `mobile.terminal`, `mobile.device.rename`,
  `mobile.device.revoke`, `mobile.device.ack`, `mobile.pairing.approve`, `mobile.pairing.deny`,
  `mobile.recovery.unblock`). What the screen shows is the daemon's broadcast, never an optimistic local copy.
- **Widths:** it must work at 72 columns, and use the room at 100. Dark and light themes.

## Approaches considered

1. **A TUI screen on `@ledge/fleet`, with the same messages as Desktop.** Picked: it is the only approach that fits.
2. **`ledge mobile …` commands.** Declined by the owner. A live pairing is awkward in a one-shot command.
3. **Reusing Desktop's components.** Impossible: they are DOM React, and the TUI renders with Ink.
4. **A new daemon API.** Pointless: the daemon already does everything.

## Decided with the owner

- An « Accès mobile » row in Réglages, with ↵ opening its own screen « Réglages › Accès mobile » (approach B of the
  placement question).
- A waiting pairing shows as an alert line at the top of every screen and a badge in the status bar (approach B of the
  pairing question). `L` opens « Lier un appareil » from anywhere.
  - The key is `L`, not `m`: `m` and `x` are taken (Overview: note and put away a task; Session: model).
  - The line has no hide key. It goes when the pairing is decided or expires.
  - It is not shown on the Mobile access screen, where the pairing heads the devices.
- « Remplacer l'ancien » in the dialog is ticked by default, as in Desktop, and `r` unticks it.
- Toasts are a single line of text, like the TUI's other toasts, with no « Voir » action. The device stays flagged on its
  row until it is acknowledged.
- The mockup as approved on 2026-11-17 (second version), with its states and keys.

## Design

### Réglages

A fifth row, « Accès mobile », shows a summary of the state:
- `● En ligne · N appareils · K demande` while online, where K counts every pairing in state `confirm`;
- `Désactivé` when access is off;
- `Hors ligne` while offline;
- `Pas connecté` when no account is signed in.

These texts are the builder's, kept within the summary shown in the mockup.

↵ opens the dedicated screen, and `esc` on it comes back to Réglages.

### Réglages › Accès mobile

Two boxes, as in the mockup.

The **access box** has these rows:
- **Accès:** ↵ or space toggles it, by sending `mobile.set` with the current `relayUrl`.
- **Relais:** ↵ opens an inline field. ↵ checks the value with `RelayUrlSchema`. When the value is refused, the field
  shows the refusal line and stays open. When it is accepted, the TUI sends `mobile.set`. `esc` cancels.
- **Compte GitHub:** its content depends on the state:
  - not signed in: ↵ sends `mobile.signin`;
  - signing in: the `verificationUri` and the `userCode`, with the time before the code expires. `c` copies the code,
    through the TUI's clipboard helper. `esc` sends `mobile.signin.cancel`;
  - `signinError: not_allowed`: the refusal text, and ↵ starts over;
  - `signinError` set to `failed`, `expired` or `denied`: that error's text (Desktop's `signinEnded`), and ↵ « Se
    connecter avec GitHub » starts over;
  - signed out by another PC, or because the session is no longer valid: the reason, and ↵ signs in again;
  - signed in: `@login · se déconnecter`, where ↵ sends `mobile.signout`.
- **État:** the link state. « Connexion… » while connecting. While offline it shows the retry countdown and the
  « unreachable » text, and ↵ sends `mobile.retry`.
- **Taper dans les terminaux:** ↵ or space toggles it with `mobile.terminal`. The row is hidden when the daemon does not
  send `terminalInput`, as in Desktop.

With access off, only the « Accès » row takes the cursor. The other rows are shown dimmed and do nothing, as Desktop
disables them.

The **devices box** has, in this order:
1. The blocked-recovery well, if any, where ↵ sends `mobile.recovery.unblock`.
2. The pairings in state `confirm`, where ↵ opens « Lier un appareil ».
3. The approved devices: glyph, name (or label), « lié le … · vu … ».
   - When a name is set, the model (the label) is shown in the hint: « iPhone · lié le 3 nov · vu … ».
   - The glyph comes from `kind`: ▯ for a phone, ▭ for a tablet.
   - A device with `recovered.pending` shows the « Reconnecté » tag and its well. ↵ « C'était bien moi » sends
     `mobile.device.ack` `recovered`.
   - A device with `refused` shows the « Tentative refusée » tag and its well. ↵ « Compris » sends `mobile.device.ack`
     `refused`.
   - `r` opens an inline rename field, which sends `mobile.device.rename` (validated with `DeviceNameSchema`).
   - `x` asks `y / n` on the row, then sends `mobile.device.revoke`.

With access off, the box is dimmed and says that linked devices cannot connect. With no device, it shows how to link
one, naming the relay's host.

Keys on this screen: `j k` or `↑ ↓` move, ↵ or space does the row's action, `r` and `x` act on device rows, `esc` goes
back. An inline field or a `y / n` confirmation takes the keys while it is open.

### The alert line and the badge

While at least one pairing is in state `confirm`, the TUI shows:
- a `▯ N` badge in the status bar of every screen, where N counts every pairing in state `confirm`;
- on every screen except Réglages › Accès mobile, a line under the status bar: « ● <label> demande à se lier à ton PC
  L comparer le code ».

`L` opens « Lier un appareil » for the oldest waiting pairing, from any screen. Inside a text field, a typed `L` is text,
not this key.

### « Lier un appareil »

A box drawn over the current screen, as in the mockup. It shows the account, the code, the check and warning texts, and
the time before the request expires.
- When an offline approved device has the same label (Desktop's `replaceable`), the dialog shows « [x] Remplacer
  l'ancien « <name> » » with its hint, ticked by default. `r` toggles it.
- `y` sends `mobile.pairing.approve`, with `replaces` set to the old device's id while the box is ticked. `n` sends
  `mobile.pairing.deny`. `esc` closes without deciding; the alert line stays.
- It then follows the pairing's state: approved (« confirme sur le téléphone »), linked, expired. In these states `esc`
  closes it.
- While it is open it takes the keys.

### Toasts

A toast uses the TUI's existing mechanism (`tui.toast`), on the line above the keys. The texts are:
- « Copié » after `c`;
- « <name> est révoqué. » after a revoke;
- « <Le device> s'est reconnecté avec sa passkey » on a `mobile.recovery` `recovered` event;
- « Reconnexion avec la passkey <du device> refusée : il est connecté » on a `refused` event.

The device wording follows Desktop's `theDevice` and `ofDevice`.

### Daemon-level states

- **`link.state === 'unavailable'`:** the screen shows only « L'accès mobile n'a pas démarré sur ce PC : <error> ».
- **Mobile state absent** (daemon too old, or offline): the screen shows only Desktop's « trop ancien » or « hors
  ligne » text.
- In both cases the Réglages row says so, briefly.

### Errors

- A refusal from the daemon (`useMobileError`) shows as a toast in the daemon's own words, as in Desktop.
- A `sendMobile` that throws (daemon offline or too old) shows as a toast with Desktop's two texts.

### Tests

Ink tests next to the existing TUI tests (`packages/ledge/test/tui-*.test.tsx`), with a fake fleet client that holds a
mobile state and records the messages sent:
- the summary row;
- each state of the screen, as in the mockup;
- each action sending the right message;
- the inline fields, including a refused relay URL;
- revoke with `y / n`;
- the alert line and the badge on another screen, and the line absent from the Mobile access screen;
- `L` opening the dialog, then `y` / `n`;
- « Remplacer l'ancien » ticked by default, `r` toggling it, and `replaces` in the message;
- the dialog following approved → linked → expired;
- the refused-attempt and recovered acknowledgements;
- the toasts, including the two `mobile.recovery` events;
- the unavailable and outdated screens;
- `L` not stealing a letter typed in a text field;
- the keys being taken while a field or the dialog is open;
- French and English.

## Left to the builder

- The file layout under `packages/ledge/src/tui/` (a screen, a dialog component, the alert line in the shell), and how
  screen routing names the new screen.
- How the expiry countdown ticks (Desktop refreshes once a second).
- Layout details at 100 columns, within the mockup's look.

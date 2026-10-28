# Updating and restarting the PC's daemon from the phone

Date: 2026-10-28. Status: design.

Builds on [the daemon's self-update](2026-10-12-auto-update-design.md) (`createDaemonUpdater`, `update.daemon`, the
`sessions-at-risk` guard) and on the phone's passkey confirmation (`packages/ledge/src/mobile/gateway.ts`,
`checkAssertion`).

Mockup (390 px, the app's dark and light tokens): <https://claude.ai/artifact/1ZWPvJHVnrh3ptwqXyMh79> (private to the
author), section « Téléphone », local copy [docs/mockups/ledge-update.html](../../mockups/ledge-update.html). Nine
states: PC en retard, Confirmation, En cours, Redémarrage, Terminé, Sessions en danger, Installé depuis git, Depuis
Équipes, Redémarrer seul.

## 1. Intent

The phone app moved to 0.26.0 while the PC's daemon stayed on 0.25.0. The Équipes tab said « Catalogue indisponible »:
the old daemon refused `teams.catalog`. PR #129 now says so at once and asks to update Ledge on the PC, but the user
had to go to the PC, run `npm i -g @paradow/ledge@0.26.0`, then `systemctl --user restart ledge-daemon`.

The daemon already knows how to do both: Desktop sends `update.daemon { version }` and the daemon runs npm, then
restarts its service. The user wants the same from the phone, and a plain restart (« ajouter dans le protocole l'update
du daemon et son restart »).

## 2. Goals, non-goals, anti-goals

Goals:

- When the PC's daemon is older than the phone app, the Connexion screen offers « Mettre à jour le PC ». The version
  asked for is **the app's own build version**, never « the latest on npm ».
- « Redémarrer le daemon », without installing anything: after an update done by hand.
- Both confirmed by the device's passkey, bound to the action and, for an update, to the version.
- The phone follows the update: installing, restarting, the link coming back, done when the PC announces the version.
- The Équipes notice of #129 gains « Mettre à jour le PC », which leads to the Connexion screen.

Non-goals:

- **Desktop.** No change to the desktop app or to the overlay: no restart button there, no new `ClientMessage`. The
  restart is reachable from the phone only (the user: « pour le desktop on ne le veut pas »).
- Updating a daemon installed from a git clone, or not under systemd: the phone says it cannot, as Desktop does.
- Choosing a version, or going back to an older one.

Anti-goals:

- A way to force past `sessions-at-risk`. A restart that would end OMP sessions the daemon owns is refused, as today.
- A path of the PC on the phone. The manual command of a clone (`cd <clone> && …`) and npm's output both hold paths:
  the phone gets the reason only, the detail stays in `~/.ledge/daemon.log`.

## 3. Design

### 3.1 What the PC says of itself

The phone snapshot's `daemon` gains two optional flags, next to `teams` (#129):

| Field | Set when | Meaning on the phone |
| --- | --- | --- |
| `update: true` | `install === 'npm'` and `systemd` | « Mettre à jour le PC » can be offered. |
| `restart: true` | `systemd` | « Redémarrer le daemon » can be offered. |

Both come from `daemonInfo()`, which the daemon computes at start. An older phone ignores them; an older daemon sends
neither, and the phone offers nothing but the text of #129.

### 3.2 Phone ↔ daemon

New passkey purpose `pc` in `ConfirmPurposeSchema`. `confirm.prepare` gains `action: 'update' | 'restart'` and
`version` (semver, required for `update`). The challenge's subject is `update@<version>` or `restart`: a challenge
given for one version never covers another, nor a restart.

Two new phone operations (`PhoneOperation`, each with `op` and `assertion`):

- `daemon.update { op, version, assertion }`
- `daemon.restart { op, assertion }`

The gateway, in order, answers `operation.result`:

1. No `update` (resp. `restart`) flag on this PC: `rejected`, `unavailable`.
2. `daemon.update` only: `version` not newer than the running daemon: `rejected`, `invalid` (no downgrade, nothing to
   do for the same version). Checked before the assertion, so the challenge is not spent.
3. `checkAssertion(deviceId, assertion, 'pc', subject)`: its refusals as for the teams operations
   (`confirm_required`, `assertion_invalid`, `assertion_expired`).
4. Otherwise `applied`: the request is handed to the updater. `applied` means « accepted », not « done ».

The updater's own refusals and its progress then reach the phone through two new `PhoneServerMessage`s, translated by
the gateway from the `update.progress` / `update.failed` the daemon already broadcasts (`gateway.forward`):

- `daemon.progress { version, step: 'installing' | 'restarting' }`
- `daemon.failed { version, reason }`, `reason` one of `UpdateFailure` (`git-install`, `no-systemd`,
  `sessions-at-risk`, `npm-failed`, `busy`). **No `detail`, no `command`**: both may hold paths.

Every phone that follows the PC gets them, as every overlay does: two phones see the same progress. A phone that did
not ask follows a run from its first `daemon.progress` (the link is about to drop); a `daemon.failed` of a run it does not
follow is ignored.

### 3.3 The daemon

- `createDaemonUpdater` gains `restart(send, reply)`: the same guards as `update` minus npm (`busy`, not under systemd,
  `sessions-at-risk`), then `update.progress { step: 'restarting' }`, `save()`, `systemctl --user restart --no-block`.
  `version` in its messages is the running one.
- The gateway gets the updater through a new optional dep (`pc: { update, restart, version, canUpdate, canRestart }`),
  wired in `server.ts` from `opts.updater` and `opts.daemon`. It is **not** a `ClientMessage`: no other client can
  restart the daemon through it.

### 3.4 Screens

**Connexion** (mockup « PC en retard »):

- A new row « Version du PC », in the warning colour when it is older than the app.
- A new section « Le PC », shown when the PC is older than the app or offers `restart`:
  - the PC is older and has `update`: the card « Le PC a du retard sur l'app · PC x · app y », « Mettre à jour le PC »;
  - the PC is older without `update`: the card « Le PC ne peut pas se mettre à jour seul », with the reason
    (« Son daemon tourne depuis un clone git » when it has `restart`, i.e. systemd without npm; « mettez Ledge à jour
    sur le PC » otherwise). No command (§2).
  - `restart`: the row « Redémarrer le daemon · Sans rien installer. Les sessions continuent. », greyed while an
    update runs.
- The button opens a sheet (« Mettre à jour le PC ? », « Redémarrer le daemon ? ») with the versions and the passkey
  line, then confirms. Without a passkey on this phone, the sheet leads to « Protéger les accords » instead.

**Progress** (« En cours », « Redémarrage », « Terminé »): steps « Confirmée avec l'appareil », « Installation par
npm », « Redémarrage du daemon », « Retour du lien ». Done when a snapshot comes with `daemon.version` ≥ the version
asked for (for a restart: any new snapshot after the link came back). No such snapshot within 4 minutes (Desktop's
`DAEMON_STALL_MS`): failed, « Le PC ne répond plus ». The progress lives in the store, not in storage: a reload shows
the card again from the versions.

**Failures** (« Sessions en danger »): the card in the danger colour, « Rien n'a changé : il reste en x », one phrase per
reason, « Réessayer ». For `npm-failed`: « npm a échoué sur le PC. Le détail est dans le journal du daemon. »

**Équipes** (« Depuis Équipes »): the « mettez Ledge à jour sur le PC » notice of #129 gains « Mettre à jour le PC », a
link to Connexion, which says what this PC allows. Not conditioned on `update`: that notice only shows for a PC that does
not announce `teams`, i.e. one older than this design, which never sends `update` either.

### 3.5 The first update stays by hand

The flags come with this design (0.27.0). A daemon before it (0.26.0 and older) announces neither: the phone shows
« Mettez Ledge à jour sur le PC », and that one update is done on the PC. Every later one can come from the phone.

### 3.6 Known effect on Desktop

A phone-started update restarts the daemon under a connected Desktop. Desktop ignores the `update.progress` it did not
ask for, and may show its « daemon unreachable » cue for the few seconds of the restart. Accepted: no Desktop change
(§2).

## 4. Tests

- Protocol: the new purpose, `confirm.prepare` with `action`/`version`, the two operations, the two server messages;
  `daemon.failed` has no `detail` nor `command`.
- Updater: `restart` refuses `busy`, `no-systemd`, `sessions-at-risk` without calling systemctl; restarts and stays busy
  otherwise.
- Gateway: the snapshot flags from `daemonInfo`; each refusal of §3.2 in order; a challenge for `update@0.26.0` refused
  for `update@0.27.0` and for `restart`; progress and failure forwarded to the phone without detail or command; no
  `ClientMessage` reaches `restart`.
- Store (versions compared with `compareVersions` of `@ledge/ui/semver`, already a dependency of the app): progress from `daemon.progress`, done on a snapshot of the version, failed on `daemon.failed` and after 4
  minutes.
- Screens: each state of the mockup; the Équipes button only with `update`.

## 5. Left to the builder

- Whether « Terminé » stays until the screen is left or fades after a few seconds.

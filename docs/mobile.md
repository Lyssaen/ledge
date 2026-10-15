# Ledge on the phone

An installable web app (PWA) that shows your agent sessions on your iPhone, from anywhere your tailnet reaches, lets you answer a pending permission, plan or question, read each agent's thread, send an instruction to an idle agent, watch its terminal and interrupt it while it works. It cannot launch, kill or rename anything. It can notify you when an agent needs you (see [Notifications](#notifications)); free-text answers to a question come in a later lot.

The whole path (Tailscale on Windows, the daemon in WSL2, the PWA on the phone) has been built and tested in WSL and in a browser. It has **not been validated on a real iPhone yet**: see [the feasibility report](spikes/2026-10-14-ledge-mobile-feasibility.md).

## How it reaches the phone

```
iPhone (Tailscale) -- https://<machine>.<tailnet>.ts.net --> tailscale serve (Windows)
    --> http://127.0.0.1:47832 --> ledge daemon, remote listener (WSL2)
```

The daemon has two listeners. The usual one, `127.0.0.1:47831`, is untouched and stays local. The remote one, `127.0.0.1:47832`, serves the app under `/m/` and one WebSocket at `/m/ws`; it is the only thing `tailscale serve` publishes. Nothing is opened to the internet (no Funnel) and nothing listens on your LAN.

## Prerequisites

1. Tailscale on the Windows host and on the iPhone, both in the same tailnet.
2. MagicDNS and HTTPS certificates enabled for the tailnet (Tailscale admin console, DNS page). The phone needs `https`: installing a PWA and WebAuthn both require it.
3. Ledge installed as usual (daemon running under systemd in WSL2).
4. WSL2 reaching its own services from Windows on `127.0.0.1` (the default localhost forwarding, in NAT or mirrored networking).

## Enable

In WSL, with your machine's tailnet name (the one in the Tailscale admin console, `<machine>.<tailnet>.ts.net`):

```sh
ledge mobile enable --origin https://<machine>.<tailnet>.ts.net
```

The origin must be `https`, a host name only, on the default port. The command writes `~/.ledge/mobile.json` (mode 0600), and the daemon starts the remote listener at once.

Then, on Windows, publish the listener:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:47832
```

This is the planned form of the command. It has not been confirmed on an installed Tailscale version yet; if the flags differ on yours, check `tailscale serve --help` (the target is always `http://127.0.0.1:47832`, WebSocket included).

`ledge mobile status` prints the origin, whether the listener is up, and the paired phones.

## Pair a phone

1. On the PC, open Ledge, Settings, Mobile tab. Press "Pair a phone": the code (six digits) and a QR appear, valid for 2 minutes.
2. Scan the QR with the iPhone camera. It opens the app in Safari. Install it to the home screen (Share, "Add to Home Screen") and open it from there.
3. Enter the six-digit code, name the phone, and confirm with Face ID or the passcode. This registers a WebAuthn key bound to the phone.
4. The phone is now listed in Settings, Mobile.

The code is wrong five times, or older than 2 minutes: the window closes and you start again on the PC. Only one pairing window is open at a time.

Reconnecting never asks for Face ID again: the app keeps a device token in its own storage and sends it when the socket opens. Without a valid token (or if the app's storage is wiped), the app falls back to pairing.

## Revoke

In Settings, Mobile, press "Remove" next to the phone. The device is forgotten and its open connection is closed within seconds; the app returns to the pairing screen. A phone is also unpaired by deleting `~/.ledge/devices.json` and restarting the daemon.

To turn the whole thing off:

```sh
ledge mobile disable
tailscale serve --https=443 off     # on Windows
```

## What the phone can see, and what it cannot do

It sees the session list grouped by repository (with an unread mark when an agent replied since you last opened its thread), each session's state, its pending permission or question, the thread (your prompts, the agent's replies, the decisions taken, from the phone or the PC) and the terminal preview. Tool actions and their outputs stay on the PC. It never receives the tmux session name, the launcher command, the recent folders or the daemon's version details.

The daemon accepts eight commands from a phone: `snapshot.request`, `session.decide`, `decide.prepare`, `operation.status`, `session.reply`, `session.history`, `session.read` and `session.interrupt`. Kills, launches, renames, folder commands, Ask Ledge, device management and `mobile.configure` are refused. The list is an explicit allow-list in the daemon (`MOBILE_COMMANDS`), and a test pins it so that a later lot cannot widen it by accident.

### Threads, instructions, terminal and interrupt

The Agents tab lists sessions by repository; opening one shows its thread. The thread is the daemon's shared history (`~/.ledge/history/`) reduced to what was said and decided. Which replies you have read is kept per phone in `devices.json`; the PC overlay has no unread marks.

- An instruction typed in the thread goes to the agent only when it is idle with nothing pending; a busy agent refuses it (`agent_busy`) and nothing is typed or queued. The draft stays in the field until the daemon confirms delivery, and a lost link is only checked, never resent.
- The terminal view is read-only: the preview lines, no keyboard. Its one action is Interrupt (the agent's own interrupt key: Esc, or Ctrl-C for Cursor Agent), enabled only while the agent works and sent once per operation. "Applied" means the keys were sent; the agent's own reply shows whether it stopped.
- Operations (decisions, instructions, interrupts) are remembered in the daemon's memory only. After a daemon restart the phone reads `unknown` for an older operation and you look at the current state instead.

### Decisions from the phone

A phone names the request it answers (id and version) and an operation id. The daemon checks that the session still waits on exactly that request before typing anything, and replays the known result if the same operation arrives twice.

Risk policy, validated on 2026-10-14 without change:

- Accepting a request the daemon classifies as low risk (for example a read-only command inside the project) needs no further check.
- Accepting anything else, or a request with no risk at all, needs a WebAuthn assertion from the paired phone. The phone first sends `decide.prepare` and receives a single-use challenge bound to its device, the session, the request, its version and the decision. The assertion is verified against the key stored at pairing, and the counter is updated.
- Denying never needs an assertion.
- Questions are answered without a device check, by option number or in free text ("Autre réponse", see below), and only while the daemon classifies them low risk.
- The PC overlay decides without WebAuthn, as before.

#### Autre réponse (free answer to a question)

Under the options of a question the phone can offer "Autre réponse". Choosing it shows a field, "Votre réponse à <bot>" (placeholder "Précisez votre choix…"); "Envoyer ma réponse" stays disabled while the text is empty or cannot be sent. The phone sends `session.reply { other: true, text, pendingId, pendingVersion, operationId }` and the daemon types the text into the dialog's "Type something." row, then Enter. It is never read as an option number.

- Which tools: only those whose capabilities say `freeTextAnswer`, which the PC sends in the snapshot. Today: Claude Code. Codex and Cursor Agent do not offer it (not verified yet: the free field of their dialogs has not been captured), and a PC that sends no capabilities hides it too.
- What a free answer may be: trimmed, 1 to 2000 characters, on one line. A line break, a control character, a bidi override or a zero-width space is refused. The phone checks this with the same rule as the PC and says why before sending (one line, 2000 characters at most); a trailing line break counts. The PC checks again (`invalid`) and a tool that cannot do it answers `unsupported`.
- Like an option number it needs no device check, only on a low-risk question, once per operation, never queued or resent.

#### What asks for the device check, and why

The rule is "when in doubt, ask": a request is low risk only if the daemon can prove it. Everything else asks for Face ID or the passcode before the phone can accept, because from a pocket you cannot judge it the way you would at the terminal. The reasons the phone names:

- `pushes`: any `git push`. A push with `--force` (or `-f`, `--force-with-lease`), `--delete`/`-d`, `--mirror`, `--prune`, or any refspec starting with `+` or `:` (for example `git push origin :main`) is described as able to replace or delete the remote history, whichever refspec carries it.
- `destroys` (`rm -r`, `git reset --hard`, `git clean`, `git branch -D`, `git checkout -- …`), `deploys`, `publishes` (`npm|pnpm|yarn publish`), `pipes_to_shell` (`curl … | sh`) and `network` (WebFetch, WebSearch).
- `sensitive_path` and `writes_outside_folder`: a path outside the project folder, under `.git`, `.env*`, `~/.ssh` or `~/.ledge`, or with a `~`.
- `script`: running `pnpm`, `npm`, `node`, `make`, `bash`, `python`, `./x`, and so on, since what they run is not visible in the command.
- `plan`: accepting a plan.
- `shell_syntax`, `unsafe_flag` and `unknown`: the stricter parsing rules. A command with a quote, a backslash, `$`, a backtick, a glob (`* ? [ ]`), braces, `;`, `&`, `|`, `<`, `>` or a control character is never low risk, because the shell may rewrite it before it runs and the words the daemon read are not what would execute (`ls "$(rm -rf x)"` reads like `ls`). Flags that run a program or write a file (`-exec`, `-delete`, `--output`, `-c`, ripgrep's `--pre`) and any command not on the small read-only list also ask.

Low risk is deliberately narrow: `ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `rg`, `grep`, `find`, a read-only `git` (`status`, `diff`, `log`, `show`, `rev-parse`, a plain `branch` listing) inside the project folder, a read inside the folder, an edit inside the folder that touches no sensitive path, and a question.

The confirmation shows the command, what it will do, where it goes, and a button that opens the device check. The PC is asked for the challenge when the dialog opens, not on the tap, because iOS only allows the Face ID prompt directly from a tap. A challenge held for more than about a minute is dropped and a new one is fetched (one more tap), judged on the phone's own clock so a wrong phone clock cannot make it expire. Closing the dialog, cancelling Face ID, losing the link or a request that changed in the meantime sends nothing.

#### What the phone says about delivery

A decision is never queued and never resent. After a tap the request shows one of: sending, "receipt not confirmed" (the link dropped, state unknown: the phone only checks the result, it never sends again), applied, rejected with the reason, or unknown. If the request changed while you looked, the buttons wait until you have re-read it. A request handled elsewhere says so.

Some of the phone's wording was written during implementation (for instance "J'ai relu la demande" on the re-read button, and the confirmation and delivery messages) and has not been reviewed by the user yet; the exact copy is in `apps/mobile/src/copy.ts`.

### Testing a decision on the iPhone (R4, R5, R8 and R10, pending on device)

1. In a throwaway directory run `git init` then `git init --bare ../fake-remote.git` and `git remote add origin file://$PWD/../fake-remote.git`, with one commit. Nothing real is at risk.
2. Start a Ledge Claude session there (`ledge claude`), with the phone paired and open on the session.
3. Ask the agent to run `ls`: the phone offers Accept; tap it. Expect one accept, applied, no Face ID prompt.
4. Ask the agent to run `git push --force origin HEAD`: the phone must ask for Face ID. Cancel it: nothing is typed and the PC prompt stays. Retry and confirm: the push goes to the fake remote only.
5. Answer a question by tapping an option: applied, no Face ID prompt.
6. R5: tap "Allow once" on a `ls` request, then switch to airplane mode at once. Expect "receipt not confirmed", then, after reconnecting, the exact state (applied or not), and a single `ls` in the pane.
7. R8: lock the phone for 10 minutes during an active session, then reopen the app: it reconnects by itself, refreshes, and checks any open operation.
8. Check `~/.ledge/daemon.log` for the operations and that no assertion or token appears in it.
9. R10: have a real Claude Code session ask an `AskUserQuestion` (for instance "Ask me which theme to use, with three options"). On the phone choose "Autre réponse", type a sentence with the soft keyboard, send. Expect the agent to receive the text word for word, then the next question or the end of the dialogue. Try a trailing line break (the phone refuses it) and 2001 characters (refused). Then open a Codex and a Cursor Agent question: "Autre réponse" must be absent.

## Notifications

The PC can wake the phone when an agent asks for a permission or a plan, asks a question, or finishes a turn, even with the app closed. It uses Web Push, which on iPhone works only from the installed home-screen app (iOS 16.4 or later).

### Turn them on

- At the end of pairing, step 4 offers "Activer les notifications"; "Plus tard" skips it.
- Later, open the Connexion panel (the settings icon in the app header). The Notifications row reads "Activées" or "Désactivées"; when off, the button below it asks again. Press it yourself: iOS only shows the permission prompt from a tap.
- The button stays disabled ("Connexion au PC...") until the PC has answered, and says so if the PC has no push. If the PC did not receive the subscription, or refused it (the daemon answers with an error within 1.5 s), the panel says so and you can retry. A refusal of the permission is final until you change it in iOS settings.
- The first phone to pair makes the PC's push key (`~/.ledge/vapid.json`, 0600). If that file is lost or replaced, the phone's subscription no longer matches: on the next connection the Connexion panel shows "Désactivées" with a message asking you to enable again, and the phone does not send the old subscription.

### Turn them off

There is no off switch in the app. Either disable Ledge in iOS Settings, Notifications (the PC then gets a "gone" answer from the push service and forgets the subscription), or press "Remove" for that phone in Settings, Mobile on the PC, which forgets the phone and its subscription. `ledge mobile disable` stops the remote listener, so no new subscription can arrive, but does not delete existing ones.

### What a notification says, and the lock screen

| Event | Title | Body |
| --- | --- | --- |
| Permission or plan request | Votre accord est demandé | task title, bot name and, when the agent gave a specific one, its motive |
| Question | `<bot>` a une question | task title |
| Turn finished | `<bot>` a terminé | task title |

Never the command, the question or the reply. The motive is the agent's own wording and may paraphrase the command, so treat it as a hint, not as what will run. A notification has no Allow or Deny button: a tap opens that request in the app (or "Déjà traitée sur le PC" if it was handled meanwhile), and accepting there follows the usual risk policy, Face ID included.

Notifications appear on the lock screen according to iOS settings (Settings, Notifications, Ledge, Show Previews). If task titles are private for you, set previews to "When Unlocked" or "Never": iOS then hides the text, and the app badge (the number of requests waiting) stays. Each request replaces its previous notification instead of stacking, and at most one "finished" notification per session is sent every 60 s.

Delivery is the push service's job (Apple), not Ledge's: it is best effort, can be late, and Ledge does not retry. The PC contacts the push service from WSL, using the proxy of your login shell when there is one; a failure is written in `~/.ledge/daemon.log` and the app stays usable.

### Testing notifications on the iPhone (R6 and R9, pending on device)

R6, with the phone locked and the app closed (swiped away):

1. Start a Ledge Claude session in a throwaway directory and ask it for ten successive commands that need approval (for example ten different `touch` files), one request at a time, noting each time the request appears on the PC.
2. For each one, note when the notification shows on the phone. Compute the median and the maximum delay and write them in the feasibility report as measurements, not as a promise.
3. Check the lock screen: title and task only, never the command. Tap one: the app opens on that request. Handle another on the PC first, then tap its notification: "Déjà traitée sur le PC".
4. Check the app icon badge equals the number of requests still waiting, and clears at zero.

R9, from the PC:

1. With the daemon under systemd and no proxy, trigger a request: the notification arrives.
2. Set a proxy in your login shell (`HTTPS_PROXY`), restart the daemon, trigger another: it arrives through the proxy.
3. Make the push service unreachable (a wrong proxy, or block the host): the request is not delivered, `~/.ledge/daemon.log` has a `push to ... failed` line, and the app and the overlay show no error.

## Files

| File | Content |
| --- | --- |
| `~/.ledge/mobile.json` | The origin and its host (the WebAuthn relying party). Absent means the phone access is off. 0600. |
| `~/.ledge/devices.json` | The paired phones: id, name, dates, WebAuthn public key and counter, and the SHA-256 of the device token (never the token), and the push subscription when notifications are on. 0600. |
| `~/.ledge/vapid.json` | The push key pair (VAPID) and the origin it speaks for. Made when the first phone pairs, never regenerated. 0600. |

## Troubleshooting

- "Daemon not running" from `ledge mobile`: start a session or `ledge daemon`.
- The page loads but the app stays "offline": the origin in `mobile.json` differs from the URL in the browser (the socket's `Origin` must match exactly); see `~/.ledge/daemon.log` for refused upgrades.
- The page does not load: `tailscale serve status` on Windows, then check that the PC is awake and Tailscale is connected on both ends.
- No notification arrives: check the Connexion panel (Notifications must read "Activées"), iOS settings for Ledge, that the app was opened from the home-screen icon, and `~/.ledge/daemon.log` for `push` lines.
- Refused origins, failed pairings and bad tokens are all logged in `~/.ledge/daemon.log`.

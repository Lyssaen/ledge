# Ledge on the phone

An installable web app (PWA) that shows your agent sessions on your iPhone, from anywhere your tailnet reaches, lets you answer a pending permission, plan or question, read each agent's thread, send an instruction to an idle agent, watch its terminal and interrupt it while it works. It cannot launch, kill or rename anything; notifications and free-text answers to a question come in later lots.

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
- Questions are answered without a device check, by option number only, and only while the daemon classifies them low risk. Free text from the phone is not supported yet.
- The PC overlay decides without WebAuthn, as before.

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

### Testing a decision on the iPhone (R4, R5 and R8, pending on device)

1. In a throwaway directory run `git init` then `git init --bare ../fake-remote.git` and `git remote add origin file://$PWD/../fake-remote.git`, with one commit. Nothing real is at risk.
2. Start a Ledge Claude session there (`ledge claude`), with the phone paired and open on the session.
3. Ask the agent to run `ls`: the phone offers Accept; tap it. Expect one accept, applied, no Face ID prompt.
4. Ask the agent to run `git push --force origin HEAD`: the phone must ask for Face ID. Cancel it: nothing is typed and the PC prompt stays. Retry and confirm: the push goes to the fake remote only.
5. Answer a question by tapping an option: applied, no Face ID prompt.
6. R5: tap "Allow once" on a `ls` request, then switch to airplane mode at once. Expect "receipt not confirmed", then, after reconnecting, the exact state (applied or not), and a single `ls` in the pane.
7. R8: lock the phone for 10 minutes during an active session, then reopen the app: it reconnects by itself, refreshes, and checks any open operation.
8. Check `~/.ledge/daemon.log` for the operations and that no assertion or token appears in it.

## Files

| File | Content |
| --- | --- |
| `~/.ledge/mobile.json` | The origin and its host (the WebAuthn relying party). Absent means the phone access is off. 0600. |
| `~/.ledge/devices.json` | The paired phones: id, name, dates, WebAuthn public key and counter, and the SHA-256 of the device token (never the token). 0600. |

## Troubleshooting

- "Daemon not running" from `ledge mobile`: start a session or `ledge daemon`.
- The page loads but the app stays "offline": the origin in `mobile.json` differs from the URL in the browser (the socket's `Origin` must match exactly); see `~/.ledge/daemon.log` for refused upgrades.
- The page does not load: `tailscale serve status` on Windows, then check that the PC is awake and Tailscale is connected on both ends.
- Refused origins, failed pairings and bad tokens are all logged in `~/.ledge/daemon.log`.

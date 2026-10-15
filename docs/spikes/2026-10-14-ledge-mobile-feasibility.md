# Ledge on the phone: feasibility on a real iPhone

**Status: not run.** Task 0 of the [master plan](../superpowers/plans/2026-10-14-ledge-mobile.md) needs the user's iPhone and the Windows Tailscale install; lot 1 was built without it. Every hypothesis below is therefore **to be verified on device**, and the code is written to fall back as the plan's table describes. Nothing in this page has been observed yet.

## Hypotheses

| # | Hypothesis | Status |
| --- | --- | --- |
| H1 | `tailscale serve` on Windows publishes `https://<machine>.<tailnet>.ts.net` to `http://127.0.0.1:47832`, WebSocket included, and WSL2's localhost forwarding reaches the daemon (NAT or mirrored). | to verify on device |
| H2 | HTTPS certificates and MagicDNS are enabled on the user's tailnet. | to verify on device |
| H3 | In a PWA installed on the iOS home screen, `navigator.credentials.create/get` works with `rpId` = the `ts.net` host and `userVerification: 'required'`. | to verify on device |
| H4 | An iOS passkey can sync through iCloud Keychain; it stays unusable without the device token. | to verify on device (lot 2) |
| H5 | Safari's storage and the installed app's storage are separate; the token (localStorage) of the installed app lasts weeks. | to verify on device |
| H6 | Web Push works for an installed PWA (iOS 16.4+): permission asked from a gesture, `push` received with the app closed, `notificationclick` opens or focuses a precise URL. | to verify on device (lot 4) |
| H7 | `navigator.setAppBadge` is available in the iOS service worker. | to verify on device (lot 4) |
| H8 | The daemon under systemd reaches `web.push.apple.com` over HTTPS (proxy from the login shell's environment if needed). | to verify on device (lot 4) |
| H9 | iOS cuts a suspended PWA's WebSocket silently; `visibilitychange` lets it reconnect on return. | to verify on device (lot 2) |
| H10 | `@simplewebauthn/server` (ESM) bundles with tsup for Node 22; `web-push` too. | `@simplewebauthn/server` part exercised by the daemon tests; to confirm on a real build |
| H11 | Codex (`request_user_input`) and Cursor Agent (AskQuestion) accept a free-text keyboard answer. | to verify on device (lot 5) |

## Planned protocol (Task 0)

Throwaway prototype in a temporary folder, not committed; only this report is.

1. Serve a static page and a WebSocket echo on `127.0.0.1:47832` from WSL2.
2. On Windows, run `tailscale serve --bg --https=443 http://127.0.0.1:47832`; note the exact command and Tailscale version that worked. Check H2 in the admin console first.
3. From the iPhone, with Tailscale on and on mobile data, open the `https://` URL in Safari. Check that the page loads and the WebSocket stays open (H1).
4. Add the page to the home screen. Write a value in `localStorage` from Safari and read it from the installed app (H5: separate storage); come back after a few days.
5. In the installed app, run `navigator.credentials.create` then `get` with `rpId` set to the `ts.net` host and `userVerification: 'required'` (H3).
6. Ask for the notification permission from a tap, send a Web Push from the PC with the app closed, tap the notification and check the URL it opens (H6, H7).
7. Record each result as confirmed, refuted or partial. If H1 or H3 is refuted, stop and present the consequences listed in the plan's hypothesis table before going further.

## Validation

To be filled in by the user, on device. R1 to R3 belong to lot 1; R4, R5 and R8 belong to lot 2 and R7 to lot 3, both implemented and covered by tests in WSL and a browser: R4, R5 and R8 have their procedures in [docs/mobile.md](../mobile.md), and all stay unchecked until run on the iPhone. The others are for the later lots.

| # | Lot | Condition | Expected | Result |
| --- | --- | --- | --- | --- |
| R1 | 1 | iPhone on mobile data, Tailscale on; then Tailscale off | The app loads and connects; without Tailscale, the connection drops and the last state stays readable. | [ ] |
| R2 | 1 | Full pairing (QR, install, code, Face ID or passcode); app closed 24 h; iPhone restarted | Still paired. A wrong code shows the error; a code older than 2 min is refused. | [ ] |
| R3 | 1 | "Remove" in Settings, Mobile, app open | The connection closes in under 2 s and the app returns to pairing. | [ ] |
| R4 | 2 | `git push --force` to a local dummy repo (`file://` remote); cancel Face ID, then confirm | Cancel: nothing injected, the request stays. Confirm: injected once, "Authorisation recorded". | [ ] |
| R5 | 2 | Airplane mode right after "Allow once" | "Receipt not confirmed", then the exact state after reconnecting; no double send in the pane. | [ ] |
| R6 | 4 | Locked screen, app closed: 10 successive requests | Notification with no command on the lock screen; a tap opens the right request or "Already handled"; exact badge. Median and maximum delay noted, no commitment. | [ ] |
| R7 | 3 | Soft keyboard on the thread, largest text size, iPhone SE or 320 px | Composer above the keyboard, no main action hidden, no horizontal overflow. | [ ] |
| R8 | 2 | App locked 10 min during an active session, then reopened | Automatic reconnection, state refreshed, open operations checked. | [ ] |
| R9 | 4 | Daemon under systemd, with and without a proxy | Push delivered, or the failure logged in `daemon.log` with no user-facing error. | [ ] |
| R10 | 5 | Free-text answer to a real Claude Code `AskUserQuestion`, from the iPhone, soft keyboard | Text received word for word by the agent; next question or end of dialogue; "Other answer" absent for Codex and Cursor Agent until verified. | [ ] |

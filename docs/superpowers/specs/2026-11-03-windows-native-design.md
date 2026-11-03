# Ledge on Windows without WSL: design

Date: 2026-11-03. Status: design, awaiting approval. Branch `docs/windows-native-study`.
Builds on [the study](2026-11-03-windows-native-daemon-study.md) (Otto) and [the measurements](2026-11-03-windows-native-results.md) (Otto-2).

## 1. Intent

A product owner (PO) works on a locked-down Windows PC where **WSL cannot be installed**, and assume nothing else can be
installed either (no Node, no Git, no admin rights). For this person it is not "native or WSL", it is "Ledge or nothing".

They must use Ledge as the team does: launch and follow **Claude Code and Codex** sessions on their own PC from
**Ledge Desktop**, and see and work with an **OpenRig** team that runs on an **EC2 Linux** instance.

Success: the PO installs one Ledge Desktop installer, without admin rights, and from Desktop launches a Claude or
Codex session in a project folder, sees its state (working, waiting, question, permission), answers it, types into its
terminal, and sees the EC2 machine with its OpenRig seats, like any other machine.

That list is the **whole acceptance bar** of this round (user's decision). Every other Desktop feature (chat, Atelier,
documents and folders, browser captures, tasks and mail between sessions, broadcast, the island, open in editor or
Explorer) is **hidden or disabled in native mode** at first, then enabled one by one in later rounds. Exception: what
the EC2 machine serves (its OpenRig seats and their views) shows as for any remote machine.

## 2. Goals, non-goals, anti-goals

Goals:

- Ledge Desktop starts and works on Windows **without WSL**.
- One per-user installer carries everything Ledge itself needs: Node runtime, Ledge daemon and CLI, Git.
- Local agents on Windows: **Claude Code** and **Codex**.
- The EC2 instance (Linux, Ledge + OpenRig + tmux as today) appears in the PO's Desktop through the existing
  multi-machine SSH link.

Non-goals (this round):

- The phone: no pairing, relay, push or phone terminal on Windows.
- OpenRig on the Windows PC itself.
- Cursor Agent and OMP on Windows.
- Replacing WSL for the existing users: the WSL mode of Desktop stays the default where WSL exists.
- A Windows *service* (session 0); the daemon runs in the user's session.

Anti-goals (would make it a failure even if it runs):

- Asking the PO for admin rights, WSL, or any manual install of a developer tool.
- Agents that die whenever Ledge restarts or updates (today agents outlive a daemon restart: keep that).
- Breaking or slowing the Linux/WSL path: every change keeps the existing tests green on Linux.
- Anything reachable by other users of the PC (named pipes, token, keys): user-only.
- A probe or adapter pressing Enter on a dialog it does not recognize (it happened in the measurements: an upsell got
  accepted).

## 3. Constraints

- Windows 10/11 x64, per-user install (Tauri NSIS `installMode: currentUser`, already the case).
- No WSL, so no tmux, no systemd, no `/proc`, no POSIX signals, no symlinks without Developer Mode, no `chmod`.
- Claude Code is a native `claude.exe`; Codex has a native Windows build. Both are installed per user.
- The Linux/WSL daemon, Desktop's WSL mode, the EC2 side: unchanged behaviour.
- Port `127.0.0.1:47831` (no WSL on the PO's PC, so no conflict there).
- Measurements already settled: `node-pty` 1.1.0 ships win32-x64 prebuilds; Claude under ConPTY renders intact,
  accepts typed input, Ctrl+U, `/exit` (exit code 0); a cold Node start is ~56 ms.

## 4. How it is made (decided)

### 4.1 Phase 0: spike, go/no-go (throwaway)

Before any product work, a throwaway spike answers one question: **can the daemon drive Claude Code and Codex through
ConPTY as reliably as through tmux?**

The spike:

- implements the `Tmux` interface (`packages/ledge/src/tmux.ts`) on `node-pty` + `@xterm/headless`, **in the daemon's
  process** (the separate pane host comes later);
- runs the daemon from a clone with the system's Node on the measurement PC (`%TEMP%\ledge-wintest`), the CLI/TUI as the
  front (no Desktop needed);
- installs Codex on the PC (per user) and uses the already installed `claude.exe`, logged in;
- listens on another port than `47831` (the WSL daemon and Desktop of that PC hold it), through an override;
- hides the system's Git for Windows from the agents' PATH, and puts the Git that the installer will carry (§4.2.5) in
  its place, so the spike sees what the PO's PC will have.

The spike runs on the developer's PC, which has admin rights: it cannot reveal the PO's PC policies. Those are
settled by the snapshot build (§4.3).

Go/no-go checks, each with Claude **and** Codex, in a scratch folder, with harmless prompts only:

1. Launch from Ledge; the session reaches `idle`; the preview shows the screen.
2. A prompt sent from Ledge (short, then a multi-line paste of ~2 KB) arrives whole and is submitted once.
3. States follow the agent: `working` while it runs, back to `idle` after.
4. A permission dialog (e.g. asked to create a file, in a mode that asks) is detected, shown, answered from Ledge
   (approve, then deny with Escape).
5. A question dialog (Claude's `AskUserQuestion`) is detected and answered by option number.
6. Hooks fire: the agent's hook runs the Ledge CLI on Windows and the daemon receives the event.
7. Interrupt (Escape / Ctrl+C) and kill end the agent and its children; the exit code reaches the daemon.
8. Windows glyphs (`>` prompt, `√` selections) are handled.

**Go** = all eight pass for Claude and at least 1–3, 6, 7 for Codex, after adapter fixes the spike may make. **No-go**
= a check that cannot be made reliable (e.g. ConPTY reorders or drops input bursts), reported with captures; then we
stop before any installer work. The spike's findings are written to
`docs/superpowers/specs/2026-11-0x-windows-native-spike.md`; its code is not merged as is.

### 4.2 After a go: the product, in this order

1. **Pane host** (study §3.1): a separate long-lived process owning one ConPTY + headless terminal per agent, behind a
   `conptyPanes()` implementation of `Tmux`; named pipes `\\.\pipe\ledge-<user>-…` restricted to the current user;
   one Job Object per pane; started outside the daemon's job so agents survive a daemon restart; versioned protocol.
   `controlArgs` (phone) is not implemented. `paneCwd` returns null.
2. **Daemon on Windows** (study §3.2): paths (`path.win32`, `%USERPROFILE%\.ledge`), environment from the registry
   instead of a login shell, stop over the protocol instead of signals, no `/proc`, resolve real `.exe` binaries
   (never spawn `.cmd` shims), retry `rename` on `EPERM`/`EBUSY`, permissions via ACL where `chmod` was used. The
   real-path bugs the test run exposed in features that stay hidden (chat: `chat/context.ts` `stepFor`, the home/root
   filter in `chat/service.ts`) wait for the round that enables them.
   Add a `.gitattributes` (`* text=auto eol=lf`) so Windows checkouts keep LF fixtures.
3. **Hooks on Windows**: `ledge setup` writes hook commands as absolute, quoted paths to the bundled `node.exe` and the
   CLI, into Claude's `settings.json` and Codex's `hooks.json`.
4. **Desktop native mode** (study §3.2, Desktop row): Desktop **supervises** the daemon (and the pane host): starts it
   at launch with the bundled Node, restarts it on crash, stops it over the protocol on quit — no scheduled task, no
   service. Token read from `%USERPROFILE%\.ledge\token` directly; embedded terminal runs `node cli attach <id>`
   in a ConPTY with no `wsl.exe`; "open in Windows Terminal" runs the same through `wt.exe`; no WSL keep-alive.
   Mode choice: **native when WSL is absent**, WSL mode otherwise (unchanged for the current users).
   In native mode the fronts hide the features outside the acceptance bar (§1).
   **Quitting Desktop** does not stop the daemon nor the agents, as today under WSL where the daemon is a service:
   they keep running, and the next Desktop launch (at login, autostart already on) finds the running daemon and adopts
   it. A logoff ends them all, as a WSL shutdown does today.
5. **Installer**: the existing NSIS per-user installer also carries a pinned Node runtime, the built Ledge daemon/CLI
   (`dist`, production `node_modules` including `node-pty`'s prebuild) and **PortableGit** (Git with its bash: native
   Claude Code on Windows relies on Git Bash, MinGit has none). Updates ride Desktop's existing
   Tauri updater: one version for Desktop + daemon. An update restarts the daemon, never the running agents.
6. **Agents**: Claude and Codex are not in the installer. Desktop shows whether each is found and offers to install it
   per user from its official Windows build. *(My call, see §6.)*
7. **EC2 machine**: the EC2 runs Ledge (Linux, as today) and OpenRig. The PO's daemon reaches it with Windows' own
   OpenSSH client (`C:\Windows\System32\OpenSSH\ssh.exe`) through the existing SSH machine link
   (`transport/ssh.ts`, `ledge bridge` on the far side). Ledge only needs `ssh` found and the user's `~\.ssh\config`
   alias; key provisioning for the PO is an ops task, outside Ledge. `ledge bridge` serves the daemon of the SSH user:
   the PO logs in to the EC2 as the Linux user whose daemon holds the OpenRig seats (an access decision for ops).
8. **Tests and CI**: the Windows CI job runs the daemon's suite on `windows-latest`; Linux-only tests (tmux, systemd,
   signals, symlinks) are skipped there by an explicit platform guard, and the pane host has its own tests on Windows.

### 4.3 Testing on the PO's PC: the snapshot build

The work reaches the PO's PC through the **snapshot channel** (branch `feat/snapshot-update-channel`, workflow
`snapshot.yml`, which publishes npm and Desktop snapshots): the native-mode work is merged there and a snapshot Desktop
installer is built and installed on the PO's PC (user's decision). That run is the first contact with the PC's
policies and settles:

- whether the unsigned per-user installer and its `node.exe`, `.node` and Git binaries run there (SmartScreen,
  AppLocker/WDAC, Defender): if not, code signing becomes a task;
- whether `ssh.exe` is present and port 22 to the EC2 is open: if not, another transport becomes a task;
- whether the official Claude and Codex downloads pass the network (proxy).

Nothing is released on the stable channel before the snapshot passed the acceptance bar (§1) on that PC.

## 5. Risks

1. ConPTY fidelity on input bursts and dialogs (the spike's reason to exist).
2. Claude Code's hooks on Windows run through a shell Claude chooses (Git Bash when present?): the hook command format
   must work there; MinGit has **no bash**. To settle in the spike (check 6).
3. Codex on Windows: sandbox behaviour without WSL, and its approval prompts under ConPTY.
4. Windows' OpenSSH client may be missing or disabled by policy on a locked PC; then the EC2 link fails with a clear
   message (bundling an SSH client is out of this round).
5. Antivirus / Defender on a bundled `node.exe` and `node-pty`'s `.node` file: slow starts or quarantine.
6. Two platforms to test for every adapter change.

## 6. Left to the builder, and the calls Otto-2 made

My calls (not asked of the user), open to change:

- Claude and Codex are installed by Desktop on demand, per user, not bundled (size, and both update themselves).
- Desktop picks native mode only when WSL is absent; no user setting this round.
- Desktop supervises the daemon instead of a scheduled task.
- The spike runs in-process; the separate pane host is product work.
- PortableGit rather than MinGit (bash for Claude Code), and the spike hides the system Git.
- Quitting Desktop leaves the daemon and agents running, as under WSL today.
- Codex runs with the strictest sandbox/approval mode it supports per user on Windows; if none works without admin
  rights, it asks for approvals (no blanket bypass).

Left to the builder:

- Exact pane-host IPC framing and the tmux key-name → VT table.
- How the bundled files are laid out under the install folder, and how the pane host survives a Desktop update
  (e.g. versioned folder).
- Which Node version is pinned (22 LTS or later).
- The ACL mechanism for `token` and keys.

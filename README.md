<img src="apps/overlay/src-tauri/icons/128x128@2x.png" alt="The Ledge mascot" width="96" align="right">

# Ledge

A living island on the top edge of your Windows screen, centred like a dynamic island, that follows every agentic session running in WSL2 (Claude Code, Codex, Cursor Agent), shows which ones are waiting for you, and lets you answer or approve without hunting for the right terminal tab. From the list you can also ask Ledge about the running sessions: it reads, it never types into a pane.

Personal project. Windows host + WSL2 only.

**[Take the tour](docs/tour.md)**: every screen of the overlay, captured from the real app.

<p>
  <img src="docs/screens/list-dark.png" alt="The list of sessions" width="300">
  <img src="docs/screens/session-permission-dark.png" alt="A permission request answered from Ledge" width="300">
  <img src="docs/screens/bubble-dark.png" alt="The bubble" width="300">
</p>

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Components](#components)
- [Session lifecycle](#session-lifecycle)
- [Asking Ledge](#asking-ledge)
- [Protocol](#protocol)
- [Session model](#session-model)
- [Files and settings](#files-and-settings)
- [Security and failure model](#security-and-failure-model)
- [How to install?](#how-to-install)
- [Development](#development)
- [Design documents](#design-documents)
- [Status and known limits](#status-and-known-limits)

## How it works

1. You start an agent with `ledge claude` instead of `claude`. The launcher puts the agent in a tmux session on a dedicated tmux server, registers it with the daemon, renames the Windows Terminal tab after the bot (`Otto · <topic or project>`) and attaches your terminal to it. Or you start one from the overlay's list (`+`): the daemon spawns the same tmux session itself and, if asked, the overlay opens a Windows Terminal tab on it (`ledge attach <id>`). The launch form opens on the default harness from Settings.
2. The agent's own hooks (installed once by `ledge setup`) call `ledge hook <Event>` (Codex: `ledge hook codex <Event>`, Cursor Agent: `ledge hook cursor <event>`) on every lifecycle event. Each call forwards one message to the daemon and exits in a few milliseconds.
3. The daemon keeps the state of every session, polls each tmux pane once a second to detect prompts the hooks do not report and to build a terminal preview, and pushes every change over a local WebSocket.
4. The Windows overlay shows one mascot per session in the island, stretches it into a bubble when a session waits for you, and sends your decision back. The daemon types it into the right pane and checks that the prompt went away.
5. From the list, "Ask Ledge" sends a question to the daemon. The daemon writes a read-only context folder and runs the chosen harness headless (Claude Code, Codex or Cursor Agent). The overlay streams the steps and the answer. Ledge never types into a session from the chat.

## Architecture

Approach: a Tauri overlay on Windows and a Node daemon in WSL2, with one WebSocket transport. WSL2 exposes its loopback to Windows, so the overlay reaches the daemon on `127.0.0.1:47831` with no network setup.

```mermaid
flowchart LR
  subgraph win["Windows host"]
    direction TB
    ov["Ledge overlay (Tauri 2)<br/>React UI in a WebView2 window<br/>Rust shell: cursor poller, outside clicks, frame, focus, monitors, Ctrl+Alt+L / N"]
    wt["Windows Terminal tab<br/><i>Otto · my-project</i>"]
    ov -. "focus_terminal (Win32, by tab title)" .-> wt
  end

  subgraph wsl["WSL2"]
    direction TB
    daemon["ledge daemon<br/>store + reducer, poller, chat, WebSocket server<br/>127.0.0.1:47831"]
    launcher["ledge claude<br/>(launcher)"]
    hook["ledge hook Event<br/>(one message, then exit)"]
    subgraph tmux["tmux server -L ledge"]
      pane["session ledge-id<br/>claude, LEDGE_SESSION=id"]
    end
    journal[("~/.ledge/sessions.json<br/>daemon.log · daemon.pid")]
  end

  ov <-- "WebSocket: snapshot, session.updated,<br/>session.preview / reply, decide, chat…" --> daemon
  launcher -- "session.register / unregister" --> daemon
  launcher -- "new-session, attach" --> pane
  wt -- "terminal attached to" --> pane
  pane -- "Claude Code hooks (stdin JSON)" --> hook
  hook -- "session.event" --> daemon
  daemon -- "capture-pane every 1 s<br/>send-keys on decision" --> pane
  daemon --- journal
```

Three principles shape the code:

- **The daemon is the only source of truth.** The overlay holds no business logic: it renders the sessions the daemon pushes and sends commands back. The launcher and the hooks are thin clients of the same socket.
- **Hooks first, pane second.** Hook events drive the state machine. The pane is read as a complement: it catches prompts the hooks do not announce, feeds the preview, and confirms that an injected answer was taken. A pending request that came from a hook is never replaced by one guessed from the pane.
- **Nothing in Ledge may hurt the agent.** A hook always exits 0 and gives up after 100 ms. If the daemon is missing, `ledge claude` still starts the agent, untracked, and says so.

## Components

The repository is a pnpm workspace with three packages.

### `packages/protocol`

Zod schemas shared by everything else: the session model, the hook-derived `SessionEvent`, and the two message unions (`ServerMessage`, `ClientMessage`). `PROTOCOL_PORT` lives here. The CLI bundles it (tsup `noExternal`); the overlay imports it directly.

### `packages/ledge` (WSL, Node 22, TypeScript)

One binary, `ledge`, with seven commands. Source under `src/`:

| Path | Role |
| --- | --- |
| `cli/index.ts` | Entry point and dispatch. The `hook` path is isolated so it can never throw or exit non-zero. |
| `cli/launch.ts` | `ledge <claude\|codex\|cursor> [--name <bot>] [-- args]`: finds or spawns the daemon, picks an id and a name, creates the tmux session with `LEDGE_SESSION` and `LEDGE_NAME` in the agent's environment, registers, renames the tab, attaches, and reports the agent's exit code through `session.unregister`. |
| `cli/hook.ts` | `ledge hook [codex\|cursor] <Event>`: maps a Claude Code, Codex or Cursor Agent hook payload (read on stdin) to a `SessionEvent` and sends it, with the agent and its folder for a session the daemon does not know yet. Subagent events carry `helperId`. An `AskUserQuestion` with several questions sends the first one's text and options; later questions and the review come from the pane. |
| `cli/setup.ts` | `ledge setup`: creates `~/.ledge` and merges `ledge hook <Event>` entries into `~/.claude/settings.json` for the twelve Claude Code events, and `ledge hook codex <Event>` entries into `~/.codex/hooks.json` (or `$CODEX_HOME`) for the ten Codex events, and `ledge hook cursor <event>` entries into `~/.cursor/hooks.json` for eight Cursor Agent events, never overwriting what is there. |
| `cli/uninstall.ts` | `ledge uninstall [--purge]`: removes only Ledge's hook entries, the systemd unit and the `~/.local/bin/ledge` link. `--purge` also deletes `~/.ledge`. |
| `cli/status.ts` | `ledge status`: one line per session from a fresh snapshot. |
| `cli/attach.ts` | `ledge attach <id>`: renames the tab after the session and puts this terminal on its pane. What the overlay runs in a new Windows Terminal tab for a session it started itself. |
| `spawn.ts` | `spawnSession`: the tmux session that runs the agent (with `LEDGE_SESSION` and `LEDGE_NAME`) and the `starting` session record. Shared by the launcher and the daemon's `session.launch`. |
| `daemon/index.ts` | `ledge daemon`: loads the journal, prunes sessions whose tmux session is gone, starts the server and the poller, writes `daemon.pid`, saves on SIGTERM/SIGINT. |
| `daemon/store.ts` | In-memory session map with change listeners; applies events through the reducer and saves the journal 200 ms after the last change (atomic write). Also the twelve most recent folders, for the overlay's launch form, and `patch` for repo/branch fields that skip the reducer. |
| `daemon/state.ts` | The pure reducer `reduce(session, event)`: the whole state machine, including helper (subagent) routing, the hook-over-pane priority, the session topic (`PaneTitle`, `Renamed`, first `UserPromptSubmit`) and `lastReply` from a `Stop`. |
| `daemon/git.ts` | One `git rev-parse` per session: repository name and path, checked-out branch, and whether `cwd` is a linked worktree. |
| `daemon/poller.ts` | Every 1 s captures each live pane (200 lines), hashes it to detect activity, broadcasts a 30-line preview when it changed, runs the adapter's prompt detection on the last 60 lines, reads Claude Code's conversation title (`PaneTitle`), refreshes git fields on the life check (every 5 s), and drops exited sessions after 10 min. |
| `daemon/server.ts` | The WebSocket server on `127.0.0.1:47831`: snapshot on connect (then `chat.history`), broadcast of every store change and preview, and the command handlers. A decision is injected with the adapter's key plan, then verified. `session.launch` checks the folder, spawns the agent with the login shell's environment (see `shell-path.ts`) and answers `session.launched`. `session.rename` sets the topic. Chat commands go to `chat/`. |
| `daemon/folders.ts` | `resolveFolder` (`~` expanded, absolute, existing) and the folder browser's `listFolder` and `createFolder`, which answer with a `folder.listing`. |
| `chat/` | Ask Ledge: `service.ts` keeps one conversation a day per harness (50 turns, 180 s cap), writes `~/.ledge/chat/context/`, and runs `claude.ts` (`claude -p --restricted`), `codex.ts` (`codex exec --sandbox read-only`) or `cursor.ts` (`cursor-agent -p --mode ask`). `LEDGE_CHAT=1` so Ledge's own hooks ignore the run; no API key is inherited. |
| `adapters/` | One adapter per tool (`Adapter` in `types.ts`): prompt detection in the pane, `promptStillVisible`, key plans for accept/deny/reply/interrupt, and preview cleaning. `claude.ts`, `codex.ts` and `cursor.ts` are all implemented. Claude Code's adapter also answers a multi-question `AskUserQuestion` (one tab after another, then the review that has no footer). |
| `tmux.ts` | Thin wrapper over the dedicated server `tmux -L ledge -f ~/.ledge/tmux.conf`. `newSession` runs the tmux client with the pane's PATH: tmux gives a detached session's pane the client's PATH, over `-e`. |
| `shell-path.ts` | The environment a login shell (`$SHELL -l`) starts with. Under systemd the daemon has the bare system environment: `claude` (`~/.local/bin`) does not resolve and no proxy variable is set; an agent launched from the overlay (or Ask Ledge) gets the terminal's on top of the daemon's, or the daemon's alone (logged) when the shell fails. |
| `update/` | The daemon's half of the auto-update: `self.ts` (version, install kind `npm`/`git`/`unknown`, systemd or not, sent in the snapshot), `guard.ts` (refuses when a restart would close live sessions) and `run-update.ts` (`update.daemon`: `npm i -g @paradow/ledge@<version>`, then restarts the service, reporting `update.progress` or `update.failed`). |
| `client.ts`, `names.ts`, `paths.ts`, `log.ts` | WebSocket client for the CLI modes, the list of 64 bot names, `~/.ledge` paths (`LEDGE_HOME` overrides), the daemon log. |

### `apps/overlay` (Windows, Tauri 2 + React 19 + Tailwind 4)

The UI is plain web code under `src/`, developed and unit-tested in WSL; the Rust shell under `src-tauri/` only builds on Windows.

| Path | Role |
| --- | --- |
| `src/daemon/client.ts`, `store.ts` | Reconnecting WebSocket client (backoff 2 s to 30 s) and a `useSyncExternalStore` store: sessions by id, previews, status, last error, recent folders, the launcher command, the last `session.launched` and `folder.listing`, and the day's chat turns (plus the live stream). |
| `src/surface/machine.ts`, `controller.ts` | The surface state machine: modes `handle` (the island at rest, compact or as the discreet strip), `bubble`, `list`, `session`, `settings`, `help`, `launch`, `chat`; timers (dwell 180 ms, leave 500 ms, bubble 4 s, hold 900 ms, unfold 540 ms); a queue of pending asks. Pure reducer with effects, tested without the DOM. |
| `src/surface/useDaemonAsks.ts` | Turns daemon updates into machine events and locks each decision until the daemon confirms it, fails it, or the connection drops. No timer ever resolves a decision. |
| `src/surface/*.tsx` | Handle (the island: resident mascot, a separator, then the session bots in a row, six at most then a "+n" pill; a 10 px strip with one dot per session under a maximised window), Shoulders (the concave fillets on each side of the island), Bubble (the island stretched to 440 px), SessionList (grouped by repository, ask field above the rows), SessionView (permission, question, last reply, terminal preview), ChatView, AskField, LaunchView and its FolderBrowser, SettingsView, HelpView, ReplyCard. |
| `src/surface/groups.ts`, `src/ui/BranchChip.tsx` | List grouping by `repoPath ?? cwd`, and the branch chip (dotted border on a linked worktree). |
| `src/surface/geometry.ts`, `frame.ts`, `scale.ts` | Layout of the island (a 38 px row of 22 px slots, centred on the top edge of the chosen screen or a quarter of the way in) and of the native window frame (`left`, `top`, width, height), with the island and window scale handled as a CSS zoom on their own layer. Every view keeps its top on the screen edge and grows downwards: the list is 380 px; a session and the chat are 480 px (560 px when reading the raw reply). |
| `src/reply/parse.ts` | Turns the agent's last markdown message into a title, a lead, classified sections and questions with options. Ordinary lists keep the markdown's bullets or numbers; done / verified / question blocks stay cards. |
| `src/defaultTool.ts` | The default harness (`ledge.defaultTool`): new sessions and the Ledge chat start on it. Claude Code when nothing valid is stored. |
| `src/bots/` | The mascots: material, pose per state, halo in the state colour, breathing while waiting. |
| `src/keyboard/` | Keyboard navigation (j/k, Alt ←/→ to the previous or next session, y/n, digits for a question's options, Esc) and the first-use coachmark. |
| `src/update/` | The overlay's half of the auto-update: `machine.ts` (the pure update state machine, daemon first then app), `useUpdate.ts` (checks at startup and every 6 hours, drives the daemon and Tauri's updater), `bridge.ts` (the updater plugin, a no-op in a browser), `UpdateCard.tsx` (the card in the list), `prefs.ts`. The About tab of the settings shows both versions. |
| `src/i18n/` | One typed catalogue, French (default) and English, same keys enforced by the type checker. |
| `src/tauri/bridge.ts` | The only file that calls `invoke`: `set_frame`, `set_outside_watch`, `focus_overlay`, `release_focus`, `focus_terminal`, `open_terminal`, `list_monitors`, `set_monitor`, plus the `ledge://outside-click` event and the `Ctrl+Alt+L` and `Ctrl+Alt+N` global shortcuts. Everything degrades to no-ops in a browser. |
| `src-tauri/src/main.rs` | The Rust shell: a borderless, transparent, always-on-top window outside the taskbar; a thread that polls the cursor every 50 ms, reports it in the hot band along the top edge (10 px high, the island plus 40 px on each side) for the hover and the mascot's gaze, tells the page when a maximised or full-screen window holds the foreground on the island's monitor (the discreet strip) and, while a panel shows, emits a press of the mouse outside the window (`GetAsyncKeyState`); window placement at `(left, top)` in physical pixels against the top edge of the monitor's work area; focus hand-back to the previously active window; `focus_terminal` finds the Windows Terminal window whose title matches the bot's tab (Win32 `EnumWindows`); `open_terminal` opens a Windows Terminal tab running `ledge attach <id>` in WSL (`wt.exe -w 0 new-tab`). |

The overlay never talks to tmux or to the agent. Its only two outputs are WebSocket commands to the daemon and the native commands above.

## Session lifecycle

```mermaid
sequenceDiagram
  autonumber
  participant U as You (terminal)
  participant L as ledge claude
  participant D as ledge daemon
  participant T as tmux pane (claude)
  participant H as ledge hook
  participant O as Overlay

  U->>L: ledge claude
  L->>D: connect (spawn detached if absent)
  L->>T: new-session ledge-<id>, LEDGE_SESSION=<id>
  L->>D: session.register {state: starting}
  D-->>O: session.updated
  L->>U: tab renamed, tmux attach

  T->>H: PermissionRequest hook (stdin JSON)
  H->>D: session.event {PermissionRequest, tool, text}
  D->>D: reduce → waiting_permission, pending{kind: permission}
  D-->>O: session.updated
  O->>O: bubble, mascot breathes

  O->>D: session.decide {id, accept}
  D->>T: capture-pane: prompt still visible?
  D->>T: send-keys (adapter key plan)
  D->>T: capture-pane up to 3× / 200 ms
  alt prompt gone
    D->>D: Decided → working
    D-->>O: session.updated
  else still there
    D->>D: InjectFailed → error
    D-->>O: session.updated + error {id, message}
  end

  T->>H: Stop hook
  H->>D: session.event {Stop} → idle
  U->>T: exit claude
  L->>D: session.unregister {exitCode}
  D->>D: exited (dropped after 10 min)
```

Points worth knowing:

- **Daemon lifetime.** `ledge setup` installs a systemd user service (`ledge-daemon.service`, `Restart=on-failure`) and enables linger, so the daemon runs from WSL boot, before any shell is open, and comes back after a crash. The launcher still probes the port: a refused connection means nothing listens (service disabled or no systemd), so it spawns `ledge daemon` detached and retries three times at 500 ms. An open port that does not answer with a valid snapshot is treated as a foreign program and the session runs untracked.
- **Exit code.** The agent runs under `sh -c '"$@"; echo $? > ~/.ledge/exit-<id>'`, so the tmux session can end naturally and the launcher still returns the agent's real exit code.
- **Hook priority.** For 2 s after any hook, prompts detected in the pane are ignored, so a hook's richer description always wins over the pane's guess. Without hooks (a session started with plain `claude`, `source: hook_only`), the pane still gives a read-only view.
- **Rest from the pane.** Some turns end with no hook: a denied request, an Esc. When the pane shows the input box with no running turn (`esc to interrupt` gone) and no dialog for 2 s, outside the hook priority window, the session goes `idle` and a request answered or dismissed in the terminal is dropped. A helper's routed request is left alone.
- **Plan and trust dialogs.** Accepting a plan picks "Yes, manually approve edits", so the permission mode never changes behind your back. The workspace trust dialog of a new folder shows as a permission: accept trusts the folder, deny exits Claude.
- **Helpers (subagents).** Hook events that carry `agent_id` update the helper list on the parent session. A helper's permission request is shown on the parent only when nothing else is pending there, and the parent's underlying state is restored when it is answered.
- **Restart.** The journal is reloaded when the daemon restarts; sessions whose tmux session no longer exists are pruned. The launcher opens a fresh connection to unregister, so a daemon restarted while the agent ran still learns about the exit.

## Asking Ledge

The list's "Ask Ledge" field sits above the sessions, matching the island's mascot ahead of the bots. `/` focuses it, `Enter` on a question sends it, `Enter` on the empty field (or a click on the field's mascot) opens today's conversation without asking. A `+` in the chat header starts a new conversation (`chat.reset`): the day's turns are cleared and the next question opens a fresh harness session.

The overlay sends `chat.ask { qid, text, tool? }`. `tool` is the default harness from Settings (Claude Code, Codex or Cursor Agent). The daemon:

1. writes `~/.ledge/chat/context/` (`sessions.md`, `pane-<id>.txt`, `reply-<id>.md`, `git-<id>.txt`) and adds each session's repository with `--add-dir`;
2. runs one headless, read-only process: `claude -p --restricted` (tools `Read,Grep,Glob` only), `codex exec --sandbox read-only`, or `cursor-agent -p --mode ask`;
3. streams `chat.step` (what it reads), `chat.delta` (the answer as it comes), then `chat.done` or `chat.error`.

One question at a time (a second one gets `chat.error`). A turn that takes more than 180 s is stopped and reported as a timeout, with no retry. A failed resume of the day's session is retried once with a fresh id. The question goes on stdin, never in argv. `LEDGE_CHAT=1` so Ledge's own hooks ignore the run; an inherited `ANTHROPIC_API_KEY` is dropped so the CLI's own login is used. The context folder is deleted when the turn ends. `~/.ledge/chat.json` remembers the day's session id and which harness it belongs to.

Bot names in the answer are links that open that session. Ledge never sends an instruction to a pane from the chat.

## Protocol

JSON messages over one WebSocket, validated with the zod schemas in `packages/protocol` on both ends.

Daemon to clients:

| Message | Meaning |
| --- | --- |
| `snapshot { sessions, recents?, launcher? }` | Sent on connect and on request. Followed by the remembered `session.preview` of each session, then `chat.history`. `recents`: the folders of past sessions (`{ cwd, project, lastAt }`, twelve at most, most recent first). `launcher`: the command that runs `ledge` inside WSL (`[node, cli]`), which the overlay extends with `attach <id>` to open a terminal tab. |
| `session.updated { session }` | Any change to a session. |
| `session.removed { id }` | The session left the list (retired or dismissed). |
| `session.preview { id, lines }` | The last 30 cleaned lines of the pane, sent only when they changed. |
| `session.launched { id }` | To the requester of a `session.launch` only: the session exists (its `session.updated` was broadcast just before). |
| `recents { recents }` | The recent folders changed. |
| `folder.listing { path, parent, entries, error? }` | To the requester of a `folder.list` or `folder.create` only: the folder (resolved, `~` expanded), its parent (`null` at the root) and its subfolders by name, hidden ones left out. A refusal says why in `error`, never in an `error` message. |
| `chat.step { qid, step }` | What Ledge is reading: `sessions`, `pane`, `reply`, `git` or `repo` (`id` / `name` / `path` when they apply). |
| `chat.delta { qid, text }` | The next slice of the answer, as the harness writes it. |
| `chat.done { qid, text, at }` | The finished answer. |
| `chat.error { qid, message }` | The question could not be answered (busy, timeout, cancel, harness missing). |
| `chat.history { turns }` | The day's turns (50 at most), after each snapshot and after each ask or reset. A turn still running has no `answer`. |
| `error { message, id? }` | A rejected command. With `id`, the overlay shows it on that session; without one, a refused launch. |

Clients to daemon:

| Message | Sender | Meaning |
| --- | --- | --- |
| `session.register { session }` | launcher | A new launcher session. A name already in use is replaced by a free one. |
| `session.event { id, event }` | hook | A hook-derived event. An unknown id creates a `hook_only` session. |
| `session.unregister { id, exitCode }` | launcher | The agent ended. |
| `session.decide { id, decision }` | overlay | `accept` or `deny` the pending request. Refused on `hook_only` sessions and when nothing is pending. |
| `session.reply { id, text }` | overlay | Type text into the pane. On a question, only a single option number (`1`–`9`) is accepted: free text would pick the highlighted option. An `AskUserQuestion` with several questions is one number per dialog; the next question (or the review) coming up is success, not a refused answer. |
| `session.rename { id, topic }` | overlay | Name the session's topic (500 characters at most, the hook's prompt cap). An empty topic hands back to the automatic sources (pane title, then first prompt). |
| `session.interrupt { id }` | overlay | Send the adapter's interrupt keys (Esc for Claude Code). |
| `session.kill { id }` | overlay | Kill the tmux session. |
| `session.dismiss { id }` | overlay | Remove a finished or read-only session from the list. |
| `session.focus { id }` | overlay | Acknowledged only; the overlay focuses the terminal itself. |
| `session.launch { tool, cwd, name?, prompt?, continue? }` | overlay | Start a session: `cwd` a WSL folder (`~` allowed, must exist), `name` a preferred bot name, `prompt` the first instruction, `continue` resumes the folder's last conversation. The daemon spawns the agent exactly like `ledge <tool>` would (minus the exit-code wrapper: the poller sees the pane end) and answers `session.launched`. |
| `folder.list { path? }` | overlay | The launch form's folder browser: list a WSL folder's subfolders (home without `path`). |
| `folder.create { parent, name }` | overlay | Make a folder named `name` (no `/`, not `.` or `..`) inside `parent`, then list it. |
| `chat.ask { qid, text, tool? }` | overlay | Ask Ledge. `tool` is the overlay's default harness (`claude` when omitted). |
| `chat.cancel { qid }` | overlay | Stop the running question. |
| `chat.reset` | overlay | Clear the day's turns and start a new harness session on the next question. Refused while a question is running. |
| `snapshot.request` | any | Ask for a fresh snapshot. |

The server accepts connections with no `Origin` header (Node clients) or with the Tauri origins (`tauri://localhost`, `http://tauri.localhost`, the Vite dev server). Any other web page is refused.

## Session model

```
id, name (bot's first name), tool: claude | codex | cursor, cwd, project, title, tmuxSession | null,
topic?, topicSource?: user | pane | prompt,
repo?, repoPath?, branch?, worktree?,
state: starting | working | waiting_input | waiting_permission | idle | exited | error,
pending?: { kind: question | permission | plan | diff, text, tool?, options?, source: hook | pane, helperId?, parentState? },
helpers: [{ id, kind, task, state }],
lastReply?: { text, at },
startedAt, lastActivityAt, lastHookAt?, exitCode?, exitedAt?, lastError?, source: launcher | hook_only
```

`title` is always `${name} · ${topic ?? project}` and is the Windows Terminal tab. `topic` is one line (80 characters after `cleanTopic` in `@ledge/protocol`). Sources, weakest first: the first `UserPromptSubmit` (`prompt`), Claude Code's conversation title in the pane (`pane`, a `PaneTitle` event), the user's rename (`user`, always wins). An empty rename hands back to the automatic sources. `PaneTitle` and `Renamed` do not bump `lastActivityAt`.

`repo` / `repoPath` / `branch` / `worktree` come from `daemon/git.ts`, refreshed on first sight and on every life check. The list groups by `repoPath ?? cwd`. A linked worktree shows a dotted branch chip. Outside a repository the fields stay absent.

`lastReply` is the agent's last message of a finished turn (`Stop`'s `last_assistant_message` for Claude Code and Codex, `afterAgentResponse` for Cursor Agent), kept until the next `UserPromptSubmit`. The overlay reads it like a plan when the session is `idle` or `exited` with nothing pending.

| State | Means |
| --- | --- |
| `starting` | Registered by the launcher, no hook yet. |
| `working` | A turn is in progress. |
| `waiting_permission` | A tool call, a plan or a diff waits for accept/deny. |
| `waiting_input` | A question (`AskUserQuestion`) waits for an answer. |
| `idle` | The turn ended; your move. |
| `error` | A turn stopped on an error, or an injected answer was not taken. The request is kept for a retry. |
| `exited` | Terminal. Set by `session.unregister`, a terminal `SessionEnd`, or the pane disappearing. |

Where a pending request comes from, for Claude Code: `PermissionRequest` gives `permission` (or `diff` for Edit/Write/MultiEdit), `PreToolUse` on `AskUserQuestion` gives `question` with the first question's options (later questions and the "Ready to submit your answers?" review come from the pane), `PreToolUse` on `ExitPlanMode` gives `plan`, a permission `Notification` gives `permission`, and the pane detector gives `permission`, `question` or `plan` from the dialog footer (the workspace trust dialog included). A `PostToolUse` for the same tool, a `Stop`, a confirmed injection, or the pane at rest clears it. Answering question 1 of a multi-question dialog so that question 2 appears is success: the first prompt is gone.

## Files and settings

WSL side, under `~/.ledge` (or `$LEDGE_HOME`):

| File | Content |
| --- | --- |
| `tmux.conf` | Config of the dedicated tmux server: status bar off, mouse on, 20 000 lines of history, `set-titles` so the Windows Terminal tab follows `${name} · ${topic ?? project}`. Written if missing; an existing file without `set-titles` receives those lines on the next init. |
| `sessions.json` | The journal, saved 200 ms after each change and reloaded on restart. |
| `daemon.log` | Dropped hooks, refused origins, failed injections, poll errors. |
| `daemon.pid` | PID of the running daemon, removed on a clean stop. |
| `chat.json` | The day's Ledge conversation: its date, harness session id and which tool it belongs to. A new day, a reset, or a change of harness starts a new one. |
| `chat/context/` | Files the chat reads, rewritten before each question and deleted when it ends (`sessions.md`, `pane-*`, `reply-*`, `git-*`). |
| `exit-<id>` | Transient: the agent's exit code, written by the launcher's wrapper and consumed by `ledge claude`. |

`~/.config/systemd/user/ledge-daemon.service` runs the daemon with the real node binary (resolved through the fnm symlink) and the built CLI; rerun `ledge setup` after changing the node version or moving the repository, it rewrites the unit and restarts the service.

`ledge setup` also edits `~/.claude/settings.json` to add one `ledge hook <Event>` command hook (5 s timeout) for each of: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, Notification, Stop, SessionEnd, PostToolUse, PostToolUseFailure, StopFailure, SubagentStart, SubagentStop.

When `~/.codex` exists, it appends one `ledge hook codex <Event>` hook to `~/.codex/hooks.json` for each of: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop, SubagentStart, SubagentStop, Interrupt, SessionEnd. Other tools' entries keep their place, so Codex keeps trusting them; Codex asks to review the new ones on its next start ("Hooks need review"), and a session launched by Ledge shows that request in the overlay.

When `~/.cursor` exists, it appends one `ledge hook cursor <event>` hook (5 s timeout) to `~/.cursor/hooks.json` for each of: sessionStart, beforeSubmitPrompt, preToolUse, postToolUse, postToolUseFailure, stop, afterAgentResponse, sessionEnd. Other tools' entries are kept; the hook always answers `{}`, which lets Cursor Agent go on as it would have.

The journal also keeps `recents`, the folders of the last twelve sessions, for the overlay's launch form.

Windows side, the overlay keeps its preferences in the WebView's `localStorage`: `ledge.lang`, `ledge.theme`, `ledge.accent` (the brand colour, `#rrggbb`; absent is the factory coral), `ledge.dnd`, `ledge.monitor`, `ledge.islandPosition` (the island's axis on the top edge: `center`, `left` or `right`, a quarter of the way in; default `center`), `ledge.discreet` (`'1'` or `'0'`, the strip under a maximised window; default `'1'`), `ledge.reducedMotion`, `ledge.handleScale` (the island size; the key keeps its historical name), `ledge.panelScale`, `ledge.coachmarks`, `ledge.defaultTool` (the harness for new sessions and the Ledge chat), `ledge.finished` (bubble / sound when a bot finishes) and `ledge.sounds`.

## Security and failure model

- The daemon listens on the loopback only and refuses browser origins other than the overlay's. There is no authentication beyond that: anything running on the machine can talk to it, which is the accepted scope of a personal tool.
- A hook never blocks or fails the agent: 100 ms budget, every error swallowed and logged.
- An answer is typed only if the prompt is on screen, and reported as taken only if the prompt then disappears. Nothing is retried automatically; the session goes to `error` and the overlay offers a retry.
- A decision is locked in the overlay until the daemon confirms, rejects, or the connection drops, so a double click never sends two answers.
- The overlay survives the daemon: it shows "daemon unreachable, retrying" under the island and reconnects with backoff.
- The Windows app updates itself through Tauri's updater. Each release is signed with a minisign key, and the app checks the signature against the public key it ships with before installing anything. Releases are fetched from GitHub over HTTPS.
- Update order is fixed: the daemon first, the app second. The overlay asks the daemon to run `npm i -g`, then restart the service, and compares the sessions before and after. The app is only installed if every session came back. If one is missing, or if the restart would close live sessions, nothing else changes and the card says why.
- The daemon refuses to update itself when it runs from a git clone or without systemd, and shows the manual command instead.

## How to install?

Ledge has two halves: the `ledge` CLI and its daemon in WSL2, and the overlay on Windows. The WSL side installs from this repository. The Windows side is a ready-made installer from the [Releases](https://github.com/Paradow-dev/ledge/releases) page, or one you build yourself.

### What you need

| Side | Requirements |
| --- | --- |
| WSL2 | A Linux distribution with `systemd=true` in `/etc/wsl.conf`, Git, Node 22, pnpm, tmux, and at least one agent: Claude Code, Codex or Cursor Agent. No root needed. |
| Windows | Windows 10 or 11 and Windows Terminal. WebView2 is already there on Windows 11; the installer fetches it otherwise. To build the installer yourself: Git, Node, pnpm and Rust stable with the MSVC toolchain (the Visual Studio C++ Build Tools). |

Get pnpm with `corepack enable` on either side if it is missing.

### 1. Install the CLI and the daemon in WSL

```sh
npm i -g @paradow/ledge && ledge setup
```

Use the `npm` of the Node 22+ that will run the daemon. With nvm, that is the version active when you run the command: `ledge setup` writes that Node into the systemd unit. To work from a clone instead, see [Development](#development).

`ledge setup` prints what it did. It writes `~/.ledge`, adds Ledge's hooks to Claude Code (`~/.claude/settings.json`), and to Codex (`~/.codex/hooks.json`) and Cursor Agent (`~/.cursor/hooks.json`) when their folders exist. It keeps whatever hooks you already have. Codex asks you to review the new hooks at its next start: trust them there or from Ledge.

It also installs and starts the `ledge-daemon.service` systemd user unit and enables linger, so the daemon runs as soon as WSL boots. Without systemd, setup says so and `ledge claude` starts the daemon on demand instead. Check it:

```sh
systemctl --user status ledge-daemon.service
ledge status
```

### 2. Get the Windows installer

Download `Ledge_<version>_x64-setup.exe` from the [latest release](https://github.com/Paradow-dev/ledge/releases/latest). The release notes give its SHA-256.

Or build it yourself. Clone the repository a second time, on the Windows disk, in PowerShell. Do not build from the `\\wsl$` path: `node_modules` must be the Windows one.

```powershell
git clone https://github.com/Paradow-dev/ledge.git $HOME\Workspace\ledge
cd $HOME\Workspace\ledge
pnpm install --frozen-lockfile
cd apps\overlay
pnpm tauri build
```

The installer lands in `apps\overlay\src-tauri\target\release\bundle\nsis\Ledge_<version>_x64-setup.exe`.

### 3. Install Ledge on Windows

Run `Ledge_<version>_x64-setup.exe`. It installs for your user only, under `%LOCALAPPDATA%`, with no administrator prompt. The installer is not code-signed, so SmartScreen may warn the first time: More info, then Run anyway. At the end, Ledge starts:

- the Ledge mascot appears in the notification area, next to the clock;
- the island appears at the top centre of your primary screen, a 38 px pill cut into the edge with the Ledge mascot on its left;
- Ledge now starts with Windows. Settings > Display > `Lancer au démarrage` turns that off.

If the island says the daemon is unreachable, go back to step 1 and check the service in WSL.

### 4. Start your first session

In any WSL terminal, start your agent through Ledge:

```sh
ledge claude          # or: ledge codex, ledge cursor
```

The Windows Terminal tab takes the bot's name and a new mascot joins the island. You can also start a session from the overlay itself: open the list with `Ctrl+Alt+L` and press `+`, or press `Ctrl+Alt+N`. The [tour](docs/tour.md) shows every screen.

The overlay speaks French by default. Settings > Langue switches it to English.

### Update

Ledge checks for a new release at startup, then every 6 hours (Settings > À propos turns this off). It never updates without your click. When a release is out, a dot appears on the island's mascot and a card appears at the top of the list: click "Mettre à jour". Ledge updates the WSL daemon first, waits for your sessions to come back, then downloads and installs the Windows app, which restarts. Your sessions keep running. See the [tour](docs/tour.md#updating).

To update by hand:

```sh
npm i -g @paradow/ledge@latest && systemctl --user restart ledge-daemon
```

Then on Windows, quit Ledge from its tray menu and run the newer installer over the old one, downloaded from the releases. A daemon that runs from a git clone is never touched by the button: the card shows the command to run, and `git pull && pnpm install && pnpm --filter @paradow/ledge build` followed by the restart does the same job.

A tmux server started before the scoped-service version lives inside the daemon's service, so a restart would close its sessions. Ledge refuses to restart then, and says so. Close those sessions or restart WSL once; later sessions are safe.

### Uninstall

In WSL, one command undoes `ledge setup`:

```sh
ledge uninstall           # add --purge to also delete ~/.ledge (session journal and log)
```

It removes only Ledge's own entries from the Claude Code, Codex and Cursor Agent hooks, and keeps every other hook where it was. It stops the daemon, removes the `ledge-daemon.service` unit and deletes the `~/.local/bin/ledge` link. Sessions still running on Ledge's tmux server are reported, not killed. It leaves linger on, since other user services may need it. If a config file is not valid JSON, it is left untouched and the command ends with an error after doing the rest.

On Windows: Settings > Apps > Installed apps > Ledge > Uninstall. It also removes launch at login. Then delete the clones if you no longer need them.

More details: the WSL side in [packages/ledge/README.md](packages/ledge/README.md), the overlay, its first-build checklist and the key reference in [apps/overlay/README.md](apps/overlay/README.md).

## Development

```sh
git clone https://github.com/Paradow-dev/ledge.git ~/Workspace/ledge && cd ~/Workspace/ledge
pnpm install
pnpm --filter @paradow/ledge build
chmod +x packages/ledge/dist/cli/index.js
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/ledge/dist/cli/index.js" ~/.local/bin/ledge   # ~/.local/bin must be on the PATH Claude Code uses for hooks
ledge setup                         # a clone install: the update button leaves it alone
```

Then:

```sh
pnpm -r typecheck
pnpm -r test                        # protocol, ledge (unit + tmux + end-to-end, needs tmux, no AI), overlay (vitest + jsdom)
pnpm --filter overlay dev           # the UI alone on http://localhost:1420, against a daemon running in WSL
pnpm --filter overlay test:e2e      # Playwright, chromium
LEDGE_SCREENSHOTS=1 pnpm --filter overlay exec playwright test e2e/screenshots.spec.ts   # refresh docs/screens (see docs/tour.md)
pnpm --filter overlay tauri dev     # Windows only
```

Layout:

```
packages/protocol/   zod schemas, PROTOCOL_PORT, topic helpers, chat turns
packages/ledge/      src/cli, src/daemon, src/adapters, src/chat, test/ (fixtures/panes: captured dialogs)
apps/overlay/        src/ (React), src-tauri/ (Rust shell), e2e/ (Playwright)
docs/                design specs, implementation plans, mockups, the approved prototype, and the tour with its captures
```

## Design documents

- Ideas from the two latest Claude Code sessions (features and bot motion): [next steps](docs/ideas/2026-10-11-next-steps.md).
- Design spec: [docs/superpowers/specs/2026-10-09-ledge-design.md](docs/superpowers/specs/2026-10-09-ledge-design.md)
- Session topics, repository grouping and the Ledge chat: [spec](docs/superpowers/specs/2026-10-11-sessions-identity-and-chat-design.md), [plan](docs/superpowers/plans/2026-10-11-sessions-identity-and-chat.md) and [mockup](docs/mockups/ledge-sessions-chat.html).
- Last-reply lists as real markdown lists: [spec](docs/superpowers/specs/2026-10-11-session-reply-lists-design.md).
- Markdown document reader — **implemented in the overlay and WSL daemon**: [spec](docs/superpowers/specs/2026-10-11-markdown-reader-design.md), [implementation plan](docs/superpowers/plans/2026-10-11-markdown-reader.md), and [approved mockup](docs/mockups/ledge-reader-existing.html). Opens cited plans, designs and skills in the same 560 px panel, supports an 800 px expanded view, and returns to the conversation with its draft and scroll position preserved. Browser integration is tested; native Windows validation is still pending.
- Starting a session from Ledge: [spec](docs/superpowers/specs/2026-10-10-launch-from-ledge-design.md) and [mockups](https://claude.ai/artifact/YBX4UV7Z2eBRNKAwNh3876)
- Design canvas (mockups and playable prototype): https://claude.ai/artifact/57oDjsKdabQBmPgAXn15mc
- Design system "Shadcn Red": https://claude.ai/artifact/QBv4bfYYVqV2aAfDjPW3JV
- Initial mascot exploration: [docs/mockups/mascots.html](docs/mockups/mascots.html), a historical comparison of three directions.
- Mascot halo study: [docs/mockups/mascots-halo.html](docs/mockups/mascots-halo.html), three renderings compared in both themes; the validated choice (contour, normal intensity, every live state, badge colours, breathing while waiting) is implemented in `apps/overlay/src/bots`. Approved resident mascot and halo: [ledge-mascot.html](docs/mockups/ledge-mascot.html), [ledge-mascot-halo.html](docs/mockups/ledge-mascot-halo.html).
- The island, **implemented on 2026-10-12**: [spec](docs/superpowers/specs/2026-10-12-island-design.md), [implementation plan](docs/superpowers/plans/2026-10-12-island.md) and [mockup](docs/mockups/ledge-island.html). The handle left the left edge for the top centre of the screen, like a dynamic island, with concave fillets where it meets the edge; the bubble is the island stretched to 440 px; every view hangs down from it. Two settings came with it (island position, discreet mode under a maximised window). Twenty-one simulated scenarios on the mockup cover every screen.
- **Approved interactive design (revision 2):** [navigable prototype](docs/mockups/ledge-prototype.html) (keep its adjacent `prototype/` folder), or [standalone HTML](docs/mockups/ledge-prototype-standalone.html) requiring no server. Twelve scenarios, **Signal in dark mode / Galet in light mode**, with subdued motion and accessible keyboard navigation. Sessions and outcomes in the prototype are simulated.
- Implementation plans: [WSL core](docs/superpowers/plans/2026-10-09-ledge-core-wsl.md), [overlay and mascots](docs/superpowers/plans/2026-10-09-ledge-overlay.md), [adapters and rich screens](docs/superpowers/plans/2026-10-09-ledge-adapters-and-screens.md), [hop, finished notices and sounds](docs/superpowers/plans/2026-10-10-ledge-hop-finished-sounds.md), [resident mascot](docs/superpowers/plans/2026-10-11-ledge-resident-mascot.md).

## Status and known limits

- Claude Code, Codex and Cursor Agent have adapters. The same three harnesses can answer Ask Ledge (Settings › Default harness); the launch form opens on that choice too.
- An `AskUserQuestion` with several questions can be answered from Ledge, one dialog at a time, including the review screen.
- Cursor Agent (verified on 2026.10.01): hooks give the turn (prompt, tools, `stop`) and the last reply (`afterAgentResponse`, rebuilt from the transcript so the turn's text blocks stay apart). They never report an approval, a question or a plan, so the pane gives them: the shell approval ("Run this command?", `y` runs once, `n` then an empty Enter skips), the workspace trust (`a` trusts, `q` quits), AskQuestion (an option number moves to it, ticks it with Space and goes on with Enter; Esc skips; a question that follows is a new prompt, not a failed answer) and Plan mode's "Ready to build?" (`b` builds locally, never in the cloud; refusing opens "Describe how to revise the plan", which reads as your turn: the next reply goes there). Keys that must not reach the agent in one read wait for the screen they are meant for (`until` steps). Ctrl-C interrupts (`stop` aborted, then a stray `error` that is ignored). Subagents fire no hook of their own kind: the parent's Task call names a helper, the subagent's hooks (its own `session_id`, but the parent's transcript in `CURSOR_TRANSCRIPT_PATH`) take it over, and the parent's next step ends it. Not covered: the "Other" free-text answer of a question, and the cloud build.
- Codex (verified on 0.162): hooks give the state, approvals (`y` runs once, Esc refuses), `request_user_input` questions and the last reply; the pane gives the Plan mode approval ("Implement this plan?", which has no hook) and the startup hooks review. Codex may run hooks in a shared app-server daemon that keeps the environment of the `codex` that started it, so a launched session names itself to its hooks through `-c shell_environment_policy.set.LEDGE_CODEX_HOOK_SESSION=<id>`, and `LEDGE_CODEX_SESSION` in the environment is trusted only when no app-server runs the hook. Plan mode itself is switched in the terminal (Shift+Tab).
- Free-text replies to a question are refused (the 2.x question dialog is a select; typed text would pick the highlighted option). Answer with an option number or in the terminal.
- The Rust shell compiles on Windows and the installer builds, but the runtime checks of the first-build checklist in the overlay README have not all been run.
- The daemon trusts whatever connects on the loopback.
- A session started from the overlay runs with the daemon's environment (the systemd service's, or the shell that first ran `ledge claude`), not your current shell's. `open_terminal` runs `wt.exe` and the default WSL distribution; neither has been exercised on a real Windows machine yet.

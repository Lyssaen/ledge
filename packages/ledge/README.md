# @paradow/ledge (WSL side)

The Ledge daemon and CLI: follow and answer your WSL agent sessions (Claude Code, Codex, Cursor Agent) from the Ledge island on Windows. See the [repository README](https://github.com/Paradow-dev/ledge#readme) for the whole picture.

## Install

Node >= 22 is required.

```sh
npm i -g @paradow/ledge && ledge setup
```

## Install for development

Run from the repository root:

```sh
pnpm install
pnpm --filter @paradow/ledge build
chmod +x packages/ledge/dist/cli/index.js
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/ledge/dist/cli/index.js" ~/.local/bin/ledge   # ~/.local/bin must be on the PATH Claude Code uses for hooks
ledge setup
```

The daemon is spawned from the built CLI (`dist/cli/index.js`), so rebuild after changes (`pnpm --filter @paradow/ledge build`).

## Use

```sh
ledge claude            # start Claude Code in a tracked tmux session (tab renamed to the bot)
ledge claude --name max # pick the bot's name
ledge status            # list bots and what they wait for
ledge attach <id>       # put this terminal on a running session (what the overlay opens a tab with)
ledge daemon            # run the daemon in the foreground (normally run by the systemd service)
ledge uninstall         # undo ledge setup: hooks, service and the ~/.local/bin link (--purge: ~/.ledge too)
```

`ledge setup` installs `ledge-daemon.service` as a systemd user unit, starts it and enables linger, so the daemon runs from WSL boot and restarts after a crash. Rerun it after a node upgrade or a repository move: the unit is rewritten and the service restarted. Useful commands:

```sh
systemctl --user status ledge-daemon.service
journalctl --user -u ledge-daemon.service -f
systemctl --user restart ledge-daemon.service   # after pnpm --filter @paradow/ledge build
systemctl --user disable --now ledge-daemon.service   # back to on-demand start by ledge claude
```

## Where things live

```text
~/.ledge/tmux.conf      dedicated tmux server config (status off, mouse on)
~/.ledge/sessions.json  journal, reloaded when the daemon restarts
~/.ledge/daemon.log     dropped hooks, failed injections, poll errors
~/.ledge/chat.json      the day's chat conversation (date, session id)
~/.ledge/chat/context/  files the chat reads (sessions.md, pane-*, reply-*, git-*)
~/.ledge/daemon.pid     PID of the running daemon, removed when it stops cleanly
~/.config/systemd/user/ledge-daemon.service   user unit written by `ledge setup`
~/.ledge/exit-<id>      transient: the agent's exit code, written by the launcher's wrapper when the agent ends and read and deleted by `ledge claude`
```

## Ask Ledge (chat)

The overlay's ask field sends a question to the daemon (`chat.ask`), which answers it with one headless, read-only run of the chosen harness (Settings › Default harness; Claude Code when omitted):

```sh
# Claude Code (default)
claude -p --restricted --tools Read,Grep,Glob --permission-mode dontAsk --output-format stream-json --verbose --include-partial-messages --max-turns 16 --append-system-prompt <persona> --add-dir <each session folder> --session-id <id>   # --resume <id> for the next questions of the day

# Codex
codex exec --sandbox read-only --json --skip-git-repo-check --ignore-user-config -C <context> -c 'sandbox_permissions=["disk-full-read-access"]' -   # exec resume <id> … for the next questions

# Cursor Agent
cursor-agent -p --mode ask --output-format stream-json --stream-partial-output --sandbox enabled --trust --workspace <context> --add-dir <each session folder>   # --resume <id> for the next questions
```

The question goes on stdin, never in argv, and `LEDGE_CHAT=1` is set so Ledge's own hooks ignore the run. An inherited `ANTHROPIC_API_KEY` is dropped so Claude Code keeps its own login. `--restricted` ignores the user, project and local settings, so none of your hooks run and no setting can widen the tools. Only `Read`, `Grep` and `Glob` are allowed on Claude Code, and anything else is denied rather than asked. Codex runs in a read-only sandbox; Cursor Agent runs in ask mode.

- `~/.ledge/chat/context/` is the folder the harness runs in, rewritten before each question: `sessions.md` (every session, its state and its file names), `pane-<id>.txt` (last terminal lines), `reply-<id>.md` (last reply), `git-<id>.txt` (status, log and diff stat). A source that fails or is empty is just left out. The folder is deleted when the turn ends.
- `~/.ledge/chat.json` holds the day's conversation (its date, session id and which tool it belongs to); a new day, a `chat.reset`, or a change of harness starts a new conversation, and a question after a failed resume starts a new one too.
- One question at a time; a turn that takes more than 180 s is stopped and the chat says it timed out (no retry). `chat.reset` is refused while a question is running.

Session names and tab titles: Ledge sets `set-titles` in `~/.ledge/tmux.conf`. A tmux server that is already running re-reads `tmux.conf` only after it restarts, so `set-titles` applies to new tmux servers. The tab string is `${name} · ${topic ?? project}`; `session.rename` from the overlay updates it.

## Tests

```sh
pnpm --filter @paradow/ledge test            # unit + tmux + end-to-end (needs tmux, no AI)
pnpm --filter @paradow/ledge test state      # only the transition table
```

## Refreshing pane fixtures

Run from `packages/ledge` (the output path is relative to it):

```sh
tmux -L ledge capture-pane -p -J -t ledge-<id> -S -30 > test/fixtures/panes/<name>.txt
```

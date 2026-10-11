# ledge (WSL side)

## Install for development

Run from the repository root:

```sh
pnpm install
pnpm --filter ledge build
chmod +x packages/ledge/dist/cli/index.js
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/ledge/dist/cli/index.js" ~/.local/bin/ledge   # ~/.local/bin must be on the PATH Claude Code uses for hooks
ledge setup
```

The daemon is spawned from the built CLI (`dist/cli/index.js`), so rebuild after changes (`pnpm --filter ledge build`).

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
systemctl --user restart ledge-daemon.service   # after pnpm --filter ledge build
systemctl --user disable --now ledge-daemon.service   # back to on-demand start by ledge claude
```

## Where things live

```text
~/.ledge/tmux.conf      dedicated tmux server config (status off, mouse on)
~/.ledge/sessions.json  journal, reloaded when the daemon restarts
~/.ledge/daemon.log     dropped hooks, failed injections, poll errors
~/.ledge/daemon.pid     PID of the running daemon, removed when it stops cleanly
~/.config/systemd/user/ledge-daemon.service   user unit written by `ledge setup`
~/.ledge/exit-<id>      transient: the agent's exit code, written by the launcher's wrapper when the agent ends and read and deleted by `ledge claude`
```

## Tests

```sh
pnpm --filter ledge test            # unit + tmux + end-to-end (needs tmux, no AI)
pnpm --filter ledge test state      # only the transition table
```

## Refreshing pane fixtures

Run from `packages/ledge` (the output path is relative to it):

```sh
tmux -L ledge capture-pane -p -J -t ledge-<id> -S -30 > test/fixtures/panes/<name>.txt
```

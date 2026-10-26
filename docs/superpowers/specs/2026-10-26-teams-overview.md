# Teams in Ledge: overview of the three specs

Date: 2026-10-26. Status: design.

| Spec | What it adds |
| --- | --- |
| [Roles, teams and Ledge as their operator](2026-10-25-roles-teams-operator-design.md) | Roles, team templates, live teams, Ledge as a task giver, the `ledge-team` and `ledge-task` cards, `@role`, autonomy, the TUI |
| [The atelier's rooms](2026-10-26-atelier-rooms-design.md) | One room per project with low walls, one table per team, the common table, joining and leaving by drag |
| [Ledge as the home view](2026-10-26-ledge-home-design.md) | Ask Ledge becomes the home view: « Le point », tabs, live cards, a richer composer |

Mockups (captured from the real Ledge Desktop and `ledge tui` against their simulated daemons, then edited):

<p>
  <img src="mockups/2026-10-26-teams/desktop-home-team-card.png" alt="Ledge home: Le point, a team proposed and launched, tasks given" width="420">
  <img src="mockups/2026-10-26-teams/desktop-home-follow-up.png" alt="Ledge home: « Où en est ledge-roles ? » and its action buttons" width="420">
</p>
<p>
  <img src="mockups/2026-10-26-teams/desktop-atelier-room.png" alt="The Ledge room: low walls, common table, team ledge-roles, resting team mobile" width="420">
  <img src="mockups/2026-10-26-teams/desktop-seat-session.png" alt="Nova's page: team, role, task pinned above the reply field" width="420">
</p>
<p>
  <img src="mockups/2026-10-26-teams/tui-ask.png" alt="TUI Ask Ledge: team card and task cards" width="280">
  <img src="mockups/2026-10-26-teams/tui-overview.png" alt="TUI overview: projects, team tables, roles, tasks" width="280">
  <img src="mockups/2026-10-26-teams/tui-launch-team.png" alt="TUI new session in team mode" width="280">
</p>
<p>
  <img src="mockups/2026-10-26-teams/mobile-ledge.png" alt="Phone: Ledge first, Le point" width="195">
  <img src="mockups/2026-10-26-teams/mobile-conversation.png" alt="Phone: team launched with the device key, tasks" width="195">
  <img src="mockups/2026-10-26-teams/mobile-inbox.png" alt="Phone: À traiter with a closed Ledge task" width="195">
  <img src="mockups/2026-10-26-teams/mobile-agents.png" alt="Phone: agents by team, with roles" width="195">
</p>

## 1. What exists

- **Sessions**: one agent in a tmux pane, registered with the daemon, followed by its hooks and its pane. A session has
  an id, a bot name, a project, a topic, a state and its helpers (subagents).
- **Projects**: a name, a colour, repositories and folder rules. The atelier draws one table per project.
- **Messages** (`ledge send`, Claude's `SendMessage`): typed at the receiver's next free moment, journaled in
  `~/.ledge/mail.json`, failures told to the sender.
- **Tasks** (`ledge task give|take|done|refuse|pass`): a giver, an owner, a state and a result, journaled in
  `~/.ledge/tasks.json`; every change is typed to the other side as a `<ledge-task>` line. The giver is always a session.
- **Ask Ledge**: a read-only harness run over a context folder (`sessions.md`, panes, replies, git, projects, forge). It
  answers, and proposes cards (`ledge-session`, `ledge-relay`, `ledge-close`, `ledge-project`) that the user clicks.
- **Identity**: at each `SessionStart` the hook tells the agent its name, project and branch and how to reach the
  others (`identityContext`).

## 2. What is new

```mermaid
flowchart LR
  user(["Toi"]) -- "question" --> home["Ledge (home view)<br/>Le point · conversation · cards"]
  home -- "ledge-team card → team.launch" --> daemon
  home -- "ledge-task card → task.cmd by: ledge" --> daemon
  subgraph daemon["ledge daemon"]
    roles["roles.ts<br/>.ledge/roles/*.md"]
    templates["teams.ts<br/>.ledge/teams/*.yaml"]
    live["teamsLive.ts<br/>teams-live.json"]
    tasks["tasks.ts<br/>tasks.json"]
    mailbox["mailbox"]
  end
  daemon -- "spawn with LEDGE_ROLE / LEDGE_TEAM" --> seats["Seats (tmux sessions)<br/>@lead @build @review @qa"]
  seats -- "SessionStart: role + team + operator" --> seats
  seats -- "ledge task give @qa · ledge send @review" --> daemon
  tasks -- "task.updated (giver ledge)" --> home
  live -- "teams / team.updated" --> atelier["Atelier<br/>room per project, table per team"]
```

1. **Roles** are Markdown files with a prompt and launch defaults. A seat is told its role and its team at every start.
2. **Teams**: a template is a file; a **live team** is a daemon record bound to one project, with its seats, its table,
   and a life of its own (active, resting, dissolved), which can be joined, left and resumed.
3. **Ledge is the operator**: it proposes a team and the first tasks as cards. Once launched, the seats delegate among
   themselves with `@role`, without cards. The tasks Ledge gave come back to the user (« À toi », « Le point »,
   phone); the tasks seats give each other stay between them.
4. **The atelier** draws a room per project with low walls; each team has its own table, the other sessions sit at the
   common table.
5. **The home view** is Ledge: « Le point » (what waits for you, the teams, the tasks Ledge gave) above the conversation.

## 3. Protocol summary

Client → daemon: `roles.list`, `team.launch`, `team.join`, `team.leave`, `team.resume`, `team.dissolve`;
`session.launch` gets `role` and `team`; `task.cmd` accepts `by: 'ledge'` and `team` on `list`.

Daemon → clients: `roles.listing`, `teams`, `team.updated`, `team.launched`, `team.failed`, `task.updated`.

Session model: `role?`, `roleLabel?`, `team?`. Context folder: `roles.md`, `teams.md`, `tasks.md`. Card blocks:
`ledge-team`, `ledge-task`.

## 4. Order of work

1. Roles. 2. Ledge as a giver. 3. Live teams and the team card. 4. `@role` and autonomy. 5. Atelier rooms.
6. Ledge home. Each step ships on its own and is useful by itself.

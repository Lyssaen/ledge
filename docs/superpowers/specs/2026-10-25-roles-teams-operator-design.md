# Roles, teams and Ledge as their operator: Ledge delegates, the team works on its own

Date: 2026-10-25. Status: design.

## 1. Intent

Ledge follows sessions one by one: each is a generalist agent with a name, a project and a topic. There is no way to say
what a session is for (build, review, QA), nor to start several sessions that know each other as a team. OpenRig
(mvschwarz/openrig) does it with a rig spec in YAML: pods are domains, seats are roles (`orch.lead`, `dev.build`,
`dev.review`), the person talks to a kernel operator that picks and starts a team, and to a lead that delegates.

Ledge takes the same shape with one difference: **Ledge itself is the operator**. Ask Ledge is already the place where
the user asks what is going on and gets cards (launch, relay, close, project). It becomes the entry point to teams:

- it composes a team from the user's request and proposes it as a card;
- once the team runs, it proposes the work to give, as a task card;
- after that the team works on its own: seats delegate to each other with `ledge task` and `ledge send`, with no card
  and no click;
- what comes back to the operator (a task done or refused, a seat that drops its work) reaches the user in « À toi »,
  the chat and the phone.

Ledge still never acts alone: every action **Ledge** takes is a card the user clicks. What the agents do between them is
theirs, as `ledge task` between sessions already is.

## 2. Goals and non-goals

Goals

- **Role.** A role is a Markdown file: a label, a prompt, and optional launch defaults (agent, model, effort, autonomy).
  A session launched with a role is told its role and its prompt at every `SessionStart`.
- **Team.** A team is a YAML file: a name and its seats (a role, optionally an agent, model, effort and preferred name).
  `team.launch` starts every seat in one folder; the sessions carry the team's name.
- **Operator cards.** Ask Ledge reads the roles, the teams and the tasks, and proposes `ledge-team` (start a team) and
  `ledge-task` (give a task to a seat) cards.
- **Ledge as a giver.** A task can be given by `ledge` (the user, through the chat). Its outcome is not typed into a
  terminal: it becomes an item of « À toi », a line in the day's chat and a phone notification.
- **Addressing by role.** Inside a team, `@build` names the live seat with that role: `ledge send @review …`,
  `ledge task give @qa …`.
- **Autonomy.** The team's own delegation needs no approval from the user. A role can ask for an agent permission mode
  that lets its seat work without stopping at every tool call.

Non-goals: a seat that is itself the operator (Ledge stays the operator; a team may have a `lead` role, it is only a
role), dependencies between tasks, deadlines, a team spread across machines (one team, one machine, one folder),
editing roles and teams in Desktop (files only for now), automatic restart of a seat that exits.

## 3. Design

### 3.1 Roles (`daemon/roles.ts`)

Read from `<repo>/.ledge/roles/*.md` (the repository's roles win) then `~/.ledge/roles/*.md`. The id is the file name.

```markdown
---
label: Relecteur
tool: codex          # optional, the default agent for this role
model: gpt-5         # optional
effort: high         # optional
autonomy: auto       # optional: ask (default) | edits | auto
---
Tu relis le travail des autres sessions sans modifier le code…
```

`Role { id, label ≤ 40, prompt ≤ 8000, tool?, model?, effort?, autonomy?, source: repo | home, path }`. A file that does
not parse is skipped and logged; `roles.list { cwd, machineId? }` answers `roles.listing { roles, problems }`.

`autonomy` maps to each agent's own permission switch at launch, never to Ledge answering prompts on the agent's
behalf:

| autonomy | Claude Code | Codex | Cursor Agent | OMP |
| --- | --- | --- | --- | --- |
| `ask` | nothing added | nothing added | nothing added | `always-ask` |
| `edits` | `--permission-mode acceptEdits` | `--ask-for-approval on-request` | nothing added | `always-ask` |
| `auto` | `--permission-mode auto` | `--ask-for-approval never --sandbox workspace-write` | `--force` | auto |

The launch card shows the autonomy of every seat before the click. A prompt the agent still raises lands in « À toi »
as today.

### 3.2 Teams (`daemon/teams.ts`)

Read from `<repo>/.ledge/teams/*.yaml` then `~/.ledge/teams/*.yaml`.

```yaml
name: workshop
seats:
  - { role: lead }
  - { role: build, tool: claude, model: opus }
  - { role: review, tool: codex, effort: high }
```

`Team { id, name, seats: { role, tool?, model?, effort?, name? }[] ≤ 8 }`. A seat's agent, model and effort are the
seat's, else the role's, else the launch form's defaults. A role is unique in a team (so `@role` is unambiguous).

### 3.3 Session model

`Session` gets `role?: string` (the role id), `roleLabel?: string` and `team?: { id: string; name: string }` (`id` is
`team-` + 4 hex, one per launch, so two launches of `workshop` are two teams). `spawnSession` takes `role` and `team`
and puts `LEDGE_ROLE` and `LEDGE_TEAM` in the agent's environment, next to `LEDGE_NAME`. The journal keeps them; a
resumed session keeps its role and team.

`session.launch` gets `role?: string`. `ledge claude|codex|cursor --role <id>` does the same from a terminal.

### 3.4 `team.launch`

`team.launch { rid, cwd, team?: string, seats?: Seat[], name?: string, machineId? }`: a saved team by id, or ad hoc
seats (from the chat card). The daemon resolves the folder, resolves every role (unknown role: the whole launch is
refused with its name), draws one team id and spawns the seats in order, each through the same path as
`session.launch`. It answers `team.launched { rid, team, sessions }`, or `team.failed { rid, reason, started }` with the
seats already started (they are not killed: the user sees them and can close them).

`ledge team up <id> [--cwd <path>]` sends it from a terminal; `ledge team list` prints the teams and roles it finds.

### 3.5 What a seat is told (`identityContext`)

After the identity lines, a seat with a role gets:

```
Ton rôle : Relecteur (review), dans l'équipe workshop.
<the role's prompt>
Ton équipe : Pim (lead), Otto (build), Nova (review). Écris-leur par leur rôle : ledge send @build "…", ledge task give @qa "…".
L'opérateur est Ledge : il t'a confié ou te confiera ton travail par une <ledge-task>. Travaille en autonomie avec ton
équipe ; ne t'arrête pour l'utilisateur que pour une décision qui lui revient. Termine toujours une tâche reçue
(ledge task done <id> "<résultat>", ou refuse) : c'est ainsi que Ledge et l'utilisateur savent où en est l'équipe.
```

The team line is rebuilt at each `SessionStart` from the live sessions, so a `/clear` or a resume sees the team as it is.

### 3.6 Addressing by role

`ledge send`, `ledge task give` and `ledge task pass` accept `@<role>`. The daemon resolves it among the live sessions of
the **sender's team**; none or several: refused with the candidates. A sender with no team gets « @role n'existe que
dans une équipe ». Claude's `SendMessage` to `@build` goes through the same resolution in the `PreToolUse` hook.

### 3.7 Ledge as a giver (`daemon/tasks.ts`)

Today `task.cmd.by` must be a live session (`d.store.get(cmd.by)`). It may now also be `ledge`:

- `giver: 'ledge'`, `giverName: 'Ledge'`. Only a client (Desktop, TUI, phone, the chat card) sends `by: 'ledge'`; the
  hook path never does, so an agent cannot give in Ledge's name.
- The owner's pointer is the usual `<ledge-task from="Ledge">`.
- On `done`, `refuse` and `drop`, `tellGiver` does not use the mailbox: the daemon broadcasts `task.updated { task }`.
  Desktop, the island, the TUI and the phone show a closed Ledge task as an item of « À toi » (« Nova a terminé
  “Relire les rôles” », with the start of the result and `show`), dismissed by the user. The day's chat appends a line
  under the turn that gave it.
- A `pass` between seats keeps `ledge` as giver: the outcome still comes back to the operator, however the team
  delegated it inside.
- Tasks the seats give each other stay as they are: giver and owner are sessions, nothing reaches the user.

### 3.8 Operator cards (Ask Ledge)

The context folder gets `roles.md` (each role: id, label, defaults, source), `teams.md` (each saved team and its seats)
and `tasks.md` (open tasks and those closed today: id, title, giver, owner, state, start of the result). `sessions.md`
gets each session's role and team.

The persona gets two blocks, each only on an explicit request, with the same rules as the existing cards (a safe
absolute folder, no guessing, ask when ambiguous):

- ```` ```ledge-team ```` `{"cwd": "<chemin>", "team": "<id>"}` or `{"cwd": …, "name": "<nom>", "seats": [{"role": "build",
  "tool": "claude"}, …]}`. Roles must exist in `roles.md`; for a role that does not exist, Ledge says so and quotes the
  file to write. The card lists each seat with its agent, model and autonomy; the button sends `team.launch`. An ad hoc
  team offers « Enregistrer comme équipe » (writes `~/.ledge/teams/<nom>.yaml`).
- ```` ```ledge-task ```` `{"to": "<session id>", "title": "<titre>", "text": "<détail>"}`, one per seat, 8 at most. The
  button sends `task.cmd { by: 'ledge', op: 'give' }`. Right after a team card, Ledge may propose the first tasks in the
  same answer; their cards stay disabled until the team is launched, then resolve `@role` to the new sessions.

« Où en est l'équipe workshop ? » is answered from `tasks.md`, `sessions.md` and the seats' replies, like any question.

### 3.9 Desktop

The atelier seats a team together at its project's table, the role label under each bot. A seat's card shows its role
and team. « À toi » gets the closed Ledge tasks (3.7). Editing roles and teams stays in the files (non-goal).

## 4. Order of work

1. Roles: `roles.ts`, `role` on `Session` and `session.launch`, `--role`, `LEDGE_ROLE`, the role lines in
   `identityContext`, the role in `ledge who` and `sessions.md`, `roles.md`.
2. Ledge as a giver: `by: 'ledge'`, `task.updated`, « À toi » items, the `ledge-task` card, `tasks.md`.
3. Teams: `teams.ts`, `team` on `Session`, `team.launch`, `ledge team up|list`, the team line in `identityContext`,
   the `ledge-team` card, `teams.md`.
4. `@role` addressing in `send`, `task` and `SendMessage`; autonomy flags; Desktop's team seating.

Each step ships on its own: after step 1 a role is useful by hand, after step 2 Ledge delegates to any session.

## 5. Tests

`roles.test.ts` (front matter, repo over home, bad file skipped, autonomy to flags per agent), `teams.test.ts` (seat
defaults, duplicate role refused), `hook.test.ts` (`identityContext` with role and team), `tasks.test.ts` (`by: ledge`
give, outcome as `task.updated` not mailbox, pass keeps the giver, `ledge` refused from the hook path),
`server.test.ts` (`team.launch` round trip, unknown role, partial failure), `send.test.ts` (`@role` resolution: one,
none, several, no team), chat card parsing (`ledge-team`, `ledge-task`, cards disabled until launch).

## 6. Risks

- **Autonomy is real power.** `auto` lets an agent edit and run commands without asking. It is opt-in per role, shown on
  the card before the click, and never set by Ledge's chat on its own (a card only uses what the role file says).
- **A team that loops.** Seats delegating to each other without end: each `ledge task` carries its giver chain in `log`;
  the operator's question « où en est l'équipe » shows it, and the user can close the team from the chat.
- **Prompt injection between seats.** A role prompt is the user's file; messages and tasks between seats keep their
  existing framing (`<ledge-message>`, `<ledge-task>`, `<` escaped), so a seat cannot impersonate Ledge or the user.

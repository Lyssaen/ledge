# Roles, teams and Ledge as their operator: Ledge delegates, the team works on its own

Date: 2026-10-25, revised 2026-10-26. Status: design.

Companion specs: [the atelier's rooms](2026-10-26-atelier-rooms-design.md) (how a team is drawn) and
[Ledge as the home view](2026-10-26-ledge-home-design.md) (where the operator lives). Overview of the three:
[2026-10-26-teams-overview.md](2026-10-26-teams-overview.md). Mockups: [mockups/2026-10-26-teams/](mockups/2026-10-26-teams/).

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
  Ledge's « Le point » and the phone.

Ledge still never acts alone: every action **Ledge** takes is a card the user clicks. What the agents do between them is
theirs, as `ledge task` between sessions already is.

## 2. Goals and non-goals

Goals

- **Role.** A role is a Markdown file: a label, a prompt, and optional launch defaults (agent, model, effort, autonomy).
  A session launched with a role is told its role and its prompt at every `SessionStart`.
- **Team template.** A YAML file: a name and its seats (a role, optionally an agent, model, effort and preferred name).
- **Live team.** A team started from a template or from a chat card is a daemon record: it belongs to one project, has
  its own table in that project's room, outlives its sessions (resting), can be resumed or dissolved, and can be joined
  or left.
- **Operator cards.** Ask Ledge reads the roles, the teams and the tasks, and proposes `ledge-team` (start a team) and
  `ledge-task` (give a task to a seat) cards. A card keeps its outcome (« Équipe lancée à 23:10 », « Confiée à Otto ·
  t3fa21c · finie »).
- **Ledge as a giver.** A task can be given by `ledge` (the user, through the chat). Its outcome is not typed into a
  terminal: it becomes an item of « À toi », a row of « Le point » and a phone notification.
- **Addressing by role.** Inside a team, `@build` names the live seat with that role: `ledge send @review …`,
  `ledge task give @qa …`.
- **Autonomy.** The team's own delegation needs no approval from the user. A role can ask for an agent permission mode
  that lets its seat work without stopping at every tool call.

Non-goals: a seat that is itself the operator (Ledge stays the operator; a team may have a `lead` role, it is only a
role), dependencies between tasks, deadlines, a team spread across machines or projects (one team, one machine, one
project, one folder), editing roles and teams in Desktop (files only for now), automatic restart of a seat that exits.

## 3. Design

### 3.1 Roles (`daemon/roles.ts`)

Read from `<repo>/.ledge/roles/*.md` (the repository's roles win) then `~/.ledge/roles/*.md`. The id is the file name.

```markdown
---
label: Relecteur
tool: codex          # optional, the default agent for this role
model: gpt-5.5       # optional
effort: high         # optional
autonomy: ask        # optional: ask (default) | edits | auto
---
Tu relis le travail des autres sessions sans modifier le code…
```

`Role { id, label ≤ 40, prompt ≤ 8000, tool?, model?, effort?, autonomy?, source: repo | home, path }`. A file that does
not parse is skipped and logged; `roles.list { cwd, machineId? }` answers `roles.listing { roles, problems }`.

`autonomy` maps to each agent's own permission switch at launch, never to Ledge answering prompts on the agent's
behalf. The exact flags are checked against each agent's current CLI before the code lands:

| autonomy | Claude Code | Codex | Cursor Agent | OMP |
| --- | --- | --- | --- | --- |
| `ask` | nothing added | nothing added | nothing added | `always-ask` |
| `edits` | `--permission-mode acceptEdits` | `--ask-for-approval on-request` | nothing added | `always-ask` |
| `auto` | `--permission-mode auto` | `--ask-for-approval never --sandbox workspace-write` | `--force` | auto |

The launch card shows the autonomy of every seat before the click. A prompt the agent still raises lands in « À toi »
as today.

### 3.2 Team templates (`daemon/teams.ts`)

Read from `<repo>/.ledge/teams/*.yaml` then `~/.ledge/teams/*.yaml`.

```yaml
name: workshop
seats:
  - { role: lead }
  - { role: build, tool: claude, model: opus }
  - { role: review, tool: codex, effort: high }
```

`TeamTemplate { id, name, seats: { role, tool?, model?, effort?, name? }[] ≤ 8 }`. A seat's agent, model and effort are
the seat's, else the role's, else the launch form's defaults. A role is unique in a team (so `@role` is unambiguous).

### 3.3 Live teams (`daemon/teamsLive.ts`, journal `~/.ledge/teams-live.json`)

```
Team { id: 'team-' + 4 hex, name, template?: string, project: ProjectId | null, machine, cwd,
       state: active | resting | dissolved, seats: { role, sessionId: string | null }[],
       createdAt, updatedAt, restingAt?, dissolvedAt? }
```

- **active**: at least one seat's session is live.
- **resting**: every seat's session has exited. The team keeps its table, its seats (with their archived session ids)
  and its tasks. `team.resume { team }` resumes each seat's session on the same conversation (`session.resume`, which
  exists), so the team comes back as it was.
- **dissolved**: `team.dissolve { team }`. The table goes; the sessions stay archived as today; the record is kept 7
  days for history. A dissolved team takes no more changes.
- `team.join { team, session, role }`: a live session takes a free role (or a new role not yet in the team). Its role
  and its teammates reach it at its next free moment, as a `<ledge-notice>` that carries the same lines as 3.5.
- `team.leave { team, session }`: the seat goes back to the project's common table; its open tasks stay its own.
- Broadcast: `teams { teams }` on connect (after `projects`), `team.updated { team }` on every change.

`Session` gets `role?: string`, `roleLabel?: string` and `team?: string` (the live team's id). `spawnSession` takes
`role` and `team` and puts `LEDGE_ROLE` and `LEDGE_TEAM` in the agent's environment, next to `LEDGE_NAME`. The session
journal keeps them; a resumed session keeps its role and team.

### 3.4 `team.launch`

`team.launch { rid, cwd, template?: string, seats?: Seat[], name?: string, machineId? }`: a template by id, or ad hoc
seats (from the chat card). The daemon resolves the folder and its project (the project rules that file sessions
today), resolves every role (unknown role: the whole launch is refused with its name), creates the live team and
spawns the seats in order, each through the same path as `session.launch`. It answers `team.launched { rid, team }`,
or `team.failed { rid, reason, team? }` with the seats already started (they are not killed: the user sees them and
can close them).

`session.launch` gets `role?: string` and `team?: string` (join at launch). `ledge claude|codex|cursor --role <id>`
does the same from a terminal; `ledge team up <template> [--cwd <path>]` sends `team.launch`; `ledge team list` prints
the templates, the roles and the live teams.

### 3.5 What a seat is told (`identityContext`, `cli/hook.ts`)

After the identity lines, a seat with a role gets:

```
Ton rôle : Relecteur (review), dans l'équipe ledge-roles.
<the role's prompt>
Ton équipe : Pim (lead), Otto (build), Nova (review). Écris-leur par leur rôle : ledge send @build "…", ledge task give @qa "…".
L'opérateur est Ledge : il t'a confié ou te confiera ton travail par une <ledge-task>. Travaille en autonomie avec ton
équipe ; ne t'arrête pour l'utilisateur que pour une décision qui lui revient. Termine toujours une tâche reçue
(ledge task done <id> "<résultat>", ou refuse) : c'est ainsi que Ledge et l'utilisateur savent où en est l'équipe.
```

The team line is rebuilt at each `SessionStart` from the live team record, so a `/clear` or a resume sees the team as
it is. Cursor Agent and OMP get the same text through their own channel (OMP: `--append-system-prompt`).

### 3.6 Addressing by role

`ledge send`, `ledge task give` and `ledge task pass` accept `@<role>`. The daemon resolves it among the live seats of
the **sender's team**; none or several: refused with the candidates. A sender with no team gets « @role n'existe que
dans une équipe ». Claude's `SendMessage` to `@build` goes through the same resolution in the `PreToolUse` hook.

### 3.7 Ledge as a giver (`daemon/tasks.ts`)

Today `task.cmd.by` must be a live session (`d.store.get(cmd.by)`). It may now also be `ledge`:

- `giver: 'ledge'`, `giverName: 'Ledge'`. Only a client (Desktop, TUI, phone, the chat card) sends `by: 'ledge'`; the
  hook path never does, so an agent cannot give in Ledge's name.
- The owner's pointer is the usual `<ledge-task from="Ledge">`.
- On `done`, `refuse` and `drop`, `tellGiver` does not use the mailbox: the daemon broadcasts `task.updated { task }`.
  Desktop, the TUI and the phone show a closed Ledge task as an item of « À toi » (« Otto a fini “Implémenter les
  rôles” · tâche de Ledge », with `Voir`), dismissed by the user.
- A `pass` between seats keeps `ledge` as giver: the outcome still comes back to the operator, however the team
  delegated it inside.
- Tasks the seats give each other stay as they are: giver and owner are sessions, nothing reaches the user.
- `task.cmd` gets `team?` on `list`, so a client can list a team's tasks.

### 3.8 Operator cards (Ask Ledge)

The context folder gets `roles.md` (each role: id, label, defaults, source), `teams.md` (templates and live teams, with
their state, seats and table) and `tasks.md` (open tasks and those closed today: id, title, giver, owner, state, start
of the result). `sessions.md` gets each session's role and team.

`FENCES` (`packages/protocol/src/proposal.ts`) gets two blocks; the persona gets their rules, each only on an explicit
request, with the same rules as the existing cards (a safe absolute folder, no guessing, ask when ambiguous):

- ```` ```ledge-team ```` `{"cwd": "<chemin>", "template": "<id>"}` or `{"cwd": …, "name": "<nom>", "seats": [{"role":
  "build", "tool": "claude"}, …]}`. Roles must exist in `roles.md`; for one that does not, Ledge says so and quotes the
  file to write. The card lists the team, its folder, its table (« nouvelle table dans la pièce Ledge ») and every seat
  with its role, agent, model, effort and autonomy, and an autonomy warning row when a seat is `auto`. Its buttons:
  « Lancer l'équipe » (`team.launch`) and « Enregistrer » (writes `~/.ledge/teams/<nom>.yaml` for an ad hoc team).
  Once launched the card says « ✓ Équipe lancée à 23:10 » and offers « Ouvrir la table ».
- ```` ```ledge-task ```` `{"to": "<session id> | @<role>", "team"?: "<team id>", "title": "<titre>", "text":
  "<détail>"}`, 8 at most. The button sends `task.cmd { by: 'ledge', op: 'give' }`. Right after a team card, Ledge may
  propose the first tasks in the same answer; their cards stay disabled (« active une fois l'équipe lancée ») until
  the team is launched, then resolve `@role` to the new sessions. Once given, the card follows its task (« ✓ Confiée à
  Mila · t91b0d4 · prise », then « finie »).

« Où en est l'équipe ledge-roles ? » is answered from `tasks.md`, `teams.md` and the seats' replies, like any question;
the answer may end with relay, task or decision cards.

### 3.9 TUI

- **Ask Ledge (3)**: the team card and the task cards as boxes, `tab` between cards, `↵` acts, `s` saves the team.
  Mockup: [tui-ask.png](mockups/2026-10-26-teams/tui-ask.png).
- **Overview (1)**: projects › tables (`▣` team, active or resting with `R` to resume; `▭` common table) › sessions with
  their `@role`; « À toi » gets closed Ledge tasks; a « TÂCHES · ▣ team » box for the selected seat's team; Ledge shows
  as a sender in « Échanges ». Keys: `T` tasks, `J` join a team, `R` resume. Mockup:
  [tui-overview.png](mockups/2026-10-26-teams/tui-overview.png).
- **New session (4)**: `ctrl+t` switches between a session and a team; a team shows its template, its seats (editable)
  and the preview « L'équipe workshop s'installera à une nouvelle table de la pièce Ledge », with the autonomy warning.
  Mockup: [tui-launch-team.png](mockups/2026-10-26-teams/tui-launch-team.png).

`▣` and `▭` are in `tui/glyphs.ts` with ASCII fallbacks (`[T]`, `[ ]`).

## 4. Order of work

1. **Roles**: `roles.ts`, `role` on `Session` and `session.launch`, `--role`, `LEDGE_ROLE`, the role lines in
   `identityContext`, the role in `ledge who` and `sessions.md`, `roles.md`.
2. **Ledge as a giver**: `by: 'ledge'`, `task.updated`, « À toi » items, the `ledge-task` card, `tasks.md`.
3. **Live teams**: `teams.ts`, `teamsLive.ts`, `team` on `Session`, `team.launch|join|leave|resume|dissolve`,
   `ledge team up|list`, the team line in `identityContext`, the `ledge-team` card, `teams.md`.
4. **`@role` addressing** in `send`, `task` and `SendMessage`; autonomy flags.
5. **Atelier rooms** and **Ledge home**: their own specs.

Each step ships on its own: after step 1 a role is useful by hand, after step 2 Ledge delegates to any session.

## 5. Tests

`roles.test.ts` (front matter, repo over home, bad file skipped, autonomy to flags per agent), `teams.test.ts` (seat
defaults, duplicate role refused), `teamsLive.test.ts` (active → resting when the last seat exits, resume, dissolve,
join and leave, journal reload), `hook.test.ts` (`identityContext` with role and team), `tasks.test.ts` (`by: ledge`
give, outcome as `task.updated` not mailbox, pass keeps the giver, `ledge` refused from the hook path), `server.test.ts`
(`team.launch` round trip, unknown role, partial failure), `send.test.ts` (`@role` resolution: one, none, several, no
team), `proposal.test.ts` (`ledge-team`, `ledge-task` blocks), TUI screen tests (overview grouping, team launch form).

## 6. Risks

- **Autonomy is real power.** `auto` lets an agent edit and run commands without asking. It is opt-in per role, shown on
  the card before the click, and never set by Ledge's chat on its own (a card only uses what the role file says).
- **A team that loops.** Seats delegating to each other without end: each task's `log` keeps the chain; « Le point »
  and « Où en est l'équipe » show it, and the user can close or dissolve the team from the chat.
- **Prompt injection between seats.** A role prompt is the user's file; messages and tasks between seats keep their
  existing framing (`<ledge-message>`, `<ledge-task>`, `<` escaped), so a seat cannot impersonate Ledge or the user.

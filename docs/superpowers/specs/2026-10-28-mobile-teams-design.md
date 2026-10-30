# Teams and roles from the phone

> Remplacé par 2026-10-30-ledge-openrig-orchestrator-design (lot 1 : équipes, rôles et tâches retirés).

Date: 2026-10-28. Status: design.

Builds on [roles, teams and Ledge as their operator](2026-10-25-roles-teams-operator-design.md) (roles, templates,
live teams, `seatContext`) and on the phone's passkey confirmation (`packages/ledge/src/mobile/gateway.ts`,
`checkAssertion`).

Mockups (390×844, the app's dark tokens): <https://claude.ai/artifact/EYCXhJBqfzkqjrzjMkKwK5> (private to the
author). Five boards: the Équipes tab, Agents with a live team, a live team's sheet, a new team built from roles, a new
role.

## 1. Intent

The user launched a team from the phone, in an armchair, through the chat's team card, and then could neither see it
nor change it: « j'étais dans mon fauteuil et j'ai créé une équipe mais je ne pouvais rien voir après ni la changer ».

Today the phone can only accept a team the chat proposes, as it is, and resume a resting team. Nobody, on any client,
can write a role or a team template: they are files edited by hand. The user wants, from the phone:

- to see a team's composition: who holds which role, with which tool and model, under which autonomy, and what each
  role is told to do (« la composition (qui tient quel rôle, avec quel outil ou modèle), ce que chaque rôle a pour
  consigne »);
- to change it;
- to write roles and teams from scratch (« je veux quand même écrire de zéro »), and to build a team from the roles
  already defined.

## 2. Goals, non-goals, anti-goals

Goals:

- A fourth tab, **Équipes**, for the definitions: create, read, update and delete a team (what the code calls a
  template, `.ledge/teams/<id>.yaml`) and a role (`.ledge/roles/<id>.md`). « Lever » launches a team on a project.
- **Agents** shows the teams that are levées (active or resting), with their sessions. A team's header opens its sheet:
  seats, who holds each one, tool · model · effort · autonomy, the role's prompt, task progress, and the actions on a
  live team (change its composition, save it as a team, dissolve it).
- Saving a role's prompt reaches the sessions that hold that role in a live team **now**, not only at their next start
  (the user: « l'équipe en cours reçoit l'update de son rôle »).
- Every write from the phone is confirmed by the device's passkey, after the user has seen the exact content.

Non-goals:

- Writing roles or templates from Desktop or the TUI. The daemon messages this spec adds are client-neutral, so they
  can follow, but this spec builds only the phone's screens.
- Changing a running session's tool, model or effort. A session cannot switch tool or model while it runs.
- Showing paths to the phone. The phone never sees a cwd today, and still won't.
- Other machines of the fleet. The phone is linked to one machine; « Dépôt », « Lever » and the catalog use only that
  machine's repos. A project's repos on another machine are not shown (the user: « l'app est connectée à une machine
  donc on garde une machine »).

Anti-goals (a failure even if it works):

- A write the user did not see. The phone shows the full prompt or the full seat list that will be written, and the
  passkey binds that content: if what reaches the daemon differs, it is refused.
- A live session silently running on an old prompt after the user changed it.
- The phone becoming a file editor for arbitrary paths: it names a role id, a team id and a scope, never a path.

## 3. Design

### 3.1 Vocabulary on screen

| On the phone | In the code |
| --- | --- |
| Équipe (in the Équipes tab) | `TeamTemplate`, `.ledge/teams/<id>.yaml` |
| Équipe levée (in Agents) | `Team`, a live team (active or resting) |
| Lever | `team.launch` with `template` |
| Supprimer (in the tab) | delete the template file |
| Dissoudre (on a live team's sheet) | `team.dissolve` |
| Maison / Dépôt | `source: 'home'` (`~/.ledge/`) / `source: 'repo'` (`<repo>/.ledge/`) |

The word « modèle » does not appear on the phone.

### 3.2 Screens

- **Tab bar**: Ledge, À traiter, Agents, Équipes. (Today it has three: Ledge, À traiter, Agents; Connexion opens
  from the header.)
- **Équipes tab**: a primary « Nouvelle équipe »; the list of teams, each with its scope and its roles, and a « Lever »
  button; a link to Agents when a team is levée; the list of roles (`@id`, label, tool · model · autonomy) with
  « + Nouveau rôle ». Tapping a team opens it in the team editor; tapping a role opens it in the role editor.
- **Team editor** (new or existing): name, project (picked by name), seats (role pill, label, tool · model · autonomy,
  « Changer » for the seat's tool/model/effort, remove), « Ajouter un rôle » with the roles not yet seated and
  « Nouveau rôle… », a warning line for every seat whose autonomy is `auto`. Actions: « Lancer l'équipe · N sièges »,
  « Enregistrer », and, on an existing team, « Supprimer ». The bounds are the protocol's: 1 to 8 seats, one seat per
  role.
- **Role editor** (new or existing): id (`@` + mono, fixed once saved), label (≤ 40), prompt (≤ 8000, with a counter),
  defaults (tool, model, effort, autonomy), scope (Maison / Dépôt <project>). « Enregistrer le rôle ».
- **Agents**: unchanged layout (project, then table); a live team's table gets a tappable header (flag, name,
  progress, chevron) that opens its sheet. A resting team keeps « Reprendre ». The « + Équipe » button is not on
  Agents: creating is done from the tab.
- **Live team sheet**: back to Agents; name, project, since when, from which team; progress; one card per seat
  (role, label, the session holding it and its state, tool · model · effort · autonomy, the first two lines of the
  role's prompt, « Lire et modifier la consigne » → role editor); a free seat shows « Démarrer ce siège ». Actions:
  « Modifier la composition » (team editor on the live team), « Enregistrer comme équipe », « Dissoudre l'équipe ».

### 3.3 Phone ↔ daemon

New phone operations, each relayed by the gateway to a daemon message (names are indicative):

| Phone operation | Daemon | Passkey |
| --- | --- | --- |
| `teams.catalog` (read) | `roles.list` for the project's repo, plus the home | no |
| `role.write` `{ scope, project?, role }` | write `.ledge/roles/<id>.md` | yes |
| `role.delete` `{ scope, project?, id }` | delete it | yes |
| `template.write` `{ scope, project?, template }` | write `.ledge/teams/<id>.yaml` | yes |
| `template.delete` `{ scope, project?, id }` | delete it | yes |
| `team.launch` from the tab `{ template \| seats, name, project }` | `team.launch` | yes (as the chat's launch) |
| `team.join` / `team.leave` / `team.dissolve` on a live team | existing messages | yes |

- **Project, not path.** The phone sends a project name. The daemon resolves it to the project's repository (the
  project's repos, as Desktop and the fleet already know them) and picks the folder. A project with several repos needs
  a rule: see §5.
- **What the passkey binds.** As for `decide` and `launch`, the challenge's subject is the operation and a digest of
  the exact content (role file text, template YAML, seat list). The daemon recomputes the digest from what it would
  write and refuses a mismatch. `confirm.prepare` gets a new purpose per operation.
- **Validation** is the protocol's: `RoleIdSchema`, `ROLE_LABEL_MAX`, `ROLE_PROMPT_MAX`, `SeatsSchema`,
  `TeamNameSchema`. The daemon validates again before writing and writes atomically (tmp + rename, as `saveTemplate`
  does). The writer produces the same format `parseRole` and the template parser read.
- **Shadowing** stays: a repo role wins over a home role of the same id. The role editor shows when the role being
  edited hides a home role, or is hidden by a repo role.
- The catalog's `problems` (files that could not be read) are shown at the bottom of the tab, read-only.

### 3.4 A prompt change reaches the live seats

Today `seatContext` is rebuilt only at a session's start (`cli/hook.ts` `seatOf`, `daemon/server.ts` `ompSeat`), so a
running session keeps the prompt it started with.

When `role.write` changes a role's prompt or label, the daemon, after writing, finds every live team's seat that holds
that role **and resolves to this file** (a repo role only for teams in that repo; a home role only where no repo role
shadows it), and sends each holding session a message, delivered like `ledge send` at its next free moment:

> Ta consigne de rôle a changé (@<id>, <label>). La voici en entier ; elle remplace la précédente : …

The message carries the full new prompt, not a diff. At its next start the session gets it anyway through
`seatContext`, which rereads the file.

### 3.5 What applies when

| Change | Live sessions | Next start |
| --- | --- | --- |
| Role prompt or label | message now (§3.4) | yes |
| Role defaults (tool, model, effort, autonomy) | no | yes, for seats without their own override |
| A live seat's model, effort (from the sheet) | no; the sheet says « au prochain démarrage du siège » | yes, resume included |
| A live seat's tool (from the sheet) | no; « Redémarrer ce siège », conversation not carried over | yes |
| Add a seat to a live team | starts a session in that seat (§3.6) | — |
| Remove a seat from a live team | the seat leaves the team; its session finishes what it is doing, then is closed (§3.6) | — |
| A team definition (in the tab) | no: a live team keeps its own composition | the next « Lever » |

### 3.6 Settled after the builder check (author's calls, to confirm)

- **Tab contents.** The tab merges the home definitions and those of every project's repo, each item tagged by scope
  (« maison », « dépôt paper-service »). `teams.catalog` answers with all of them. A same role id in two repos shows
  twice, each with its repo. A team definition stays without a project: the template format does not change.
- **Project at launch.** The team editor's « Projet » is the project the team is launched on, and, for « Dépôt », the
  repo it is stored in. « Lever » from the list asks for the project, preselected to the team's repo for a Dépôt team.
- **A live seat's tool, model, effort.** Stored on the live team's seat (new optional fields beside `role` and
  `sessionId`). Model and effort apply at the seat's next resume or start. A tool change cannot resume: the sheet
  offers « Redémarrer ce siège » and says the seat's conversation is not carried over.
- **Composition change on a live team.** Saved as one edited seat list, one daemon operation, one passkey over the
  digest of the whole list. Adding a seat starts a session in it (a new daemon operation; `team.join` only seats a
  running session).
- **Removing a seat from a live team** (the user's decision: « on le supprime, il finit ce qu'il fait puis on le
  vire »). The seat is dropped from the team, not left free. Its session is not interrupted: it finishes its current
  turn, then the daemon closes it. While it finishes, the sheet shows it as « termine puis part ». A task it still owns
  is not closed by this: it shows to its giver as usual when the session goes. `team.leave`, which only frees the seat
  and keeps the session running, stays as it is for the other clients.
- **Prompt-change recipients.** Every running session that holds the role and resolves to the written file, in a team
  or not. A resting team's seats get no queued message: they reread the file at resume.
- **Hand edits.** Every write and delete carries the hash of the file version the phone showed. The daemon refuses if
  the file changed since (« le fichier a changé sur le PC »), and the phone reloads it.
- **Renaming.** A team's id is fixed once saved, like a role's: renaming changes only its name.
- **Problems** are shown with the file name and scope, never the path.

## 4. Tests

- Protocol: the new operations' schemas, their bounds, and that a phone operation carries no path.
- Daemon: role and template writes (format round-trips through `parseRole` / the template parser, atomic write, scope
  → folder, project → repo), deletes, shadowing, the digest check refusing a changed content.
- Prompt change: only seats whose role resolves to the written file get the message; a dissolved team's seats do not;
  the message holds the full prompt.
- Gateway: each write without a valid assertion is refused (`confirm_required`, `assertion_invalid`,
  `assertion_expired`), as for `launch`.
- Mobile: the tab, the team editor (seat bounds, auto warning), the role editor (counter, id rules), the live sheet,
  the four-tab bar, the link from Agents' team header.

## 5. Left to the builder

- A project with several repositories on this machine: which one « Dépôt » writes to. Sensible default: the
  project's first listed repository on this machine, with the repo name shown on the scope button
  (« Dépôt paper-service »).
- How « finishes, then is closed » is detected for each tool (the session's next idle state is the natural signal).
- The editors' controls for tool, model, effort and autonomy (sheet, picker), drawn from what the daemon already
  accepts (`ToolSchema`, `ModelIdSchema`, `EffortSchema`, `AutonomySchema`).
- Exact operation names, the digest's form, and how the catalog is cached on the phone.
- Whether deleting a role that a team definition still seats is refused or allowed with a warning.

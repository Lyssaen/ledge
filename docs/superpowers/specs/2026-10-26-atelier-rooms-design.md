# The atelier's rooms: one room per project, one table per team

> Remplacé par 2026-10-30-ledge-openrig-orchestrator-design (lot 1 : équipes, rôles et tâches retirés).

Date: 2026-10-26. Status: design.

Builds on [roles, teams and Ledge as their operator](2026-10-25-roles-teams-operator-design.md) (live teams, §3.3).
Mockups: [desktop-atelier-room.png](mockups/2026-10-26-teams/desktop-atelier-room.png) (the room, kept),
[desktop-seat-session.png](mockups/2026-10-26-teams/desktop-seat-session.png) (a seat's page and the sidebar tree).

## 1. Intent

Ledge Desktop's atelier draws **one table per project**: its sessions sit around it, their topics lie on it as sheets,
their subagents stand at the ends (`atelier/layout.ts` `sceneOf`, `atelier/ProjectTable.tsx`). With teams, a project
can hold several groups that work apart: a team on the roles, another on mobile, and sessions that belong to no team.
One table per project can no longer say who works with whom.

The project becomes a **room**; inside it, **each live team has its own table**, and the sessions without a team sit at
the room's **common table**, which is exactly today's project table. Nothing that exists is lost: a project with no
team looks like today, inside its walls.

## 2. Decisions taken on the mockups

Five room styles were drawn on the real app (outline, tinted floor, low walls, platform, header card), then four decor
sets. Kept:

- **Low walls** (variant C): a back wall with a 4 px line in the project's colour, side walls, a front wall with an
  opening marked « ENTRÉE », and the room's plaque centred on the back wall (swatch, name, « 3 tables · 7 sessions »,
  waiting and working counts).
- **Margin** between the walls and the tables: **110 px** at the sides and the front, **150 px** at the back (atelier
  units, before zoom). 70 px between the tables of one room.
- **No decoration** in the room. The plants stay **on the tables**, as today (`atelier/Plants.tsx`, `plantSpots.ts`).
- The other styles and decors stay in the design canvas for reference; none of them ships.

## 3. Design

### 3.1 Scene model (`atelier/layout.ts`)

```ts
interface AtelierTable { key: string; kind: 'common' | 'team'; team?: Team; mains: Session[] }
interface AtelierRoom { project: Project; tables: AtelierTable[] }
interface AtelierScene { rooms: AtelierRoom[]; unassigned: Session[]; empty: Project | null }
```

`sceneOf(order, projects, teams, projectIdOf, filter)`:

- a session with a `team` that is a live team of this project goes to that team's table;
- any other session of the project goes to the common table (`key: 'common:<project>'`);
- a team's table is drawn while the team is `active` or `resting`, even with no live seat (a resting team shows its
  archived seats dimmed, see 3.4); a `dissolved` team has no table;
- the common table is drawn only when it has sessions, or when the room has no team table at all;
- tables are ordered: common first, then teams by creation;
- `unassigned` (Sans projet) is unchanged.

`walkOrder` walks rooms, then tables, then seats (keyboard `Alt ←/→`, `Alt 1…9`). `MAX_SEATS` applies per table.

### 3.2 Components

- `atelier/ProjectRoom.tsx` (new): the walls, the plaque, the entrance, and its tables in a flex row that wraps, with
  the margins of §2. Its `--project` colour drives the wall line and the plaque swatch. Room menu (`⋯` on the plaque):
  « Nouvelle session ici », « Nouvelle équipe ici… » (opens the launch form in team mode), « Modifier le projet ».
- `atelier/ProjectTable.tsx` becomes `AtelierTable.tsx`: the same table, chairs, sheets, end seats and plants as
  today, now keyed by table. Plants are seeded by the table key instead of the project id, so two tables of one room
  do not get the same plants.
- The table heading (today the rug label: name and `⎇ branch`):
  - common table: the project name and « table commune »;
  - team table: `⚑ <team name>` and « équipe · opérateur Ledge · 1/2 tâches », or « équipe au repos · Reprendre ».
- Seats: under each bot, the machine label (`seat-machine`) gives way to the role pill (`@build`) when the session has
  a role; the machine moves to the seat's tooltip.
- Sheets on a team table are the team's open tasks (`t…` id, title, who gave it, state) rather than the sessions'
  topics; a session with no task keeps its topic sheet, as today.

### 3.3 Interactions

- **Drop a session on a team table**: a small menu asks the role (the team's free roles, then « autre rôle… ») and
  sends `team.join`. Dropping on the common table of the same project sends `team.leave`. Dropping on another room
  files the session in that project (today's rule writing, `atelier/filing.ts`) and leaves its team.
- **Resting team**: its table is drawn at 60 % opacity with its seats' archived bots; the heading's « Reprendre » sends
  `team.resume`; the table menu has « Dissoudre l'équipe » (confirmed).
- **Ledge → team**: when Ledge gives a task, the exchange layer (`atelier/MessageLayer.tsx`) draws the dotted line from
  Ledge's corner to the owner's seat, with the task's title, as it does for messages between sessions.
- Zoom and « Ajuster » fit rooms rather than tables; the fit keeps the walls' margins inside the view.

### 3.4 Sidebar tree (`shell/sidebar/model.ts`, `Tree.tsx`)

Project › « table commune » (its branches and sessions, as today) › `⚑ team` rows (« équipe · 1/2 », or « au repos »)
› their seats with the role pill. The project row says « 3 tables ». « À toi » (`Attention.tsx`) gets the closed tasks
Ledge gave (see the roles spec §3.7): « ✓ a fini « Implémenter les rôles » · tâche de Ledge », with « Voir ».

### 3.5 A seat's page (`session/`)

The breadcrumb becomes `Atelier / <project> / ⚑ <team> / <bot>` with the role pill after the bot's name; the meta line
adds the team, the agent, the model and the autonomy; a « TÂCHE » notice replaces « Avis automatique » for a
`<ledge-task>`; the seat's current task is pinned above the reply field (« t5c7e2a · Relire le candidat 8e2f1c0 ·
donnée par Otto @build · prise », « Voir les tâches »).

## 4. Tests

`layout.test.ts` (rooms and tables from sessions and teams; resting team kept; dissolved team gone; common table rules;
walk order), component tests for `ProjectRoom` (plaque counts, menu) and the role pill on a seat, `filing.test.ts`
(drop on a team table → `team.join`, on the common table → `team.leave`), e2e `atelier.spec.ts` (a room with two teams
and a common table; drag to join; resume a resting team), sidebar tree model tests.

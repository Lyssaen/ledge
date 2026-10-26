# Ledge as the home view: the operator is the entry point

Date: 2026-10-26. Status: design.

Builds on [roles, teams and Ledge as their operator](2026-10-25-roles-teams-operator-design.md).
Mockups: [desktop-home-team-card.png](mockups/2026-10-26-teams/desktop-home-team-card.png) (a team proposed and
launched, its tasks given) and [desktop-home-follow-up.png](mockups/2026-10-26-teams/desktop-home-follow-up.png)
(« Où en est ledge-roles ? » and its action buttons).

## 1. Intent

Ask Ledge today is a 400 px panel docked on the right of the atelier (`chat/ChatPanel.tsx`, `.ledge-chat-panel`),
opened with `/` from a field at the top of the sidebar. Its answers are read-only, with cards for the few actions it
may propose. Now that Ledge is the operator (it composes teams, gives them work and reports back), it is where the user
starts: it becomes the **home view** of Ledge Desktop, and the atelier becomes the place to look at the work.

Two layouts were drawn on the real app: a wider dock (560 px) beside the atelier, and Ledge in the centre. **Ledge in
the centre is kept.**

## 2. Design

### 2.1 Navigation (`nav/state.ts`)

- `Place` gets `{ kind: 'home' }`, and `initialNav` starts there. `View` keeps `'atelier'`; the overview place is the
  atelier tab.
- Sidebar: the field at the top (`.st-ask`) becomes **Ledge's entry**: the resident mascot, « Ledge. », a live line
  (« 2 à toi · 1 équipe active »), the `/` key, and the question field under it. It is highlighted while the home view
  is shown. « Atelier » stays the second entry.
- `/` from anywhere goes home and focuses the composer. `Échap` from the home view goes back to the previous place.
- The docked panel stays for one case: asking Ledge while a session page or the atelier is shown (`Ctrl+/`), so the
  user can ask about what they look at without leaving it. It is the same component in a narrow layout.

### 2.2 The home view (`chat/LedgeHome.tsx`, reusing `ChatPanel`'s pieces)

From top to bottom, the conversation column at most 920 px wide and centred:

1. **Header**: mascot, « Ledge. », « Opérateur · voit 9 sessions, 2 équipes, 2 machines · lecture seule », new
   conversation, close (back to the atelier).
2. **Tabs**: « Conversation », « Équipes · n », « Tâches · n », « Historique » (the day's conversations, which the
   daemon already keeps).
3. **« Le point »**, pinned at the top of the scroll while the conversation scrolls under it. It is built by the client
   from the daemon's state, **not by the LLM**, so it is instant and always true:
   - « À toi »: the pending requests (as the sidebar's « À toi »), answerable in place (Oui, Non, Voir), and the closed
     tasks Ledge gave;
   - « Équipes »: each live team with its seats count, its project, a progress bar of its Ledge tasks (done / given),
     and « Table » (opens the atelier on it) or « Reprendre » for a resting team;
   - « Confiées par Ledge »: the open tasks Ledge gave and those closed today, with their owner and state.
   « Résumer la journée » asks Ledge for a written summary (an ordinary question).
4. **The conversation**: as today (user bubble, Ledge's answer, sources), with the new cards of the roles spec §3.8.
   A card keeps its outcome after the click and follows it live: « ✓ Équipe lancée à 23:10 · Ouvrir la table »,
   « ✓ Confiée à Mila · t91b0d4 · prise » then « finie ». Answers may end with action buttons that are cards in a
   compact form (« Autoriser pnpm test pour Mila », « Confier l'étape 2 à @build »); nothing happens without a click.
5. **Composer**: suggestions above it (« Monte une équipe… », « Confie une tâche à… », « Où en est ledge-roles ? »,
   « Qui a besoin de moi ? »), a multi-line field, the harness picker (as today), `@` to mention a session and `#` a
   team (inserted as ids the context folder resolves), and the reminder « lecture seule · rien sans ton clic ».

The « Équipes » and « Tâches » tabs are lists of the same records as « Le point », with filters (team, state, giver)
and the same actions; « Tâches » opens a task's `show` (detail, result, history).

### 2.3 Data

No new daemon state: « Le point » reads the snapshot (sessions with `pending`), `teams` / `team.updated` and
`task.updated` (roles spec §3.3 and §3.7), and a `task.cmd { op: 'list', by: 'ledge', all: true }` at load. The live
line of the sidebar entry is computed from the same.

### 2.4 Phone and TUI

- The phone app's chat gets « Le point » as its first screen, with the same three parts.
- The TUI keeps its tab order (Overview is `1`); Ask Ledge (`3`) gets the team and task cards, and its header says
  « Opérateur ». A « Le point » box at the top of Ask Ledge is a later step.

## 3. Tests

`nav/state.test.ts` (home is the initial place, `/` goes home, `Échap` goes back), `LedgeHome` component tests (« Le
point » from a snapshot: pending, teams, tasks; card outcome states), e2e `chat.spec.ts` (home on boot, a team card
launched, a task card given then followed to « finie »), the sidebar entry's live line.

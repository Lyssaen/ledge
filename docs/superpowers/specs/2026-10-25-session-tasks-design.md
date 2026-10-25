# Tasks between sessions: work that is given, taken and closed, not only said

Date: 2026-10-25. Status: design.

## 1. Intent

Messages between sessions (`ledge send`, `SendMessage`) say things; nothing records that a piece of work was given,
who holds it, or whether it ended. An agent that asks another « fais les tests de X » has no way to know the work is
done but to wait for a message that may never come: the receiver may forget, end its session, or be cleared.

OpenRig (mvschwarz/openrig) separates the two: `rig send` for nudges, a durable queue for work. A queue item is
claimed by its owner, handed off, and closed only with a reason; the sender is woken by a short pointer, never the
whole item. Its skills put it in one line: use send for quick nudges and the queue for anything that must not get lost.

Ledge takes the smallest part of that: a task has a giver, an owner, a state, and a result; every change that the other
side must know is typed to it at its next free moment by the mailbox, as a one-line pointer.

## 2. Goals and non-goals

Goals

- **Give.** `ledge task give <nom> "<titre>" ["<détail>"]`: a task for a live Ledge session. The owner gets a one-line
  `<ledge-task>` naming the giver, the title and the commands to read and close it.
- **Take, close.** `take` marks it in progress; `done <id> ["<résultat>"]` and `refuse <id> "<raison>"` close it and tell
  the giver, with the start of the result or the reason.
- **Pass.** `pass <id> <nom> ["<note>"]`: the task changes owner (the giver stays); the new owner is told.
- **Never lost.** Tasks are journaled in `~/.ledge/tasks.json`. An owner that ends (exited, removed) with an open task
  drops it: the giver is told, and can give it again.
- **Read.** `list` (the tasks I hold and the ones I gave that are still open; `--all` adds the closed ones), `show <id>`.
- Codex's hook runs a lone `ledge task …` itself, as it runs `ledge send`.

Non-goals: Desktop display (the CLI and the typed pointers carry it; a tasks panel is a separate design), dependencies
between tasks, deadlines and reminders, tasks across machines, tasks for sessions Ledge cannot type into.

## 3. Design

### 3.1 Model (`daemon/tasks.ts`)

```
Task { id: 't' + 6 hex, title ≤ 200, text ≤ 20000, giver, giverName, owner, ownerName,
       state: open | taken | done | refused | dropped, result?, at, updatedAt, log: { at, by, what }[] }
```

`log` keeps the passes and closes (« Pim a passé la tâche à Nova : note »). A closed task is kept 7 days, 300 at most.

Only the owner takes, closes or passes a task; the giver may also `refuse` it (to cancel). A closed task takes no more
change.

### 3.2 Protocol

- `task.cmd { rid, by, op: give | take | done | refuse | pass | show | list, task?, to?, title?, text?, all? }` (`task`,
  not `id`: the fleet routes a client message carrying `id` to that session's machine)
- `task.result { rid, task?, tasks?, reason? }`: the task changed or shown, the list, or why it was refused.

### 3.3 Pointers

The mailbox gets `notify(target, text, rid)`: a one-line system notice queued for the target's next free moment (no
failure notice about it). Tasks use it for every pointer:

- to the owner, on give and pass:
  `<ledge-task id="t1a2b3c" from="Otto">Tâche de Otto : « titre ». Lis-la : ledge task show t1a2b3c ; prends-la : ledge task take t1a2b3c ; à la fin : ledge task done t1a2b3c "résultat" (ou refuse).</ledge-task>`
- to the giver, on done, refuse and drop:
  `<ledge-task id="t1a2b3c" from="Pim">Tâche « titre » terminée par Pim : début du résultat… (ledge task show t1a2b3c)</ledge-task>`

The history shows a `<ledge-task>` prompt as a notice, never as the user's words; it does not set the topic.

### 3.4 Agents

The identity context gets one line: « Pour confier un travail qui ne doit pas se perdre, plutôt qu'un message :
`ledge task give <nom> "<titre>" "<détail>"`. Une `<ledge-task>` t'en confie une ou te dit qu'une des tiennes a fini. »

## 4. Tests

`tasks.test.ts` (give, take, done, refuse by owner and giver, pass, rights, closed task frozen, owner exit drops and
tells, journal reload), `send.test.ts` (`parseLedgeCommand` task), `crossSession.test.ts` (ledge-task frame),
`history.test.ts` (a ledge-task is a notice), `server.test.ts` (`task.cmd` round trip).

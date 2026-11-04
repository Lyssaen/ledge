# Ledge's brain: what Ledge and its sessions know of themselves and of the user's environment

Date: 2026-11-04. Status: draft, to review with the user. No code yet; the write-back cards (§3.6) need a mockup
approved before any UI code.

## 1. Where we are

Checked in the code on 2026-11-04, and in a real chat turn (the transcript of the mobile thread
`hFKHtYhbHWH2iUobccmVL_`, session `17de03bf…`).

Two readers, two very different views:

- **The chat** gets, at each question, a folder written by `writeContext()` (`packages/ledge/src/chat/context.ts:25`):
  `sessions.md`, `pane-<id>.txt`, `reply-<id>.md`, `git-<id>.txt`, `folders.md`, `projects.md`, `tasks.md`,
  `forge*.md` (only when the question matches `asksForge`), `ledge.md` (the guide `docs/ledge-guide.md` plus what the code
  says, `chat/guide.ts:372`) and the user's notes: `~/.ledge/context/*.md` copied as `context-<name>.md` with
  `context-index.md` (`chat/notes.ts:163`). Its persona is `buildPersona()` (`chat/persona.ts:440`).
- **A session Ledge launched** gets only `identityContext()` (`packages/ledge/src/cli/hook.ts:383`): its name, project,
  branch, how to reach the others (`ledge who`, `ledge send`, `ledge task`), its open tasks. It does not know what Ledge
  is beyond that, and it never sees the user's notes: that the tablet's `sudo` asks for a password, which machine runs
  what, where a secret lives. The notes exist (5 today: `machines.md`, `reseau.md`, `services.md`, `bots-deploiement.md`,
  `acces-et-secrets.md`) and are read by the chat only.

Nothing goes back: what a session finds out about the environment is lost when it ends, unless the user edits a note
by hand.

## 2. Goals and non-goals

Goals:

1. **One source, two readers.** The chat and every session read the same knowledge, by the same index.
2. **Read on demand.** A session is told the index (a few lines), never the notes themselves; it reads a note when its
   work needs it. Nothing is pushed that a CSS session does not need.
3. **Write-back under the user's control.** A session (or the chat) may *propose* a fact or flag a note as wrong; nothing
   is written before the user validates a card. The chat stays read-only.
4. **Never a secret value.** A note says where a secret is, never what it is; a note can be kept out of the sessions.
5. **Dated.** Each fact says when it was checked; the index shows what is getting old.

Non-goals:

- No vector store, no embeddings, no RAG. With tens of notes, an index of `title` + `when` that the model reads is
  enough and keeps every fact traceable to a file and a date. Reconsider past ~150 notes.
- No automatic writing of notes by an agent, ever.
- Not a replacement for a repository's `CLAUDE.md` / `AGENTS.md`: the brain describes the environment, the repository
  describes its code. On the code, the repository wins (said in the hook, §3.4).
- The notes stay on the machine of the daemon that holds them; no sync between machines in this spec (§6, Q4).

## 3. Design

### 3.1 The notes (the user's part)

Folder unchanged: `~/.ledge/context/*.md` (the guide already documents it, `docs/ledge-guide.md:26`, and the user's
notes are there). Only regular `.md` files directly in the folder, as `notes.ts` reads them today.

Front matter, every field optional, an older note reads unchanged:

| Field | Meaning | Default |
|---|---|---|
| `title` | one line, the index's label | the file name |
| `when` | when to read it | the first line of the body |
| `scope` | `all`, `chat` (never shown to sessions) or `sessions` | `all` |
| `projects` | comma-separated project names or ids: shown in the index of those projects' sessions only | every project |
| `checked` | date the content was last verified (`YYYY-MM-DD`) | none: the index shows the modification date |

`acces-et-secrets.md` would get `scope: chat` if the user wants it kept out of the sessions (§6, Q2).

### 3.2 What Ledge says of itself (the generated part)

Already generated for the chat, made readable by sessions under fixed names that cannot clash with a note
(a note named like one of them is listed under `note:<name>`):

- `ledge`: `ledge.md` as today (guide + version + agents installed + actions).
- `projects`: the projects, their repositories per machine (what `projects.md` holds).
- `machines`: the machines the daemon knows (`daemon/machines.ts`), name and reachability, no credentials.

`sessions` and `tasks` are not duplicated: `ledge who` and `ledge task list` already answer.

### 3.3 One module, `packages/ledge/src/brain/`

- `index.ts`: reads the folder once per call (no cache: a note edited by hand is seen at once), parses the front matter
  with the existing `frontMatter()` (moved from `chat/notes.ts`), returns entries
  `{ name, title, when, scope, projects, modifiedAt, checkedAt?, truncated, doubtful? }`, sorted by name, capped at
  `NOTES_MAX` (200) and `NOTE_MAX` (32 KiB) as today.
- `chat/notes.ts` becomes a thin writer over it (same files, same steps), filtered on `scope !== 'sessions'`.
- Daemon requests `brain.list { for: sessionId }` and `brain.show { name, for }`: the daemon applies `scope` and
  `projects` for that session, so a hook-side bug cannot leak a `chat` note.

### 3.4 Sessions: the hook and the CLI

`identityContext()` gains a block after the tasks, only when there is at least one entry for this session, at most 20
lines (the rest: « et N autres : `ledge brain` »):

```
Ce que Ledge sait de ton environnement (notes de l'utilisateur, à lire seulement si ton travail en a besoin) :
- machines — « Les machines du homelab » — quand : une question sur une machine précise… — vérifiée le 2026-11-01
- reseau — « … » — quand : … — modifiée le 2026-10-30
Lis-en une avec `ledge brain <nom>` ; `ledge brain ledge` dit ce qu'est Ledge. Pour le code, le CLAUDE.md ou AGENTS.md
du dépôt prime. Tu apprends un fait durable sur l'environnement : `ledge brain propose <nom> "<fait>" "<comment tu le sais>"`.
Une note te semble fausse : `ledge brain flag <nom> "<ce qui ne va pas>"`. L'utilisateur valide avant que rien ne s'écrive.
```

CLI (`packages/ledge/src/cli/brain.ts`, `case 'brain'` in `cli/index.ts`):

- `ledge brain` — the index for this session (`LEDGE_SESSION`), or every entry outside a session.
- `ledge brain <name>` — the note's text, headed by its name, title and dates; a truncated note says so.
- `ledge brain propose <name|new:<name>> "<fact>" "<source>"` — §3.6.
- `ledge brain flag <name> "<what is wrong>"` — §3.6.

For Codex, Cursor and OMP, whose shell cannot reach the daemon, `parseLedgeCommand` and `runLedgeCommand`
(`cli/hook.ts:470`) learn `brain` like `who`, `read`, `task` and `handover`, and the Codex / OMP hook sentence names it.

Size: the block is ~1.5 KiB for 5 notes, told once at start, resume and clear (as the identity is).

### 3.5 The chat

- The persona's sources paragraph points at the same names; `context-index.md` keeps its name and gains `checked` and
  the « à revoir » flag (§3.6).
- The chat may propose `note.propose` (a new registry action, card `generic`, risk `reversible`, max 1): same arguments
  as the CLI. Rule: only when the user states a durable fact about the environment and asks to keep it.

### 3.6 Write-back: proposals and flags

A proposal is not a free rewrite of a note: it **adds a dated fact** or **creates a short note**. Rewriting stays the
user's, by hand. This keeps the review small (one line to read) and the note the user's own text.

- `propose`: `{ note, fact (≤ 500), source (≤ 300), by: session name, at }`. Validated → appended to the note under a
  `## Ajouts` section (created at the end if missing) as `- <fact> — <source>, proposé par <by> le <date>`. For
  `new:<name>`, a note is created with `title` and `when` given in the card (the user edits them before validating).
- `flag`: `{ note, what (≤ 500), by, at }`. Validated → kept in `~/.ledge/brain.json` (not in the note); the index shows
  the note « à revoir : <what> » until the note's modification date passes the flag's (the user edited it) or the user
  clears it.
- Refused at the source (daemon, before any card): a fact or a source that `redact()` (`chat/forge.ts:239`) changes
  (it looks like a token or a credential), a note with `scope: chat` proposed by a session, an unknown note.
- Where the card shows: the desktop's pending list and the phone, like a task given to Ledge; at most 3 pending per
  session (beyond: refused « trop de propositions en attente »). A proposal is answered `Ajouter`, `Modifier puis
  ajouter`, `Refuser`; the session gets the outcome as a `<ledge-notice>`.
- Storage: `~/.ledge/brain.json` (`{ proposals: [], flags: [] }`), written like the other journals.

Mockup to approve before any card code: desktop pending row, phone card, « Modifier puis ajouter » editor, and the
« à revoir » marker in a Settings list of notes (read-only list with « Ouvrir le dossier »).

### 3.7 Freshness

The index line says `vérifiée le <checked>` when given, else `modifiée le <mtime>`. Past 60 days without a check
(either date), the line says « ancienne : à vérifier avant de t'y fier ». Validating a proposal does not set `checked`:
only the user does.

## 4. Lots

- **Lot 0 — the chat's context, separate from the brain** (found while auditing, each one small). Done on
  `feat/chat-context-lot0` (2026-11-04), item 9 as a comment only: Codex's sandbox confines writes, never reads, so no
  flag can narrow what it reads.
  1. `claudeArgs` (`chat/claude.ts:488`): `--strict-mcp-config` and an empty MCP config, so the claude.ai connectors
     (49 deferred tools, ~83 KB per turn in the audited transcript) stop reaching the chat.
  2. `--system-prompt` instead of `--append-system-prompt`, so Claude Code's own terminal-oriented prompt goes; the
     persona then says the few things it relied on (Markdown, language).
  3. `tasks.md`: each task's `text` (cut at 1 000 characters), so `task.answer` can quote the options.
  4. `sessions.md`: `model` and `effort`, `machineName`, `queue` length; archived sessions in a short final section
     (name, id, archived at), for `session.restore`.
  5. Forge: write `forge*.md` for every question when the cache is fresh, run `gh`/`glab` only on `asksForge`; the
     persona no longer says « no access » when the file is missing, only when the file says so.
  6. `addDirs`: the projects' local repositories too, not only the sessions' (else a question with no session cannot
     read any repository, as in the audited turn).
  7. `folders.md`: leave out folders under the OS temporary directory.
  8. `tasks.md` « closed today » against `input.now`'s date.
  9. Codex chat: replace `disk-full-read-access` by the context folder and `addDirs`, or document why not.
- **Lot 1 — read**: §3.1–3.5 without `propose`/`flag`. Tests: index parsing (scope, projects, checked, clash with a
  generated name), daemon filtering per session, hook block (cap, empty), CLI on all four harnesses, chat unchanged
  for an older notes folder.
- **Lot 2 — write-back**: §3.6, after the mockup. Tests: append and create, redaction refusal, scope refusal, caps,
  flag lifecycle, notice to the session.
- **Lot 3 — freshness**: §3.7 and the Settings list.

## 5. Risks

- **Prompt injection through a note.** A note is the user's text, but a proposal comes from a session that may have read
  hostile content (a web page, a repository). Mitigation: nothing is written without the user reading the exact line;
  the fact is shown as plain text, never rendered; the source is shown next to it.
- **Stale knowledge stated as fact.** Mitigation: dates on every line (§3.7), and the hook says « à lire seulement si ».
- **Token cost.** The index only, capped at 20 lines, once per start.

## 6. Open questions for the user

1. Name: « Cerveau » in the UI and `ledge brain` in the CLI, or keep « contexte » / `ledge context` (already the
   folder's name, but « contexte » also means the context window and the handover)?
2. `acces-et-secrets.md`: `scope: chat` (sessions never see where secrets are), or `all` (a session deploying a bot
   needs to know where its token lives)?
3. Proposals: append-only `## Ajouts` as designed, or let a card replace a whole note (more powerful, much heavier to
   review)?
4. Several machines: notes stay per daemon (Legion's and the PC's differ), or one machine holds them for all?

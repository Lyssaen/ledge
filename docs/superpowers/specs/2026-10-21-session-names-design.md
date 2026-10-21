# Session names: Ledge addresses, Claude topics

Date: 2026-10-21 · Status: draft, awaiting review

## Why

Since #20 (`74a1f03`), Ledge launches Claude Code with `-n <Ledge name>` so that SendMessage and ListAgents address a
session by its Ledge name. In Claude Code 2.1.306, `-n` sets one display name used for three things at once: the peer
name (the SendMessage address), the `claude --resume` picker label, and the terminal title. Two things broke for the user:

1. **`ledge who` shows SUJET = NOM.** The Claude adapter reads the pane title as the session's topic
   (`state.ts` `PaneTitle`). With `-n Pim`, Claude titles its pane `✳ Pim`, so every topic is the name.
2. **`claude --resume` lists names only.** `-n` writes `custom-title: "Pim"` (and `agent-name: "Pim"`) into the
   transcript, and Claude no longer generates its own title (`ai-title` entries): a session launched with `-n` has none.
   The picker shows « Pim », « Otto », … instead of what each conversation was about.

The analysis also found that Ledge's directory (the daemon's store) and Claude's (`~/.claude/sessions/<pid>.json`)
diverge: Ledge keeps names unique among its own sessions only, Claude's directory keeps files of dead processes (two
« Pim » and two « Bix » were listed, one of each dead), a name Ledge changes at register (two launches picking the same
name, `server.ts` `session.register`) is not the one Claude was launched with, and a `/rename` in Claude is never seen.

## What the user wants

- `claude --resume` shows, for a session Ledge launched, **« <Ledge name> - <topic Claude generated> »**
  (e.g. « Pim - Refonte des noms de session »).
- `ledge who`'s SUJET column shows that topic, never the name again.
- Only sessions Ledge launched talk to each other. Sessions the user started by hand (`hook_only`) stay visible in
  `ledge who` (read only) and are not reachable.
- A Claude-to-Claude message keeps Claude's native delivery (it arrives mid-turn, Claude acks it); Ledge only
  translates the address. Typing into the pane stays the path for Codex (and OMP's protocol), unchanged.

## Decided approach (option B)

**Ledge stops passing `-n`. Ledge, not Claude's peer directory, owns the Ledge name → address mapping.**

A spike (2026-10-21) proved the key mechanism: a `PreToolUse` hook on `SendMessage` that answers
`permissionDecision: "allow"` with `updatedInput` = the input with `to` replaced by `uds:/run/user/1000/cc-socks/<pid>.sock`
gets the message delivered to that session, even though the name the model used (`Fantome`) exists nowhere. Claude's
SendMessage input carries more than the documented fields: `{ to, summary, message, type: "message", recipient,
recipient_kind: "name", content }`. Rewriting `to` alone was enough; the receiver got
`<cross-session-message from="uds:…/<sender pid>.sock" from-name="<sender's Claude name>">`.

### 1. Launch without `-n`

- `agentNameArgs` (`spawn.ts`) goes: Claude is launched without `-n`. Claude then names itself (e.g. `ledge-88`),
  generates its `ai-title`, and titles its pane with it, so the existing `PaneTitle` → topic path gives the real topic
  again. `LEDGE_NAME` / `LEDGE_SESSION` in the environment are unchanged.
- A user who passes `-n`/`--name` in the agent args keeps it, as today.

### 2. Topic: never the name

The pane title stays the topic source for Claude, with two filters in the reducer (or the Claude adapter's `paneTitle`):

- a title equal to the session's Ledge name is ignored (sessions launched before this change, resumed: their transcript
  still holds `custom-title: "Pim"`, and Claude titles the pane with it);
- a title of the form `<Ledge name> - <rest>` gives `<rest>` (sessions resumed after Ledge wrote its label, see §5).

The existing fallbacks stay: topic from the first prompt (`state.ts` line ~323) when no pane title gave one, a user
rename (`topicSource: 'user'`) wins over both.

### 3. Sending: the hook resolves the address

Today `relayMessage` (`cli/hook.ts`) submits every Claude SendMessage to the mailbox with `intercept: true`; the mailbox
answers `native` for a Claude target (or an unknown name), and Claude resolves the name in its own directory.

**Only a Ledge-launched sender is handled** (builder's-check call): a SendMessage from a session the user started by
hand (`hook_only`) is left entirely to Claude, as if Ledge were not there, so two hand-started sessions keep messaging
each other natively.

**Resolution order for `to`** (call made after the builder check), first match wins:
1. a `uds:` address: the live peer file of that socket;
2. the Ledge name (bare, without ` [ref]`) of a live, non-archived Ledge session: Ledge owns the names;
3. a Claude name in Claude's directory (live pids only), e.g. a reply addressed to `from-name`. Two live peers with
   that name: refused as ambiguous (« plusieurs sessions s'appellent <name> »), never guessed.

This flips `peers.ts`'s current order (Claude's directory first, Ledge name as fallback).

New behaviour of an intercepted SendMessage from a Ledge-launched Claude, by what `to` resolves to:

| Target | Outcome |
|---|---|
| A live Ledge-launched Claude session | Hook answers `allow` + `updatedInput` with `to` (and `recipient`) = that session's current `uds:` address. Native delivery. |
| A live Ledge-launched Codex / OMP session | Unchanged: the mailbox delivers, the real tool is denied with the ack. |
| A `hook_only` session (started by hand) | Refused, as for Codex today: « <name> n'a pas été lancée par Ledge : impossible de lui écrire ». |
| A Ledge-launched Claude whose address cannot be found (no live peer file for its `agentSessionId`) | Refused with a clear reason (« <name> n'est pas joignable »), not left to Claude. |
| A name Ledge does not know at all | Left native, as today (not Ledge's business). |

- The address comes from Claude's directory: the `<pid>.json` whose `sessionId` is the target's `agentSessionId` (or
  the basename of its `transcriptPath`), **whose pid is alive**. The daemon computes it (it already has the store and
  `peers.ts`); the ack carries it, e.g. `outcome: 'native', address: 'uds:…'`. The protocol change is the builder's.
- Reading Claude's directory skips dead pids everywhere (`readPeers`), which also fixes history cards linked to an
  old session of the same name.
- A message too long for Ledge (`MESSAGE_MAX`) to a Claude target: still resolved and rewritten (the rewrite does not
  carry the text through Ledge); only the mailbox path has the limit.

### 4. Receiving: the sender's Ledge name

The receiver sees `from-name="ledge-88"` (Claude's name, now meaningless). A message delivered while the receiver is
working does **not** go through its `UserPromptSubmit` hook (observed 2026-10-21: the spike's message reached a busy
session as a queued command, and Ledge's history recorded no received card), so the receiver's hooks cannot name the
sender reliably. The sender's hook does it instead: when it rewrites `to` (§3), it also prefixes the message text
with the same note Ledge types for Codex today (`crossSession.ts` `note`): « (message de la session <sender name>, pas
de l'utilisateur ; pour répondre : SendMessage vers <sender name>) ». It reaches the receiver idle or busy. A reply
addressed to the `uds:` address or to the Claude name also works: §3 resolves those too.

- The history strips that note when it pairs a received body with its sent card (as `ledgeMessages` already does for
  the typed path), and the received card shows the sender's Ledge name when its peer is known (`history.ts`
  `receive`: today `from: m.name ?? m.from`).
- Known gap, out of scope: a message received mid-turn produces no received card in the thread (it is not a
  `UserPromptSubmit`). This is already the case today and is unchanged here.
- Notices (`[Cross-session idle notice]`, delivery notices) name peers by Claude name: they keep resolving through
  `peerOf`, and show the Ledge name when there is one.

### 5. The `claude --resume` label

Claude only shows a label other than its own title if the transcript holds a `custom-title` entry. Ledge appends one:

- `{"type":"custom-title","customTitle":"<name> - <topic>","sessionId":"<agentSessionId>"}` at the end of the
  session's transcript (`transcriptPath`), where `<topic>` is the session's Ledge topic (Claude's generated title in
  the normal case, a user rename if there was one, the first prompt as last resort). No topic: no entry.
- **When**: once the Claude process is gone (the launched session goes `exited`: `session.unregister` / `PaneGone`,
  and also when a model change replaces the agent before it is resumed). Claude never writes the file at that moment,
  so there is no concurrent append. Consequence accepted by the user: a session still running, or one that crashed
  without Ledge seeing its end, shows Claude's title alone in the picker.
- Only for Claude sessions Ledge launched, and not when the user passed their own `-n`.
- When Ledge resumes such a session, Claude reads that `custom-title` back as its display name and pane title: §2's
  `<name> - ` filter keeps the topic clean. Claude may stop updating `ai-title` once a custom title exists; the topic
  then stays the one written, and the next exit rewrites the same label. Accepted.

**To verify first (spike, before any of the above is built):** with a dead session's transcript holding `ai-title`
entries and an appended `custom-title`, does `claude --resume`'s picker show the custom title, and does a resumed
session keep it? If the picker ignores an appended entry, stop and come back to the user: the fallback (typing
`/rename` into the pane) has costs they have not weighed.

### 6. What a session is told

`identityContext` (`cli/hook.ts`) for Claude: keep « Tu es <name> … Les autres sessions Ledge te connaissent sous le nom
<name> », keep `ledge who`, and say: « Pour écrire à une autre session Ledge, Claude ou Codex, utilise son nom Ledge
(donné par `ledge who`) comme adresse SendMessage : Ledge le transmet. `ListAgents` montre les noms internes de Claude,
pas les noms Ledge. » Codex's text is unchanged.

## Goals

- `ledge who` SUJET and `claude --resume` show the conversation's topic, with the Ledge name prefix in the picker.
- SendMessage by Ledge name works between Ledge-launched sessions whatever Claude calls them, including after a
  register-time rename, a `/rename` in Claude, or stale peer files.
- A received message names its sender by Ledge name.

## Non-goals

- Reaching sessions started by hand (`hook_only`).
- Changing Codex or OMP messaging, or the mailbox's typing path.
- Making `ListAgents` show Ledge names (Claude owns that list).
- Rewriting old transcripts in bulk: a session launched before this change gets its label the next time Ledge sees it exit.

## Anti-goals

- Ledge writing into a transcript Claude is appending to (only after the process is gone).
- A message silently going to the wrong session: a dead or ambiguous peer is refused, never guessed.
- The hook slowing the agent: SendMessage keeps its 1.5 s budget; on timeout or failure (daemon down, no answer), the
  hook falls back to today's behaviour (native SendMessage, unchanged input).

## Constraints

- Claude Code ≥ 2.1.303 (cross-session messaging); `updatedInput` on `PreToolUse` as verified on 2.1.306.
- The hook must work with the daemon down (it then does nothing, as today).
- Tests follow the repo's vitest style; the spike's end-to-end check (a Claude SendMessage rewritten to a live session's
  socket and received) is worth keeping as a manual check in the plan, not as a CI test (it needs a logged-in Claude).

## Left to the builder

- The exact protocol change for the address in the ack, and whether resolution lives in the daemon or the hook.
- Whether to also rewrite `recipient` / `recipient_kind` (rewriting `to` alone worked; keep the input coherent if
  `recipient_kind` has a value for addresses).
- Where the `<name> - ` filter lives (adapter vs reducer), and the separator handling (`-`, ` - `).
- The README line for `ledge claude --name` (it names the Ledge session; it no longer names Claude's).

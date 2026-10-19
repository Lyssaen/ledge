# Codex sessions talk to the others: messages between Ledge sessions, whatever the agent

Date: 2026-10-19. Status: design.

## 1. Intent

Today only Claude Code sessions can write to each other. Ledge rides Claude Code's own cross-session messaging:
`SendMessage` to a peer's name, delivered over a socket each Claude process announces in
`~/.claude/sessions/<pid>.json` (`daemon/peers.ts`), and Ledge names each Claude with `-n <name>`
(`spawn.ts`, `agentNameArgs`) so the Ledge name is the address. A Codex session has no socket and no address: it can
run `ledge who` and see the others, but it cannot write to anyone, and nobody can write to it. The identity context
says so implicitly: the « Pour écrire à une autre session Ledge… » line is given to Claude only (`cli/hook.ts`,
`identityContext`).

The user: « je veux pouvoir faire comme avec claude je veux qu'il communique ». A Codex session launched by Ledge
must be a full participant: it writes to any session by its Ledge name, it receives messages from any session (a Claude
or another Codex) and answers them, and Desktop shows its exchanges with the same cards as Claude's.

## 2. Goals, non-goals, anti-goals

Goals

- **Codex → anyone.** A Codex session sends a message to any live Ledge session (Claude or Codex) by its Ledge name.
- **Anyone → Codex.** A Claude session writes to a Codex with `SendMessage` and the Codex's Ledge name, as it would to
  another Claude: nothing new for Claude to learn (the user chose « transparent »). A Codex writes to a Codex the same
  way it writes to anyone.
- **Delivery like Claude's** (user: « comme claude »): a message to a session that is busy waits for the end of its
  turn, then arrives as a new prompt that wakes it. Never an interruption.
- **The receiver knows who wrote.** A delivered message names its sender (Ledge name and tool), so the receiver can
  answer.
- **Desktop shows it.** Sent and received messages involving a Codex appear in the thread as the existing message cards
  (`sent` / received, delivered, read), like Claude ↔ Claude today.

Non-goals

- **Claude ↔ Claude is untouched.** It keeps Claude Code's native channel; Ledge only steps in when the target is not a
  Claude.
- **Sessions on other machines.** Local daemon only; a remote machine's sessions are out of scope.
- **Sessions Ledge did not launch** (`source: 'hook_only'`): they have no tmux pane to type into. Writing to one is
  refused with a reason.
- **Claude's extras**: `notify_when_idle`, approval/hold of messages, artifacts across sessions. Not reproduced.
- **Cursor.** Out of scope for now; the mechanism must not be tied to Codex so Cursor can follow later (my call).

Anti-goals

- **Never impersonate a Claude peer.** Writing fake `~/.claude/sessions/*.json` entries or speaking Claude Code's
  internal peer protocol was considered for full transparency and rejected: the protocol is internal, versioned and
  authenticated by keys, with approval/refusal steps; reproducing it means reverse-engineering and bypassing that
  authentication, and it would break on any Claude Code update. Only documented mechanisms: hooks, the Ledge daemon,
  tmux.
- **Never lose or reorder silently.** A message that cannot be delivered (target exited, deleted, not launched by
  Ledge) is reported as such, to the sender when it is still sending and in Desktop otherwise.
- **Never type into a dialog.** Delivery never lands in a permission or question prompt: that would answer it.

## 3. How it works (decided)

### 3.1 One delivery path in the daemon

The daemon gets a message request: `{ from: <session id>, to: <Ledge name>, text, summary? }`. It resolves `to` among
live, non-archived sessions by Ledge name, then:

**Fire-and-ack** (my call). The daemon answers the request at once, without waiting for the typing: `accepted` (it will
deliver now or when the target is free) or `refused` with the reason. Delivery then happens asynchronously and its
outcome (delivered, dropped) reaches the sender's card in Desktop (§3.5), not the sender itself. Each request carries an
id (the `SendMessage` `tool_use_id` for Claude, a fresh one for `ledge send`) and the daemon ignores a repeat of an id
it already accepted, so a retry never delivers twice.

**One queue per target, shared with the chat relay** (my call). `daemon/relay.ts` already queues the Ledge chat's
instructions and types them into a target at its next free moment. Agent messages share its typing lock, so the two
never race for the same idle moment; at a free moment the user's chat instruction goes first, then agent messages in
arrival order, one per free moment (my call, found while planning: the relay queue lives in the chat turns, and the
user's own instruction outranks an agent's).

- **Target idle** (no pending prompt, not working): types the message into the target's tmux pane as a prompt and
  submits it, through the same path `session.reply` uses (`replyTo` → `injectAndVerify` with the adapter's
  `replyPlan`), so injection is verified the same way.
- **Target busy** (working, waiting for permission, a question open): the message joins a per-target FIFO queue in the
  daemon. When the target next becomes idle, the queue is delivered in order. Several queued messages may be delivered
  as one prompt with several blocks (as Claude Code does) or one by one: builder's choice.
- **Target not deliverable** (unknown name, exited, `hook_only`, no tmux pane): refused immediately with the reason.
  A queued message whose target exits or is deleted before delivery is dropped and marked so in the sender's thread.

The queue lives in daemon memory (my call): a daemon restart drops pending messages, and that is acceptable; the
sender's card then shows it was not delivered.

### 3.2 What the receiver sees

The prompt names the sender and is recognisable by Ledge's parsers, in a Ledge-own tag, not Claude Code's
`<cross-session-message>` (my call: a typed prompt mimicking a harness tag would confuse Claude and look like an
injection):

```
<ledge-message from="Pim" tool="codex">…</ledge-message>
Pour répondre, utilise `ledge send Pim "…"`   (Codex receiver)
Pour répondre, utilise SendMessage vers Pim     (Claude receiver)
```

**Another agent's words, not the user's** (my call, following « comme claude »). Typed into the pane, the message
arrives as a user prompt, but Claude Code's native messages are framed as another session's words with no user
authority. The Ledge prompt says the same in one line: a message from the session `<name>`, not an instruction from the
user. No rate limit or loop guard beyond what Claude has natively (none in Ledge today).

The exact wording and the reply hint are the builder's. `tmux.sendText` rejects newlines: a multi-line body is
flattened (as `replyPlan` already does) unless the builder finds a reliable multi-line input for both TUIs.

### 3.3 Codex sends: `ledge send`

A new CLI command `ledge send <name> "<message>"` (optional `--summary`). It identifies the sender by
`LEDGE_CODEX_HOOK_SESSION` (`CODEX_HOOK_VAR`, set per session through `shell_environment_policy` by `agentIdArgs`), not
`LEDGE_SESSION`, which a shared Codex app-server may carry from another session (`cli/hook.ts`, `codexLedgeId`);
outside Codex it falls back to `LEDGE_SESSION`. The sender's name is looked up in the daemon, not read from
`LEDGE_NAME` (it follows renames). It sends the request and prints the daemon's answer on one line: accepted (delivered
now, or queued until `<name>` is free) or refused with the reason.

The identity context (`identityContext`) tells a Codex session: « Pour écrire à une autre session Ledge, lance
`ledge send <nom> "<message>"` ». A Claude session's line is extended so it knows that `SendMessage` with the Ledge
name works for every session listed by `ledge who`, Codex included.

### 3.4 Claude writes to a Codex: intercepting `SendMessage`

Ledge already installs a Claude Code `PreToolUse` hook. For `SendMessage`, the hook asks the daemon whether `to` is the
name of a live Ledge session whose tool is **not** Claude. Only then does it step in (my call): a Claude target always
keeps the native channel, even one the native channel cannot reach (launched with the user's own `-n`, peer file not
written yet, older Claude Code), so Claude ↔ Claude stays exactly as today. If it is a Codex:

1. the hook sends the message request (§3.1) with `from` = the calling Claude's Ledge session;
2. it answers Claude Code with `permissionDecision: "deny"` and a reason that reads as a receipt: « Message transmis
   par Ledge à Pim (Codex) : il le recevra dès qu'il sera libre », or the refusal.

Known limit, accepted by the user: Claude sees the call as refused-with-a-reason, not as delivered; the reason tells
it what happened. `ListAgents` does not list Codex sessions; `ledge who` does.

The hook must answer within its timeout. Ledge's hooks give the daemon 100 ms today (`runHook`), with a 5 s cap in
the installed settings (`cli/setup.ts`); this hook needs one round-trip for resolve-and-accept, which fire-and-ack keeps
short, and the builder sets its budget. When the daemon is down or does not answer in time, the hook lets `SendMessage`
proceed unchanged (it fails natively, « unavailable ») and never blocks Claude. If the request did reach the daemon
after all, Claude's retry carries a new `tool_use_id`; that rare double is accepted (my call).

### 3.5 Desktop cards

`daemon/history.ts` already builds `sent` cards from `SendMessage` and received items from `<cross-session-message>`
prompts, with delivered/read status. Extend it so that:

- a message sent through the daemon (either path) creates or updates the sender's `sent` card with `peer` = the target
  session and its status: queued, delivered, dropped/refused;
- a `<ledge-message>` prompt on the receiver is parsed (next to `crossSession` in `daemon/crossSession.ts`) as a
  received message, and marks the matching `sent` card read, as Claude ↔ Claude does today;
- an intercepted `SendMessage` (denied by the hook) is not shown as a failure: its card follows the daemon's status.

## 4. Constraints

- Codex runs in a sandbox. `ledge send` talks to the local daemon (WebSocket on localhost). Whether Codex's default
  sandbox lets a shell command reach it, or raises an approval prompt each time, must be checked first on Codex CLI
  0.162; the same applies to `ledge who`, which is already advertised to Codex. If it is blocked, the builder finds
  the narrowest fix (an allowed command, a socket path, a Codex config passed at launch like `agentIdArgs`) and says
  which.
- Delivery depends on reliable idle detection for both tools (`daemon/state.ts`). Typing while the agent is actually
  working is the failure to avoid; `injectAndVerify` must confirm the prompt was taken.
- Test with fakes as the existing tests do (`test/server.test.ts`, `test/hook.test.ts`, `test/chat-codex.test.ts`).

## 5. Left to the builder

- Protocol message names and shapes between the CLI/hook and the daemon.
- Batching of queued messages into one prompt or several.
- The exact prompt wording and reply hints, in French like the identity context.
- How multi-line bodies are handled (flattened by default).
- How Desktop renders the « queued » state on a card (reuse the existing statuses if one fits).

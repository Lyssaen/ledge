# Session names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude sessions launched by Ledge keep Claude's own generated topic (in `ledge who` and in `claude --resume` as « <Ledge name> - <topic> »), while SendMessage by Ledge name keeps working through an address rewrite in the PreToolUse hook.

**Architecture:** Ledge stops passing `-n` to Claude. The Claude PreToolUse hook resolves a SendMessage `to` itself (it already fetches the daemon snapshot; it reads Claude's peer directory locally) and either rewrites `to` to the target's live `uds:` address (Claude target), hands the message to the mailbox (Codex/OMP, as today), or denies with a reason. The pane-title topic ignores the Ledge name, and the daemon appends a `custom-title` label to the transcript once the Claude process is gone.

**Tech Stack:** TypeScript (ESM), vitest, pnpm workspace (`packages/ledge`, `packages/protocol`).

**Spec:** `docs/superpowers/specs/2026-10-21-session-names-design.md`

## Global Constraints

- Claude Code ≥ 2.1.303; `updatedInput` on `PreToolUse` as verified on 2.1.306.
- The hook must work with the daemon down: it then does nothing (prints nothing, SendMessage proceeds unchanged).
- SendMessage keeps its 1.5 s budget (`SEND_MESSAGE_MS`); timeout or failure → native SendMessage, unchanged input.
- Only Ledge-launched senders (`source: 'launcher'`) are handled; a `hook_only` sender's SendMessage is left entirely to Claude.
- A dead or ambiguous peer is refused, never guessed. Dead pids are ignored everywhere `readPeers` is used.
- Ledge never writes into a transcript while its Claude process runs (only once the session is `exited`).
- User-facing strings are French, exactly as written in this plan. Code, comments, commits in English.
- Tests: vitest, run from `packages/ledge` with `pnpm vitest run <file>`; full gate `pnpm -r typecheck && pnpm test` from the repo root.
- Work only in the worktree `.claude/worktrees/session-names` on branch `feat/session-names`; never mutate the shared `main` checkout.

## Decisions made while planning (left to the builder by the spec)

- **Resolution lives in the hook, no protocol change.** The hook already reads the snapshot (it holds every session, archived ones included) and runs on the same machine as Claude's `~/.claude/sessions`. The mailbox's `intercept` branch stays as the fallback it is today.
- **Only `to` is rewritten** (what the spike verified); `recipient` / `recipient_kind` are left as Claude wrote them. `message` and, when it is a string, `content` (Claude fills it with the same text) get the sender note prefixed.
- **The `<name> - ` filter lives in the reducer** (`state.ts` `PaneTitle`), where `s.name` is known.
- **No `ownAgentName` field.** Whether the user named Claude themselves is read from the transcript: the label is written unless the transcript's last `custom-title` is someone else's (neither the Ledge name nor `<name> - …`). This also respects a user `/rename`.
- **Label length:** `<name> - <topic>` on one line, at most 80 characters (topic cut, `…` appended).
- **Model change (spec §5 "also when a model change replaces the agent") is dropped:** the agent is resumed right away, so its next exit writes the label. To mention to the user.

## Review Focus

1. **Stale peer files:** a dead `<pid>.json` with the same `sessionId` (or name) as a live one must never be the address → Task 1 tests.
2. **Daemon down or slow:** SendMessage proceeds unchanged, nothing printed → Task 3 test.
3. **`to` copied from ListAgents with ` [ref]`, or a reply to the `uds:` address / the Claude `from-name`:** all resolve to the same Ledge session → Task 2 tests.
4. **A resumed pre-change session** whose pane title is the bare Ledge name, or `<name> - <topic>` → topic never equals the name → Task 4 tests.
5. **A transcript the user renamed** (`/rename`, or `-n` passed by the user) keeps its title; a long or multi-line topic gives a one-line ≤ 80-char label → Task 6 tests.

---

### Task 0: Spike — does `claude --resume` show an appended `custom-title`? (manual, gate)

**Files:** none in the repo (scratchpad only).

- [ ] **Step 1:** Pick a dead Claude transcript that has `ai-title` entries and no `custom-title` (`grep -L custom-title ~/.claude/projects/*/*.jsonl | xargs grep -l ai-title | head`). Copy it under a new uuid into a scratch project dir (`~/.claude/projects/<scratch-project>/<new-uuid>.jsonl`, rewriting `sessionId` with `sed`) so the user's real transcript is untouched.
- [ ] **Step 2:** Append `{"type":"custom-title","customTitle":"Spike - Sujet de test","sessionId":"<new-uuid>"}` as the last line.
- [ ] **Step 3:** In a throwaway tmux session (`tmux -L ledge-spike`), run `claude --resume` from the scratch project dir and capture the pane. Expected: the picker row reads `Spike - Sujet de test`.
- [ ] **Step 4:** Resume that conversation, send `/exit`, re-open the picker. Expected: still `Spike - Sujet de test`. Kill the tmux server and delete the scratch project dir.
- [ ] **Step 5:** If either expectation fails: **stop, do not build Task 6**, report to the user (spec §5). Other tasks do not depend on it.

---

### Task 1: Peers — live pids only, address of a session

**Files:**
- Modify: `packages/ledge/src/daemon/peers.ts`
- Test: `packages/ledge/test/peers.test.ts`

**Interfaces:**
- Produces:
  - `readPeers(dir?: string, alive?: (pid: number) => boolean): ClaudePeer[]` — files whose pid is not alive are skipped. Default `alive = pidAlive`.
  - `pidAlive(pid: number): boolean` — `process.kill(pid, 0)`; `ESRCH` → false, `EPERM` → true, success → true.
  - `addressOf(s: Pick<Session, 'agentSessionId' | 'transcriptPath'>, peers: readonly ClaudePeer[]): string | undefined` — the `address` of the peer whose `sessionId` is `s.agentSessionId` or the basename (without `.jsonl`) of `s.transcriptPath`; the transcript basename wins when both are set and differ (it follows `/clear` and `--resume`).
  - `peerFor`'s direct `<pid>.json` read (address branch) also checks the pid with `pidAlive`.

- [ ] **Step 1: Write the failing tests** (existing fixtures use pids 304399 and 1; pass `alive` explicitly so the tests do not depend on real pids):

```ts
it('skips the file of a dead process', () => {
  writeFileSync(join(dir, '42.json'), JSON.stringify({ ...file, pid: 42, messagingSocketPath: '/x/42.sock' }));
  expect(readPeers(dir, pid => pid !== 42).map(p => p.pid).sort()).toEqual([1, 304399]);
});
it('the address of a session: its live peer, by session id, else by transcript', () => {
  const peers = readPeers(dir, () => true);
  expect(addressOf({ agentSessionId: ID }, peers)).toBe(`uds:${sock}`);
  expect(addressOf({ transcriptPath: `/p/${ID}.jsonl` }, peers)).toBe(`uds:${sock}`);
  expect(addressOf({ agentSessionId: 'old', transcriptPath: `/p/${ID}.jsonl` }, peers)).toBe(`uds:${sock}`);
  expect(addressOf({ agentSessionId: ID }, readPeers(dir, pid => pid !== 304399))).toBeUndefined();
  expect(addressOf({}, peers)).toBeUndefined();
});
it('pidAlive: this process is alive, a free pid is not', () => {
  expect(pidAlive(process.pid)).toBe(true);
  expect(pidAlive(2 ** 22 + 1)).toBe(false);
});
```

Update every existing `readPeers(dir)` call in this file to `readPeers(dir, () => true)` (fixture pids are not real processes); keep « two files with the same name: the live one wins » passing.

- [ ] **Step 2:** `pnpm vitest run test/peers.test.ts` → FAIL (`addressOf`/`pidAlive` not exported, dead file listed).
- [ ] **Step 3:** Implement in `peers.ts`.
- [ ] **Step 4:** `pnpm vitest run test/peers.test.ts test/history.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(peers): skip dead Claude processes, find a session's address`.

---

### Task 2: Resolve a SendMessage target

**Files:**
- Modify: `packages/ledge/src/daemon/peers.ts` (append)
- Test: `packages/ledge/test/peers.test.ts`

**Interfaces:**
- Consumes: `ClaudePeer`, `bareName`, `addressOf` (Task 1).
- Produces:

```ts
export type Resolution =
  | { outcome: 'native'; target: Session; address: string } // a Ledge-launched Claude: rewrite `to` to `address`
  | { outcome: 'ledge'; target: Session }                   // Codex / OMP / other: the mailbox delivers
  | { outcome: 'refused'; reason: string }
  | { outcome: 'unknown' };                                 // not Ledge's business: SendMessage proceeds unchanged
export function resolveTarget(to: string, sessions: readonly Session[], peers: readonly ClaudePeer[]): Resolution;
```

Resolution order (first match wins), on `name = bareName(to)`:
1. `name` starts with `uds:` → the peer with that `address`; its Ledge session by `sessionId` (as `peerFor` matches: `agentSessionId` or transcript basename). No peer or no session → `unknown`.
2. A session with `s.name === name`, `state !== 'exited'`, no `archivedAt`.
3. Live peers with `p.name === name`: two or more → `refused`, reason `plusieurs sessions s'appellent ${name}`; one → its Ledge session; none, or no session → `unknown`.

Then, for the target session `t`:
- `t.source === 'hook_only'` → `refused`, reason `${t.name} n'a pas été lancée par Ledge : impossible de lui écrire` (same text as `mailbox.ts:96`).
- `t.tool === 'claude'`: `addressOf(t, peers)` → `native` with it; none → `refused`, reason `${t.name} n'est pas joignable`.
- otherwise → `ledge`.

- [ ] **Step 1: Write the failing tests** in a `describe('resolveTarget', …)` with sessions built by `fake` (add `name`, `tool`, `source: 'launcher'`, `state: 'idle'`) and peers given as literals (no files):
  - `'Pim'`, `'Pim [ab12]'`, `uds:${sock}` and the Claude name `'ledge-88'` (peer `{ name: 'ledge-88', sessionId: ID, address: `uds:${sock}` }`) → each `{ outcome: 'native', target: pim, address: `uds:${sock}` }`.
  - A Ledge name wins over a Claude peer of the same name belonging to another session.
  - Two peers named `'ledge-88'` → `{ outcome: 'refused', reason: "plusieurs sessions s'appellent ledge-88" }`.
  - Codex `'Nova'` → `{ outcome: 'ledge', target: nova }`.
  - hook_only Claude `'Bix'` → refused `"Bix n'a pas été lancée par Ledge : impossible de lui écrire"`.
  - Launched Claude without a peer → refused `"Pim n'est pas joignable"`.
  - Exited or archived `'Pim'` with no peer named Pim, and `'ghost'` → `{ outcome: 'unknown' }`.
- [ ] **Step 2:** `pnpm vitest run test/peers.test.ts` → FAIL.
- [ ] **Step 3:** Implement `resolveTarget`. `ledgePeer` / `peerFor` stay for the history (Task 5 changes their use only).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(peers): resolve a SendMessage target by Ledge name, address or Claude name`.

---

### Task 3: The hook rewrites the address and names the sender

**Files:**
- Modify: `packages/ledge/src/daemon/crossSession.ts` (export the note helpers)
- Modify: `packages/ledge/src/cli/hook.ts` (`relayMessage`, `identityContext`)
- Test: `packages/ledge/test/crossSession.test.ts`, `packages/ledge/test/hook.test.ts`

**Interfaces:**
- Consumes: `readPeers`, `resolveTarget`, `Resolution` (Tasks 1-2).
- Produces (crossSession.ts):
  - `messageNote(from: string, to: Tool): string` — the existing private `note`, exported under this name (same text).
  - `stripNote(text: string): { sender?: string; text: string }` — when `text` (after `trimStart`) opens with `messageNote(x, 'claude')` or `messageNote(x, 'codex')` for some `x`, returns `sender: x` and the rest trimmed; otherwise `{ text }` unchanged. `ledgeMessages` uses it instead of its inline lead check.

`relayMessage` new flow (sender = `snapshot.sessions.find(s => s.id === from)`):
1. Sender missing or `source !== 'launcher'` → `undefined`.
2. `resolveTarget(to, snapshot.sessions, readPeers())`.
3. `unknown` → `undefined`. `refused` → deny, reason `Ledge n'a pas pu transmettre le message à ${to} : ${reason}`.
4. `native` → print `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } }` where `updatedInput` is the whole input with `to: address`, `message: \`${messageNote(sender.name, 'claude')} ${message}\``, and `content` prefixed the same way when it is a string. No length check on this path.
5. `ledge` → today's path unchanged (length check, `session.message` with `intercept: true`, ack → reason).

- [ ] **Step 1: Write the failing tests.**
  - crossSession: `stripNote(\`${messageNote('Pim', 'claude')} Salut\`)` → `{ sender: 'Pim', text: 'Salut' }`; `stripNote('Salut')` → `{ text: 'Salut' }`; existing `ledgeMessages` tests still pass.
  - hook.test.ts, new `describe('runHook: Claude SendMessage to a Claude')`: sender `a` is a launched Claude session `Otto` in the store; target `Pim` (claude, `agentSessionId: ID`); a temp `CLAUDE_CONFIG_DIR` whose `sessions/<process.pid>.json` names `ID` with socket `/s/x.sock` (the test's own pid is alive). Assertions:
    - output is `{ hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { to: 'uds:/s/x.sock', message: "(message de la session Otto, pas de l'utilisateur ; pour répondre : SendMessage vers Otto) Salut", summary: 'Un salut', content: <same prefixed text> } }` (the `send` helper gains `content: message`);
    - `'Pim [ab12]'` gives the same `to`;
    - no peer file → deny `"Ledge n'a pas pu transmettre le message à Pim : Pim n'est pas joignable"`;
    - a 20001-char message to Pim → `allow` (not refused);
    - sender `a` stored as `hook_only` → `undefined`;
    - daemon down (port of a closed server) → `undefined` within the budget.
  - Existing `runHook: Claude SendMessage to a Codex` tests: the store gains the launched sender `a` (claude); « to a Claude target, the real SendMessage proceeds » becomes the no-peer refusal above or moves to the new describe; the raw-WebSocket test sends a snapshot holding the sender too.
  - `identityContext` test (hook.test.ts ~448): expects `Pour écrire à une autre session Ledge, Claude ou Codex, utilise son nom Ledge (donné par \`ledge who\`) comme adresse SendMessage : Ledge le transmet. \`ListAgents\` montre les noms internes de Claude, pas les noms Ledge.`
- [ ] **Step 2:** `pnpm vitest run test/crossSession.test.ts test/hook.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Update `identityContext`'s Claude line to the text above and its doc comment (Claude is no longer launched with `-n`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(hook): rewrite a SendMessage to a Ledge-launched Claude to its live address`.

---

### Task 4: Topic — never the name

**Files:**
- Modify: `packages/ledge/src/daemon/state.ts:248`
- Test: `packages/ledge/test/state.test.ts` (next to « a pane title replaces a prompt topic »)

**Interfaces:** none new. `PaneTitle` text `t` (already trimmed by the adapter): `t === s.name` → `s` unchanged; `t` starting with `${s.name} - ` → topic is the rest; otherwise as today.

- [ ] **Step 1: Write the failing test** (`mk('a')` is named `Otto`):

```ts
it('a pane title that is the session name is no topic; « <name> - <topic> » gives the topic', () => {
  let s = reduce(mk('a'), { name: 'UserPromptSubmit', at, source: 'hook', text: 'premier prompt' });
  expect(reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'Otto' })).toBe(s);
  s = reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'Otto - Refonte des noms' });
  expect(s.topic).toBe('Refonte des noms'); expect(s.topicSource).toBe('pane');
  expect(reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'Ottoman - x' }).topic).toBe('Ottoman - x');
});
```

- [ ] **Step 2:** `pnpm vitest run test/state.test.ts` → FAIL.
- [ ] **Step 3:** Implement in the `PaneTitle` case.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `fix(state): a pane title equal to the session name is not its topic`.

---

### Task 5: History — strip the note, show the Ledge name

**Files:**
- Modify: `packages/ledge/src/daemon/history.ts` (`sentOf` ~252, `receive` ~272, the `crossSession` loop ~122)
- Test: `packages/ledge/test/history.test.ts`

**Interfaces:**
- Consumes: `stripNote` (Task 3).
- `sentOf`: the card's `text` is `stripNote(input.message).text` (PostToolUse carries the rewritten input).
- The `crossSession` loop: each block's body goes through `stripNote`; the received card's `from` is `sender ?? m.name ?? m.from`, its `text` the stripped body; `receive`'s peer lookup tries `peerOf(sender)` first when there is one.

- [ ] **Step 1: Write the failing tests:**
  - A PostToolUse SendMessage whose input message is `"(message de la session Otto, pas de l'utilisateur ; pour répondre : SendMessage vers Otto) Salut"` gives a sent card with `text: 'Salut'`.
  - A UserPromptSubmit `<cross-session-message from="uds:/s/1.sock" from-name="ledge-88">(message de la session Otto, …) Salut</cross-session-message>` gives a received card `from: 'Otto'`, `text: 'Salut'`, paired (`sent` set, sender card `read`) with Otto's sent card `Salut` when `peerOf('Otto')` returns Otto's id.
- [ ] **Step 2:** `pnpm vitest run test/history.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(history): received messages name their sender by Ledge name`.

---

### Task 6: Label the transcript for `claude --resume` (only if Task 0 passed)

**Files:**
- Modify: `packages/ledge/src/daemon/transcript.ts` (append)
- Modify: `packages/ledge/src/daemon/server.ts` (the `store.onChange` at ~260)
- Test: `packages/ledge/test/transcript.test.ts`, `packages/ledge/test/server.test.ts`

**Interfaces:**
- Produces:
  - `resumeLabel(name: string, topic: string): string` — `${name} - ${topic}` with every whitespace run (newlines included) collapsed to one space, trimmed; longer than 80 chars → cut to 79 + `…`.
  - `labelTranscript(path: string, name: string, label: string): boolean` — reads the transcript tail (`tailLines`); finds the last `custom-title` entry. Skips (returns false) when the file is missing, when that entry's `customTitle === label`, or when it exists and is neither `name` nor starts with `${name} - ` (the user named it). Otherwise appends `{"type":"custom-title","customTitle":label,"sessionId":<basename without .jsonl>}` + `\n` and returns true. Never throws.
- Server: on `c.type === 'updated'` for a session with `tool === 'claude'`, `source === 'launcher'`, `state === 'exited'`, `transcriptPath` and `topic` set, call `labelTranscript(transcriptPath, name, resumeLabel(name, topic))` once per exit — keep a `Map<id, exitedAt>` of the last exit labelled (cleared on `removed`); log a failure, never throw.

- [ ] **Step 1: Write the failing tests** (temp dir transcripts):
  - `resumeLabel('Pim', 'Refonte\n des noms')` → `'Pim - Refonte des noms'`; a 200-char topic → length 80, ends with `…`.
  - No custom-title → appended line parses to `{ type: 'custom-title', customTitle: 'Pim - Sujet', sessionId: '<uuid>' }`, returns true; a second call → false, file unchanged.
  - Last custom-title `'Pim'` (pre-change session) or `'Pim - Ancien'` → appended; last custom-title `'mon titre'` → false, unchanged; missing file → false.
  - server.test.ts: a launched Claude session with `transcriptPath` and `topic: 'Sujet'` patched to `exited` → the transcript ends with the label line; a second update of the same exited session appends nothing; a Codex or `hook_only` session → nothing.
- [ ] **Step 2:** `pnpm vitest run test/transcript.test.ts test/server.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(daemon): label an exited Claude transcript « <name> - <topic> » for claude --resume`.

---

### Task 7: Launch Claude without `-n`

**Files:**
- Modify: `packages/ledge/src/spawn.ts:27-33,97` (remove `CLAUDE_OWN_NAME`, `agentNameArgs` and its use)
- Modify: `packages/ledge/test/who.test.ts:33-38` (the `agentNameArgs` describe becomes a spawn assertion)
- Modify: `packages/ledge/README.md:42` → `ledge claude --name max   # pick the session's Ledge name`

- [ ] **Step 1: Write the failing test** in `who.test.ts` (or wherever spawn's command is already asserted — `grep -n "'--session-id'" test/`): a Claude spawn's agent command contains no `-n`; with `args: ['-n', 'mine']` it contains `-n mine` exactly once.
- [ ] **Step 2:** Run it → FAIL.
- [ ] **Step 3:** Remove `agentNameArgs`; fix any other import of it (`grep -rn agentNameArgs src test`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(spawn): launch Claude Code without -n, so it titles its own conversation`.

---

### Task 8: Full gate and manual end-to-end check

- [ ] **Step 1:** From the worktree root: `pnpm install --frozen-lockfile` (if `node_modules` is missing), `pnpm -r typecheck && pnpm test` → all green.
- [ ] **Step 2 (manual, needs a logged-in Claude):** with the worktree's CLI (`pnpm --filter @paradow/ledge dev`) against a scratch daemon port, launch two Claude sessions with `ledge claude`; in the first, ask it to SendMessage the second by its Ledge name. Expected: the second receives the message prefixed with « (message de la session <first>, … ) », replies by the same name, and `ledge who` shows a real topic for both (not the name). Kill both tmux sessions (`tmux -L ledge kill-session -t ledge-<id>`).
- [ ] **Step 3:** After `/exit` of one session, `claude --resume` in its project lists it as `<name> - <topic>`.
- [ ] **Step 4:** Open the PR (French body: Problème / Cause / Correction / Tests), mentioning the dropped model-change label trigger.

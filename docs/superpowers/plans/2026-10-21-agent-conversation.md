# The « Conversation » tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task says which steps are **test-writer** work (failing tests first) and which are **worker** work (implementation).

**Goal:** On a session page in Ledge Desktop, a « Conversation » tab in the side pane shows the exchange between this agent (A) and one other agent (B), merged from both threads: every message once, both ways, in the order it was sent, with its delivery status, live. It opens from every message card and from the conversation header. From the tab you can light a message in A's thread, or open B's page on a message only B's thread holds. When Ledge does not know B, the tab says it shows one side only.

**Architecture:** Desktop only. A pure merge (`session/conversation.ts`, ported from the mockup's `conversation.ts`) turns A's thread items and B's thread items into `Bubble`s. A page-level hook (`session/useConversations.ts`) builds one view per open Conversation tab. It resolves B's session, asks for B's thread through `useThreads` (a list version of `useThread`, which becomes its wrapper), memoises each tab's bubbles, and counts unseen messages. This lives at page level because `SidePane` mounts only the active tab. `SessionPage` holds the tabs (`{ kind: 'conv'; peer }`). It passes the active conversation and its callback down `Thread → Turn → MessageCard`, as for plans. It also passes the views, its flash and B's page to `SidePane`, which renders the new `ConversationTab`.

**Tech Stack:** TypeScript, React 19, vitest + Testing Library (jsdom) with `@ledge/fleet/test/mockDaemon`, Playwright (`apps/desktop/e2e`), pnpm workspaces. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-21-agent-conversation-design.md`, including « Confirmed by the user ». **Mockup:** `docs/mockups/agent-conversation/` (`conversation.ts` = reference merge, `ConversationPane.tsx`, `MessageCard.tsx`, `conversation.css`, `copy.ts`) and `docs/mockups/ledge-agent-conversation-{dark,light,one-sided,narrow,empty,entry,lit}.png`. **v1:** `docs/superpowers/specs/2026-10-18-agent-messages-design.md`, `docs/superpowers/plans/2026-10-18-agent-messages.md`.

## Why there is no daemon, protocol or fleet change (checked)

- `packages/ledge/src/daemon/server.ts:184-185` sends every new thread item (`session.thread.item`) to every client. `server.ts:525-526` answers a `session.thread` request for any session id. So Desktop can read B's thread and follow it live.
- `packages/fleet/src/store.ts:83-89` applies a pushed item only to a thread it already holds. `store.ts:78` drops every thread of a session that is still online when a snapshot comes, so Desktop asks for it again on each snapshot (`useThread`'s existing rule).
- `packages/protocol/src/thread.ts` already carries what the merge needs: `sent.received`, `received.sent` and `peer` (B's raw daemon id). B is resolved on A's own machine (`qualify(machine, peer)`), as `Thread.tsx`'s `usePeers` already does.

## Global Constraints

- Work on `feat/agent-conversation`, which is already checked out. Do not switch branches. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, as in v1.
- The repository has no `AGENTS.md` or `CLAUDE.md`. The constraints come from the spec, the v1 plan and the code:
  - French copy is the source of truth. `Messages = typeof fr`, so `en.ts` must match its shape (TypeScript checks this). Nothing in `src` imports `fr.ts` or `en.ts` statically (`test/messages.test.ts`).
  - Neutral colour tokens only. The single colour is `--sidebar-primary` for the unseen dot. Reuse `.message-card`, `.to-latest`, `.changes-empty`, `.side-head`, `.lnk.message-link` and `.lnk.message-fold`.
  - `Thread` and `Turn` are memoised. Every new prop is either a stable callback or a value that only changes when what it shows changes. `test/session-renders.test.tsx` must stay green unchanged.
  - jsdom has no real layout. Guard `scrollTo` (`typeof el.scrollTo === 'function'`, as `SessionPage.toLatest` does). `ResizeObserver` is a silent stub (`test/setup.ts`).
  - The pane's tabs belong to the page (`SessionPage` is remounted per agent). Nothing is persisted.
  - No import from `docs/mockups/**` in `apps/`. The mockup's `ConversationContext` is not ported: the spec asks for props, as for plans.
- Copy for `session.conversation`, French first. The French uses `deName` from `fr.ts` (« d’Otto ») as the spec's own examples do:
  - `follow` « suivre la conversation »
  - `followTitle(b)` « Suivre la conversation avec {b} à côté du fil »
  - `followBeside` « Suivre à côté », `openBeside` « Ouvert à côté »
  - `tab(b)` « Conversation · {b} »
  - `tabNew(b, n)` « Conversation · {b}, 1 nouveau message / n nouveaux messages »
  - `log(a, b)` « Conversation entre {a} et {b} »
  - `count(n)` « 1 message / n messages »
  - `kicker(x, y)` « Message {deName x} à {y} »
  - `readBy(y)` « Lu par {y} », `deliveredTo(y)` « Remis à {y}, pas encore lu »
  - `inThread` « dans le fil », `inThreadTitle(a)` « Montrer dans le fil {deName a} »
  - `fresh(n)` « 1 nouveau message / n nouveaux messages »
  - `oneSidedLead` « Vue d’un seul côté »
  - `oneSided(b, a)` « {b} n’est pas une session que Ledge suit sur cette machine. La conversation est lue dans le fil {deName a} seulement : les messages {deName b} apparaissent quand {a} les reçoit, et Ledge ne sait pas si ceux {deName a} ont été lus. »
  - `empty(a, b)` « Aucun message entre {a} et {b} pour l’instant. », `emptyHint` « Ils s’afficheront ici, en direct, dès que l’un écrira à l’autre. »
  - `loadingPeer(b)` « Lecture du fil {deName b}… »
  - English: the mockup's `copy.ts` `en` block, as is.

## Decisions taken here (the builder's latitude) and why

1. **How long B's thread is asked: while its tab is open, active or not.** Three options were weighed:
   - (a) Call `useThread` inside `ConversationTab`. The tab is unmounted while inactive, so its dot could not count messages only B's thread holds once a snapshot has dropped that thread.
   - (b) A headless child per tab that reports its data up. This costs extra renders and moves state up through effects.
   - (c) A list version, `useThreads`, called from one page-level hook. **Chosen.** `useThread` becomes its one-session wrapper, so there is still one rule for asking.
2. **The merge and the unseen count live in `SessionPage`** (through `useConversations`). `SidePane` renders only the active tab, so inactive tabs are not mounted.
3. **No entry point on a subagent's page.** The spec excludes subagent messages (`helperId`), so a tab opened there would always be empty.
4. **`STATUS_MARK` is exported from `MessageCard.tsx` and reused** rather than copied into the tab.
5. **« dans le fil » lights the message the way `nav.place.item` does** (`follow.current = false; setFlash(id)`). The view needs no switch: the pane only shows on the thread.
6. **The unseen baseline goes down when the count goes down** (both agents ran /clear). Messages that come after are then still counted.

## Review Focus

- Item ids are unique per thread only (`recv-<turn>-<i>` exists in both threads): each bubble is keyed `a:<id>` or `b:<id>`. → Task 2.
- A message only B's thread held, once A receives it: it keeps its place, gains « dans le fil », the count does not change, and it never counts as new. → Tasks 2 and 6.
- A snapshot drops B's thread. It is asked again, its last items are shown meanwhile, the loading line does not flash, and the unseen count does not move. → Tasks 3 and 6.
- One side only: no `session.thread` request for B's raw name. → Task 4.
- A subagent's page offers no entry point. → Task 4.
- Narrow layout: the tab closes before the message is lit. → Tasks 5 and 7.

---

### Task 1: Copy and icon [worker]

**Files:**
- Modify: `apps/desktop/src/i18n/fr.ts` (add `session.conversation` right after `session.message`)
- Modify: `apps/desktop/src/i18n/en.ts` (same place)
- Modify: `apps/desktop/src/shell/icons.ts` (add after `mail` / `arrowRight`)

**Interfaces (produces):**
- `t.session.conversation: { follow: string; followTitle(b: string): string; followBeside: string; openBeside: string; tab(b: string): string; tabNew(b: string, n: number): string; log(a: string, b: string): string; count(n: number): string; kicker(from: string, to: string): string; readBy(who: string): string; deliveredTo(who: string): string; inThread: string; inThreadTitle(a: string): string; fresh(n: number): string; oneSidedLead: string; oneSided(b: string, a: string): string; empty(a: string, b: string): string; emptyHint: string; loadingPeer(b: string): string }`
- French uses `plural` (n > 1) and `deName`; English uses `pluralEn`.
- `SHELL_ICONS.exchange: ['M4 8h14', 'm15 5 3 3-3 3', 'M20 16H6', 'm9 13-3 3 3 3']`, with a one-line comment: « the pair in the Conversation tab's head ».

- [ ] **Step 1 (worker):** add the keys and the icon.
- [ ] **Step 2:** `pnpm --filter desktop typecheck` → clean. There is no test of its own: Tasks 4–6 assert the French strings and Task 7 the English ones.
- [ ] **Step 3:** commit `feat(desktop): copy and icon for the Conversation tab`.

### Task 2: The merge — `session/conversation.ts` [test-writer → worker]

**Files:**
- Create: `apps/desktop/src/session/conversation.ts`
- Test: `apps/desktop/test/session-conversation-merge.test.ts` (pure, no DOM)

**Interfaces (produces):**
- `export interface Bubble { key: string; from: 'a' | 'b'; at: string; summary?: string; text: string; status: SentItem['status']; inA?: string; inB?: string }` (doc comments as in the mockup).
- `export function conversation(a: readonly ThreadItem[], b: readonly ThreadItem[] | undefined, key: string, selfId: string): Bubble[]` — the mockup's code as is:
  - Only main-thread items count (`helperId === undefined`): A's whose `peerKey(i) === key`, B's whose `peer === selfId`.
  - A's sent `s` and B's received `r` are one bubble when `r.sent === s.id || s.received === r.id`. B's sent `b` and A's received `r` are one when `r.sent === b.id`.
  - The time is the sender's `at` (the receiver's when the sender's item is unknown). The sort is stable.
  - A message A received whose sender's item is unknown reads `'read'`.
- `export function conversationPeer(a: readonly ThreadItem[], key: string): string | null` — returns B's raw daemon id (`key`) when some main A item with that key carries `peer`, or when no A item with that key is left (a tab that outlived its messages). Returns `null` when A's items name B only by its raw name (one side only).
- `export function conversationName(a: readonly ThreadItem[], key: string): string` — the raw name A's latest main item with that key gives (`to` / `from`), else `key`.

- [ ] **Step 1 (test-writer): failing tests.** Builders: `aSent`, `aRecv`, `bSent`, `bRecv`, with `at = T(s)`.
  1. `pairs Otto's message with Nova's copy, by r.sent or by s.received`: A sent `s1` {received `recv-1-0`, status `read`, summary} plus B received `recv-1-0` {sent `s1`} give exactly `[{ key: 'a:s1', from: 'a', at: T(10), summary, text, status: 'read', inA: 's1', inB: 'recv-1-0' }]`. The same single bubble comes when only `r.sent` links them, and when only `s.received` does.
  2. `pairs Nova's message with Otto's copy; time and summary from Nova's item`: B sent `b1` {at T(20), summary 'Reçu'} plus A received `r1` {at T(30), sent `b1`} give `[{ key: 'a:r1', from: 'b', at: T(20), summary: 'Reçu', status: 'read', inA: 'r1', inB: 'b1' }]`.
  3. `a message Nova wrote that Otto has not received yet stands alone`: B sent `b2` {status `delivered`} gives `{ key: 'b:b2', from: 'b', status: 'delivered', inB: 'b2' }` with `inA` undefined.
  4. `Otto's message after a /clear: only Nova's copy, on Otto's side, read`: B received `rX` {sent `gone`}, which A does not hold, gives `{ key: 'b:rX', from: 'a', at: rX.at, status: 'read', inB: 'rX' }` with no summary and no `inA`.
  5. `two queued messages: two bubbles in Nova's order, each paired`: B sent `b1` T(20) and `b2` T(21); A received `recv-3-0` {sent b1} and `recv-3-1` {sent b2}, both at T(25). Keys are `['a:recv-3-0', 'a:recv-3-1']` and times `[T(20), T(21)]`.
  6. `ids are unique per thread only`: A received `recv-1-0` {sent `b1`, which B holds} and B received `recv-1-0` {sent `gone`} give keys `a:recv-1-0` and `b:recv-1-0`, both present and distinct.
  7. `orders by the sender's time, stable on ties`: A sent T(5), B-only sent T(3) and A received with an unknown sender T(4) come out `[B-only, A received, A sent]`. Two bubbles at the same `at` keep A-then-B input order.
  8. `one side only: Otto's messages keep their status, those Otto received read`: with `b` undefined, key `'harness-assistant-bf'`, A sent {to `harness-assistant-bf`, no peer, `delivered`} and A received {from `harness-assistant-bf`, no peer}, the statuses are `['delivered', 'read']` and no bubble has `inB`.
  9. `a third agent's messages and a subagent's are left out`: A sent to `kit` (peer `kit`), A sent to `nova` with `helperId: 'h1'`, B sent to `kit` and B received from `otto` with `helperId` all give no bubble. Only Otto↔Nova main items remain.
  10. `nothing between them`: `conversation([], [], 'nova', 'otto')` is `[]`.
  11. `conversationPeer`: `'nova'` when A's items carry `peer: 'nova'`; `null` when A's items with key `harness-assistant-bf` carry no `peer`; `'nova'` for `([], 'nova')`.
  12. `conversationName`: `'harness-assistant-bf'` from a received `from`; the latest of two raw names; the key when there is no item.
- [ ] **Step 2:** `pnpm --filter desktop test session-conversation-merge` → FAIL (module missing).
- [ ] **Step 3 (worker):** port the mockup's `conversation.ts` (import `peerKey` from `./exchanges`) and add the two helpers.
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5:** commit `feat(desktop): merge two agents' threads into one conversation`.

### Task 3: Several threads at once — `useThreads` [test-writer → worker]

**Files:**
- Modify: `apps/desktop/src/session/useThread.ts`
- Test: `apps/desktop/test/use-thread.test.tsx` (the three existing tests stay unchanged and must pass)

**Interfaces (produces):**
- `export function useThreads(client: Pick<DaemonClient, 'send'>, sessions: readonly Session[]): ReadonlyMap<string, ThreadItem[] | undefined>`. For each session:
  - Its thread is asked once per `snapshotSeq` while missing, and never while the session is offline.
  - While it is asked again, the last items seen for that id stay returned.
  - The kept items of an id that left the list are forgotten.
  - The effect's dependency is a key built from ids and offline flags, not the array's identity.
- `export function useThread(client, session) { return useThreads(client, [session]).get(session.id); }` — same contract as today.

- [ ] **Step 1 (test-writer): failing tests.** Add a `Many` probe that renders `useThreads` counts per id.
  1. `useThreads asks each thread once and follows live items`: with Otto and Nova, `d.received` holds exactly one `session.thread` per id; `d.threadItem('nova', …)` raises Nova's count.
  2. `after a reconnect, asks again and keeps the last items meanwhile`: `await d.dropClients()`, then wait until `d.received` holds two `session.thread` messages for `nova`. Nova's count never reads `loading` from the drop on.
  3. `an offline session is never asked; one leaving the list is not asked again`.
- [ ] **Step 2:** `pnpm --filter desktop test use-thread` → FAIL.
- [ ] **Step 3 (worker):** implement `useThreads`; make `useThread` its wrapper.
- [ ] **Step 4:** same command → PASS (6 tests).
- [ ] **Step 5:** commit `feat(desktop): ask and follow several threads at once`.

### Task 4: Open a Conversation tab from the thread [test-writer → worker]

**Files:**
- Create: `apps/desktop/src/session/useConversations.ts`, `apps/desktop/src/session/ConversationTab.tsx`
- Modify: `apps/desktop/src/session/SidePane.tsx`, `SessionPage.tsx`, `Thread.tsx`, `MessageCard.tsx`
- Modify: `apps/desktop/src/styles/session.css` (append after `.message-line-text{…}`, before the notices block)
- Test: create `apps/desktop/test/session-conversation.test.tsx` (French). Update `apps/desktop/test/session-messages.test.tsx:55,65`.

**Interfaces:**
- Consumes: Task 1 copy and icon, Task 2 `conversation` / `conversationPeer` / `conversationName` / `Bubble`, Task 3 `useThreads`.
- `useConversations.ts`:
  - `export interface ConversationView { key: string; peer: Session | null; name: string; bubbles: readonly Bubble[]; loading: boolean }`.
  - `export function useConversations(client: Pick<DaemonClient, 'send'>, self: Session, items: readonly ThreadItem[] | undefined, keys: readonly string[]): ReadonlyMap<string, ConversationView>`.
  - `peer` is `byId.get(qualify(machine, conversationPeer(...)))`, else `null`. `selfId` is `splitId(self.id)?.id ?? self.id`.
  - `loading` is `peer !== null && !peer.offline && B's thread is undefined`.
  - Each view's `bubbles` keeps its identity while A's `items` and B's thread array are unchanged (cache by key).
- `SidePane.tsx`:
  - `PaneTab` gains `{ kind: 'conv'; peer: string }`.
  - `tabId` gives `conv:<peer>`.
  - `SidePaneProps` gains `convs: ReadonlyMap<string, ConversationView>`.
  - For a conv tab: label `tc.tab(name)`, mail icon, `pathOf` `''`.
  - The « Agrandir » / « Fermer » buttons are pulled out into a `buttons` node, shared by `head` and the conv tab.
  - Render branch: `tab.kind === 'conv'` gives `<ConversationTab key={active} self={session} view={…} buttons={buttons} />`.
- `ConversationTab.tsx`:
  - `export function ConversationTab(p: { self: Session; view: ConversationView; buttons: ReactNode }): JSX.Element`. Markup and classes follow the mockup's `ConversationTab` / `BubbleRow`.
  - Head `.side-head.conv-head`: `.conv-pair` holds A's bot and name, the `SHELL_ICONS.exchange` icon, then B's bot (known peer only) and B's name. Then `.conv-count` (hidden at 0), then `buttons`.
  - `.conv-note[role=note]` when `peer === null`.
  - `.conv-wrap > .side-body.conv-body` holds, in order:
    - `p.conv-loading.muted` with `loadingPeer`, while `loading`;
    - `.changes-empty.conv-empty` with `empty` and `emptyHint`, when there are no bubbles and it is not loading;
    - `ol.conv-log[role=log]` with `aria-label = log(A, B)`, always mounted.
  - Bubble: `li.conv-row.{mine|theirs}[.first]`, then `div.message-card.conv-bubble.{sent|received}[role=article][data-bubble=key]`, containing:
    - the hidden kicker;
    - `.conv-who` on the first bubble of a run;
    - the summary;
    - the body, clamped with `isLong` and « Lire tout le message »;
    - `.conv-meta`: `time` · mark (`STATUS_MARK`) and word (`read` → `tm.seen` with title `readBy(to)`; `delivered` → `tm.delivered` with title `deliveredTo(to)`; else `tm[status]`).
- `MessageCard.tsx`:
  - `export const STATUS_MARK`.
  - `MessageCardProps` gains `following: boolean` and `onFollow?(): void`.
  - On a card, after the existing links: `· <button class="lnk message-link" title={followTitle(peerName)}>{follow}</button>` when `onFollow` is set.
  - On the header, before « Replier »: `<button class="lnk message-fold conv-follow" aria-pressed={following} title={followTitle(peerName)}>{following ? openBeside : followBeside}<chevronRight/></button>` when `onFollow` is set.
  - Folded lines are unchanged.
- `Thread.tsx`:
  - `ThreadProps` gains `convOpen: string | null` (the peerKey of the active conv tab) and `onConversation?(peer: string): void` (stable; absent means no entry point).
  - `TurnProps` gains the same. A turn gets `convOpen` only when it holds that conversation's first message (`convs.get(convOpen)?.[0]`), else `null`.
  - `message()` passes `following={convOpen === key}` and `onFollow={onConversation && (() => onConversation(key))}`.
- `SessionPage.tsx`:
  - `const openConversation = useCallback((peer: string) => openTab({ kind: 'conv', peer }), [openTab])`.
  - `const convOpen = active?.kind === 'conv' ? active.peer : null`.
  - `convKeys` is memoised from `tabs`; `const convs = useConversations(p.client, session, items, convKeys)`.
  - `<Thread … convOpen={convOpen} onConversation={helper ? undefined : openConversation} />` and `<SidePane … convs={convs} />`.
- `session.css`:
  - The mockup's `conversation.css` first section, from `.conv-head .conv-title` to `.conv-follow[aria-pressed=true]`, without `.conv-tab-dot` (Task 6), `.conv-doc` or the mock chrome.
  - Plus `.conv-loading{margin:0 auto 12px;max-width:680px;font-size:12px;text-align:center}`.

**Fixture** (shared by Tasks 4–6, in the new test file): a local `openOtto(items)` as in `session-messages.test.tsx`, with `d.thread('nova', nova)` set per test.
- `otto`: `prompt p1` T0; `sent s1` T10 {received `recv-1-0`, status `read`, summary 'Le schéma est prêt'}; `received recv-2-0` T30 {sent `toolu_n1`, text 'Merci, je regarde.'}.
- `nova`:
  - `received recv-1-0` T12 {from/peer `otto`, sent `s1`};
  - `sent toolu_n1` T20 {to/peer `otto`, received `recv-2-0`, status `read`, summary 'Reçu'};
  - `sent toolu_n2` T40 {to/peer `otto`, status `delivered`, summary 'Une question', text 'Tu as la migration ?'}.

- [ ] **Step 1 (test-writer): failing tests** in `session-conversation.test.tsx`, under `describe('the Conversation tab')`, plus the updates to existing tests.
  1. `« suivre la conversation » on every card, sent or received, known peer or not; the header's « Suivre à côté »` (Goal 2):
     - each `.session-thread .message-card` has a button « suivre la conversation » titled « Suivre la conversation avec Nova à côté du fil », including on a card from `zed` (no peer), whose title names `zed`;
     - the header has « Suivre à côté » with `aria-pressed="false"`;
     - after « Replier », the `.message-line`s hold no such button.
  2. `on a subagent's page, no way to the conversation`: Otto's thread holds a `sent` with `helperId: 'h1'`. Open the subagent page as `session-reply.test.tsx:272` does. The page has no « suivre la conversation » and no « Suivre à côté ».
  3. `the link opens « Conversation · Nova » beside Otto's thread, and asks Nova's thread once` (Goals 1, 2):
     - before the click, `d.received` holds no `session.thread` for `nova`;
     - after it, the pane (`complementary` « Volet de lecture ») shows the head with « Otto », « Nova », « 3 messages », and `path[d="M4 8h14"]` inside `.conv-pair`;
     - `.session-page` stays `data-session="local:otto"` and the thread tabpanel is still there;
     - exactly one `{ type: 'session.thread', id: 'nova' }`.
  4. `each message once, both ways, in the order sent, with its side and delivery` (Goal 1):
     - within `role=log` « Conversation entre Otto et Nova », the `data-bubble`s are `['a:s1', 'a:recv-2-0', 'b:toolu_n2']`;
     - `a:s1` is in `.conv-row.mine`, the others in `.theirs`;
     - `a:s1`'s meta holds « ✓✓ » and « lu », `.message-read` titled « Lu par Nova »;
     - `b:toolu_n2`'s meta holds « Remis, pas encore lu », titled « Remis à Otto, pas encore lu »;
     - `a:recv-2-0` holds summary « Reçu » and `time[dateTime=T20]`, and its `.conv-who` reads « Nova »; `b:toolu_n2` has no `.conv-who` (same run);
     - the hidden kickers are « Message d’Otto à Nova » and « Message de Nova à Otto »;
     - a 300-character body is clamped until « Lire tout le message ».
  5. `the header's pill reads « Ouvert à côté » while its tab is the active one; following again does not open a second tab` (Goal 2):
     - after « Suivre à côté », the pill reads « Ouvert à côté » with `aria-pressed="true"`;
     - opening a document (a reply linking `docs/guide.md`, with `d.documents.set`) brings the pill back to « Suivre à côté » `false`;
     - « suivre la conversation » again gives 2 tabs, with « Conversation · Nova » `aria-selected="true"`.
  6. `one Conversation tab per peer: Nova's and Kit's side by side, each its own pair` (Goal 1, user decision):
     - Otto also sent to `kit` and Kit's thread holds the copy; Nova's thread holds a `sent` to `kit`;
     - after following both, the tabs are « Conversation · Nova » and « Conversation · Kit »;
     - Nova's log holds no Kit message, and Kit's log holds none of Nova's.
  7. `one side only: the strip, the raw name, ⇄, no bot, no « voir son fil », no request` (Goal 4):
     - Otto holds a received and a sent with `harness-assistant-bf`, without `peer`;
     - the tab is « Conversation · harness-assistant-bf »;
     - `role=note` reads « Vue d’un seul côté · harness-assistant-bf n’est pas une session que Ledge suit sur cette machine. La conversation est lue dans le fil d’Otto seulement : … »;
     - `.conv-pair` holds the exchange path, and the head has no « voir son fil »;
     - the sent bubble reads « Remis, pas encore lu »;
     - `d.received` has no `session.thread` other than `otto`.
  8. `Nova's thread not read yet: Otto's side at once, « Lecture du fil de Nova… » until it comes` (Goal 1, user decision):
     - with no `d.thread('nova')`, bubbles `a:s1` and `a:recv-2-0` show and « Lecture du fil de Nova… » is visible above the log;
     - after `d.push({ type: 'session.thread', id: 'nova', items: nova })`, the line is gone and `b:toolu_n2` is there.
  9. `both ran /clear: the tab stays, says there is nothing yet, its log still mounted`:
     - with the tab open, `d.push` Otto's and Nova's threads holding a prompt only;
     - « Aucun message entre Otto et Nova pour l’instant. » and the hint show; the head has no count; `role=log` is present and empty.
  - **Existing tests that legitimately change**, in `session-messages.test.tsx`:
    - line 55 becomes `/^Message reçuDe Nova · voir son fil · suivre la conversation/`;
    - line 65 becomes `/^Message envoyéÀ Nova · ✓✓lu · voir son fil · suivre la conversation/`;
    - « a peer outside Ledge » also asserts « suivre la conversation » is present.
- [ ] **Step 2:** `pnpm --filter desktop test session-conversation.test session-messages` → FAIL.
- [ ] **Step 3 (worker):** implement as specified in the order: `useConversations`, `ConversationTab`, `SidePane`, `MessageCard` / `Thread`, `SessionPage`, CSS.
- [ ] **Step 4:** the same command → PASS. Then `pnpm --filter desktop test session-renders use-thread session-pane session-plans` → PASS unchanged. Then `pnpm --filter desktop typecheck` → clean.
- [ ] **Step 5:** commit `feat(desktop): follow a conversation between two agents in a side tab`.

### Task 5: From the tab to the threads [test-writer → worker]

**Files:**
- Modify: `ConversationTab.tsx`, `SidePane.tsx`, `SessionPage.tsx`
- Test: `apps/desktop/test/session-conversation.test.tsx`

**Interfaces:**
- `ConversationTab` props gain `onLight(id: string): void` and `onOpenPeer(item?: string): void`.
- Head: `<button class="lnk message-link conv-peer" title={tm.seeIn(name)}>{tm.seeTheirs}</button>`, for a known peer only.
- Bubble meta:
  - ` · « dans le fil »` (title `inThreadTitle(A)`) when `inA` is set;
  - else ` · « voir son fil »` (title `tm.seeIn(name)`, calls `onOpenPeer(inB)`) when the peer is known and `inB` is set.
- Bubble: class `can-light` when `inA` is set. A click outside `button, a`, with an empty `window.getSelection()`, calls `onLight(inA)`.
- `SidePaneProps` gains `onLight(id: string, covered: boolean): void` and `onOpenPeer(peer: Session, item?: string): void`. The `<aside>` gets a ref; `covered = getComputedStyle(aside).position === 'absolute'`.
- `SessionPage`:
  - `lightMessage(id, covered)`: `if (covered && activeTab !== null) closeTab(activeTab)`, then `follow.current = false`, then `setFlash(id)`.
  - `openPeer(peer, item)`: `p.dispatch({ type: 'open', id: peer.id, ...(item !== undefined && { item }) })`.

- [ ] **Step 1 (test-writer): failing tests** (stub `Element.prototype.scrollIntoView` as `session-messages.test.tsx` does).
  1. `« dans le fil » lights Otto's message in place; the page and the pane stay` (Goal 3):
     - put `s1` in a past, folded exchange (add a later prompt);
     - clicking « dans le fil » (title « Montrer dans le fil d’Otto ») on `a:s1` gives `.message-card.lit[data-message="s1"]` (its exchange unfolded) and calls `scrollIntoView`;
     - `data-session` stays `local:otto` and the tab is still open;
     - the light is gone after 1.8 s.
  2. `a click on the bubble does the same; on its links or over a selection it does not` (Goal 3):
     - clicking `a:recv-2-0`'s body lights `recv-2-0`;
     - clicking « Lire tout le message » lights nothing;
     - with `window.getSelection` stubbed to return 'abc', a click lights nothing.
  3. `a message only Nova's thread holds: « voir son fil » opens Nova on it, lit` (Goal 3):
     - `b:toolu_n2` has no « dans le fil »;
     - its « voir son fil » gives `data-session="local:nova"` and `.message-card.lit[data-message="toolu_n2"]`.
  4. `the head's « voir son fil » opens Nova's page`.
- [ ] **Step 2:** `pnpm --filter desktop test session-conversation.test` → FAIL.
- [ ] **Step 3 (worker):** implement.
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5:** commit `feat(desktop): from the conversation, the message in the thread`.

### Task 6: Live — in place, the unseen dot, the new-messages pill, reconnects [test-writer → worker]

**Files:**
- Modify: `useConversations.ts`, `SidePane.tsx`, `ConversationTab.tsx`, `SessionPage.tsx`, `session.css`
- Test: `apps/desktop/test/session-conversation.test.tsx`

**Interfaces:**
- `useConversations(client, self, items, keys, active: string | null)`. `active` is the peerKey of the active conv tab while the pane shows, else `null`. `ConversationView` gains `unseen: number`.
  - Page state is a `ReadonlyMap<string, number>` baseline. While a tab is active, the baseline equals its count. When a count drops below the baseline, the baseline drops with it.
  - `unseen = max(0, count − baseline)`. Baselines of closed tabs are dropped.
- `SidePane`: a conv tab that is not active with `unseen > 0` gets `aria-label={tc.tabNew(name, unseen)}` and `<i className="conv-tab-dot" aria-hidden="true" />`.
- `ConversationTab`:
  - the mockup's follow logic: `follow` ref; a layout effect on `[bubbles]` sticks to the end or counts additions into `fresh`;
  - `onScroll` uses `atEnd` and resets `fresh` at the end;
  - a `ResizeObserver` on the body, with its children observed after each render (as `SessionPage`), keeps the end in view;
  - `.to-latest` shows `tc.fresh(fresh)`; its click calls `scrollTo({ top: scrollHeight, behavior: 'smooth' })`, guarded.
- `session.css`: `.conv-tab-dot{…}` from the mockup.

- [ ] **Step 1 (test-writer): failing tests.**
  1. `statuses change in place; a message only Nova's thread held keeps its place once Otto receives it; a new one comes at the end` (Goal 1, live):
     - Otto's `s2` is `delivered`; `d.threadItem('otto', { …s2, status: 'read' })` makes the same `data-bubble` read « ✓✓ lu »;
     - `d.threadItem('otto', received recv-4-0 { sent: 'toolu_n2' })`: the third bubble becomes `a:recv-4-0` with « dans le fil », and the count stays « 3 messages »;
     - `d.threadItem('nova', sent toolu_n3)` adds a bubble at the end: « 4 messages ».
  2. `the tab not active: a dot and « 2 nouveaux messages » for messages, not for a status`:
     - Conversation and a document tab are open, the document active;
     - a status change only gives no `.conv-tab-dot`;
     - two new `sent` from Nova: the tab is named « Conversation · Nova, 2 nouveaux messages » and the dot is there;
     - activating it clears both.
  3. `scrolled up, a new message brings « 1 nouveau message », the view stays; the pill takes the reader to the end`:
     - stub `.conv-body` geometry (scrollHeight 2000, clientHeight 500, scrollTop 200) and its `scrollTo`, as `session.test.tsx:216-231` does;
     - one live message gives « 1 nouveau message », a second « 2 nouveaux messages », with `scrollTop` still 200;
     - the click calls `scrollTo` `[{ top: 2000, behavior: 'smooth' }]` and the pill goes;
     - at the end (`scrollTop` 1500), a new message sets `scrollTop` to `scrollHeight` and no pill shows.
  4. `a reconnect asks Nova's thread again; the conversation stays as it was meanwhile`:
     - after `await d.dropClients()`, `d.received` holds two `session.thread` for `nova`;
     - `b:toolu_n2` stays, no « Lecture du fil de Nova… » shows, no dot appears on the tab;
     - a later `d.threadItem('nova', …)` adds a bubble.
- [ ] **Step 2:** `pnpm --filter desktop test session-conversation.test` → FAIL.
- [ ] **Step 3 (worker):** implement.
- [ ] **Step 4:** same command → PASS. `pnpm --filter desktop test session-renders` → PASS unchanged.
- [ ] **Step 5:** commit `feat(desktop): the Conversation tab follows both threads live`.

### Task 7: End to end [test-writer]

**Files:**
- Modify: `apps/desktop/e2e/session-review.spec.ts` (the side pane's scenarios live there). Fixture in the spec: Otto's thread `review` plus turn-2 messages with Nova, and Nova's thread; `fakeDaemon(page, fleet, { threads: { otto, nova } })`.

- [ ] **Step 1 (test-writer):** `test('the Conversation tab: both sides interleaved, Otto on the right, live; narrow, « in the thread » closes it and lights the message')`:
  - At 1600 × 900, open Otto and click « follow the conversation ».
  - The pane (`complementary` « Reading pane ») shows « Conversation · Nova », « 3 messages », and `role=log` « Conversation between Otto and Nova ».
  - `.conv-log` width ≤ 680. The right edge of the `.conv-row.mine` bubble is within 2 px of the log's right edge; the `.theirs` bubbles' left edge is within 2 px of its left edge.
  - `daemon.item('nova', sent toolu_n3)` gives « 4 messages ».
  - Set the viewport to 1280 × 900 and press `o` (terminal). The pane is `position: absolute`.
  - Click « in the thread » on `[data-bubble="a:s1"]`. The pane has count 0, and `.message-card.lit[data-message="s1"]` is visible.
  - The fixture's no-console-error check holds.
- [ ] **Step 2:** `pnpm --filter desktop e2e session-review` → PASS (after Tasks 4–6).
- [ ] **Step 3:** commit `test(desktop): the Conversation tab end to end`.

### Task 8: Verification [main agent]

- [ ] `pnpm --filter desktop typecheck`, `pnpm --filter desktop test`, `pnpm --filter desktop e2e` → all green; note the counts.
- [ ] A dev build compared by eye with `ledge-agent-conversation-{dark,light,one-sided,narrow,empty,entry,lit}.png`, in French and English. Report what was not checked.

---

## Constraints checked

| Constraint | How the plan respects it |
| --- | --- |
| No daemon or protocol change unless needed | Proven unneeded (section above). Only `apps/desktop` changes. |
| French first, English alongside, typed by `fr` | Task 1. `en: Messages` fails `typecheck` on any gap. No static import of `fr` / `en` in `src` (`messages.test.ts`). |
| Neutral colours, tokens only | Only the mockup's CSS plus one `.conv-loading` rule using existing tokens; the dot uses `--sidebar-primary` (spec). |
| One message style | Bubbles are `.message-card` with `sent` / `received` classes; no new card. |
| Wired like plans | `convOpen` / `onConversation` follow `planOpen` / `onPlan` through `Thread → Turn → MessageCard`. No context. |
| Memoised thread | Stable callback (`useCallback` on `openTab`). `convOpen` reaches only the turn holding the header. Guarded by the unchanged `session-renders` tests. |
| One way to ask a thread | `useThread` becomes `useThreads`' wrapper. Guarded by the unchanged `use-thread` tests. |
| Tabs belong to the page | State stays in `SessionPage`; nothing is persisted. |
| No new dependency | None. |
| Clean cutover | Mockup code is ported, not imported; `STATUS_MARK` has one definition; no shim. |
| Changelog / docs | The repository has no CHANGELOG or user documentation of the pane; the spec and this plan are the docs. |

## Risks

- **Render cost.** `SessionPage` already re-renders on every store change (`Workspace` → `useThread` → `useDaemon`). The bubbles are cached per tab on array identity, so `ConversationTab`'s effects see only real changes.
- **The `useThread` refactor** could regress `Workspace`. Mitigated by keeping the existing tests unchanged.
- **jsdom has no layout:** `covered()` is always false there, so the narrow path is tested only by Task 7.
- **Unseen counting by count:** an update that both adds and removes messages under-counts. The spec's dot is a hint, so this is accepted.
- **Key switch:** when A receives a message only B held, its key changes from `b:` to `a:` (the spec's keys), which remounts that bubble. Its place is kept; « Lire tout » unfolds again from closed.
- **Pairing is asymmetric** (B's sent ↔ A's received by `r.sent` only, per the spec). The daemon sets both ids together, so no duplicate is expected.

## Hand-off notes

**test-writer**
- The integration tests run in French, through `<App>` and `createMockDaemon`, as in `session-messages.test.tsx`. Copy its local `openOtto`; local helpers per file are the existing pattern.
- French strings use the typographic apostrophe « ’ » (`deName`: « d’Otto »).
- Scope queries to the pane (`complementary` « Volet de lecture ») and to `role=log`: bubbles are `role=article` too.
- `d.push({ type: 'session.thread', … })` delivers a thread late or replaces it (/clear). `d.dropClients()` forces a snapshot. Without `d.thread('nova', …)`, Nova's request is never answered.
- Only the two regexes in `session-messages.test.tsx` change. `session-renders`, `use-thread`, `session-pane` and `session-plans` stay as they are and must pass.

**worker**
- Port from the mockup: `conversation.ts` as is; `ConversationTab` / `BubbleRow` markup; MessageCard's two entry points with props instead of `ConversationContext`; the first section of `conversation.css` without `.conv-doc`.
- Guard `scrollTo`. Observe the body's children after each render.
- Never edit `packages/**`. No new dependency.

## Follow-ups deliberately left out

- **Narrow layout with other tabs open (decision for a human):** « dans le fil » closes only the Conversation tab, as the spec says, so the next tab still covers the thread. Whether to close or hide the whole pane is not decided by the spec.
- **« dans le fil » twice within 1.8 s on the same message** does not scroll again: the existing flash mechanism ignores an unchanged id. This is not in the acceptance criteria.
- **A render-count test for the tab** in `session-renders.test.tsx`: not tied to a criterion; the cache is covered by the interface.
- **Stable bubble keys across the `b:` → `a:` switch:** would change the spec's keys.
- **Non-goals:** a composer, more than two agents, a subagent's own messages, the way back from a card to the tab, the atelier, the island and the PWA (spec).
- **B offline without a thread ever read:** no loading line and no strip. B shares A's machine, so A's page is frozen too; wording would need a decision if it ever matters.

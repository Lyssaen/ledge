# Following a conversation between two agents — design

2026-10-21. Mockup approved by the user: `docs/mockups/agent-conversation/` (built into `docs/mockups/ledge-agent-conversation.html` by `node docs/mockups/agent-conversation/build.mjs`; captures `docs/mockups/ledge-agent-conversation-{dark,light,one-sided,narrow,empty,entry,lit}.png`). It follows `2026-10-18-agent-messages-design.md` (v1): same cards, same copy, same neutral colours.

The mockup mounts Desktop's real title bar, sidebar, top bar and session page (thread, reply) on a fixture fleet: Otto's page, the pane open on « Conversation · Nova ». Only two things are the mockup's: `MessageCard.tsx` (the app's, plus the two entry points; diff it against `apps/desktop/src/session/MessageCard.tsx`) and `ConversationPane.tsx` (the new tab inside SidePane's markup). The bar above the window switches the state (both threads, unknown peer, empty), the width, the theme and the language, and « Simuler la suite » plays the live part (Otto's message delivered, Otto receives Nova's, Nova reads Otto's, Nova replies, Otto receives it). URL: `?state=both|oneSided|empty&theme=dark|light&width=wide|narrow&lang=fr|en&step=0…5`.

## Why

The user wants to « suivre la conversation entre deux agents ». In v1 each message is a card in the thread it belongs to, so a conversation is cut in pieces: in Otto's thread, Otto's messages and the ones that reached Otto sit between Otto's actions, and past exchanges fold them away; what only Nova's thread knows (a message Nova wrote that Otto has not received yet) is not there at all; and « voir son fil » replaces the page. Following both sides means going back and forth between two pages.

## Goals

1. On a session page, a « Conversation » tab in the side pane (beside documents, changes and plans) shows the exchange between this agent (A) and one other (B): every message once, both ways, in the order it was sent, with its delivery, live.
2. It opens from any message card and from the conversation header in the thread, without leaving A's thread.
3. From a message in the tab, A's thread brings it into view and lights it, in place; a message A's thread does not hold yet opens B's thread on it.
4. When Ledge does not know B, the tab still shows what A's thread holds, and says it is one side only.

## Non-goals

- Writing, replying or relaying from the tab: no composer (v1's non-goal).
- Three or more agents in one view; a subagent's own messages (`helperId`); the atelier, the island and the PWA.
- Claude Code's automated notices (NoticeLine) in the tab: they stay in the thread.
- The way back (a card in the thread lighting its bubble in the tab).
- Keeping tabs across visits: the pane's tabs belong to the page, as today.
- Messages across machines: v1's limit stands (a peer is resolved on the daemon's own machine only).

## Anti-goals

- State colours on messages (v1). The only colour is the accent's dot for unseen messages, the thread's « Nouveau » marker colour.
- A second message style: the bubbles are the thread's `.message-card` (B's like a received card on the left, A's like a sent card on the right, filled).
- Leaving A's page to follow the conversation, or showing a message twice (A's `sent` and B's `received` copy of it).

## Decisions

### Entry points (thread)

- Every card, sent or received, known peer or not: « · suivre la conversation » at the end of its `who` line (`.lnk`, title « Suivre la conversation avec Nova à côté du fil »). Folded one-line rows are unchanged (a click unfolds them).
- The conversation header (« Échange avec Nova · 7 messages », from two messages, v1): a pill « Suivre à côté › » before « Replier », same style; while that tab is the pane's active one it reads « Ouvert à côté » and is `aria-pressed`, as PlanCard's « Lire le plan » / « Ouvert à côté ».
- Both open the tab `{ kind: 'conv', peer: peerKey }` (`tabId` `conv:<peerKey>`); already open, it becomes the active one. Thread → Turn → MessageCard get it as plans do (`planOpen` / `onPlan`): the active conversation's peerKey and the callback.

### The tab

- One tab per pair; two peers, two tabs in the existing bar. No picker.
- Label « Conversation · Nova » (mail icon). Not « Échange »: « Échange de 14:02 » already names a turn in the thread.
- Head (SidePane's `side-head`): Otto's bot and name ⇄ Nova's bot and name, « 8 messages » (hidden at zero), « voir son fil » (known peer only), « Agrandir », « Fermer ». The bots already carry each agent's state; no badge or state dot is added.
- Width, handle, « Agrandir » (65 %), Escape and the narrow layout (the pane over the thread, under 860 px of page) are SidePane's, unchanged. The messages sit in a centred column (680 px max), bubbles 86 % of it at most.

### What it shows

- Sources: A's thread (the page's items) and B's thread, asked with `useThread(client, peer)` while the tab is mounted. Main-thread items only (no `helperId`): A's whose `peerKey` is the tab's, B's whose `peer` is A's raw daemon id.
- One bubble per message, paired as v1 pairs them: A's `sent` s and B's `received` r are one when `r.sent === s.id` or `s.received === r.id`; B's `sent` b and A's `received` r when `r.sent === b.id`. Unpaired items stand alone (B's messages A has not received; A's messages A's thread no longer holds after a /clear).
- Item ids are unique per thread only (`recv-<turn>-<i>` exists in both): a bubble is keyed `a:<id>` when A's thread holds it, else `b:<id>`.
- Order: by the sender's `at` (the receiver's when the sender's item is not known), stable.
- A bubble: the author's bot and name on the first of a run only; the sender's summary (bold, as on the card); the body clamped as on the card (`isLong`, « Lire tout le message »); a meta line « 14:02 · ✓✓ lu · dans le fil ».
- Delivery, from the sender's item, v1's marks and words: « ✓✓ lu » (title « Lu par Nova »), « ✓ Remis, pas encore lu » (title « Remis à Otto, pas encore lu »), « … Envoi… », « ✕ Non remis ». A message A received whose sender's item is not known reads « lu »: A's hook delivered it.
- Reference merge: `docs/mockups/agent-conversation/conversation.ts`, to port as `session/conversation.ts` with its tests.

### Live

- Both threads change as today (`session.thread.item`); the tab follows. A status changes in place (Envoi… → Remis → lu); a message only B's thread held keeps its place once A receives it, and gains « dans le fil ».
- Opened at the end. A new message keeps the end in view while the reader is there (`atEnd`, as the thread); higher up, the view does not move and a pill « ↓ 1 nouveau message » (the thread's `.to-latest`) counts them until the end is reached. A resize (pane, narrow layout, an unfolded long message) keeps a reader at the end there.
- The tab open but not active: a dot on it for messages added since it was last active (messages, not status changes), and its name says « Conversation · Nova, 2 nouveaux messages ».
- The list is `role="log"`, mounted even when empty so the first message is announced; each bubble is an `article` with a hidden « Message de Nova à Otto ».

### From the tab to the threads

- « dans le fil » (title « Montrer dans le fil d'Otto »), or a click on the bubble outside its links and outside a selection: the page's flash, as `nav.place.item` and the Changes view's « tour 2 » already do — its exchange unfolds, it comes to the middle and lights 1.8 s, and the thread stops following its end.
- A message only B's thread holds: « voir son fil » opens B's page on it (v1's `open` with `item`); the page changes, on purpose.
- Narrow (the pane lies over the thread): « dans le fil » closes the tab first, then lights the message.

### One side only (peer unknown)

- No `peer` on A's items (another machine, a Claude process Ledge did not launch): B's thread is not asked. The tab shows A's messages and B's messages A received; A's stop at « Remis, pas encore lu » (nothing pairs them); B's messages A has not received are not known.
- Said once in a strip under the head, always in view (dashed, `--well`, like the frozen thread's note): « Vue d'un seul côté · harness-assistant-bf n'est pas une session que Ledge suit sur cette machine. La conversation est lue dans le fil d'Otto seulement : les messages de harness-assistant-bf apparaissent quand Otto les reçoit, et Ledge ne sait pas si ceux d'Otto ont été lus. » The raw name in the head and the tab, no bot, no « voir son fil ».

### Empty, loading

- Neither thread holds a message between them any more (both agents ran /clear): the tab stays rather than closing under the reader, centred « Aucun message entre Otto et Nova pour l'instant. » and « Ils s'afficheront ici, en direct, dès que l'un écrira à l'autre. »; no count in the head. It is reachable only for a tab opened before.
- B's thread not read yet: A's side shows at once, with a muted « Lecture du fil de Nova… » line above the messages until B's arrives (not in the mockup).

### Themes, accessibility

- Tokens only (`--card`, `--secondary`, `--border`, `--input`, `--well`, `--muted-foreground`; `--sidebar-primary` for the dot). Checked in dark and light.
- Every action is a button reachable by keyboard; the bubble click is a mouse shortcut for « dans le fil ». Escape closes the active tab (SidePane's rule).

### Copy

French first, English alongside (`session.conversation` in fr.ts / en.ts; the mockup's `copy.ts`). Everything else reuses v1's `session.message` and `session.pane`.

| Key | fr | en |
| --- | --- | --- |
| follow / followTitle | suivre la conversation / Suivre la conversation avec {B} à côté du fil | follow the conversation / Follow the conversation with {B} beside the thread |
| followBeside / openBeside | Suivre à côté / Ouvert à côté | Follow beside / Open beside |
| tab / tabNew | Conversation · {B} / Conversation · {B}, {n} nouveaux messages | Conversation · {B} / Conversation · {B}, {n} new messages |
| log / count | Conversation entre {A} et {B} / {n} messages | Conversation between {A} and {B} / {n} messages |
| kicker | Message de {X} à {Y} | Message from {X} to {Y} |
| readBy / deliveredTo | Lu par {Y} / Remis à {Y}, pas encore lu | Read by {Y} / Delivered to {Y}, not read yet |
| inThread / inThreadTitle | dans le fil / Montrer dans le fil de {A} | in the thread / Show it in {A}'s thread |
| fresh | {n} nouveaux messages (1 nouveau message) | {n} new messages (1 new message) |
| oneSidedLead / oneSided | Vue d'un seul côté / (the strip above) | Seen from one side / {B} is not a session Ledge follows on this machine. The conversation is read from {A}'s thread only: {B}'s messages show once {A} receives them, and Ledge cannot tell whether {A}'s were read. |
| empty / emptyHint | Aucun message entre {A} et {B} pour l'instant. / Ils s'afficheront ici, en direct, dès que l'un écrira à l'autre. | No messages between {A} and {B} yet. / They will show here, live, as soon as one writes to the other. |
| loadingPeer | Lecture du fil de {B}… | Reading {B}'s thread… |

### Code shape

`PaneTab` gains `{ kind: 'conv'; peer: string }`; SidePane renders a `ConversationTab`; SessionPage passes the open conversation and its callback down the thread as for plans, and its flash to the tab. New: `session/conversation.ts` (the merge), `SHELL_ICONS.exchange` (two arrows), the strings above, and the mockup's `conversation.css` first section appended to `session.css` after the message cards.

## Left to the builder

Markup and CSS details within the mockup's look; test fixtures; how long B's thread stays asked (while the tab is mounted, or while it is open); English polish.

## Confirmed by the user (2026-10-21)

- « suivre la conversation » on every card, sent or received (the third link in the card's line is accepted).
- Sides are relative to the page: this agent on the right, as « sent » in its thread; on Nova's page Nova is on the right.
- One Conversation tab per peer: an agent talking with several agents can have several Conversation tabs open at once.
- The builder adds what the mockup missed: the ⇄ between the two names in the one-sided head, and the « Lecture du fil de Nova… » line while B's thread loads.

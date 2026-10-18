# Messages between agents — design

2026-10-18. Mockup approved by the user: `docs/mockups/session-management/exchange.tsx` + `exchange.css` (built into `docs/mockups/ledge-session-management.html`; examples in the threads of Otto, Rio and Nova).

## Why

Claude Code sessions talk to each other (`SendMessage`; the receiver gets `<cross-session-message>`). The user follows two sessions coordinating (Otto ↔ Nova on 2026-10-18) and cannot tell, in Ledge Desktop, who said what to whom: a received message shows as **if the user had typed it** (a prompt bubble « Vous »), a sent one as a raw tool row « SendMessage » with JSON for a label. The atelier shows nothing.

## Goals

1. In a session's thread, a message sent and a message received are each a card that names both agents, says the direction, and (for a sent one) whether it was read.
2. From either card, open the other agent's thread on the same message.
3. The cards with one peer can be folded together into one-line rows, in place.
4. In the atelier, a message being sent shows as a bubble over the sender for 5 s and a dotted line to the receiver's seat; seats that exchanged recently carry a small « ✉ Name » tag.

## Non-goals

- Sending a message from Ledge, or relaying one (the chat's relay already exists and is a different thing).
- Codex and Cursor: they have no agent-to-agent messaging today.
- Messages across machines (Remote Control, cloud): the peer is resolved on the daemon's own machine only; elsewhere the card shows the raw name and no link.
- The island (overlay) and the mobile PWA: they keep whatever they show today; they must not break on the new item kinds.
- A sidebar signal (Nova's sidebar rework owns that zone; ask first).

## Anti-goals

- A received message rendered as the user's prompt, or counted as the session's topic.
- Colour: the state colours (blue working, red approval, amber question, green done) stay for what agents need from the user. Messages are neutral (foreground, dashed for received).

## What the harness gives (verified 2026-10-18, Claude Code 2.1.302)

- **Sent**: a `PreToolUse` / `PostToolUse` of tool `SendMessage`, input `{ to, summary, message }`. `to` is a peer name (`harness-assistant-bf`), sometimes with a ref (`harness-assistant-bf [7e2ea7]`), or an address `uds:/run/user/1000/cc-socks/<pid>.sock`.
- **Received**: a `UserPromptSubmit` whose prompt is `<cross-session-message from="uds:…/<pid>.sock" from-name="harness-assistant-2d" from-mode="prompting">\n<body>` (closing tag optional; the transcript, not the hook, prefixes « Another Claude session sent a message: »). The hook caps prompts at 500 chars today.
- **Directory**: `~/.claude/sessions/<pid>.json` holds `{ pid, sessionId, name, messagingSocketPath, tmux, … }` for each Claude process. `sessionId` is the Ledge session's `agentSessionId` (or the basename of its `transcriptPath`). That maps a name or an address to a Ledge session.

## Decisions

- Protocol: two new thread item kinds, `sent` and `received`; a `Session.lastMessage` for the atelier (Desktop does not hold every session's thread).
- The daemon resolves names/addresses to Ledge session ids (`peer`) and pairs a received message with the sent one in the sender's thread (text prefix), marking it read and cross-linking both ids.
- A sent item's status: `sending` → `delivered` (tool success) → `read` (the peer's hook delivered it); `failed` on tool failure. `read` never goes back.
- A received message opens a turn, like a prompt (it is one, for the agent), but renders as a card, not as « Vous ».
- Desktop copy follows the mockup (French; English alongside in `en.ts`).
- Mockup's 10-minute « recent » window for the seat tag; 5 s bubble (same as the island's speech balloon).

## Left to the builder

Card markup and CSS details within the mockup's look; exact test fixtures; whether the atelier line is SVG or CSS (the mockup uses SVG with `offset-path`).

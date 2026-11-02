# Browser captures: an agent's screenshots in the thread and a « Navigateur » tab

Date: 2026-11-02. Status: design.

Mockup (reviewed with the user): [browser-captures.jpg](mockups/2026-11-02-browser-captures/browser-captures.jpg)
(1 the thread, 2 the « Navigateur » tab, 3 the comparison, 4 the phone).

Decisions marked *(design call)* were made while writing this document, not by the user; everything else under §3 is
the user's.

## 1. Intent

Agents run design checks with Playwright (the `playwright` plugin's MCP server, `@playwright/mcp`). Each
`browser_take_screenshot` returns the image to the agent, and the agent judges the design from it. Ledge shows none of
it: the thread row says the tool ran and prints its text, the image is gone. The user cannot see what the agent saw,
nor compare the page before and after a fix, without opening `.playwright-mcp/` by hand.

What the user asked for (option 2 of the 2026-11-02 analysis):

- the captures an agent takes show up in the session's thread;
- a « Navigateur » tab in the session's side pane gathers the session's captures, to re-read a design check at a glance
  and compare before / after;
- **later** (not in this version), a live view of the agent's browser (option 3). This version must not paint the tab
  into a corner for it.

## 2. Goals, non-goals, anti-goals

Goals
- Every image a tool returns to a Claude Code session (Playwright first, but any MCP tool that returns an image) is kept
  by Ledge, reduced to the size every surface can carry, and attached to that tool's thread row.
- Desktop shows it as a thumbnail on the row; a click opens the « Navigateur » tab on that capture.
- The « Navigateur » tab lists the session's captures in order, shows one large, and shows two side by side.
- The phone shows a minimal « Capture » row with the thumbnail, only for tool rows that carry images; a tap opens it
  full screen. The TUI shows the thumbnail on the tool row.

Non-goals (this version)
- The live view, streaming, taking control of the browser (option 3, §8).
- Keeping captures beyond the thread's window: the tab shows the captures of the items the thread still holds
  (`MAX_ITEMS` = 400). A daemon-side capture index comes with option 3.
- Full-resolution originals in Ledge: the stored capture is the reduced one; the original stays where the agent wrote it.
- Playwright videos and traces (`--save-video`, `--save-trace`).
- The « Navigateur » tab on the phone and in the TUI.
- Showing the phone's other tool rows (only rows with captures appear).
- Codex, Cursor Agent and OMP, unless their tool-result hook payload carries image blocks in a shape the same extractor
  reads (§5.1); the builder checks, and leaves them out otherwise.
- Changing how agents launch Playwright (MCP flags, headless, output dir).

Anti-goals (a failure even if it works)
- A hook that gets slow for ordinary tools: the PostToolUse hook sits on the agent's critical path. Only a result that
  carries images may wait longer (§5.1).
- The attachment store filling the disk: captures follow the same 24 h sweep as pasted images, kept only while a
  journaled thread names them.
- A capture shown on the wrong session, or a capture from another session leaking into this one's tab.

## 3. What the user decided

- Option 2 now: captures in the thread **and** a « Navigateur » tab in the side pane.
- Option 3 (live view) later; keep it in mind.
- The playback the user approved:
  - thumbnail on the tool row, click opens it large;
  - the tab lists the captures in order, each with the page URL, the time and the viewport size;
  - two captures can be shown side by side (before / after);
  - `.playwright-mcp/` goes into `.gitignore`.
- The mockup above, as the look to build.
- The phone gets a minimal « Capture » row, shown only when a tool row carries images.
- The daemon reduces captures itself, with a pure-JavaScript image library, so the phone and the relay can carry them
  even when Desktop is closed.
- The tab loses captures older than the thread's window; accepted for this version, a daemon-side index comes with
  option 3.

## 4. Current state (verified 2026-11-02)

- The plugin's MCP server is started as `npx @playwright/mcp@latest` (0.0.84 in the npx cache), no flags: headed
  Chromium through WSLg, outputs in `<cwd>/.playwright-mcp/`.
- A real `browser_take_screenshot` in a Ledge session (session `0131`, tool_use `toolu_016XnECDSRoEgG2t1CFSLt16`)
  produced:
  - in the Claude transcript, `toolUseResult` = `[{type:'text', text:'### Result\n- [Screenshot of viewport](.playwright-mcp/page-….png)\n### Ran Playwright code …'}, {type:'image', source:{type:'base64', media_type:'image/png', data:'…'}}, {type:'text', text:'[Image: source: <~/.claude/projects/…/tool-results/….png>]'}]`;
  - in Ledge's journal (`~/.ledge/history/0131.jsonl`), a `tool` row whose `output` holds only the two text blocks:
    `toolOutput` (`packages/ledge/src/cli/hook.ts:72`) keeps `text` and drops the image.
  - The hook's `tool_response` is assumed to have the transcript's shape; the journal row is consistent with it (the
    text blocks match). The builder confirms it with a hook payload dump; the fallback is in §5.1.
- The screenshot's text does not carry the page URL. Most other Playwright tools do, as `### Page\n- Page URL: <url>`
  (seen on `browser_navigate`).
- The hook's budget: `runHook` gives PostToolUse 100 ms in all (connect, send, flush); Claude Code allows the hook 5 s
  (`"timeout": 5` in settings).
- What exists to build on:
  - the content-addressed attachment store (`packages/ledge/src/daemon/attachments.ts`), `attachment.put` /
    `attachment.get` on the daemon socket, routed by session id across the fleet;
  - prompts already carry images: `SessionEvent.attachments` (ids) → `History.record` → `images: AttachmentRef[]` on the
    `prompt` item (`packages/ledge/src/daemon/history.ts:132`, `packages/protocol/src/thread.ts:17`);
  - the sweep keeps every id found under an `"images"` key of a journal line (`History.attachmentIds`), whatever the
    item's kind;
  - Desktop's `Thumbs` (with the shared lightbox, `@ledge/ui/images`), the phone's `PhoneThumbs`, the TUI's
    `threadImages`;
  - the side pane's tabs: `PaneTab = doc | diff | plan | conv` (`apps/desktop/src/session/SidePane.tsx:20`), with a
    « dans le fil » link that lights the item in the thread (the conversation tab).
- What does not exist yet:
  - the phone shows no tool rows: `apps/mobile/src/model/thread.ts` makes only `me`, `agent`, `event` and `awaiting`
    entries (« tools, helpers and messages between agents are left to the terminal »), although
    `packages/ledge/src/mobile/project.ts` projects `tool` rows;
  - the daemon makes no previews and has no image library (`packages/ledge` has five pure-JS dependencies);
  - the phone shows « Image trop lourde pour le téléphone » for an image without a preview, and the relay refuses a
    sealed message over `SEALED_MAX` (1 MB) and closes a socket over 8 MB per 10 s (`apps/relay/src/hub.ts`).
- Limits in force: `ATTACHMENT_MAX` 400 kB and `IMAGE_LONG_SIDE` 1600 px (what Desktop's pasted images are re-encoded
  to), `PREVIEW_MAX` 40 kB and `PREVIEW_LONG_SIDE` 480 px, `ATTACHMENT_LOCAL_MAX` 2 MB, `ATTACHMENTS_MAX` 5 per message,
  `MAX_FRAME` 4 MB per socket frame, `MAX_ITEMS` 400 per thread.

## 5. Design

### 5.1 Hook: hand the images to the daemon

In `ledge hook PostToolUse` (Claude Code):

1. Extract the image blocks of `tool_response` when it is an array. Accept the Claude shape
   (`{type:'image', source:{type:'base64', media_type, data}}`) and the raw MCP shape (`{type:'image', data, mimeType}`)
   *(design call: one extractor, two shapes, so Codex or Cursor can reuse it if their payloads carry MCP content)*.
   Keep the types `IMAGE_MIMES` lists; ignore the rest. At most `ATTACHMENTS_MAX` images, in order.
2. Fallback when `tool_response` holds no image block but its text has `[Image: source: <path>]` lines: read those files
   (absolute paths under `~/.claude/projects/`, nothing else) *(design call: the builder's dump decides whether the
   fallback is the main path or dead code; keep it only if a real payload needs it)*.
3. Send each image to the daemon as a capture (§5.2), awaiting its ref.
4. Send the PostToolUse event with `attachments: [ids]`, as `UserPromptSubmit` already does.

Budget *(design call)*: a PostToolUse whose response carries images gets its own deadline, 1 s in all; every other
PostToolUse keeps 100 ms. When the deadline passes, the event goes without the images that were not stored and says
`imagesDropped: true`. The image never blocks the event, and the agent never waits more than 1 s.

An image the daemon refuses (§5.2) is dropped the same way (`imagesDropped: true`).

`toolOutput` still drops image blocks; the text stays as it is (the `.playwright-mcp/…png` link and the
`[Image: source: …]` line included) *(design call: no text rewriting; the row's text is the agent's)*.

### 5.2 Daemon: reduce and store

- A capture reaches the daemon raw, up to what one socket frame carries (`MAX_FRAME` 4 MB, base64 included). The
  carrying message is the builder's call (a flag on `attachment.put` that only a local, non-fleet caller may set, or a
  dedicated message).
- The daemon reduces it with a pure-JavaScript library (no native module: the daemon installs on WSL and on remote
  Linux machines as plain JS) to what Desktop's pasted images already are:
  - the stored image: long side ≤ `IMAGE_LONG_SIDE`, ≤ `ATTACHMENT_MAX`; a PNG or JPEG already within both limits is
    kept as is, anything else is re-encoded as JPEG *(design call: one stored image per capture, the size every surface
    and the relay carry; the original stays in `.playwright-mcp/`)*;
  - a preview: long side ≤ `PREVIEW_LONG_SIDE`, ≤ `PREVIEW_MAX`;
  - the store's id is the reduced image's hash, as for any other attachment.
- A type the library cannot decode (WebP, GIF) is stored only if already within the limits, without a preview;
  otherwise refused. A full-page capture taller than it is wide is reduced like any other (it gets narrow; accepted).
- Reduction runs before the daemon answers the hook, inside the hook's 1 s. The builder measures a 1280 × 800 PNG and a
  full-page one on WSL; if reduction does not fit, the daemon answers once the original is accepted and reduces after,
  updating the row when done (builder's call, but the hook's budget stays 1 s).
- `SessionEvent`: PostToolUse may carry `attachments` (ids) and `imagesDropped`.
- `ToolItem` gains `images?: AttachmentRef[]` and `imagesDropped?: true`. Both optional; older clients ignore them.
- `History.record`, PostToolUse: maps `ev.attachments` through `refOf` as the prompt case does, and puts `images` on the
  row. The sweep already keeps them (the line has an `"images"` key).
- The phone's projection of a tool row (`packages/ledge/src/mobile/project.ts`) carries `images` too.

### 5.3 Desktop: the thread (mockup, screen 1)

- A tool row with `images` shows its thumbnails under the row's head, at the thread's size (420 × 260), each tagged with
  its size, always visible even when the row's details are folded *(design call: a capture is the point of the call, it
  should not hide behind a fold)*. In an action group, the group shows the thumbnails of its rows.
- A click on a thumbnail opens the « Navigateur » tab on that capture (§5.4), not the lightbox *(design call: the tab is
  where captures are compared; the lightbox stays one click away from the tab's large view)*.
- `imagesDropped`: a quiet line « Capture trop lourde pour Ledge ».
- The session's head shows a « Navigateur » button with the capture count, once the thread holds at least one capture
  *(design call)*.

### 5.4 Desktop: the « Navigateur » tab (mockup, screens 2 and 3)

A new `PaneTab` kind `browser`, one per session.

- **Opens** from a thumbnail (on that capture) or from the head's « Navigateur » button (on the latest capture).
- **Captures** are derived on the client from the thread items, no new message: every tool row with `images`, in thread
  order, helpers' rows included and marked with the helper's name. One entry per image.
- **Each entry** shows: thumbnail, page URL, time (`clock(at)`), size (`width × height` of the ref), who took it (the
  agent or the helper), and the tool's short name when it is not a Playwright screenshot. The page URL is the last
  `Page URL:` found in a Playwright tool output of the same thread (same helper) at or before the capture; none found,
  no URL *(design call: derivation, pure function, unit-tested)*.
- **Layout**: the selected capture large, with its meta line and « Comparer », « Agrandir » (the shared lightbox, with
  its Copy / Save), « dans le fil » (lights the row in the thread, as the conversation tab does). Below, a strip of
  entries in thread order, a divider between exchanges, the count and time span above it; scrolled to the end when a
  capture arrives while the tab is open.
- **Comparison**: « Comparer » turns the strip into a pick of two (badges A and B); the two show side by side, stacked
  when the pane is narrow; the head shows « Comparaison · Quitter ».
- **Empty**: the tab cannot be opened without a capture; if the thread is cleared under it, it says so and offers to
  close.
- Wording in `fr` and `en` i18n.

### 5.5 Phone and TUI (mockup, screen 4)

- Phone: `threadItems` gains a `capture` entry for each tool row that carries `images` (and only those): the tool's
  short name, the size, the thumbnails (`PhoneThumbs`, previews from §5.2); a tap opens the existing full-screen
  viewer. `imagesDropped` alone makes no entry *(design call: the phone shows what it can open)*.
- TUI: `threadImages` includes tool rows' images, so the existing chips and `o` open them.

### 5.6 Repo hygiene

`.playwright-mcp/` in `.gitignore`.

## 6. Mockups

The mockup above covers Desktop (dark) and the phone. A light-theme Desktop pass and the TUI are left to the builder,
within the same layout.

## 7. Testing

- Unit: the extractor (Claude shape, MCP shape, non-image block, unknown type, more than 5, the `[Image: source:]`
  fallback if kept); the hook's image deadline (a slow daemon drops images and sets `imagesDropped`, the event still
  goes); the reduction (PNG and JPEG within limits kept as is, a large PNG re-encoded under both limits, a preview made,
  WebP within limits kept without preview, WebP over limits refused); `History.record` PostToolUse with attachments;
  the sweep keeping a tool row's image; the URL derivation; the phone's `capture` entry.
- Desktop component tests: the row's thumbnails, the head's button, the tab's list, selection, comparison, « dans le
  fil ».
- Desktop e2e (Playwright, from `apps/desktop`): a fixture thread with a capture, click → the tab opens on it.
- Timing: a 1280 × 800 PNG and a full-page capture through hook + reduction on WSL, under 1 s.
- End to end by hand: a real Ledge Claude session takes a Playwright screenshot; the thumbnail shows on Desktop, the
  phone (through the relay) and the TUI; the tab lists it with its URL.

## 8. Later: the live view (option 3), what this design keeps open

Not built now. What the later work would add, and what this version leaves room for:

- The daemon owns one Chromium per session that asks for it, started with a remote-debugging port; the session's
  Playwright MCP is pointed at it with `--cdp-endpoint` (the flag exists in 0.0.84). Injecting that per harness (Claude
  `--mcp-config`, Codex, Cursor) and over SSH machines is the main cost.
- Frames come from CDP `Page.startScreencast`, pushed over the daemon socket to the session's viewers.
- A daemon-side index of the session's captures, so the tab keeps them beyond the thread's window.
- The « Navigateur » tab is where it shows: the live view takes the large area, the captures strip stays below. That is
  why the tab is a session-level `browser` kind and not a « captures » kind, and why its large area is a slot the
  selected capture fills today.

## 9. Left to the builder

- The pure-JS image library (PNG and JPEG decode, resize, JPEG encode), within the no-native-module constraint.
- The message that carries a capture to the daemon (§5.2) and whether images are sent in parallel.
- Reduce-then-answer or answer-then-reduce (§5.2), from the measured timings.
- Where the thumbnails sit inside an action group's markup.
- The exact look of the strip and of the comparison, within the mockup.
- Whether Codex / Cursor payloads fit the extractor (check with a payload dump; leave them out if not).

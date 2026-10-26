# Pasting an image: in a session's reply and in the Ledge chat, on Desktop, the phone and the TUI

Date: 2026-10-26. Status: design.

Mockups (approved): [desktop-session.png](mockups/2026-10-26-image-paste/desktop-session.png) (a screenshot in the
thread and one waiting in the reply field), [desktop-enlarged.png](mockups/2026-10-26-image-paste/desktop-enlarged.png),
[desktop-chat.png](mockups/2026-10-26-image-paste/desktop-chat.png),
[mobile-thread.png](mockups/2026-10-26-image-paste/mobile-thread.png),
[mobile-enlarged.png](mockups/2026-10-26-image-paste/mobile-enlarged.png),
[tui-session.png](mockups/2026-10-26-image-paste/tui-session.png).

Decisions marked *(design call)* were made while writing this document, not by the user; everything else under §3 is
the user's.

## 1. Intent

The user often wants to show an agent a screenshot: a layout that breaks, an error dialog, a page of another tool.
Today every way Ledge sends text to an agent is text only (`session.reply`, `chat.ask`, the phone's `session.reply` and
`chat.ask`, the TUI's reply and Ask), and every view drops images (`daemon/transcript.ts` keeps only text blocks,
`omp/project.ts` too). The only way in is the embedded terminal, where Ctrl V hands Claude Code the clipboard itself,
and then the thread never shows it.

What the user asked for:

- paste a screenshot in the reply field of a session and in the Ledge chat;
- on all three surfaces: Desktop, the phone, the TUI;
- see it in the thread, as a **fairly large thumbnail that opens full size on click**;
- mockups before any code (done, approved).

## 2. Goals, non-goals, anti-goals

Goals
- An image can be attached to a session reply (send, queue, steer) and to a Ledge chat question, from the three surfaces.
- The agent really sees it: natively when its interface takes images, otherwise as a file it can read.
- The thread (session and chat) shows it as a thumbnail on every surface; Desktop and the phone open it full size, the
  TUI opens it in the system's image viewer.

Non-goals (this version)
- Images in a launch prompt (`session.launch`), a permission note (`session.decide`), a free-text answer to an ask
  (`session.answer`), a reply that answers an open dialog (§6.1), or a message between sessions.
- Showing images the agent itself produced or read (tool results, assistant images), or images pasted straight into
  the agent's own terminal (Claude Code's `[Image #1]`). The thread shows what was sent through Ledge.
- Any file that is not an image (PDF, logs…).
- Rendering images referenced in markdown (`markdown.tsx` keeps rendering them as text, never fetching).

Anti-goals (would make it a failure even if it works)
- A pasted screenshot that silently does not reach the agent, or reaches it without the user's text.
- The phone or the relay choking on images (a closed socket, `rate_limited`, `too_large`, a forced resync) — size and
  pace are settled before sending, never discovered by the transport.
- A daemon that serves arbitrary files: only its own stored images, by id.

## 3. Decided with the user

- Three surfaces, both places (session reply and Ledge chat).
- Thumbnail in the thread, large enough to read the gist (Desktop at most 420×260 under the prompt text; chat and phone
  above the bubble, 200–240 px wide), click/tap opens it full size.
- TUI: no picture in the terminal; a line `▣ capture 1440×900 · 212 Ko · o ouvrir dans la visionneuse` that opens it in
  the system viewer (Windows' when under WSL).
- The six mockups above, as drawn.
- The Windows island (`apps/overlay`): **display only**. Its chat and session thread show the thumbnails and open them
  full size; it cannot attach images. It uses the shared `packages/ui/src/chat/ChatView.tsx`, so the composer's paste is
  behind a prop the island leaves off; its own `Thread.tsx` gains the thumbnails, `ReplyCard.tsx` is untouched.

## 4. The image itself

### 4.1 Normalised on the sending side
Every client shrinks and re-encodes before sending, so one stored image fits every hop (daemon frame 4 MiB, phone
plaintext 640 KiB, OMP RPC frame 1 MiB chunked):

- long side at most **1600 px** (Claude downsizes beyond ~1568 px anyway, so nothing the model sees is lost);
- encoded **WebP** (quality 0.85), falling back to JPEG where WebP encoding is missing; PNG/GIF/JPEG/WebP accepted as
  input;
- **at most 400 KB** encoded; above, the client lowers the quality, then the size, until it fits; if it never fits, the
  image is refused with a message (« Image trop lourde, même réduite »);
- **5 images per message** at most;
- *(design call)* the same client also makes a **preview**: 480 px on the long side, WebP/JPEG, at most 40 KB. It is
  stored next to the image and is what the phone's thread shows (§7), so a screen of thumbnails costs the relay tens of
  KB, not megabytes. The daemon has no image encoder and does not need one.

Desktop and the phone do this with a canvas (`createImageBitmap` + `OffscreenCanvas`/`canvas.toBlob`); the avatar code
(`apps/desktop/src/shell/avatar.ts`) already shrinks an image this way. The TUI has no encoder of its own: under WSL it
asks PowerShell (System.Drawing) for the clipboard image already scaled and encoded as JPEG, plus the preview;
elsewhere see §8.

### 4.2 Stored by the daemon of the machine that will use it
- `~/.ledge/attachments/<sha256>.<ext>` (`paths.ts`), content-addressed: the same image twice is one file. The id is the
  hex sha256; the extension comes from the checked MIME type (magic bytes, not the client's word). The preview is
  `<sha256>.preview.<ext>`, fetched with the same id.
- *(design call)* Retention: an image stays as long as a session history or a chat history refers to it (histories are
  never pruned, so neither are their images; at ≤ 440 KB each this is small). An image put but never sent is deleted
  after **24 h**. A sweep at daemon start and once a day does this; it reads the histories to know what is referenced.
- Served only by id (`^[0-9a-f]{64}$`), never by path; anything else is `not_found`.

## 5. Protocol (`packages/protocol`)

- `attachment.put { requestId, target, mime, data /* base64 */, preview: { mime, data } }` → `attachment.stored
  { requestId, id, mime, width, height, bytes }` or `attachment.error { requestId, reason: 'too_large' | 'not_image' |
  'unreadable' }`. `target` is the session id (or, for the chat, see below), so the fleet routes the put by it like any
  message with an `id` (`fleet.ts:366-368`).
- `attachment.get { requestId, id, preview?: boolean }` → `attachment.data { requestId, id, mime, data }` or
  `attachment.error`.
- `session.reply` gains `attachments?: string[]` (ids, max 5); `text` may then be empty (`min(1)` relaxed when there is
  at least one attachment). Ids unknown to the daemon → refused with `attachment_missing`, the draft stays.
- `chat.ask` gains `attachments?: string[]`; `ChatTurn` gains `attachments?: AttachmentRef[]`.
- `ThreadItem` `prompt` gains `images?: AttachmentRef[]` where `AttachmentRef = { id, mime, width, height, bytes }`.
- `session.queue.restored` goes from `texts: string[]` to also carrying, per entry, the restored attachment ids
  (`entries: { text, attachments? }[]`, `texts` kept for older clients), plus `imagesDropped?: boolean` (§6.1).
- Size limit enforced by the daemon: 400 KB per image, 40 KB per preview — except §8's 2 MB case.
- Phone protocol (`phone.ts`), mapped by `mobile/gateway.ts` to the local messages:
  - client → daemon: `attachment.put`, `attachment.get`, `attachments` on `session.reply` and `chat.ask`;
  - daemon → client: `attachment.stored`, `attachment.data`, `attachment.error` in `PhoneServerMessageSchema`;
  - `PhoneChatTurnSchema` (strict) gains `attachments`;
  - the phone's thread item `me` (`apps/mobile/src/model/thread.ts`) gains `images?: AttachmentRef[]`, and the
    daemon's `toPhoneItem` (`packages/ledge/src/mobile/project.ts`) copies `images` (it rebuilds items field by field);
  - the phone matches its own sends to thread prompts by text (`model/thread.ts:61`); an image-only send matches by
    its attachment ids instead.
  A put or get is one sealed message (≤ 400 KB → ≤ 875 KB on the wire after padding and base64, under `PLAIN_MAX`).
- **Pace on the phone** *(design call)*: the relay closes a socket over 8 MiB per 10 s and the daemon's phone outbox
  allows 4 MiB per 10 s for all phones. So the phone sends its puts **one at a time**, fetches full images only on tap,
  and fetches previews through one queue (one in flight). Five full images then take a few seconds to upload, which the
  chips' spinners show.
- **Multi-machine chat** *(design call)*: the client cannot know the answering machine (the fleet resolves `chat.route`
  and sends `chat.ask` itself, `fleet.ts:252-264`). So for the chat the client hands the encoded images to the fleet
  with the question; the fleet puts them on the routed machine, then sends `chat.ask` with the ids. Thumbnails of a chat
  turn are fetched from the machine that answered it (the turn knows its machine). With one machine this is the same
  path.

## 6. How each agent receives it

### 6.1 Sessions
- **OMP (`omp-rpc`)**: `prompt` / `follow_up` / `steer` carry `images: [{ type: 'image', data, mimeType }]` read from
  the store (`daemon/omp/host.ts` `send`). Native.
  - Thread: a `prompt` is recorded by Ledge itself (host.ts:153), with `images`. A queued `follow_up`/`steer` enters the
    thread from OMP's `message_start` echo (`omp/project.ts:108-115`), which carries image data, not ids, and is
    matched by text. The host keeps, per session, the ids of what it queued, in order; the echo takes the ids of the
    first pending entry whose text matches — an empty text included, so an image-only queued message still appears.
  - « Reprendre » (`abort_and_restore_queue`): OMP returns `images` per entry and one `imagesDropped` flag. Ledge puts
    back each entry's ids from its own pending list into `session.queue.restored`; the draft comes back with its chips.
    If `imagesDropped`, the draft comes back with a notice that its images were lost.
- **A reply that answers an open dialog** (OMP's `omp.answer(text)`, `server.ts:596`, or a tmux agent's question): it
  takes text only. *(design call)* The daemon refuses a reply with attachments while the session waits on a dialog
  (`attachments_not_accepted`); the clients disable Send with chips present and say « Réponds d'abord à la question,
  l'image partira après ». The chips stay.
- **Claude Code, Codex, Cursor (tmux)**: they cannot be typed an image. The reply text is followed by one bracket per
  image, then flattened as today (`tmux send-keys -l`, so not a terminal paste):
  `… regarde. [Image attached: /home/me/.ledge/attachments/3f…a1.webp]`. *(design call)* Fixed English wording: the
  daemon has no user language, the agent is the reader, and the hook parses one form. Claude Code reads it with Read,
  Codex with `view_image`.
- **The thread for tmux agents**: the `prompt` item comes from the `UserPromptSubmit` hook. `cli/hook.ts` extracts the
  `[Image attached: <attachments dir>/<id>.<ext>]` brackets (the store's own directory only) **before** the
  500-character cut, removes them from the text and passes their ids; the daemon fills `images` from the store's
  metadata. *(design call)* As a fallback, the daemon also remembers the ids of the last reply it typed into each
  session and attaches them to the next `prompt` item from that session within 30 s if the hook found none — this covers
  an agent that rewrites the path before the hook sees it. The first task of the plan checks, in a real Claude Code and
  Codex session, what the hook receives.

### 6.2 Ledge chat
Each question is a one-shot CLI run (`chat/service.ts`). Use each CLI's own image input:
- Claude: `--input-format stream-json` with a user message holding the text and image blocks (the run already uses
  `--output-format stream-json`).
- OMP: `@<path>` arguments (its CLI turns them into image attachments).
- Codex: `codex exec -i <path>` per image.
- Cursor *(design call)*: its run is sandboxed in the chat's context folder (`chat/cursor.ts`), so the images are copied
  into that folder and named in the question with the same bracket as §6.1.
The question's `ChatTurn` keeps the refs, so the chat view and the history show them.

## 7. Showing it

- **Desktop thread** (`session/Thread.tsx`, prompt row): under `prompt-text`, the images in a row, each
  `max-width: 420px; max-height: 260px; object-fit: cover`, rounded, bordered, `cursor: zoom-in`. Fetched (full image)
  with `attachment.get` when the row is in view, cached as object URLs for the page's life.
- **Desktop chat** (`packages/ui/src/chat/ChatView.tsx`): above the question bubble, right-aligned, about 200×130.
- **Desktop enlarged**: an overlay over the whole window (mockup `desktop-enlarged.png`): who and when, size and
  weight; « Copier » (to the clipboard as PNG), « Enregistrer… », Esc or ✕ closes; ←/→ between the images of the same
  message.
- **Phone thread and chat**: above the `me` bubble, 240 px wide, showing the **preview**. Tap: full screen with the full
  image (fetched then), pinch to zoom, swipe down or ✕ to close, « Partager » (Web Share with the file) and
  « Enregistrer ». Previews fetched lazily as they scroll into view, through the queue of §5.
- **TUI** (`tui/model/thread.ts`): one line per image under the prompt text,
  `▣ capture 1440×900 · 212 Ko · o ouvrir dans la visionneuse`; `o` opens the newest image of the visible exchange (each
  further press, the previous one). Opening: fetch with `attachment.get`, write to a temp file, open with the system
  viewer (WSL: `explorer.exe` on the Windows path; Linux `xdg-open`; macOS `open`). Same lines in the TUI's Ask/chat.
- An image with no preview (§8's large case) shows on the phone as « Image trop lourde pour le téléphone · ouvrir sur
  le PC ».

## 8. Composing

- **Desktop** (`session/Reply.tsx`, and the chat field in `packages/ui/src/chat/ChatView.tsx`): Ctrl V with an image in
  the clipboard (`clipboardData.files`) and drag-and-drop onto the field add it; text paste is unchanged. Waiting images
  sit above the text as 96×64 chips with their size and a ✕. Send is enabled with text **or** an image. While
  uploading, the chip shows a spinner and Send waits; a refused image shows the reason under the field.
  The embedded terminal's own Ctrl V (raw byte to Claude Code) is untouched.
- **Phone** (`screens/Reply.tsx`, `ui/chat/Composer.tsx`): a ＋ button left of the field opens the system picker
  (`<input type=file accept=image/* multiple>`: gallery, camera, files); a long-press paste of an image works too.
  72 px chips with ✕ and size. The draft (text) is saved as today; waiting images are not (they are lost on reload).
- **TUI** (`tui/ui/TextInput.tsx`, `screens/Session.tsx`, `screens/Ask.tsx`): **Alt+V** pastes the clipboard image
  (Windows Terminal keeps Ctrl V for its own text paste). Chips `▣ capture 1440×900 ✕` above the `❯` line; Backspace on
  an empty field removes the last one. Footer hints as in the mockup.
  Reading the clipboard: under WSL `powershell.exe` (`System.Windows.Forms.Clipboard.GetImage()`, scaled to 1600 px,
  JPEG 85, plus the preview); Linux `wl-paste --type image/png` or `xclip -selection clipboard -t image/png -o`; macOS
  `osascript` (`the clipboard as «class PNGf»`). Outside WSL the TUI cannot re-encode: it sends the PNG as is with no
  preview. *(design call)* The daemon accepts up to **2 MB** per image on its local socket (it cannot tell the TUI from
  Desktop there, and Desktop always sends ≤ 400 KB anyway); the phone gateway keeps 400 KB. No clipboard image: a short
  notice in the footer.

## 9. Failures

- Upload refused (`too_large`, `not_image`, `unreadable`): the chip turns red with the reason; the message cannot be
  sent until it is removed.
- An attachment id unknown at send time (swept, other machine): the daemon refuses the reply (`attachment_missing`), the
  draft and its chips stay.
- A reply with images while a dialog is open: refused (`attachments_not_accepted`, §6.1).
- `attachment.get` fails in a thread: a grey placeholder with « Image indisponible ».
- An agent that does not support images natively and fails to read the file: nothing Ledge can see; the user sees the
  agent's answer.

## 10. Tests

- Protocol schemas: the new messages, `attachments` max 5, empty text allowed only with attachments, the phone
  schemas (strict ones included).
- Store: content addressing, MIME sniffing, id-only access (path traversal refused), size limits, sweep keeps files a
  history refers to and deletes unsent ones after 24 h.
- Hook: brackets extracted before the cut, removed from the text, only the store's own directory recognised; the
  daemon's 30 s fallback.
- OMP host: `images` in `prompt`/`follow_up`/`steer`; echo matched to pending ids (image-only too); restore keeps ids;
  `imagesDropped`; reply refused while a dialog is open.
- tmux adapters: the bracket line appended then flattened.
- Chat runners: the CLI arguments / stream-json input per tool; Cursor's copy into the context folder; the fleet's put
  after routing.
- Desktop: paste and drop add chips; send with image only; thumbnail fetched and opened; e2e on the fake daemon.
- Phone: picker → shrink → put (one at a time) → reply; preview in the thread, full image on tap; gateway mapping;
  `toPhoneItem` keeps `images`; a put fits `PLAIN_MAX`.
- TUI: Alt+V with a stubbed clipboard reader; chips; the thread line; `o` calls the opener.

## 11. Left to the builder

- Exact component split, file names, i18n keys (French and English), CSS.
- Caching strategy on each client, beyond « fetch once per page life ».
- The sweep's exact schedule.
- The exact shape of the fleet's chat hand-off (§5), as long as the client never needs to know the routed machine.

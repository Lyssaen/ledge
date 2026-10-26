# Image paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A screenshot can be pasted into a session reply and into the Ledge chat from Desktop, the phone and the TUI; the agent receives it (natively or as a file path), and every thread shows it as a thumbnail that opens full size.

**Architecture:** Clients shrink and encode images themselves (≤ 1600 px, ≤ 400 KB, plus a ≤ 40 KB preview) and store them on the daemon of the session's machine (`attachment.put`, content-addressed under `~/.ledge/attachments`). Replies and chat questions carry attachment ids; the daemon hands them to OMP natively, to tmux agents as `[Image attached: <path>]` text, and to the chat CLIs through their own image flags. Thread prompt items and chat turns carry `AttachmentRef`s; clients fetch the bytes with `attachment.get`.

**Tech Stack:** TypeScript (ESM), zod, vitest, React (desktop, overlay, mobile PWA), Ink (TUI), Playwright (desktop e2e), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-26-image-paste-design.md`

## Global Constraints

- Image: long side ≤ **1600 px**, encoded ≤ **400 000 bytes** (`ATTACHMENT_MAX`); preview long side **480 px**, ≤ **40 000 bytes** (`PREVIEW_MAX`); **5** images per message (`ATTACHMENTS_MAX`). Daemon local socket accepts up to **2 000 000 bytes** (`ATTACHMENT_LOCAL_MAX`); the phone gateway keeps 400 000.
- Accepted input types: PNG, GIF, JPEG, WebP. Stored types are sniffed from magic bytes, never taken from the client.
- Attachment id: lowercase hex sha256, `^[0-9a-f]{64}$`. The daemon serves files by id only.
- Unsent images are deleted after **24 h**; images a session history or a live chat turn refers to are kept.
- Bracket text typed into tmux agents, exactly: `[Image attached: <absolute path>]`, one per image, after the reply text, separated by single spaces.
- The phone sends puts one at a time and fetches previews through a single queue (one request in flight); full images only on tap.
- User-facing French strings exactly as written in this plan, `vous` register everywhere (Desktop, phone, TUI, island). Desktop/island/TUI also get English strings. Code, comments, commits in English.
- Tests: vitest, run from the package dir with `pnpm vitest run <file>`; full gate from the repo root: `pnpm -r typecheck && pnpm test`. Desktop e2e: `pnpm --filter @ledge/desktop exec playwright test <spec>`.
- Work only in the worktree `.claude/worktrees/feat+image-paste` on branch `feat/image-paste`; never mutate the shared `main` checkout.

## Decisions made while planning (left to the builder by the spec)

- **Chat images travel inline.** Local `chat.ask` carries `images: ImageUpload[]` (5 × ~590 KB base64 fits the 4 MiB frame); the daemon stores them on receipt. The fleet keeps them on its `PendingRoute` and sends them with the `chat.ask` to the routed machine, so no client ever needs the machine before routing. The phone (one daemon, 640 KiB per message) instead puts each image first and sends `attachments: string[]` ids with its `chat.ask`.
- **Routing a put/get.** `attachment.put`/`attachment.get` carry the optional session `id` (qualified by the fleet, routed by the existing `'id' in msg` branch) or, for a chat turn's image, `machine` (`ChatTurn.machineId`). Neither → local machine. The fleet registers each `requestId` → machine and only emits the answer from that machine, like `document.read`.
- **Empty text is checked by the daemon, not the schema.** `session.reply.text` and `chat.ask.text` become `z.string()` (no `min(1)`); the daemon refuses empty text without images with the existing `'invalid'` code. Zod discriminated unions cannot hold refined members.
- **`AttachmentRef` carries `preview: boolean`**, so a client knows when no preview exists (TUI on Linux/macOS) and shows the « trop lourde » note on the phone.
- **The store keeps an in-memory index** (`<id>.json` meta files loaded at start), so `History` can turn ids into refs synchronously.
- **OMP frame budget.** OMP's RPC frame is 1 MiB for what Ledge sends too (`omp/rpc.ts:132`). Images go natively while the serialized command stays ≤ 1 MiB; the rest are appended as bracket text (OMP can read files). Task 0 checks whether OMP accepts larger inbound frames; if it does, raise the budget to that limit.
- **Shared browser pieces live in `@ledge/ui`** (desktop, island and phone all depend on it): `encodeImage`, `ImageThumb`, `AttachmentChips`, `Lightbox`. Byte fetching lives in `@ledge/fleet` (`putImage`, `getImage`, `useImageUrl`) for desktop, island and TUI; the phone has its own (sealed link).
- **TUI opening keys.** `o` in the session's read mode; **Alt+O** in Ask (its field always has focus, so a bare `o` is typed text).
- **Desktop « Enregistrer… »** uses an `<a download>` on the blob URL (no dialog plugin in the app); a manual check in the real Tauri app is part of Task 12.

## Review Focus

1. **A refused or failed upload never sends a half message:** Send stays disabled while a chip is uploading or red; the reply is not sent without its images → Task 11 (desktop) and Task 13 (phone) tests.
2. **A reply with images while the session waits on a dialog** is refused (`attachments_not_accepted`) for both OMP and tmux agents, and the text plus chips stay in the composer → Task 4 test, Task 11 test.
3. **A long message (> 500 chars) with images** still shows its images in the thread: brackets are extracted before the cut → Task 5 test.
4. **Image-only messages** (empty text) appear in every thread: OMP queued echo with empty text, phone own-op matching by ids → Task 6 and Task 13 tests.
5. **Path traversal / foreign ids:** `attachment.get` with `../`, an uppercase or short id, or a hex id not in the store returns `not_found`; a bracket naming a path outside the store directory is left as plain text → Task 2 and Task 5 tests.

---

### Task 0: Spike — what the agents and CLIs accept (manual, gate)

**Files:** none in the repo (scratchpad only). Record findings at the top of this plan under « Spike results » and commit that edit.

- [ ] **Step 1: Claude chat.** In a scratch dir with a 1440×900 PNG `shot.png`, run `claude -p --input-format stream-json --output-format stream-json --verbose --tools Read` with stdin one line `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"What colour dominates this image? One word."},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"<base64>"}}]}}`. Expected: an answer naming the colour. If it fails, Task 7 uses the fallback noted there.
- [ ] **Step 2: OMP chat.** `echo "What colour dominates this image?" | omp -p --mode json --no-session @/abs/path/shot.png` (also try `@` arg before `-p`). Record the working argv position. Expected: answer naming the colour.
- [ ] **Step 3: Codex chat.** `echo "What colour dominates this image?" | codex exec --sandbox read-only --json --skip-git-repo-check -i /abs/path/shot.png -`, then the same with `exec resume <id> ... -i`. Record whether `resume` accepts `-i`.
- [ ] **Step 4: OMP RPC inbound limit.** Read the installed OMP's RPC reader (`$(dirname $(readlink -f $(which omp)))`, search for the max frame / `rpc_chunk` handling on input). Record the inbound limit in bytes.
- [ ] **Step 5: Hook text for tmux agents.** On a private tmux socket (`tmux -L ledge-spike`), start Claude Code in a scratch project, type with `tmux send-keys -l -- 'look [Image attached: /abs/path/shot.png]'` then Enter, with a `UserPromptSubmit` hook that appends its stdin to a scratch file. Repeat with Codex. Record the exact `prompt` the hook received for each (path intact, or rewritten to `[Image #1]`). Kill the tmux server afterwards.
- [ ] **Step 6:** If Step 5 shows the path rewritten, Task 5's fallback (Task 4 Step 5) is the primary mechanism for that agent; note it. No other task changes.

---

### Task 1: Protocol — attachments module and message changes

**Files:**
- Create: `packages/protocol/src/attachments.ts`
- Modify: `packages/protocol/src/index.ts` (export), `packages/protocol/src/messages.ts` (`:23` RefusalCode, `:26-45` SessionEvent, `:104` queue.restored, `:91-152` server union, `:163-266` client union, `:193` session.reply, `:232` chat.ask), `packages/protocol/src/thread.ts:16`, `packages/protocol/src/chat.ts:79`, `packages/protocol/src/phone.ts` (`:180-186`, `:203-249`, `:253-286`)
- Test: `packages/protocol/test/attachments.test.ts`, `packages/protocol/test/messages.test.ts`, `packages/protocol/test/phone.test.ts`

**Interfaces:**
- Produces (`attachments.ts`):
  - `ATTACHMENT_ID = /^[0-9a-f]{64}$/`, `AttachmentIdSchema`
  - `IMAGE_MIMES = ['image/webp','image/jpeg','image/png','image/gif'] as const`, `ImageMimeSchema`, `type ImageMime`
  - `ATTACHMENT_MAX = 400_000`, `ATTACHMENT_LOCAL_MAX = 2_000_000`, `PREVIEW_MAX = 40_000`, `ATTACHMENTS_MAX = 5`, `IMAGE_LONG_SIDE = 1600`, `PREVIEW_LONG_SIDE = 480`
  - `b64Max(bytes: number): number` = `Math.ceil(bytes / 3) * 4`
  - `AttachmentRefSchema = z.object({ id: AttachmentIdSchema, mime: ImageMimeSchema, width: int().positive(), height: int().positive(), bytes: int().positive(), preview: z.boolean() })`, `type AttachmentRef`
  - `ImageUploadSchema = z.object({ mime: ImageMimeSchema, data: z.string().min(1).max(b64Max(ATTACHMENT_LOCAL_MAX)), preview: z.object({ mime: ImageMimeSchema, data: z.string().min(1).max(b64Max(PREVIEW_MAX)) }).optional() })`, `type ImageUpload`
  - `AttachmentErrorReasonSchema = z.enum(['too_large','not_image','unreadable','not_found','offline'])` (`offline` is only emitted by the fleet when the target machine is not connected)`
  - Client: `AttachmentPutSchema { type:'attachment.put', requestId: min1.max100, id?: string, image: ImageUploadSchema }`; `AttachmentGetSchema { type:'attachment.get', requestId, attachment: AttachmentIdSchema, preview?: boolean, id?: string, machine?: string }`
  - Server: `AttachmentStoredSchema { type:'attachment.stored', requestId, ref }`; `AttachmentDataSchema { type:'attachment.data', requestId, attachment, mime, data: string }`; `AttachmentErrorSchema { type:'attachment.error', requestId, reason }`
- Produces (changes):
  - `RefusalCodeSchema` += `'attachment_missing'`, `'attachments_not_accepted'`
  - `SessionEventSchema` += `attachments: z.array(AttachmentIdSchema).max(ATTACHMENTS_MAX).optional()`
  - client `session.reply`: `text: z.string()`, `attachments: z.array(AttachmentIdSchema).max(ATTACHMENTS_MAX).optional()`
  - client `chat.ask`: `text: z.string()`, `images: z.array(ImageUploadSchema).max(ATTACHMENTS_MAX).optional()`
  - `session.queue.restored` += `entries: z.array(z.object({ text: z.string(), attachments: z.array(AttachmentIdSchema).optional() })).optional()`, `imagesDropped: z.boolean().optional()`
  - thread `prompt` += `images: z.array(AttachmentRefSchema).optional()`; `ChatTurnSchema` += `attachments: z.array(AttachmentRefSchema).optional()`
  - phone client: `attachment.put { requestId, image }` whose `image.data` max is `b64Max(ATTACHMENT_MAX)` (no `id`), `attachment.get { requestId, attachment, preview? }`; `session.reply.text` → `z.string().max(MESSAGE_MAX)` + `attachments?`; `chat.ask.text` → `z.string().trim().max(MESSAGE_MAX)` + `attachments?`
  - phone server: the three `attachment.*` server schemas; `PhoneChatTurnSchema` += `attachments: z.array(AttachmentRefSchema).max(ATTACHMENTS_MAX).optional()`

- [ ] **Step 1: Write failing tests** — `attachments.test.ts`: `parseClientMessage` accepts a put with a 64-hex-free upload and rejects `image.mime: 'image/bmp'`; `attachment.get` rejects `attachment: 'ABC'`, `'../x'` and a 63-char hex; `AttachmentRefSchema` round-trips `{ id: 'a'.repeat(64), mime:'image/webp', width:1440, height:900, bytes:212_000, preview:true }`. `messages.test.ts`: `session.reply` with `text:''` and one id parses; with 6 ids throws; `chat.ask` with `images` parses; queue.restored with `entries` parses. `phone.test.ts`: phone put with `data` longer than `b64Max(400_000)` throws; `PhoneChatTurnSchema` (strict) accepts `attachments`; `padPlain(JSON.stringify(<phone put of 400 000 bytes + 40 000 preview>))` is not null.
- [ ] **Step 2:** Run `pnpm vitest run test/attachments.test.ts test/messages.test.ts test/phone.test.ts` in `packages/protocol`. Expected: FAIL.
- [ ] **Step 3:** Implement the schemas above and add them to the unions.
- [ ] **Step 4:** Re-run. Expected: PASS. Then `pnpm -r typecheck` from the root; fix every caller that relied on `text.min(1)` typing only if it fails to compile (behaviour comes in later tasks).
- [ ] **Step 5: Commit** — `feat(protocol): attachment messages, refs on prompts and chat turns`

---

### Task 2: Daemon store — image sniffing and the attachments directory

**Files:**
- Create: `packages/ledge/src/imageInfo.ts`, `packages/ledge/src/daemon/attachments.ts`
- Modify: `packages/ledge/src/paths.ts:21-24` (add `attachments: join(dir, 'attachments')`)
- Test: `packages/ledge/test/image-info.test.ts`, `packages/ledge/test/attachments.test.ts`

**Interfaces:**
- Produces:
  - `imageInfo(buf: Buffer): { mime: ImageMime; width: number; height: number } | null` — PNG (IHDR), GIF (logical screen), JPEG (first SOF0–SOF15 marker except C4/C8/CC), WebP (`VP8 `, `VP8L`, `VP8X`).
  - `class AttachmentError extends Error { constructor(readonly reason: 'too_large'|'not_image'|'unreadable'|'not_found') }`
  - `class AttachmentStore { constructor(dir: string, now?: () => number); load(): Promise<void>; put(image: Buffer, preview: Buffer | undefined, max: number): Promise<AttachmentRef>; ref(id: string): AttachmentRef | null; path(id: string): string | null; read(id: string, preview?: boolean): Promise<{ mime: ImageMime; data: Buffer } | null>; sweep(referenced: ReadonlySet<string>): Promise<string[]> }`
  - Layout: `<dir>/<id>.<ext>`, `<dir>/<id>.preview.<ext>`, `<dir>/<id>.json` (the ref). `ext` from mime: `webp|jpg|png|gif`.

- [ ] **Step 1: Write failing tests** — `image-info.test.ts`: hand-built headers give `{ mime:'image/png', width:1440, height:900 }`, same for a JPEG with an APP0 segment before SOF0, a GIF, and the three WebP variants; `Buffer.from('%PDF-1.4')` → null; a truncated PNG (20 bytes) → null.
  `attachments.test.ts` (temp dir): `put` returns `id` = sha256 hex of the bytes, `bytes` = length, `preview:true` when a preview is given; the same bytes twice → one `<id>.*` set and the second put refreshes the mtime; `put(buf, undefined, 10)` throws reason `too_large`; a PDF throws `not_image`; a preview over `PREVIEW_MAX` or not an image throws `not_image`/`too_large`; `ref`/`path`/`read` return null for `'../etc/passwd'`, `'A'.repeat(64)` and an unknown 64-hex id; `read(id, true)` on an image without preview → null; a new store on the same dir after `load()` returns the same `ref(id)`; `sweep(new Set())` with `now` 25 h after the put deletes all three files and returns the id, `sweep(new Set([id]))` keeps them, and a put 23 h old is kept.
- [ ] **Step 2:** Run both files in `packages/ledge`. Expected: FAIL.
- [ ] **Step 3:** Implement. `put` validates the preview with `imageInfo` too and writes files atomically (temp + rename). Sweep age is from the image file's mtime.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ledge): content-addressed image store`

---

### Task 3: Daemon messages — put, get, chat.ask images, sweep

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts` (construct `AttachmentStore(paths().attachments)` and `load()` at start; new `case 'attachment.put'` / `'attachment.get'`; `case 'chat.ask'` :1208; sweep at start and every 24 h, `unref`'d), `packages/ledge/src/daemon/history.ts` (add `attachmentIds(): Promise<Set<string>>` reading every `<dir>/*.jsonl` and collecting prompt `images[].id`), `packages/ledge/src/chat/service.ts` (`ask` signature, `attachmentIds()`), `packages/ledge/src/chat/threads.ts` (union of desktop + device services' `attachmentIds()`)
- Test: `packages/ledge/test/server-attachments.test.ts`, `packages/ledge/test/history.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas, Task 2 `AttachmentStore`.
- Produces:
  - `ChatService.ask(qid: string, text: string, emit: (m: ChatMessage) => void, tool?: Tool, images?: AttachmentRef[]): Promise<void>` — sets `turn.attachments` when non-empty; `ChatService.attachmentIds(): string[]`.
  - Server option `attachments?: AttachmentStore` (tests inject one on a temp dir); exposed to later tasks as the server-local `attachments`.

- [ ] **Step 1: Write failing tests** (server spun up as in `server.test.ts:55-61`) — `attachment.put` with a base64 PNG answers `attachment.stored` with the same `requestId` and the ref; with a 2 000 001-byte payload answers `attachment.error { reason:'too_large' }`; `attachment.get` of that id answers `attachment.data` whose `data` decodes to the same bytes; `preview:true` without preview → `attachment.error { reason:'not_found' }`; `chat.ask` with `text:''` and no images → `error { request:'chat.ask', code:'invalid' }`; `chat.ask` with one image → the emitted `chat.history` turn has `attachments[0].id` = sha256 of the image; `chat.ask` with a non-image → `error { request:'chat.ask', code:'invalid' }` and no turn. `history.test.ts`: `attachmentIds()` finds an id written in a prompt item of a previous History instance's file.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `chat.ask` stores each image with `ATTACHMENT_LOCAL_MAX` before calling `chat.ask(..., refs)`; any `AttachmentError` → `refuse` with code `'invalid'` and message `image refused: <reason>`. The sweep's referenced set = `history.attachmentIds()` ∪ chat threads' `attachmentIds()`.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ledge): attachment.put/get and chat images in the daemon`

---

### Task 4: Session replies with images — tmux agents, refusals, fallback

**Files:**
- Create: `packages/ledge/src/attachmentText.ts`
- Modify: `packages/ledge/src/daemon/server.ts` (`case 'session.reply'` :1029, `replyTo` :575-590, `replyOmp` :596-604, `case 'session.event'` :965-998)
- Test: `packages/ledge/test/attachment-text.test.ts`, `packages/ledge/test/server-attachments.test.ts`

**Interfaces:**
- Produces (`attachmentText.ts`, pure, no heavy imports — the hook uses it):
  - `imageBracket(path: string): string` → `` `[Image attached: ${path}]` ``
  - `withImages(text: string, paths: string[]): string` → text and brackets joined by single spaces, trimmed
  - `takeImages(text: string, dir: string): { text: string; ids: string[] }` — removes brackets whose path is `<dir>/<64 hex>.<webp|jpg|png|gif>`, returns their ids in order and the text with them removed (spaces collapsed, trimmed); any other bracket stays in the text.
- Produces (server): `replyTo(id: string, text: string, how?: { steer?: boolean; attachments?: string[] }): Promise<Refusal | null>`; OMP call becomes `omp.send(s.id, text, mode, refs)` (Task 6 implements the parameter).

- [ ] **Step 1: Write failing tests** — `attachment-text.test.ts`: `withImages('regarde', ['/h/.ledge/attachments/<id>.webp'])` = `'regarde [Image attached: /h/.ledge/attachments/<id>.webp]'`; `withImages('', [p])` = `'[Image attached: p]'`; `takeImages` round-trips that, keeps `[Image attached: /tmp/x.png]` and `[Image attached: /h/.ledge/attachments/../x.webp]` as text.
  Server (fake tmux records `sent`): reply `{ text:'regarde', attachments:[id] }` to an idle Claude session → typed text equals `withImages('regarde', [store.path(id)])`; unknown id → `error { code:'attachment_missing' }` and nothing typed; Claude session with `pending.kind:'question'` and an attachment → `error { code:'attachments_not_accepted' }`; `{ text:'', attachments: [] }` → `'invalid'` (unchanged message `empty reply`); OMP session with pending + attachment → `attachments_not_accepted` and `omp.answer` not called. Fallback: after that successful Claude reply, a `session.event` `UserPromptSubmit` without `attachments` within 30 s gets `images` on the recorded prompt item; a second prompt event after that does not; one after 30 s (fake clock) does not.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement in this order inside `replyTo`: unknown/readOnly/closing checks (unchanged) → resolve every id with `attachments.ref` (missing → `Refusal('attachment missing', 'attachment_missing')`) → if any attachment and `s.pending` → `Refusal('reply with images while a dialog is open', 'attachments_not_accepted')` → OMP branch → existing checks with `text` replaced by `withImages(text, paths)` for tmux agents. Keep `typed: Map<sessionId, { ids: string[]; at: number }>` set after a successful inject; in `session.event`, an event with `attachments` clears the entry, one without takes it when `now - at ≤ 30_000`.
- [ ] **Step 4:** Re-run, plus `pnpm vitest run test/server.test.ts test/omp-server.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ledge): session replies carry images to tmux agents`

---

### Task 5: Hook and history — images on prompt items

**Files:**
- Modify: `packages/ledge/src/cli/hook.ts:24-28` (`promptText`), `:188`, `:323`; `packages/ledge/src/daemon/history.ts:110-160` (`record`), constructor gains a `refOf: (id: string) => AttachmentRef | null` (server passes `id => attachments.ref(id)`)
- Test: `packages/ledge/test/hook.test.ts`, `packages/ledge/test/history.test.ts`

**Interfaces:**
- Consumes: `takeImages` (Task 4), `paths().attachments`.
- Produces: hook `UserPromptSubmit` events carry `attachments?: string[]`; `prompt` items carry `images?: AttachmentRef[]` (unknown ids dropped).

- [ ] **Step 1: Write failing tests** — `hook.test.ts` (next to `:728` « cut to 500 characters »): a 700-char prompt ending with two brackets for the store dir maps to `text` = first 500 chars of the prompt without the brackets and `attachments` = both ids; a bracket for `/tmp/x.png` stays in `text` and gives no `attachments`; the Cursor `beforeSubmitPrompt` path does the same. `history.test.ts`: `record` of a `UserPromptSubmit` with `attachments:[id]` whose `refOf` knows it gives a prompt item with `images:[ref]`; an unknown id is dropped; no `attachments` → no `images` key.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** `promptText` calls `takeImages(t, paths().attachments)` before slicing.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ledge): the thread shows images sent to tmux agents`

---

### Task 6: OMP — native images, queued echo, restore

**Files:**
- Modify: `packages/ledge/src/daemon/omp/host.ts` (`send` :151-161, `interruptAndRestore` :164-168), `packages/ledge/src/daemon/omp/project.ts` (`Tracking` :21, `newTracking` :31, `message_start` :108-116), `packages/ledge/src/daemon/server.ts` (`case 'session.interrupt'` :1047), `packages/ledge/test/fake-omp.mjs` (log `images`; `abort_and_restore_queue` returns `images` per entry and `imagesDropped` when the env `FAKE_OMP_DROP_IMAGES=1`)
- Test: `packages/ledge/test/omp-host.test.ts`, `packages/ledge/test/omp-project.test.ts` (create if absent, else the existing projection test file), `packages/ledge/test/omp-server.test.ts`

**Interfaces:**
- Consumes: `AttachmentStore.read` (host gets the store in its options: `createOmpHost({ ..., attachments })`), `withImages`.
- Produces:
  - `send(id: string, text: string, mode?: 'prompt'|'follow_up'|'steer', images?: AttachmentRef[]): Promise<void>`
  - `Tracking.queued: Array<{ text: string; attachments: string[] }>`
  - `interruptAndRestore(id: string): Promise<{ entries: Array<{ text: string; attachments: string[] }>; imagesDropped: boolean }>`; the server replies `session.queue.restored { id, texts: entries.map(e => e.text), entries, imagesDropped? }`.

- [ ] **Step 1: Write failing tests** — host: `send(id, 'look', 'prompt', [ref])` logs a `prompt` command with `images:[{ type:'image', data:<base64 of file>, mimeType: ref.mime }]` and the recorded prompt item has `images:[ref]`; with 5 refs of 400 000 bytes the command line is ≤ 1 MiB (or Task 0's limit) and the overflow images appear as brackets at the end of `message`; `follow_up` with `text:''` and one image → after the fake's `message_start` echo (empty text, image content) the thread has a prompt item with `images:[ref]`; `interruptAndRestore` after queuing `'a'`+img and `'b'` returns `entries [{text:'a', attachments:[id]}, {text:'b', attachments:[]}]`; with `FAKE_OMP_DROP_IMAGES=1` → `imagesDropped: true`. Projection: `message_start` with empty text and no queued entry → `[]` (unchanged); with a matching queued entry → one `UserPromptSubmit` with `attachments`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `prompt` mode keeps `echo.push(text.trim())` and applies `UserPromptSubmit { text, attachments }`; `follow_up`/`steer` push to `queued`; `message_start` takes the first `queued` entry whose `text` equals the trimmed text (empty included) and emits with its `attachments`, else falls back to today's `echo` logic. Restore pairs OMP's returned entries with `queued` in order by text.
- [ ] **Step 4:** Re-run with `test/omp-server.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ledge): OMP receives images natively`

---

### Task 7: Chat runners — images per CLI

**Files:**
- Modify: `packages/ledge/src/chat/claude.ts` (`RunOptions` :10-17, `claudeArgs` :20-23), `packages/ledge/src/chat/omp.ts` (`ompChatArgs` :11-15), `packages/ledge/src/chat/codex.ts` (`codexArgs` :6-9), `packages/ledge/src/chat/cursor.ts` (`cursorArgs`, `runCursor`), `packages/ledge/src/chat/run.ts:5-25` (`runJsonl` takes `stdin?: string`, default `o.question`), `packages/ledge/src/chat/service.ts:256` (pass `images`), `packages/ledge/test/fake-claude.mjs` (record argv and stdin to `FAKE_LOG` when set)
- Test: `packages/ledge/test/chat-claude.test.ts`, `chat-omp.test.ts`, `chat-codex.test.ts`, `chat-cursor.test.ts`, `chat-service.test.ts`

**Interfaces:**
- Consumes: `ChatService.ask(..., images)` (Task 3), `AttachmentStore.path`.
- Produces: `RunOptions.images?: Array<{ path: string; mime: ImageMime }>`; `claudeInput(question: string, images: Array<{ path; mime }>): string` (one JSON line + `\n`).

- [ ] **Step 1: Write failing tests** — Claude: with images, `claudeArgs` contains `--input-format stream-json` and `claudeInput` parses to `{ type:'user', message:{ role:'user', content:[{type:'text', text:q}, {type:'image', source:{type:'base64', media_type:'image/png', data:<base64>}}] } }`; without images argv is unchanged. OMP: `@<path>` per image at the position Task 0 Step 2 recorded. Codex: `-i <path>` per image before the final `-` (and on `resume` only if Task 0 Step 3 said so, otherwise the resume run starts fresh when images are present). Cursor: each image is copied into `cwd` as `image-1.<ext>`… and stdin ends with `withImages(question, [<cwd>/image-1.<ext>, …])`. Service: a `chat.ask` with one image reaches the fake with the expected argv/stdin for each tool.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. **If Task 0 Step 1 failed**, Claude instead gets `--add-dir <attachments dir>` and the question `withImages(question, paths)`; write the test for that variant instead.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ledge): the Ledge chat passes images to each CLI`

---

### Task 8: Phone gateway and projection

**Files:**
- Modify: `packages/ledge/src/mobile/gateway.ts` (`precheck` :244-251, `local` :264-271, read path :476 + `chat.ask` :457-460, new `attachment.put`/`attachment.get` read cases), `packages/ledge/src/mobile/project.ts:78-80` (`toPhoneItem` prompt), `packages/ledge/src/mobile/chat.ts:23` (`toPhoneTurn` copies `attachments`)
- Test: `packages/ledge/test/mobile-gateway.test.ts`, `packages/ledge/test/mobile-project.test.ts`

**Interfaces:**
- Consumes: gateway deps gain `attachments: AttachmentStore`.
- Produces: phone `attachment.put` stores with `ATTACHMENT_MAX` (400 000) and answers `attachment.stored`/`attachment.error`; `attachment.get` answers `attachment.data`/`attachment.error`; `session.reply` maps to `{ type:'session.reply', id, text, attachments? }`; phone `chat.ask` resolves ids to refs (missing → `chat.error` code `'failed'`) and calls `ask(qid, text, emit, tool, refs)`.

- [ ] **Step 1: Write failing tests** — gateway: a 400 001-byte phone put → `attachment.error { reason:'too_large' }`; a 400 000-byte put + 40 000 preview → `attachment.stored`, and the emitted frame passes `padPlain`; `session.reply { text:'', attachments:[id] }` dispatches `{ type:'session.reply', id:'b', text:'', attachments:[id] }`; `{ text:'' }` without attachments → `operation.result rejected 'invalid'` and nothing dispatched; a daemon refusal `attachments_not_accepted` → `rejected` with that reason. Project: a prompt item with `images` keeps them through `toPhoneItem`; a chat turn keeps `attachments` through `toPhoneTurn`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run with `test/mobile-outbox.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ledge): phone gateway carries images`

---

### Task 9: Fleet — routing, chat hand-off, reply ids, client helpers

**Files:**
- Create: `packages/fleet/src/attachments.ts`
- Modify: `packages/fleet/src/fleet.ts` (`send` :335-425, `chat.ask` :340-351, `PendingRoute` :12, `chat.routed` :251-265, answer acceptance near :240-250), `packages/fleet/src/decisions.ts` (`reply` :31, :166-168), `packages/fleet/src/index.ts` (export)
- Test: `packages/fleet/test/fleet.test.ts`, `packages/fleet/test/attachments.test.ts`, `packages/fleet/test/decisions.test.ts` (or the existing decisions test file)

**Interfaces:**
- Produces:
  - `class AttachmentFailure extends Error { constructor(readonly reason: AttachmentErrorReason | 'timeout') }`
  - `putImage(client: DaemonClient, image: ImageUpload, route?: { id?: string }, timeoutMs = 20_000): Promise<AttachmentRef>`
  - `getImage(client: DaemonClient, attachment: string, route?: { id?: string; machine?: string }, preview = false, timeoutMs = 20_000): Promise<{ mime: ImageMime; data: string }>`
  - `useImageUrl(client: DaemonClient, ref: AttachmentRef | undefined, route?: { id?: string; machine?: string }, preview = false): { url: string | null; failed: boolean }` — module-level cache `Map<string, Promise<string>>` of object URLs keyed `${route.machine ?? route.id ?? ''}|${ref.id}|${preview}`; failed fetches are not cached.
  - `Decisions.reply(s, text, onRefused?, how?: { steer?: boolean; attachments?: string[] })`
  - `ChatTurn` local optimistic turns: unchanged.

- [ ] **Step 1: Write failing tests** — fleet with `[LOCAL_MACHINE, remote]`: `attachment.put { id:'remote:s1' }` goes to the remote with `id:'s1'`, its `attachment.stored` is emitted, the same answer from local with that `requestId` is not; `attachment.get { machine:'remote' }` goes to the remote without the `machine` field; no route → local; a put/get whose target machine is not connected → the fleet emits `{ type:'attachment.error', requestId, reason:'offline' }` without sending anything. `chat.ask` with `images` and two machines: `chat.route` has no `images`; after `chat.routed` to the remote, the remote receives `chat.ask` with the same `images`. Decisions: `reply(s, '', undefined, { attachments:[id] })` sends `{ type:'session.reply', id, text:'', attachments:[id] }`; `attachments: []` omits the field. Helpers (fake client): `putImage` resolves on the matching `attachment.stored`, rejects `AttachmentFailure('too_large')` on the matching error, `'timeout'` after `timeoutMs`.
- [ ] **Step 2:** Run in `packages/fleet`. Expected: FAIL.
- [ ] **Step 3:** Implement. `fleet.ts` keeps `attachmentAsks: Map<requestId, machineId>` set in `send` before forwarding and cleared on the answer.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(fleet): route attachments and carry chat images`

---

### Task 10: Shared browser pieces — encoder, chips, thumbnail, lightbox

**Files:**
- Create: `packages/ui/src/images/encode.ts`, `packages/ui/src/images/AttachmentChips.tsx`, `packages/ui/src/images/ImageThumb.tsx`, `packages/ui/src/images/Lightbox.tsx`, `packages/ui/src/images/index.ts`
- Modify: `packages/ui/src/index.ts` (export)
- Test: `packages/ui/test/images-encode.test.ts`, `packages/ui/test/images-ui.test.tsx`

**Interfaces:**
- Produces:
  - `type EncodeFailure = 'notImage' | 'tooLarge' | 'unreadable'`
  - `interface Encoded { image: ImageUpload; width: number; height: number; bytes: number }`
  - `encodeImage(file: Blob, codec?: Codec): Promise<{ ok: true; value: Encoded } | { ok: false; reason: EncodeFailure }>` where `interface Codec { decode(b: Blob): Promise<{ width: number; height: number; draw(w: number, h: number): Promise<{ encode(mime: 'image/webp'|'image/jpeg', q: number): Promise<Blob> }> }> }`; the default codec uses `createImageBitmap` + canvas like `apps/desktop/src/shell/avatar.ts:41-53`; `setCodecForTests(c: Codec | null)`.
  - `formatBytes(n: number, lang: 'fr' | 'en'): string` → `'212 Ko'` / `'212 KB'` (÷1000, rounded; ≥ 1 000 000 → one decimal `'1,4 Mo'` / `'1.4 MB'`)
  - `interface ChipItem { key: string; url: string; width: number; height: number; bytes: number; state: 'uploading' | 'ready' | 'refused'; reason?: string }`
  - `AttachmentChips({ items, onRemove, size, removeLabel, lang }: { items: ChipItem[]; onRemove(key: string): void; size: { w: number; h: number }; removeLabel: string; lang: 'fr'|'en' })` — size: desktop `{ w:96, h:64 }`, phone `{ w:72, h:72 }`; a refused chip's reason is also shown under the field by the caller
  - `ImageThumb({ url, failed, width, height, maxW, maxH, alt, unavailable, onOpen }: { url: string | null; failed: boolean; width: number; height: number; maxW: number; maxH: number; alt: string; unavailable: string; onOpen(): void })`
  - `Lightbox({ images, index, onIndex, onClose, title, actions, closeLabel }: { images: Array<{ url: string | null; meta: string }>; index: number; onIndex(i: number): void; onClose(): void; title: string; actions?: ReactNode; closeLabel: string })` — full-window overlay, `role="dialog"` `aria-modal`, Esc and ✕ close, ←/→ move within `images`, focus moved in and restored.

- [ ] **Step 1: Write failing tests** — encode (fake codec): a 3000×2000 input is drawn at 1600×1067 and encoded `image/webp` q 0.85; when the codec returns a JPEG blob for WebP the upload's mime is `image/jpeg`; a codec whose first two encodes exceed 400 000 bytes yields the third quality step (0.85 → 0.7 → 0.55 → 0.4, then long side × 0.8 down to 640 px); never under 400 000 → `{ ok:false, reason:'tooLarge' }`; preview drawn at 480 long side q 0.7, omitted if still > 40 000 at q 0.5; `text/plain` blob → `notImage`; decode throws → `unreadable`; input over 25 000 000 bytes → `tooLarge` without decoding. `formatBytes(212_345,'fr')` = `'212 Ko'`, `(1_400_000,'en')` = `'1.4 MB'`. UI: chips render a spinner for `uploading`, the reason for `refused`, call `onRemove(key)` from the button labelled `removeLabel`; `ImageThumb` with `failed` shows `unavailable`; Lightbox closes on Escape, ArrowRight calls `onIndex(1)`.
- [ ] **Step 2:** Run in `packages/ui`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ui): image encoder, chips, thumbnail and lightbox`

---

### Task 11: Desktop — composing (session reply and chat)

**Files:**
- Create: `apps/desktop/src/images/useAttachments.ts`
- Modify: `apps/desktop/src/session/Reply.tsx` (form :206, textarea :207-208, `submit` :108-112, `steer` :104-107, `session.queue.restored` handler :62-67), `packages/ui/src/chat/ChatView.tsx` (props :24-68, `submit` :129, input :245-254), `packages/ui/src/chat/copy.tsx` (ChatCopy keys), `apps/desktop/src/chat/ChatPanel.tsx:67-72`, `apps/desktop/src/chat/LedgeHome.tsx:275-281`, `apps/desktop/src/i18n/fr.ts`, `apps/desktop/src/i18n/en.ts`, `packages/ui/test/chat-copy-fixture.ts`
- Test: `apps/desktop/test/session-reply-images.test.tsx`, `packages/ui/test/chat-attach.test.tsx`

**Interfaces:**
- Consumes: `encodeImage`, `AttachmentChips`, `ChipItem` (Task 10); `putImage`, `Decisions.reply(..., { attachments })` (Task 9).
- Produces:
  - `useAttachments(client: DaemonClient | undefined, mode: { put: { id: string } } | { inline: true }): { items: ChipItem[]; add(files: File[]): void; remove(key: string): void; ready: boolean; ids(): string[]; uploads(): ImageUpload[]; clear(): void; error: string | null }` — `put` mode uploads each image on add; `ready` = no `uploading`, no `refused`; adding a 6th sets `error` to the « 5 images » string and ignores it.
  - `ChatView` prop `attach?: { items: ChipItem[]; onFiles(files: File[]): void; onRemove(key: string): void; ready: boolean }`; Send is enabled when `text.trim()` or (`attach.items.length > 0`), and only if `attach.ready`; paste of image files on the input and drop on the form call `onFiles` and `preventDefault`; text paste unchanged.
- Strings (fr / en):
  - chip remove: « Retirer l'image » / "Remove image"
  - too heavy: « Image trop lourde, même réduite » / "Image too large, even reduced"
  - not an image: « Ce fichier n'est pas une image » / "This file is not an image"
  - max: « 5 images au plus par message » / "5 images per message at most"
  - dialog open: « Répondez d'abord à la question, l'image partira après » / "Answer the question first, the image will go after"
  - lost on restore: « Les images de ce message ont été perdues » / "This message's images were lost"

- [ ] **Step 1: Write failing tests** — desktop (`boot`, mock daemon answering `attachment.put`, encoder stubbed with `setCodecForTests`): pasting an image file into the reply field shows a chip and sends `attachment.put { id: session.id }`; Send with empty text sends `session.reply { text:'', attachments:[id] }` and clears the chips; while the put is unanswered Send is disabled; a put answered `too_large` shows the red chip with « Image trop lourde, même réduite » and Send stays disabled until it is removed; a session with `pending.kind:'question'` and a chip → Send disabled and the dialog string shown; a refusal of the reply keeps the chips; `session.queue.restored` with `entries[0].attachments` brings back the chip (ref from the store via `useImageUrl`) and with `imagesDropped` shows the lost string. `chat-attach.test.tsx`: `ChatView` with `attach` and empty text enables Send when one ready chip exists and calls `onAsk('')`; with a `refused` chip Send is disabled.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The chat callers use `useAttachments(client, { inline: true })` and send `chat.ask { …, images: uploads() }`, then `clear()`.
- [ ] **Step 4:** Re-run with `test/session-reply.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(desktop): paste and drop images in replies and the chat`

---

### Task 12: Desktop and island — thumbnails and the enlarged view

**Files:**
- Create: `apps/desktop/src/images/Thumbs.tsx` (maps refs to `ImageThumb` via `useImageUrl`, opens `Lightbox`)
- Modify: `apps/desktop/src/session/exchanges.ts:36, :129, :137` (`Exchange.prompt.images?: AttachmentRef[]`), `apps/desktop/src/session/Thread.tsx:371-385` (thumbs under `prompt-text`), `packages/ui/src/chat/ChatView.tsx:174-175` (prop `turnImages?: (turn: ChatTurn) => ReactNode` rendered above the question bubble), desktop chat callers (pass `turnImages`), `apps/overlay/src/surface/Thread.tsx:26-30`, `apps/overlay/src/surface/Surface.tsx:784` (`turnImages`, no `attach`), `apps/overlay/src/i18n/messages.ts`, desktop i18n, desktop CSS for `.prompt-images`, `apps/desktop/e2e/daemon.ts` (answer `attachment.get`, `attachment.put`), `apps/desktop/e2e/thread.ts`
- Delete: `apps/desktop/e2e/mockup-images.spec.ts`, `docs/superpowers/specs/mockups/2026-10-26-image-paste/index.html`
- Test: `apps/desktop/test/thread-images.test.tsx`, `apps/overlay/test/thread.test.tsx`, `apps/desktop/e2e/images.spec.ts`

**Interfaces:**
- Consumes: `useImageUrl` (Task 9), `ImageThumb`, `Lightbox`, `formatBytes` (Task 10).
- Produces: `Thumbs({ client, refs, route, max, who, at }: { client: DaemonClient; refs: AttachmentRef[]; route: { id?: string; machine?: string }; max: { w: number; h: number }; who: string; at: string })` — fetches when the row scrolls into view (`IntersectionObserver`; where it is missing, as in jsdom, at mount); object URLs live for the page.
- Sizes: session thread `max { w:420, h:260 }`, `object-fit: cover`, `cursor: zoom-in`; chat `max { w:200, h:130 }`, right-aligned. Lightbox title « Capture · <who>, <HH:MM> », meta « 1440×900 · 212 Ko ». Desktop actions « Copier » / "Copy" (PNG to the clipboard via canvas → `navigator.clipboard.write`) and « Enregistrer… » / "Save…" (`<a download="capture-<HHMM>.<ext>">`); island: no actions. Unavailable: « Image indisponible » / "Image unavailable".

- [ ] **Step 1: Write failing tests** — desktop: a thread whose prompt item has two refs renders two thumbnails after `attachment.get` answers; clicking the first opens the dialog titled « Capture · Vous, 14:02 » with « 1440×900 · 212 Ko »; ArrowRight shows the second; Escape closes; an `attachment.error` shows « Image indisponible ». A chat turn with `attachments` and `machineId:'remote'` sends `attachment.get { machine:'remote' }`. Island: prompt with images shows thumbnails and opens the lightbox; the island chat has no paste (pasting an image file into its field does not call `onFiles` — no `attach` prop). e2e `images.spec.ts` (fake daemon): paste an image into the reply field via a synthetic `ClipboardEvent` with a `DataTransfer` PNG, Send, the fake daemon receives `session.reply` with one attachment, pushes a prompt item with that ref, the thumbnail appears, opens, « Enregistrer… » triggers a Playwright `download`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; delete the mockup spec and gallery page.
- [ ] **Step 4:** Re-run the three suites. Expected: PASS.
- [ ] **Step 5: Manual check** — `pnpm --filter @ledge/desktop tauri dev` against the real daemon: paste a screenshot into an OMP session and a Claude session; both answer about the image; « Copier » then paste into Paint works; « Enregistrer… » saves a file. Report what was checked.
- [ ] **Step 6: Commit** — `feat(desktop): image thumbnails and enlarged view, island display`

---

### Task 13: Phone — attach, thumbnails, full screen

**Files:**
- Create: `apps/mobile/src/state/images.ts` (put queue, preview queue, ref cache), `apps/mobile/src/ui/ImageViewer.tsx`, `apps/mobile/src/ui/PhoneThumbs.tsx`
- Modify: `apps/mobile/src/state/store.ts` (`MobileStore` :63, `reply` :69/:473, `ask` :106/:566, `onMessage` :273), `apps/mobile/src/model/thread.ts` (`me` item :14, matching :55-63, own unmatched ops :73-79), `apps/mobile/src/screens/Reply.tsx:33`, `apps/mobile/src/screens/Thread.tsx` (`Bubble` :26-37, send :136-140, draft clearing :94-101), `apps/mobile/src/ui/chat/Composer.tsx:9`, `apps/mobile/src/screens/Chat.tsx:56-62`, `apps/mobile/src/ui/chat/TurnView.tsx:66`
- Test: `apps/mobile/test/state/images.test.ts`, `apps/mobile/test/model/thread.test.ts`, `apps/mobile/test/screens/reply-images.test.tsx`, `apps/mobile/test/screens/chat.test.tsx`

**Interfaces:**
- Consumes: phone protocol (Task 1), `encodeImage`, `AttachmentChips`, `formatBytes` (Task 10).
- Produces:
  - `MobileStore.putImage(image: ImageUpload): Promise<AttachmentRef>` — serialized: the next put is sent only after the previous one is answered; 30 s timeout → reject `'timeout'`; rejects with the server `reason`.
  - `MobileStore.imageUrl(id: string, preview: boolean): Promise<string>` — one request in flight across all calls; object URLs cached per `(id, preview)`; failures not cached.
  - `MobileStore.knownImage(id: string): AttachmentRef | undefined` — refs from this device's puts.
  - `MobileStore.reply(id, text, opts?: { assertion?; expect?; attachments?: string[] })`, `MobileStore.ask(text: string, attachments?: string[]): string`
  - `me` item: `images?: AttachmentRef[]` (from PC prompts), `attachments?: string[]` (own pending ops).
  - Matching: an applied own op claims the first unclaimed prompt with the same text **and** the same image id list (`images?.map(i => i.id) ?? []` equals `message.attachments ?? []`).
- Strings: ＋ button « Joindre une image »; chip remove « Retirer l'image »; full screen « Partager », « Enregistrer », close « Fermer »; no preview « Image trop lourde pour le téléphone · ouvrir sur le PC »; unavailable « Image indisponible »; plus Task 11's « trop lourde », « pas une image », « 5 images », dialog strings.

- [ ] **Step 1: Write failing tests** — images state: two `putImage` calls → the second `attachment.put` is sent only after the first `attachment.stored`; three `imageUrl` calls → one `attachment.get` in flight at a time; a second `imageUrl` for the same key sends nothing. Model: an applied op `{ text:'', attachments:[id] }` matches a prompt `{ text:'', images:[ref] }` and not a prompt `{ text:'' }` without images. Screens (`setup()`, `t.deliver`): choosing a file through the hidden `input[type=file][accept="image/*"][multiple]` shows a chip (72 px), and a paste event carrying an image file on the field does the same and sends `attachment.put`; Send with only the chip sends `session.reply { text:'', attachments:[id], expect:null }`; while uploading Send is disabled; a session waiting on a question with a chip → Send disabled and « Répondez d'abord à la question, l'image partira après »; a `me` bubble with a ref shows the preview at 240 px once it scrolls into view and, tapped, the full screen fetching `preview:false`; a ref with `preview:false` shows the « trop lourde pour le téléphone » note; chat: `＋` then send calls `ask('', [id])` and the turn shows its thumbnail.
- [ ] **Step 2:** Run in `apps/mobile`. Expected: FAIL.
- [ ] **Step 3:** Implement. `ImageViewer`: pinch zoom with two pointers (scale clamped 1–4), vertical swipe > 120 px or ✕ closes, « Partager » uses `navigator.share({ files: [file] })` only when `navigator.canShare?.({ files })`, else hidden; « Enregistrer » is an `<a download>`. Chips are not persisted; the draft text is.
- [ ] **Step 4:** Re-run with `test/screens/reply.test.tsx test/state/store.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): attach images, preview thumbnails, full-screen view`

---

### Task 14: TUI — Alt+V, chips, image lines, opening

**Files:**
- Create: `packages/ledge/src/tui/clipboard.ts`, `packages/ledge/src/tui/openImage.ts`
- Modify: `packages/ledge/src/tui/screens/Session.tsx` (reply mode, `send` :54-60, keys :100-102, input :129-137), `packages/ledge/src/tui/screens/Ask.tsx` (`ask` :43-50, `useInput` :75, keys :100, input :109), `packages/ledge/src/tui/actions.ts:51` (`reply(s, text, onRefused, how?: { attachments?: string[] })`), `packages/ledge/src/tui/model/thread.ts:71` (prompt lines), `packages/ledge/src/tui/model/chat.ts:20`, `packages/ledge/src/tui/i18n/fr.ts`, `packages/ledge/src/tui/i18n/en.ts`, `packages/ledge/test/tui-fixture.tsx` (mock daemon answers `attachment.put`/`attachment.get`)
- Test: `packages/ledge/test/tui-clipboard.test.ts`, `packages/ledge/test/tui-model.test.ts`, `packages/ledge/test/tui-images.test.tsx`

**Interfaces:**
- Consumes: `putImage`, `getImage` (Task 9), `imageInfo` (Task 2).
- Produces:
  - `interface ClipboardImage { image: ImageUpload; width: number; height: number; bytes: number }`
  - `readClipboardImage(env?: NodeJS.ProcessEnv, run?: (file: string, args: string[], o: { cwd?: string; maxBuffer: number; encoding: 'buffer' }) => Promise<{ stdout: Buffer }>, platform?: NodeJS.Platform): Promise<ClipboardImage | null>` — WSL (`env.WSL_DISTRO_NAME`): `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -STA -Command <script>` with `cwd:'/mnt/c'`; the script reads `System.Windows.Forms.Clipboard.GetImage()`, scales to long side 1600, saves JPEG at quality 85 then lower (70, 55, 40) until ≤ 400 000 bytes, plus a 480 px JPEG 70 preview, and prints one JSON line `{"w":…,"h":…,"main":"<b64>","prev":"<b64>"}` or nothing when there is no image. Linux: `wl-paste --type image/png`, else `xclip -selection clipboard -t image/png -o`; macOS: `osascript -e 'the clipboard as «class PNGf»'` written to a temp file. Non-WSL images have no preview.
  - `openImage(file: string, env?: NodeJS.ProcessEnv, spawnImpl?: typeof spawn, platform?: NodeJS.Platform): Promise<void>` — WSL: `wslpath -w <file>` then `/mnt/c/Windows/explorer.exe <winpath>` (`cwd:'/mnt/c'`, detached, `unref`; explorer's exit code 1 is not an error); Linux `xdg-open`; macOS `open`. Files go to `join(os.tmpdir(), 'ledge-images', '<id>.<ext>')`.
  - Prompt and chat-question lines: one line per image, indented 2: `▣ capture 1440×900 · 212 Ko · o ouvrir dans la visionneuse` (en: `▣ capture 1440×900 · 212 KB · o open in viewer`); in Ask the hint reads `alt+o` instead of `o`.
  - Chips line above `❯`: `▣ capture 1440×900 ✕` per image, `…` while uploading, the reason in red when refused.
  - Keys: Alt+V (`key.meta && input === 'v'`) pastes in reply mode and Ask; Backspace on an empty field removes the last chip; `o` (Session read mode) opens the newest image of the visible exchange, each further press the previous one (wraps); Alt+O does the same in Ask over chat turns. Footer adds `alt+v` « image » / "image" while composing, and `o` « ouvrir l'image » / "open image" when the thread has images. No clipboard image: footer notice « Pas d'image dans le presse-papiers » / "No image in the clipboard".

- [ ] **Step 1: Write failing tests** — clipboard (fake `run`): WSL path calls powershell with `cwd:'/mnt/c'` and parses the JSON line into a `ClipboardImage` with `preview`; empty stdout → null; Linux with `wl-paste` failing falls back to `xclip`; both failing → null; `openImage` on WSL calls `wslpath -w` then `explorer.exe` with the Windows path. Model: a prompt item with a 1440×900, 212 000-byte ref yields the exact line above in fr and en. Screens (`startTui`): in reply mode Alt+V (`'\u001bv'`) with a stubbed reader shows the chip and sends `attachment.put { id }`; Enter with empty text sends `session.reply { text:'', attachments:[id] }`; Backspace on empty removes the chip; read mode `o` calls the stubbed opener with a file whose bytes equal the `attachment.data`; Ask Alt+V then Enter sends `chat.ask` with `images`; no clipboard image shows the notice.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The reader and opener are injected through the TUI context so tests stub them.
- [ ] **Step 4:** Re-run with `test/tui-screens.test.tsx`. Expected: PASS.
- [ ] **Step 5: Manual check (WSL)** — copy a screenshot with Win+Shift+S, `ledge tui`, open a session, Alt+V, Enter; the agent describes the image; `o` opens it in the Windows viewer.
- [ ] **Step 6: Commit** — `feat(tui): paste images with Alt+V and open them in the viewer`

---

### Task 15: Final gate

- [ ] **Step 1:** From the repo root: `pnpm -r typecheck && pnpm test`. Expected: all pass. Then `pnpm --filter @ledge/desktop exec playwright test`. Expected: all pass.
- [ ] **Step 2:** `git status` shows no leftover mockup spec or `index.html`; the six mockup PNGs, the spec and this plan are committed.
- [ ] **Step 3:** Report to the user: what the manual checks of Tasks 12 and 14 showed, and Task 0's spike results.

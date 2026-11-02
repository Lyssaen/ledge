# Browser captures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Images an agent's tools return (Playwright screenshots first) are kept by Ledge, shown on their thread rows on
Desktop, the phone and the TUI, and gathered in a Desktop « Navigateur » side-pane tab with a before / after comparison.

**Architecture:** The Claude Code PostToolUse hook extracts the image blocks of `tool_response` and hands each to the
local daemon (`attachment.capture`), which reduces it with pure-JS codecs and stores it in the existing attachment store;
the event then names the ids, and `History` puts `images` on the tool row. Clients derive everything else from the
thread items: Desktop thumbnails and the `browser` pane tab, the phone's `capture` entry, the TUI's chips.

**Tech Stack:** TypeScript, zod (`@ledge/protocol`), Node daemon (`packages/ledge`, tsup), `pngjs` + `jpeg-js` (new,
pure JS), React 19 Desktop (Tauri webview), React phone app, Ink TUI, vitest, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-02-browser-captures-design.md` (mockup:
`docs/superpowers/specs/mockups/2026-11-02-browser-captures/browser-captures.jpg`, source `.html` next to it).

## Global Constraints

- No native module in `packages/ledge`: the image codecs are `pngjs` and `jpeg-js`, nothing else.
- Stored capture: long side ≤ `IMAGE_LONG_SIDE` (1600 px), ≤ `ATTACHMENT_MAX` (400 000 bytes). Preview: long side ≤ `PREVIEW_LONG_SIDE` (480 px), ≤ `PREVIEW_MAX` (40 000 bytes).
- Raw capture accepted by the daemon: ≤ `CAPTURE_RAW_MAX` = 2 800 000 bytes (its base64 fits a 4 MB `MAX_FRAME`).
- At most `ATTACHMENTS_MAX` (5) images per tool result, in order.
- Hook budget: 1 000 ms (`CAPTURE_HOOK_MS`) for a PostToolUse whose response carries images; every other PostToolUse keeps 100 ms.
- Only Claude Code payloads are wired; Codex / Cursor / OMP stay as they are.
- Every user-visible word goes through i18n, `fr` and `en` (Desktop `apps/desktop/src/i18n/{fr,en}.ts`, phone `apps/mobile/src/copy.ts`).
- Exact copy (fr): « Navigateur », « Comparer », « Comparaison · Quitter », « Agrandir », « dans le fil », « Capture trop lourde pour Ledge », « Choisis les deux captures à comparer ».
- Tests per package: `pnpm vitest run <file>` from the package's directory. Desktop e2e: `pnpm exec playwright test <spec>` from `apps/desktop` (never `--filter @ledge/desktop`, it matches nothing and exits 0).
- Commits in English, conventional (`feat(ledge): …`, `feat(desktop): …`, `feat(mobile): …`, `feat(protocol): …`), on `feat/browser-captures`.

## Review Focus

- One tool result with two images: both stored in order, both on the row, two entries in the tab (Task 4, Task 6).
- Daemon absent or slow while the hook holds images: the event still goes within 1 s, without the images, `imagesDropped: true` (Task 4).
- The same bytes captured twice (same attachment id): two entries in the tab, each opening its own row (Task 6).
- A helper's captures: URL taken from that helper's Playwright outputs only, entry marked with the helper's name (Task 6).
- The focused capture's row leaves the thread window (400 items): the tab falls back to the latest capture, or says it has none and offers to close (Task 8).

---

### Task 1: Protocol: images on tool rows and the `attachment.capture` message

**Files:**
- Modify: `packages/protocol/src/thread.ts:21` (tool item), `packages/protocol/src/messages.ts:46` (SessionEvent) and the client message union, `packages/protocol/src/attachments.ts`
- Test: `packages/protocol/test/attachments.test.ts`, `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces:
  - `ToolItem.images?: AttachmentRef[]` (max `ATTACHMENTS_MAX`), `ToolItem.imagesDropped?: true`
  - `SessionEvent.imagesDropped?: boolean`; the `attachments` comment widens to « UserPromptSubmit, PostToolUse »
  - `CAPTURE_RAW_MAX = 2_800_000` in `attachments.ts`
  - `AttachmentCaptureSchema = { type: 'attachment.capture', requestId, image: { mime: ImageMime, data: string (min 1, max b64Max(CAPTURE_RAW_MAX)) } }`, added to the daemon's client message union (not to the phone's); replies are the existing `attachment.stored` / `attachment.error`
  - `toolShortName(tool: string): string` (the part after the last `__`, e.g. `mcp__plugin_playwright_playwright__browser_take_screenshot` → `browser_take_screenshot`) and `isBrowserCapture(tool: string): boolean` (an MCP tool whose name contains `playwright` and ends with `browser_take_screenshot`), exported from `thread.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// attachments.test.ts
it('accepts a capture up to CAPTURE_RAW_MAX', () => {
  const data = 'A'.repeat(b64Max(CAPTURE_RAW_MAX));
  expect(AttachmentCaptureSchema.safeParse({ type: 'attachment.capture', requestId: 'r1', image: { mime: 'image/png', data } }).success).toBe(true);
  expect(AttachmentCaptureSchema.safeParse({ type: 'attachment.capture', requestId: 'r1', image: { mime: 'image/png', data: data + 'AAAA' } }).success).toBe(false);
});
// messages.test.ts
it('a tool row carries images and imagesDropped', () => {
  const ref = { id: 'a'.repeat(64), mime: 'image/jpeg', width: 1280, height: 800, bytes: 120_000, preview: true };
  const row = ThreadItemSchema.parse({ kind: 'tool', id: 't1', at: NOW, turn: 1, tool: 'x', label: 'x', status: 'success', images: [ref], imagesDropped: true });
  expect(row).toMatchObject({ images: [ref], imagesDropped: true });
});
it('names tools', () => {
  expect(toolShortName('mcp__plugin_playwright_playwright__browser_take_screenshot')).toBe('browser_take_screenshot');
  expect(toolShortName('Bash')).toBe('Bash');
  expect(isBrowserCapture('mcp__plugin_playwright_playwright__browser_take_screenshot')).toBe(true);
  expect(isBrowserCapture('mcp__other__screenshot')).toBe(false);
});
```

- [ ] **Step 2: Run them, expect FAIL** — `cd packages/protocol && pnpm vitest run test/attachments.test.ts test/messages.test.ts` → unknown exports / unrecognized keys.
- [ ] **Step 3: Implement the schemas and helpers listed under Produces.**
- [ ] **Step 4: Run them, expect PASS**, then `pnpm typecheck` at the repo root (consumers must still compile).
- [ ] **Step 5: Commit** — `feat(protocol): images on tool rows and attachment.capture`

---

### Task 2: Daemon: reduce a capture

**Files:**
- Create: `packages/ledge/src/daemon/reduce.ts`
- Modify: `packages/ledge/package.json` (dependencies `pngjs`, `jpeg-js`; devDependency `@types/pngjs`)
- Test: `packages/ledge/test/reduce.test.ts`

**Interfaces:**
- Consumes: `AttachmentError` (`daemon/attachments.ts`), `imageInfo` (`imageInfo.ts`), protocol limits.
- Produces: `reduceCapture(raw: Buffer): { image: Buffer; preview?: Buffer }`, throws `AttachmentError('not_image' | 'too_large')`.

Rules (spec §5.2):
- `raw.length > CAPTURE_RAW_MAX` → `too_large`; `imageInfo(raw) === null` → `not_image`.
- PNG or JPEG with long side ≤ 1600 and bytes ≤ 400 000: `image` is `raw` itself; a preview is still made.
- PNG or JPEG otherwise: decode, downscale so the long side is ≤ 1600 (area average: each output pixel is the mean of the source pixels it covers; alpha composited on white), encode JPEG at quality 85; while over 400 000 bytes, step the quality down by 10 to 45, then shrink the long side by 0.8 and retry.
- Preview: same downscale to long side ≤ 480, JPEG quality 70, stepping down by 10 to 40 while over 40 000 bytes.
- WebP / GIF: kept as is without preview when within both limits, else `too_large`.

- [ ] **Step 1: Write the failing tests** (fixtures built in the test with `pngjs` `PNG.sync.write` and `jpeg-js` `encode`; a noisy fill so sizes are realistic)

```ts
it('keeps a small PNG as is and makes a preview', () => {
  const raw = png(1280, 800, 'flat');
  const out = reduceCapture(raw);
  expect(out.image).toBe(raw);
  expect(imageInfo(out.preview!)).toMatchObject({ mime: 'image/jpeg', width: 480, height: 300 });
  expect(out.preview!.length).toBeLessThanOrEqual(PREVIEW_MAX);
});
it('re-encodes a large PNG under both limits', () => {
  const out = reduceCapture(png(2560, 1600, 'noise'));
  expect(imageInfo(out.image)).toMatchObject({ mime: 'image/jpeg', width: 1600, height: 1000 });
  expect(out.image.length).toBeLessThanOrEqual(ATTACHMENT_MAX);
});
it('reduces a full-page capture by its long side', () => {
  expect(imageInfo(reduceCapture(png(1280, 6400, 'noise')).image)).toMatchObject({ width: 320, height: 1600 });
});
it('keeps a small WebP without preview, refuses a large one', () => {
  expect(reduceCapture(SMALL_WEBP).preview).toBeUndefined();
  expect(() => reduceCapture(LARGE_WEBP_HEADER)).toThrow(expect.objectContaining({ reason: 'too_large' }));
});
it('refuses what is not an image, and what is over CAPTURE_RAW_MAX', () => {
  expect(() => reduceCapture(Buffer.from('nope'))).toThrow(expect.objectContaining({ reason: 'not_image' }));
  expect(() => reduceCapture(Buffer.alloc(CAPTURE_RAW_MAX + 1))).toThrow(expect.objectContaining({ reason: 'too_large' }));
});
```

(`SMALL_WEBP` / `LARGE_WEBP_HEADER`: reuse the WebP fixtures of `test/image-info.test.ts`; a header announcing 4000 × 3000 is enough for the refusal.)

- [ ] **Step 2: Run, expect FAIL** — `cd packages/ledge && pnpm vitest run test/reduce.test.ts`.
- [ ] **Step 3: Add the dependencies** (`pnpm --filter @paradow/ledge add pngjs jpeg-js && pnpm --filter @paradow/ledge add -D @types/pngjs`) **and implement `reduceCapture`.**
- [ ] **Step 4: Run, expect PASS.** Then `pnpm build` in `packages/ledge` and check `dist` runs (`node dist/cli.js --version` or the package's bin): the codecs must bundle or resolve.
- [ ] **Step 5: Measure** — a throwaway script (scratchpad, not committed) times `reduceCapture` on a real 1280 × 800 Playwright PNG (`.playwright-mcp/` of the main checkout has some) and on a 1280 × 6400 noise PNG, on WSL. Record both times in the commit message body. If either is over 600 ms, stop and report: the spec's answer-then-reduce variant (§5.2) is then needed and changes Task 3.
- [ ] **Step 6: Commit** — `feat(ledge): reduce browser captures with pure-JS codecs`

---

### Task 3: Daemon: store captures and put them on tool rows

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts:1249` (message switch, next to `attachment.put`), `packages/ledge/src/daemon/history.ts:180-206` (PostToolUse), `packages/ledge/src/mobile/project.ts:123-133` (tool rows)
- Test: `packages/ledge/test/server-attachments.test.ts`, `packages/ledge/test/history.test.ts`, `packages/ledge/test/mobile-project.test.ts`

**Interfaces:**
- Consumes: `reduceCapture` (Task 2), `AttachmentCaptureSchema`, `ToolItem.images` (Task 1).
- Produces: daemon answers `attachment.capture` with `attachment.stored { ref }` (ref of the reduced image, `preview` true when one was made) or `attachment.error { reason }`; `History.record` PostToolUse puts `images` (refs in event order, unknown ids skipped) and `imagesDropped: true` on the row; the phone's projection keeps both.

- [ ] **Step 1: Write the failing tests**

```ts
// server-attachments.test.ts
it('stores a capture reduced, with its preview', async () => {
  const ref = await capture(client, png(2560, 1600, 'noise'));
  expect(ref).toMatchObject({ mime: 'image/jpeg', width: 1600, height: 1000, preview: true });
  expect((await get(client, ref.id, true)).mime).toBe('image/jpeg');
});
it('refuses a capture that is not an image', async () => {
  expect(await captureError(client, Buffer.from('nope'))).toBe('not_image');
});
// history.test.ts
it('PostToolUse with attachments puts images on the row', () => {
  const h = new History({ dir, refOf: id => (id === REF.id ? REF : null) });
  h.record('s1', { name: 'PreToolUse', at: T0, source: 'hook', tool: SHOT, toolUseId: 'u1' });
  const row = h.record('s1', { name: 'PostToolUse', at: T1, source: 'hook', tool: SHOT, toolUseId: 'u1', attachments: [REF.id, 'f'.repeat(64)], imagesDropped: true });
  expect(row).toMatchObject({ kind: 'tool', id: 'u1', images: [REF], imagesDropped: true });
});
it('keeps a tool row image through the sweep', async () => {
  /* record as above, then */ expect(await h.attachmentIds()).toContain(REF.id);
});
// mobile-project.test.ts
it('projects a tool row with its images', () => {
  expect(projectItem(toolRowWithImages)).toMatchObject({ kind: 'tool', images: [REF], imagesDropped: true });
});
```

(`capture`, `captureError`, `get`: small helpers in the test file, built like the existing `attachment.put` tests there; `projectItem`: whatever `mobile-project.test.ts` already calls for one item.)

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run test/server-attachments.test.ts test/history.test.ts test/mobile-project.test.ts`.
- [ ] **Step 3: Implement** — server: decode base64 as `storeUpload` does, `reduceCapture`, `attachments.put(image, preview, ATTACHMENT_MAX)`; history: map `ev.attachments` through `this.refOf` exactly as the prompt case (line 132); projection: copy `images` / `imagesDropped` with `pickSet`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(ledge): store captures and carry them on tool rows`

---

### Task 4: Hook: hand a tool's images to the daemon

**Files:**
- Create: `packages/ledge/src/cli/toolImages.ts`
- Modify: `packages/ledge/src/cli/hook.ts` (`runHook`, lines 472-517), `.gitignore`
- Test: `packages/ledge/test/hook.test.ts`, `packages/ledge/test/tool-images.test.ts`

**Interfaces:**
- Consumes: `attachment.capture` (Tasks 1, 3), `imageInfo`.
- Produces:
  - `toolImages(response: unknown, home?: string): { mime: ImageMime; data: string }[]` — base64 `data`; Claude blocks `{type:'image', source:{type:'base64', media_type, data}}` and MCP blocks `{type:'image', data, mimeType}`; mimes outside `IMAGE_MIMES` skipped; at most 5. Fallback only if the payload check (Step 1) shows Claude sends no image block: text blocks' `[Image: source: <abs path>]` lines, read only when the path is under `<home>/.claude/projects/`, type from `imageInfo`.
  - `CAPTURE_HOOK_MS = 1000`.
  - In `runHook`, for `agent === 'claude'` and `PostToolUse` with images: deadline `CAPTURE_HOOK_MS`; after `connect`, each image is sent as `attachment.capture` in order, awaiting `attachment.stored` or `attachment.error` (whichever comes first) within the deadline; then `session.event` goes with `attachments` (stored ids) and `imagesDropped: true` when any image was refused or not answered in time. Without images, nothing changes (100 ms, event sent right after connect).

- [ ] **Step 1: Check the real payload** — in a scratch dir, a settings file whose PostToolUse hook is `cat > <scratch>/payload.json`; run `claude -p --settings <file> "Use Playwright: open data:text/html,<h1>probe</h1> and take a screenshot"`; then `jq '.tool_response | map(.type)' <scratch>/payload.json`. Expected: `["text","image","text"]`. Note the result in the commit body; if there is no `"image"`, the fallback becomes the main path.
- [ ] **Step 2: Write the failing tests**

```ts
// tool-images.test.ts
it('reads Claude and MCP image blocks, in order, at most 5', () => {
  const claude = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
  const mcp = { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' };
  expect(toolImages([{ type: 'text', text: 'x' }, claude, mcp])).toEqual([{ mime: 'image/png', data: 'AAAA' }, { mime: 'image/jpeg', data: 'BBBB' }]);
  expect(toolImages(Array(7).fill(claude))).toHaveLength(5);
  expect(toolImages([{ type: 'image', data: 'C', mimeType: 'image/tiff' }])).toEqual([]);
  expect(toolImages('text only')).toEqual([]);
});
// hook.test.ts (fake daemon as the file's other runHook tests)
it('stores a screenshot before sending its PostToolUse', async () => {
  const seen = await runWithFakeDaemon('PostToolUse', payloadWithImages(2), { onCapture: i => ({ type: 'attachment.stored', ref: refN(i) }) });
  expect(seen.map(m => m.type)).toEqual(['attachment.capture', 'attachment.capture', 'session.event']);
  expect(seen[2].event).toMatchObject({ attachments: [refN(0).id, refN(1).id] });
  expect(seen[2].event.imagesDropped).toBeUndefined();
});
it('sends the event without images when the daemon does not answer in time', async () => {
  const t0 = Date.now();
  const seen = await runWithFakeDaemon('PostToolUse', payloadWithImages(1), { onCapture: () => null /* never answers */ });
  expect(Date.now() - t0).toBeLessThan(1300);
  expect(seen.at(-1)).toMatchObject({ type: 'session.event', event: { imagesDropped: true } });
  expect(seen.at(-1).event.attachments).toBeUndefined();
});
it('a PostToolUse without images keeps the 100 ms path', async () => {
  const seen = await runWithFakeDaemon('PostToolUse', payloadWithImages(0), {});
  expect(seen.map(m => m.type)).toEqual(['session.event']);
});
```

- [ ] **Step 3: Run, expect FAIL** — `pnpm vitest run test/tool-images.test.ts test/hook.test.ts`.
- [ ] **Step 4: Implement `toolImages` and the `runHook` branch; add `.playwright-mcp/` to `.gitignore`.**
- [ ] **Step 5: Run, expect PASS**, then the whole `packages/ledge` suite (`pnpm vitest run`).
- [ ] **Step 6: Commit** — `feat(ledge): keep the images a tool returns`

---

### Task 5: Desktop: captures on the thread's tool rows

**Files:**
- Modify: `packages/ui/src/images/Thumbs.tsx` (optional `onOpen`, export the viewer), `apps/desktop/src/images/Thumbs.tsx` (pass-through), `apps/desktop/src/session/ActionGroup.tsx` (`ActionRow`, `ActionGroup`), `apps/desktop/src/session/Thread.tsx` (prop), `apps/desktop/src/styles/session.css`, `apps/desktop/src/i18n/{fr,en}.ts`
- Test: `apps/desktop/test/thread-images.test.tsx`

**Interfaces:**
- Consumes: `ToolItem.images`, `ToolItem.imagesDropped` (Task 1).
- Produces:
  - `@ledge/ui/images` `Thumbs` gains `onOpen?(index: number): void`: when given, a click calls it and no lightbox opens. `Viewer` is exported as `ThumbsViewer` (same props).
  - `ActionGroup` and `Thread` gain `onCapture(toolId: string, index: number): void`.
  - i18n `t.session.thread.captureDropped` = « Capture trop lourde pour Ledge » / "Capture too large for Ledge".

Behavior: a row with `images` shows them under its `.act` line (420 × 260, `who` = the session's name, `at` = the row's clock), whether or not its output is expanded; a folded group shows, under its fold row, the thumbnails of all its rows in order. `imagesDropped` adds a quiet line under the row.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows a tool row capture and routes its click', async () => {
  const onCapture = vi.fn();
  renderThread({ items: [toolRow({ id: 'u1', images: [REF] })], onCapture });
  await user.click(await screen.findByRole('button', { name: /capture/i }));
  expect(onCapture).toHaveBeenCalledWith('u1', 0);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('shows the captures of a folded group', () => {
  renderThread({ items: [toolRow({ id: 'u1', images: [REF] }), toolRow({ id: 'u2' }), toolRow({ id: 'u3', images: [REF2] })] });
  expect(screen.getAllByRole('button', { name: /capture/i })).toHaveLength(2);
});
it('says when a capture was too large', () => {
  renderThread({ items: [toolRow({ id: 'u1', imagesDropped: true })] });
  expect(screen.getByText('Capture trop lourde pour Ledge')).toBeVisible();
});
```

(`renderThread`, `toolRow`: follow the helpers `thread-images.test.tsx` already uses for prompt images; adjust the accessible name to what `Thumb` renders.)

- [ ] **Step 2: Run, expect FAIL** — `cd apps/desktop && pnpm vitest run test/thread-images.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**, plus `test/session-rail.test.tsx` and `packages/ui` tests (`cd packages/ui && pnpm vitest run`) for regressions.
- [ ] **Step 5: Commit** — `feat(desktop): captures on the thread's tool rows`

---

### Task 6: Desktop: the session's captures, derived from the thread

**Files:**
- Create: `apps/desktop/src/session/captures.ts`
- Test: `apps/desktop/test/session-captures.test.ts`

**Interfaces:**
- Consumes: `ThreadItem`, `toolShortName`, `isBrowserCapture` (Task 1).
- Produces:

```ts
export interface Capture {
  key: string;        // `${toolId}:${index}` — unique even when two rows hold the same image
  toolId: string; index: number; ref: AttachmentRef; at: string; turn: number;
  helperId?: string;
  url?: string;       // last `- Page URL: <url>` in a Playwright tool output of the same helper scope, at or before this row
  tool?: string;      // toolShortName, only when !isBrowserCapture(row.tool)
}
export function capturesOf(items: readonly ThreadItem[]): Capture[];
export function exchangesOf(captures: readonly Capture[]): number; // distinct turns
```

- [ ] **Step 1: Write the failing tests**

```ts
it('lists captures in thread order with the page URL', () => {
  const caps = capturesOf([nav('n1', 'http://localhost:5173/'), shot('s1', [REF]), nav('n2', 'http://localhost:5173/tarifs'), shot('s2', [REF2])]);
  expect(caps.map(c => [c.key, c.url])).toEqual([['s1:0', 'http://localhost:5173/'], ['s2:0', 'http://localhost:5173/tarifs']]);
});
it('keeps two entries for the same bytes, and one per image of a row', () => {
  expect(capturesOf([shot('s1', [REF]), shot('s2', [REF])]).map(c => c.key)).toEqual(['s1:0', 's2:0']);
  expect(capturesOf([shot('s1', [REF, REF2])]).map(c => c.key)).toEqual(['s1:0', 's1:1']);
});
it('scopes the URL to the helper', () => {
  const caps = capturesOf([nav('n1', 'http://a/', undefined), nav('n2', 'http://b/', 'h1'), shot('s1', [REF], 'h1'), shot('s2', [REF2])]);
  expect(caps.map(c => [c.helperId, c.url])).toEqual([['h1', 'http://b/'], [undefined, 'http://a/']]);
});
it('names a non-Playwright image tool and gives it no URL', () => {
  expect(capturesOf([nav('n1', 'http://a/'), tool('t1', 'mcp__figma__get_screenshot', [REF])])[0]).toMatchObject({ tool: 'get_screenshot', url: undefined });
});
it('counts exchanges', () => {
  expect(exchangesOf(capturesOf([shot('s1', [REF], undefined, 1), shot('s2', [REF], undefined, 1), shot('s3', [REF], undefined, 2)]))).toBe(2);
});
```

(`nav(id, url, helperId?)`: a Playwright `browser_navigate` tool row whose `output` holds `### Page\n- Page URL: <url>`; `shot(id, images, helperId?, turn?)`: a `browser_take_screenshot` row.)

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run test/session-captures.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(desktop): derive a session's captures from its thread`

---

### Task 7: Desktop: the « Navigateur » tab and its head button

**Files:**
- Create: `apps/desktop/src/session/BrowserTab.tsx`
- Modify: `apps/desktop/src/session/SidePane.tsx` (`PaneTab`, `tabId`, labels, icon, render), `apps/desktop/src/session/SessionPage.tsx` (captures memo, `openCapture`, head button, props to `Thread` and `SidePane`), `apps/desktop/src/shell/icons.ts` (a browser icon), `apps/desktop/src/styles/session.css`, `apps/desktop/src/i18n/{fr,en}.ts`
- Test: `apps/desktop/test/session-browser.test.tsx`, `apps/desktop/e2e/session.spec.ts` (or `images.spec.ts`, whichever holds thread-image fixtures)

**Interfaces:**
- Consumes: `capturesOf`, `exchangesOf`, `Capture` (Task 6); `ThumbsViewer`, `Thumbs` (Task 5); `onCapture` (Task 5); SessionPage's existing `showInThread(toolId)` (line 115).
- Produces:
  - `PaneTab` gains `{ kind: 'browser' }`; `tabId` → `'browser'`.
  - SessionPage: `const captures = useMemo(() => capturesOf(items ?? []), [items])`; `openCapture(key: string | null)` opens/activates the browser tab and sets `captureFocus` (null → latest); `onCapture={(toolId, i) => openCapture(`${toolId}:${i}`)}` on `Thread`.
  - `BrowserTab({ captures, focus, client, session, helperName, head, onShowInThread, onClose })` where `helperName(id: string): string | undefined` and `onShowInThread(toolId: string): void`.
  - i18n `t.session.browser`: `tab` « Navigateur », `pill(n)` « Navigateur » + count, `compare` « Comparer », `compareOn` « Comparaison · Quitter », `pick` « Choisis les deux captures à comparer », `enlarge` « Agrandir », `inThread` « dans le fil », `count(n, x)` « n captures · x échanges », `none` « Plus aucune capture dans le fil », and `en` equivalents.

Behavior (spec §5.4, mockup screens 2 and 3):
- Head: a `kids-pill` button « Navigateur » with `captures.length`, shown when `captures.length > 0`; opens on the latest.
- Tab, single mode: meta line (URL mono, `clock(at)`, `width×height`, the session's or helper's name, `tool` when set), buttons Comparer / Agrandir / dans le fil, the selected capture large (fetched full size via the shared thumb loader), then the strip: count line, cells in order with a divider between turns, selected cell outlined; the strip scrolls to its end when a capture is appended while open.
- Compare mode: the strip's clicks fill A then B (badges); the two show side by side, stacked under 560 px of pane width; head shows « Comparaison · Quitter ».
- Focus: when `focus` changes, select it; when the selected key leaves `captures`, select the latest; when `captures` is empty, show `none` and a Fermer button.
- « dans le fil » calls `onShowInThread(toolId)`; « Agrandir » opens `ThumbsViewer` on the session's capture refs at the selected index.

- [ ] **Step 1: Write the failing component tests**

```tsx
it('opens on the latest capture from the head button', async () => {
  renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
  await user.click(screen.getByRole('button', { name: /Navigateur/ }));
  expect(within(pane()).getByText('2 captures · 1 échange')).toBeVisible();
  expect(selectedCell()).toHaveAttribute('data-capture', 's2:0');
});
it('opens on the clicked thread capture', async () => {
  renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
  await user.click(threadThumb('s1'));
  expect(selectedCell()).toHaveAttribute('data-capture', 's1:0');
});
it('compares two captures', async () => {
  renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
  await user.click(screen.getByRole('button', { name: /Navigateur/ }));
  await user.click(within(pane()).getByRole('button', { name: 'Comparer' }));
  await user.click(cell('s1:0')); await user.click(cell('s2:0'));
  expect(within(pane()).getAllByTestId('compare-side')).toHaveLength(2);
  expect(within(pane()).getByRole('button', { name: 'Comparaison · Quitter' })).toBeVisible();
});
it('lights the row in the thread', async () => { /* click « dans le fil » → the row with data-tool="s1" gets the flash class */ });
it('falls back when the focused capture leaves the thread', () => {
  const { rerender } = renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] }); openOn('s1:0');
  rerender({ items: [shot('s2', [REF2])] });
  expect(selectedCell()).toHaveAttribute('data-capture', 's2:0');
  rerender({ items: [] });
  expect(within(pane()).getByText('Plus aucune capture dans le fil')).toBeVisible();
});
```

(Build `renderSession` like `test/session-pane.test.tsx`; cells carry `data-capture={key}`.)

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run test/session-browser.test.tsx`.
- [ ] **Step 3: Implement**, matching the mockup's layout in dark and light themes (use the existing theme tokens of `session.css`, no new colors).
- [ ] **Step 4: Run, expect PASS**, plus `test/session-pane.test.tsx test/session.test.tsx test/session-conversation.test.tsx`.
- [ ] **Step 5: Write the e2e** — `test('a capture opens the Navigateur tab', …)`: a fixture thread with one Playwright screenshot row carrying an image the fake daemon serves; click the thread thumbnail; expect the side pane titled « Navigateur » and its large image loaded. Run `cd apps/desktop && pnpm exec playwright test e2e/<file> -g "Navigateur"`, expect PASS.
- [ ] **Step 6: Commit** — `feat(desktop): Navigateur tab with captures and comparison`

---

### Task 8: Phone: a « Capture » entry

**Files:**
- Modify: `apps/mobile/src/model/thread.ts` (`ThreadItem`, `threadItems`), `apps/mobile/src/screens/Thread.tsx` (`Bubble`), `apps/mobile/src/copy.ts`
- Test: `apps/mobile/test/model/thread.test.ts`, `apps/mobile/test/screens/thread.test.tsx`

**Interfaces:**
- Consumes: `ToolItem.images` through the phone's thread (Task 3 projection), `toolShortName`, `isBrowserCapture`.
- Produces: `ThreadItem` variant `{ key: string; kind: 'capture'; label: string; at: string; images: AttachmentRef[] }`, `label` = `copy.thread.capture` (« Capture ») for a browser capture, else `toolShortName(tool)`; made only for tool rows with `images.length > 0`, in PC order. Update the « Tools … are left to the terminal » comment.

- [ ] **Step 1: Write the failing tests**

```ts
it('makes a capture entry only for tool rows with images', () => {
  const out = threadItems([toolRow('t1'), toolRow('t2', { images: [REF] }), toolRow('t3', { imagesDropped: true })], SESSION, {});
  expect(out.filter(i => i.kind === 'capture')).toEqual([{ key: 't2', kind: 'capture', label: 'Capture', at: AT, images: [REF] }]);
});
// screens/thread.test.tsx
it('shows the capture thumbnail, opening full screen on tap', async () => {
  renderThread([toolRow('t2', { images: [REF] })]);
  expect(screen.getByText('Capture')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /capture|image/i }));
  expect(screen.getByRole('dialog')).toBeVisible();
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd apps/mobile && pnpm vitest run test/model/thread.test.ts test/screens/thread.test.tsx`.
- [ ] **Step 3: Implement** — `Bubble` case `capture`: a muted line (check mark, label, `width×height` mono) then `<PhoneThumbs store={store} refs={item.images} align="start" />`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(mobile): show agents' captures in the thread`

---

### Task 9: TUI: tool rows' images as chips

**Files:**
- Modify: `packages/ledge/src/tui/model/thread.ts:148-151` (`threadImages`)
- Test: `packages/ledge/test/tui-images.test.tsx`

**Interfaces:**
- Consumes: `ToolItem.images`.
- Produces: `threadImages(items, unfolded)` also returns tool rows' images, in thread order.

- [ ] **Step 1: Write the failing test**

```ts
it('includes tool rows images', () => {
  expect(threadImages([prompt('p1', [REF]), toolRow('t1', { images: [REF2] })], true)).toEqual([REF, REF2]);
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd packages/ledge && pnpm vitest run test/tui-images.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(ledge): TUI chips for captures`

---

### Task 10: End-to-end check on a real session

No code unless something breaks (then fix in the owning task's files, with a test).

- [ ] **Step 1:** `pnpm typecheck` and `pnpm build` at the root; each touched package's suite (`packages/protocol`, `packages/ledge`, `packages/ui`, `apps/desktop`, `apps/mobile`) passes.
- [ ] **Step 2:** Run the branch's daemon and Desktop as the repo's dev docs say (check `ledge who` first; never swap the shared daemon under running sessions without the user's go — ask via `ledge task give ledge`).
- [ ] **Step 3:** In a Ledge Claude session: navigate Playwright to a local page, screenshot, change the page, screenshot again, and take one full-page screenshot. Expected: two thumbnails on Desktop's rows; the head's « Navigateur 2 »; the tab lists both with the URL; Comparer shows both; the phone (paired, through the relay) shows two « Capture » entries that open full screen; `ledge tui` shows the chips; the full-page one is either reduced and shown or marked « Capture trop lourde pour Ledge ».
- [ ] **Step 4:** Note the hook's measured time for a screenshot (daemon log or a `time` around a replayed payload) in the PR description.

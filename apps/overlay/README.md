# Ledge overlay

The notch's web app: the island on the top edge of the screen that opens into the list of agent sessions, grouped by repository, and a read-only chat with Ledge. The React UI lives in `src/` and is tested in WSL. It has no native shell of its own: Ledge Desktop builds it into `dist/notch/` and shows it in its second window, `notch` (`apps/desktop/src-tauri/src/notch.rs` holds the native side). The notch talks to the Ledge daemon over `ws://127.0.0.1:47831`.

## Develop (WSL)

```
pnpm --filter overlay dev                        # http://localhost:1420
pnpm --filter overlay exec tsx test/devMock.ts   # a fake daemon on 47831 with five bots
pnpm --filter overlay test
pnpm --filter overlay test:e2e                   # Playwright, the real app in Chromium
```

The dev mock needs port 47831 free: stop the real daemon first.

### Preview the Markdown reader in a browser

This preview uses separate ports so an existing Ledge daemon and overlay can keep running. From the repository root, start these two commands in separate terminals:

```sh
pnpm --filter overlay exec tsx test/readerDemo.ts
VITE_LEDGE_DEMO_WS=ws://127.0.0.1:47832 pnpm --filter overlay exec vite --port 1421 --strictPort --host 127.0.0.1
```

Open `http://127.0.0.1:1421`, select Otto, then click **Ouvrir le README** in his reply. The sample is [docs/reader-demo/README.md](../../docs/reader-demo/README.md); the demo socket reads that real WSL file and follows its link to `docs/tour.md`. The demo port may be changed with `LEDGE_READER_DEMO_PORT` and the matching `VITE_LEDGE_DEMO_WS` URL. Stop both terminals with Ctrl+C when finished.

The e2e suite (`e2e/*.spec.ts`) drives the real app with a real mouse and keyboard in Chromium; the daemon is simulated
in the page (`e2e/daemon.ts`), so nothing needs to run on 47831. Vite is started on port 5199 (or an existing server
there is reused). Any console error or page error fails the spec. The first run may need
`pnpm --filter overlay exec playwright install chromium`. Traces and screenshots go to `e2e/.results/` (git-ignored).

## Build (Windows PowerShell, Rust installed)

The notch ships inside Ledge Desktop: build, run and install it from `apps/desktop` (`pnpm --filter desktop tauri dev`, `pnpm tauri build` there; see the root README). Ledge Desktop's installer also stops and uninstalls the old « Ledge » app, the notch on its own up to 0.6 (`apps/desktop/src-tauri/windows/hooks.nsh`). The icon, the tray, launch at login and updates are Ledge Desktop's.

## Keys

| Key | Action |
| --- | --- |
| Ctrl+Alt+L | open / close the list (global); over a bubble it opens the list |
| J K (or arrows) | move in the list |
| 1-9 | choose an option inside a question card |
| Enter | open the focused row |
| / | focus the Ask Ledge field (list only) |
| Y N | approve / deny a permission ask; on a question, a diff or a plan in the list they open it instead (a diff or plan is decided from its open session, after review) |
| Alt+Left / Alt+Right | previous / next session, wrapping, an ask or not (focused in the list, opened from a session) |
| Ctrl+Alt+N | open / close the new-session form (global) |
| R | reply |
| O | open the terminal tab |
| D | do not disturb |
| Esc | back, then close |
| ? | keyboard help, inside the surface (Esc returns to the list) |
| Ctrl+Alt+T | toggle dark / light theme |

Language, default harness, screen, theme, do not disturb, reduced motion, finished notices and the two sizes are also in the list's Settings view, and are remembered in `localStorage` (`ledge.lang`, `ledge.defaultTool`, `ledge.monitor`, `ledge.theme`, `ledge.dnd`, `ledge.reducedMotion`, `ledge.handleScale`, `ledge.panelScale`, `ledge.finished`, `ledge.sounds`).

## Screen

The handle sits on the left edge of one screen: the primary by default, or the one chosen in Settings > Screen. The shell lists the monitors (`list_monitors`) and moves the window to the chosen one (`set_monitor`); frames are then in that screen's work-area coordinates. The choice is a monitor name (`\\.\DISPLAY2` on Windows); a chosen screen that is unplugged falls back to the primary until it comes back, without losing the setting.

### The native window never moves

The native window covers the whole work area of that screen and is placed once (`set_frame` places it again only when the work area changes, for instance after a Screen change). What follows the island is the *drawn rectangle*: the bounding rectangle of everything the page draws, reported by `set_frame` on every change of shape, grown at once and shrunk only after the size transition has settled (`useNativeFrame`). The window takes the mouse only while the cursor is on that rectangle: the cursor poller toggles `set_ignore_cursor_events` (`WS_EX_TRANSPARENT`) on the way in and out, polling every 16 ms within 40 px of the rectangle and every 50 ms elsewhere, so clicks beside the island reach the windows beneath and clicks on it reach the page. The page draws in work-area coordinates and needs no offset. A press "outside" (`press_outside`) is one that misses that rectangle, not the window.

Why: moving or resizing the window while the surface animates was the blink between two shapes. `SetWindowPos` moved the window, wry resized the WebView2 controller on `WM_SIZE` (asynchronously for its child HWND), and the page was presented at its new offset: nothing ties those to the same compositor frame, so any frame where one had happened without the other showed the content displaced or clipped. A window that never moves cannot race. The rectangle is not a window region (`SetWindowRgn`, tried in 0.3.2): a region makes DWM stop compositing the window with its alpha channel, so every pixel of the region the page leaves clear (the corners beside the rounded island, the shoulders) showed white.

## Language

The notch speaks French (the default) and English. It follows Ledge Desktop's language (Réglages > Général, `desktop.lang`), live. Every visible string, aria-labels and tooltips included, comes from one typed catalogue, `src/i18n/messages.ts`: `fr` and `en` have the same keys (the build fails otherwise), plurals are explicit, and relative times read "2 min" in French and "2m" in English. The French copy follows the approved mockup. Messages relayed from the daemon or the terminal are shown as they come. The unit tests and most e2e specs run in English (`setFallbackLang('en')` in `test/setup.ts`, the `lang` fixture option in `e2e/fixtures.ts`); the French ones opt in.

## Sizes (UI scales)

Every size is designed in CSS px for a 1080p work area. Settings has two sizes, each Auto, 100%, 125%, 150% or 200%, remembered separately:

- **Handle size** (`ledge.handleScale`): the resting handle on the screen edge, its bots, gaps and tick, and the "daemon unreachable" line. Auto is the primary work area's height in logical px (after Windows scaling) divided by 1080, to the nearest quarter, between 100% and 200%: 1080 px is 100%, 1440 px 125%, 1600 px 150%, 2160 px (4K at 100% Windows scaling) 200%.
- **Window size** (`ledge.panelScale`): the bubble, the list, a session, the chat, settings, help and the coachmark. Auto is the height divided by 2160, to the nearest quarter, between 100% and 200%: 100% up to a 4K work area at 100% Windows scaling, larger only on taller work areas. The list is 380 px; a session and the chat are 480 px so the header actions keep their hit area; reading the raw last reply widens the session to 560 px.

Changing one never changes the other. A value saved by an older version under `ledge.uiScale` is copied to both once. The page itself is never zoomed: the geometry (`scaledLayout` in `src/surface/geometry.ts`) lays the handle out in a screen of height / handle scale and the opened views in height / window scale, then multiplies each by its scale; each layer carries a CSS `zoom` of its own scale. Frames sent to the shell are therefore plain logical px (the Rust side is unchanged). The OS reduced-motion preference always wins. While the daemon is unreachable, and for sessions started without Ledge (read only), every send and decision path is disabled, keys included; the terminal tab button and O still bring the terminal forward.

## Your turn: the last reply read like a plan

When a session is `idle` (or `exited`) with no request pending and the daemon carries a `lastReply` (the `Stop` hook's `last_assistant_message` for Claude Code and Codex, `afterAgentResponse` for Cursor Agent), the session view shows that message structured instead of the raw terminal preview: `src/reply/parse.ts` reads the markdown into a title, a lead, sections classified by their heading (done, verified, questions, next, other) and the questions the agent asks, each with the options it proposes (a list right under the question, or "A or B?"). `src/surface/ReplyCard.tsx` renders them: green checks for what was done, monospace rows for what was verified, question cards whose chips fill the reply field (one numbered line per question when there are several), a dashed box for what is left, and ordinary lists that follow the markdown (`·` for `-`, `1.` `2.` for `1.` — not numbered cards). A toggle shows the reply as written. The terminal preview folds under the card; reading mode opens it again. The next prompt (`UserPromptSubmit`) drops the reply on the daemon side, so the view goes back to the preview while the agent works.

The parser never drops content: a reply with no structure is shown as prose under the default title. Sessions started without the launcher carry a reply too when their hooks report one; the view stays read only.

## Ask Ledge

`AskField` sits above the session rows. `/` focuses it; `Enter` on a question sends `chat.ask` with the stored default harness (`src/defaultTool.ts`, `ledge.defaultTool`); `Enter` on the empty field, or a click on the field's mascot, opens `ChatView` without asking. The view streams `chat.step` then `chat.delta`, shows sources, and turns bot names into links that open that session. `+` sends `chat.reset` (new conversation). Stop sends `chat.cancel`. One conversation a day per harness; a change of default harness starts a new one on the next question.

## Session identity

List rows group by repository (`src/surface/groups.ts`). Line 1 is the topic, line 2 is the bot's name · branch · age. Click the topic in the session header to rename it (`session.rename`, 500 characters at most); Escape cancels without closing the view. An empty topic hands back to the automatic sources (pane title, then the first prompt). The terminal tab follows `${name} · ${topic ?? project}`.

## Known V1 limits

- Focus brings the Windows Terminal window forward; it does not switch to the exact tab yet.
- Free-text answers to a question go through the dialog's own free-text row, which only Claude Code's adapter knows: for Codex and Cursor the question's free field ("Ou proposez autre chose…") is off; answer in the terminal.
- "Toujours pour cette session" (allow for the session) is shown off: no adapter confirms a scoped authorization yet.
- The review of a diff or a plan is the session's terminal preview for now.
- The last reply comes from the `Stop` hook of Claude Code and Codex, and from `afterAgentResponse` for Cursor Agent.
- The Rust shell compiles and passes its unit tests on Windows, but the runtime checks of the first build above are not all done.

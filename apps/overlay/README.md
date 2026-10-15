# Ledge overlay

The Windows overlay for Ledge: a handle on the left screen edge that opens into the list of agent sessions, grouped by repository, and a read-only chat with Ledge. The React UI lives in `src/` and is tested in WSL. The Tauri shell in `src-tauri/` builds on Windows. The overlay talks to the Ledge daemon over `ws://127.0.0.1:47831`.

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

```
pnpm --filter overlay tauri dev
pnpm --filter overlay tauri build    # NSIS installer in src-tauri/target/release/bundle
```

Needs Windows with Rust (stable MSVC), Node, pnpm and WebView2.

The installer needs no administrator rights: `installMode` is `currentUser` in `src-tauri/tauri.conf.json`, so Ledge goes under `%LOCALAPPDATA%`, its uninstall entry under HKCU, and no UAC prompt appears. Keep it that way (`perMachine` and `both` both require elevation). WebView2 is already present on Windows 11 and on an up-to-date Windows 10; if it is missing, the installer downloads the bootstrapper, which installs per user when run without elevation.

### First Windows build

The Rust side compiles on Windows and its unit tests pass (`Cargo.lock` is committed); the runtime checks below have not all been run yet. Build from a clone on the Windows disk (for example `C:\Users\<you>\Workspace\ledge`), not from the WSL path: `node_modules` must be the Windows one.

1. `pnpm install`.
2. `cd apps\overlay\src-tauri; cargo test`: all tests must pass.
3. `pnpm tauri dev` with the daemon running in WSL, then check:
   - the Ledge icon is in the notification area (tray): its tooltip and the first, greyed line of its menu read `Ledge <version> (dev)` under `tauri dev` and `Ledge <version>` once installed (the version of `package.json`, which the release workflow sets from the tag); `Quitter Ledge` (`Quit Ledge` in English, it follows Settings > Language live) closes the overlay;
   - borderless, transparent, no shadow, not in the taskbar, always on top; handle vertically centered on the left edge of the primary work area, nothing drawn twice or offset; also at 125% and 150% scaling and with the taskbar on the left;
   - resting the cursor on the handle opens the list after about 180 ms; leaving earlier does nothing; a list opened this way folds once the pointer leaves it, unless a field inside is being typed in; a click anywhere outside an open panel folds it; hovering does nothing while the daemon is down;
   - Ctrl+Alt+L from another app opens the list and gives the overlay focus (j/k/y/n work at once); pressing it again closes; an ask arriving while you type elsewhere shows the bubble without stealing focus; Ctrl+Alt+L while a bubble shows opens the list; Ctrl+Alt+N from anywhere opens the new-session form with its field focused, and again folds it;
   - with a terminal focused, Ctrl+Alt+L, then Y, then Esc: typing reaches the terminal again at once (focus is handed back, no click needed);
   - the window grows with the surface and shrinks only after the shrink animation; the coachmark (first three keyboard opens) is fully visible;
   - with the daemon stopped, "daemon injoignable, nouvelle tentative" ("daemon unreachable, retrying" in English) is fully visible beside the handle;
   - in a session, `o` or the terminal button brings Windows Terminal forward;
   - open the list with Ctrl+Alt+L while the cursor rests on the handle, then press Esc: it must not reopen while the cursor rests there;
   - open and close transitions show no flash of misplaced content;
   - clicks beside the surface reach the app underneath;
   - sizes on the 4K screen: Settings shows Handle size `Auto (200%)` and Window size `Auto (100%)` at 100% Windows scaling (see Sizes below for the rules), the handle and bots are clearly readable, the handle stays centered on the left edge, and the list opens at its base 380 px;
   - switching each size between Auto, 100%, 125%, 150% and 200% resizes only its own part, live, with nothing clipped or offset: the handle size moves the handle and its bots; the window size moves the bubble, list, session, settings, help and coachmark; the window follows the surface, hovering the handle still opens the list, clicks beside the surface still reach the app underneath;
   - with two screens: Settings shows a Screen group (`Primary`, `Screen 2`, in the OS order); choosing `Screen 2` moves the handle to that screen's left edge at once, centered in its work area, the list opens there; back to `Primary` returns it; the choice survives a restart (`ledge.monitor`); unplugging the chosen screen brings the handle back to the primary and Settings shows the choice as `Unplugged` until the screen returns; a screen plugged in after the start appears in the group the next time Settings opens.
4. `pnpm tauri build`: NSIS installer with the Ledge mascot as its icon.
5. Install it, then check launch at login (see below): the first start turns it on, Settings > Display shows `Lancer au démarrage` checked, turning it off and signing out then in leaves Ledge closed, turning it on again brings it back at the next sign-in; uninstalling removes the `Ledge` value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.

## App icon

The installer, the executable and the uninstall entry show the Ledge mascot. Its source is `src-tauri/icons/ledge-app.svg`, the resident mascot of the notch in its dark colours. After changing it, regenerate every size from `apps/overlay`, then delete the `android` and `ios` folders the command also creates:

```
pnpm tauri icon src-tauri/icons/ledge-app.svg
```

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

## Tray

The overlay has no taskbar button, so the Windows notification area carries the Ledge mascot (`icons/ledge-tray.png`, a smaller cut of the app icon without feet) to show that it runs. Its tooltip and the greyed first line of its menu give the version from `tauri.conf.json`, with `(dev)` on a debug build, so an installed Ledge and a `tauri dev` one running side by side can be told apart. The menu's `Quitter Ledge` / `Quit Ledge` exits the overlay (the daemon in WSL keeps running). The shell starts with the French label; the webview relabels it in its language (`set_tray_labels`) at start and on every language change.

## Launch at login

An installed Ledge starts with Windows: `tauri-plugin-autostart` writes a `Ledge` value (the product name) under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, no administrator rights needed. The first start of an installed build turns it on once and leaves a marker, `%APPDATA%\be.paradow.ledge\autostart-default`, so an "off" chosen later sticks across restarts. Settings > Display > `Lancer au démarrage` / `Launch at startup` reads the state from Windows each time Settings opens (it can also be changed from the Task Manager's Startup apps) and sets it (`get_autostart`, `set_autostart`). A `tauri dev` build never offers it and never turns it on: it would register a debug binary under `target\`. Uninstalling removes the Run value, the Task Manager flag and the marker (`src-tauri/windows/hooks.nsh`), so a new install starts with launch at login on again.

## Screen

The handle sits on the left edge of one screen: the primary by default, or the one chosen in Settings > Screen. The shell lists the monitors (`list_monitors`) and moves the window to the chosen one (`set_monitor`); frames are then in that screen's work-area coordinates. The choice is a monitor name (`\\.\DISPLAY2` on Windows); a chosen screen that is unplugged falls back to the primary until it comes back, without losing the setting.

### The native window never moves

The native window covers the whole work area of that screen and is placed once (`set_frame` places it again only when the work area changes, for instance after a Screen change). What follows the island is the *drawn rectangle*: the bounding rectangle of everything the page draws, reported by `set_frame` on every change of shape, grown at once and shrunk only after the size transition has settled (`useNativeFrame`). The window takes the mouse only while the cursor is on that rectangle: the cursor poller toggles `set_ignore_cursor_events` (`WS_EX_TRANSPARENT`) on the way in and out, polling every 16 ms within 40 px of the rectangle and every 50 ms elsewhere, so clicks beside the island reach the windows beneath and clicks on it reach the page. The page draws in work-area coordinates and needs no offset. A press "outside" (`press_outside`) is one that misses that rectangle, not the window.

Why: moving or resizing the window while the surface animates was the blink between two shapes. `SetWindowPos` moved the window, wry resized the WebView2 controller on `WM_SIZE` (asynchronously for its child HWND), and the page was presented at its new offset: nothing ties those to the same compositor frame, so any frame where one had happened without the other showed the content displaced or clipped. A window that never moves cannot race. The rectangle is not a window region (`SetWindowRgn`, tried in 0.3.2): a region makes DWM stop compositing the window with its alpha channel, so every pixel of the region the page leaves clear (the corners beside the rounded island, the shoulders) showed white.

## Language

The overlay speaks French (the default) and English. Settings > Langue / Language switches it live and remembers it (`ledge.lang`). Every visible string, aria-labels and tooltips included, comes from one typed catalogue, `src/i18n/messages.ts`: `fr` and `en` have the same keys (the build fails otherwise), plurals are explicit, and relative times read "2 min" in French and "2m" in English. The French copy follows the approved mockup. Messages relayed from the daemon or the terminal are shown as they come. The unit tests and most e2e specs run in English (`setFallbackLang('en')` in `test/setup.ts`, the `lang` fixture option in `e2e/fixtures.ts`); the French ones opt in.

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

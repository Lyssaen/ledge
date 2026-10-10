# Ledge overlay

The Windows overlay for Ledge: a handle on the left screen edge that opens into the list of agent sessions. The React UI lives in `src/` and is tested in WSL. The Tauri shell in `src-tauri/` builds on Windows. The overlay talks to the Ledge daemon over `ws://127.0.0.1:47831`.

## Develop (WSL)

```
pnpm --filter overlay dev                        # http://localhost:1420
pnpm --filter overlay exec tsx test/devMock.ts   # a fake daemon on 47831 with five bots
pnpm --filter overlay test
pnpm --filter overlay test:e2e                   # Playwright, the real app in Chromium
```

The dev mock needs port 47831 free: stop the real daemon first.

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

### First Windows build

The Rust side has not been compiled yet. On the first build:

1. `pnpm install`.
2. `cd apps\overlay\src-tauri; cargo test`: all tests must pass (`matches_bot_title_or_terminal`, `frame_is_placed_on_the_work_area_in_physical_px`, `edge_needs_the_left_edge_and_a_band`, `a_rearm_never_enters_but_a_real_reentry_does`). Fix compile errors first and commit the generated `Cargo.lock`.
3. `pnpm tauri dev` with the daemon running in WSL, then check:
   - borderless, transparent, no shadow, not in the taskbar, always on top; handle vertically centered on the left edge of the primary work area, nothing drawn twice or offset; also at 125% and 150% scaling and with the taskbar on the left;
   - hovering a bot shows the full tooltip, even for a long pending text;
   - cursor against the left edge above or below the handle opens the list after about 180 ms; leaving earlier does nothing; the edge does nothing while the list or a session is open, or the daemon is down;
   - Ctrl+Alt+L from another app opens the list and gives the overlay focus (j/k/digits/y/n work at once); pressing it again closes; an ask arriving while you type elsewhere shows the bubble without stealing focus; Ctrl+Alt+L while a bubble shows opens the list;
   - with a terminal focused, Ctrl+Alt+L, then Y, then Esc: typing reaches the terminal again at once (focus is handed back, no click needed);
   - the window grows with the surface and shrinks only after the shrink animation; the coachmark (first three keyboard opens) is fully visible;
   - with the daemon stopped, "daemon injoignable, nouvelle tentative" ("daemon unreachable, retrying" in English) is fully visible beside the handle;
   - in a session, `o` or the terminal button brings Windows Terminal forward;
   - open the list with Ctrl+Alt+L while the cursor rests on the left edge, then press Esc: it must not reopen until the cursor leaves the edge and comes back;
   - open and close transitions show no flash of misplaced content;
   - clicks beside the surface reach the app underneath;
   - sizes on the 4K screen: Settings shows Handle size `Auto (200%)` and Window size `Auto (100%)` at 100% Windows scaling (see Sizes below for the rules), the handle and bots are clearly readable, the handle stays centered on the left edge, and the list opens at its base 380 px;
   - switching each size between Auto, 100%, 125%, 150% and 200% resizes only its own part, live, with nothing clipped or offset: the handle size moves the handle, its bots, the tooltip and the edge bands; the window size moves the bubble, list, session, settings, help and coachmark; the window follows the surface, the edge bands above and below the handle still open the list, clicks beside the surface still reach the app underneath;
   - with two screens: Settings shows a Screen group (`Primary`, `Screen 2`, in the OS order); choosing `Screen 2` moves the handle to that screen's left edge at once, centered in its work area, the edge bands and the tooltip follow, the list opens there; back to `Primary` returns it; the choice survives a restart (`ledge.monitor`); unplugging the chosen screen brings the handle back to the primary and Settings shows the choice as `Unplugged` until the screen returns; a screen plugged in after the start appears in the group the next time Settings opens.
4. `pnpm tauri build`: NSIS installer with the bot icon.

## Keys

| Key | Action |
| --- | --- |
| Ctrl+Alt+L | open / close the list (global); over a bubble it opens the list |
| J K (or arrows) | move in the list |
| 1-9 | jump to a row in the list; choose an option inside a question card |
| Enter | open the focused row |
| Y N | approve / deny a permission ask; on a question, a diff or a plan in the list they open it instead (a diff or plan is decided from its open session, after review) |
| Alt+Right | next ask |
| R | reply |
| O | open the terminal tab |
| D | do not disturb |
| Esc | back, then close |
| ? | keyboard help, inside the surface (Esc returns to the list) |
| Ctrl+Alt+T | toggle dark / light theme |

Language, screen, theme, do not disturb, reduced motion and the two sizes are also in the list's Settings view, and are remembered in `localStorage` (`ledge.lang`, `ledge.monitor`, `ledge.theme`, `ledge.dnd`, `ledge.reducedMotion`, `ledge.handleScale`, `ledge.panelScale`).

## Screen

The handle sits on the left edge of one screen: the primary by default, or the one chosen in Settings > Screen. The shell lists the monitors (`list_monitors`) and moves the window to the chosen one (`set_monitor`); frames and edge bands are then in that screen's work-area coordinates. The choice is a monitor name (`\\.\DISPLAY2` on Windows); a chosen screen that is unplugged falls back to the primary until it comes back, without losing the setting.

## Language

The overlay speaks French (the default) and English. Settings > Langue / Language switches it live and remembers it (`ledge.lang`). Every visible string, aria-labels and tooltips included, comes from one typed catalogue, `src/i18n/messages.ts`: `fr` and `en` have the same keys (the build fails otherwise), plurals are explicit, and relative times read "2 min" in French and "2m" in English. The French copy follows the approved mockup. Messages relayed from the daemon or the terminal are shown as they come. The unit tests and most e2e specs run in English (`setFallbackLang('en')` in `test/setup.ts`, the `lang` fixture option in `e2e/fixtures.ts`); the French ones opt in.

## Sizes (UI scales)

Every size is designed in CSS px for a 1080p work area. Settings has two sizes, each Auto, 100%, 125%, 150% or 200%, remembered separately:

- **Handle size** (`ledge.handleScale`): the resting handle on the screen edge, its bots, gaps and tick, the tooltip, the "daemon unreachable" line and the edge bands. Auto is the primary work area's height in logical px (after Windows scaling) divided by 1080, to the nearest quarter, between 100% and 200%: 1080 px is 100%, 1440 px 125%, 1600 px 150%, 2160 px (4K at 100% Windows scaling) 200%.
- **Window size** (`ledge.panelScale`): the bubble, the list, a session, settings, help and the coachmark. Auto is the height divided by 2160, to the nearest quarter, between 100% and 200%: 100% up to a 4K work area at 100% Windows scaling, larger only on taller work areas.

Changing one never changes the other. A value saved by an older version under `ledge.uiScale` is copied to both once. The page itself is never zoomed: the geometry (`scaledLayout` in `src/surface/geometry.ts`) lays the handle out in a screen of height / handle scale and the opened views in height / window scale, then multiplies each by its scale; each layer carries a CSS `zoom` of its own scale. Frames and edge bands sent to the shell are therefore plain logical px (the Rust side is unchanged). The OS reduced-motion preference always wins. While the daemon is unreachable, and for sessions started without Ledge (read only), every send and decision path is disabled, keys included; the terminal tab button and O still bring the terminal forward.

## Known V1 limits

- Focus brings the Windows Terminal window forward; it does not switch to the exact tab yet.
- Free-text answers to a question are not supported by the daemon yet: the question's free field ("Ou proposez autre chose…") is off; answer in the terminal.
- "Toujours pour cette session" (allow for the session) is shown off: no adapter confirms a scoped authorization yet.
- The review of a diff or a plan is the session's terminal preview for now.
- The Rust shell is untested on a real Windows build until the first-build checks above pass.

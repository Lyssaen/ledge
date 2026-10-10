# Ledge overlay

The Windows overlay for Ledge: a handle on the left screen edge that opens into the list of agent sessions. The React UI lives in `src/` and is tested in WSL. The Tauri shell in `src-tauri/` builds on Windows. The overlay talks to the Ledge daemon over `ws://127.0.0.1:47831`.

## Develop (WSL)

```
pnpm --filter overlay dev                        # http://localhost:1420
pnpm --filter overlay exec tsx test/devMock.ts   # a fake daemon on 47831 with five bots
pnpm --filter overlay test
```

The dev mock needs port 47831 free: stop the real daemon first.

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
   - Ctrl+Alt+L from another app opens the list and gives the overlay focus (j/k/digits/y/n work at once); pressing it again closes; an ask arriving while you type elsewhere shows the bubble without stealing focus;
   - the window grows with the surface and shrinks only after the shrink animation; the coachmark (first three keyboard opens) is fully visible;
   - with the daemon stopped, "daemon unreachable, retrying" is fully visible beside the handle;
   - in a session, `o` or the terminal button brings Windows Terminal forward;
   - open the list with Ctrl+Alt+L while the cursor rests on the left edge, then press Esc: it must not reopen until the cursor leaves the edge and comes back;
   - open and close transitions show no flash of misplaced content;
   - clicks beside the surface reach the app underneath.
4. `pnpm tauri build`: NSIS installer with the bot icon.

## Keys

| Key | Action |
| --- | --- |
| Ctrl+Alt+L | open / close the list (global) |
| J K (or arrows) | move in the list |
| 1-9 | jump to a row in the list; choose an option inside a question card |
| Enter | open the focused row |
| Y N | approve / deny a yes/no ask; on a question they open it instead |
| Alt+Right | next ask |
| R | reply |
| O | open the terminal tab |
| D | do not disturb |
| Esc | back, then close |
| ? | show keys |
| Ctrl+Alt+T | toggle dark / light theme |

Theme and do-not-disturb are remembered in `localStorage` (`ledge.theme`, `ledge.dnd`).

## Known V1 limits

- Focus brings the Windows Terminal window forward; it does not switch to the exact tab yet.
- The Rust shell is untested on a real Windows build until the first-build checks above pass.

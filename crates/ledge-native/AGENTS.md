# crates/ledge-native

Win32 helpers shared by Ledge Desktop and its island: autostart, browser opening, the daemon token, desktop
integration, PTYs (`portable-pty`), shells, Windows Terminal focus and opening (`wt.exe`), WSL keep-alive.

## Build and test

- The `windows` crate sits behind `cfg(windows)`: from WSL only the portable code compiles.
- `cargo test --workspace` runs on CI's Windows runner (`.github/workflows/release.yml`). When a change could not be
  built or tested on Windows, say so in the report.

## Rules

- Everything that crosses into WSL (`wsl.exe`, paths, the daemon token) handles a stopped or slow WSL without hanging
  the app.
- No token value in a log or an error.

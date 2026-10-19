# Embedded terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The session view's terminal pane becomes a real interactive terminal: the agent's live tmux screen and the user's own shells, for local (WSL) and SSH sessions, in a resizable column on the right.

**Architecture:** A pseudo-terminal lives in the Tauri process (`portable-pty`, ConPTY on Windows) and spawns `wsl.exe --exec <argv>`. The argv comes from `@ledge/fleet`, the same way the external tab gets it today. Bytes stream to the webview over a Tauri `Channel` as raw `ArrayBuffer`s. The webview renders with xterm.js. A non-React `TermStore` owns the tabs, the pseudo-terminals and the xterm instances, so a shell survives navigation and hiding the pane. `TermPane` replaces `TerminalPane` in `Workspace.tsx` and draws the mockup's heading, banners and footer.

**Tech Stack:** Rust (`portable-pty` 0.9, tauri 2.6 `ipc::Channel`), React 19 + TS, `@xterm/xterm` 5.5.0, `@xterm/addon-fit` 0.10.0, `@xterm/addon-webgl` 0.18.0, `@xterm/addon-web-links` 0.11.0, vitest + testing-library, playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-embedded-terminal-design.md`. The mockup is https://claude.ai/artifact/Q196g4ggDopZDfRYqvPHgu, with boards `Main`, `T1Agent` … `T4SansTmux` and their `Dark*` versions, and components `TermPane` and `Session`.

## Global Constraints

- Work on a branch `feat/embedded-terminal`, never on `main`. The first commit adds the spec and this plan.
- The mockup is the reference for structure, copy and states (user's rule: « avant de modifier du code il faut update les maquettes »). A visible change it does not show goes into the mockup first.
- All copy lives in `apps/desktop/src/i18n/fr.ts` and `en.ts`. The French follows `fr.ts`'s « vous », so the mockup's « Ton shell reste disponible » becomes « Votre shell reste disponible ».
- Colours come from tokens only, in both themes. The xterm theme is read from CSS custom properties, never hard-coded in TS.
- Every argv that reaches `wsl.exe` passes `wslArg` (TS) and `wsl_arg_ok` (Rust): no `"`, no control character, no trailing `\`, never empty.
- No shell persistence across Ledge restarts. A shell ends when its tab closes or Ledge quits.
- The browser build (no Tauri) keeps today's read-only preview.
- The external terminal (`openSessionTerminal`) is reached only from the pane's « Ouvrir dans un terminal externe ».
- The focus key is `Ctrl` + `e.code === 'Backquote'`. While focus is inside `[data-terminal]`, Ledge's own shortcuts (Ctrl+K, Ctrl+,, Esc, Alt+digits, single letters) do not fire.
- Comments and naming match the surrounding code: one-line doc comments that say why, French product terms quoted « like this ».

## Review Focus

1. **The worktree folder is gone.** The agent left its worktree and it was removed, or `workdir` points to a folder that no longer exists. The user expects a shell anyway, in the home folder, rather than a tab that dies at once. Pinned in Task 1 (`cd '<dir>' 2>/dev/null || cd`).
2. **A folder or launcher with a `"` or a trailing `\`.** No shell must be spawned with a mangled argv. The tab says the shell can't open, and nothing crashes. Pinned in Task 1 (`null`), Task 5 (`unavailable`) and Task 6 (the tab shows `shellUnavailable`).
3. **Fast output.** `cargo build`, or Claude Code redrawing its whole screen, emits megabytes per second. The pane must stay responsive and must not grow memory without bound: chunks are batched, never sent as JSON number arrays, and scrollback is capped. Pinned in Task 2 (raw channel) and Task 4 (`scrollback: 5000`).
4. **Switching sessions during a reconnect.** The user leaves an SSH session while its agent tab is waiting to retry. The timer must not fire against a session that is no longer shown, and must not open two attachments. Pinned in Task 5.
5. **Pasting while the agent asks a question.** A multi-line paste into Claude Code must arrive as one bracketed paste, not as keystrokes that submit line by line. Pinned in Task 4 (`term.paste`, never the raw input path).

---

### Task 1: Argv for shells and read-only attach

**Files:**
- Modify: `packages/fleet/src/machines.ts:23-30,106-118` (`MachineSource`-side interface with `terminal(id)`, `quote`, `wslArg`, `terminalCommand`)
- Modify: `packages/fleet/src/fleet.ts:356` (`terminal`, new `shell`)
- Modify: `packages/ledge/src/tmux.ts:21,107` (`attachArgs`)
- Modify: `packages/ledge/src/cli/attach.ts`, `packages/ledge/src/cli/index.ts:3,43`
- Test: `packages/fleet/test/fleet.test.ts`, `packages/ledge/test/attach.test.ts`, `packages/ledge/test/tmux.test.ts`

**Interfaces:**
- Produces:
  - `terminalCommand(machine: MachineState, rawId: string, opts?: { readOnly?: boolean }): string[] | null`
  - `shellCommand(machine: MachineState, dir: string): string[] | null`
  - On the fleet: `terminal(id: string, opts?: { readOnly?: boolean }): string[] | null` and `shell(id: string): string[] | null`. The second uses the session's `workdir ?? cwd`.
  - `tmux.attachArgs(name: string, opts?: { readOnly?: boolean }): string[]`
  - `ledge attach [--read-only] <id>`

- [ ] **Step 1: Write the failing tests**

```ts
// fleet.test.ts
it('a read-only attach asks ledge for it, locally and through ssh', () => {
  expect(terminalCommand(local, 'a1', { readOnly: true })).toEqual([...local.launcher!, 'attach', '--read-only', 'a1']);
  expect(terminalCommand(remote, 'a1', { readOnly: true })!.at(-1)).toBe("'ledge' 'attach' '--read-only' 'a1'");
});
it('a shell starts in the folder, falls back to home, and runs the login shell', () => {
  expect(shellCommand(local, '/home/u/w t')).toEqual(['sh', '-c', "cd '/home/u/w t' 2>/dev/null || cd; exec $(getent passwd $(id -un) | cut -d: -f7) -l"]);
  expect(shellCommand(remote, "/srv/it's")).toEqual(['ssh', '-t', '--', 'build-01', "cd '/srv/it'\\''s' 2>/dev/null || cd; exec $SHELL -l"]);
});
it('no shell for a folder wsl.exe would mangle', () => {
  expect(shellCommand(local, '/w/"x"')).toBeNull();
  expect(shellCommand(local, '/w/x\\')).toBeNull();
  expect(shellCommand(local, '')).toBeNull();
});
it('the fleet opens a shell in the folder the agent moved into', () => {
  // session local:a1 with cwd '/r' and workdir '/r/.worktrees/x'
  expect(fleet.shell('local:a1')!.at(-1)).toContain("cd '/r/.worktrees/x'");
  expect(fleet.shell('local:nope')).toBeNull();
});
```

```ts
// tmux.test.ts
expect(t.attachArgs('ledge-a', { readOnly: true }).slice(-4)).toEqual(['attach-session', '-r', '-t', '=ledge-a']);
// attach.test.ts
it('--read-only attaches with tmux -r', async () => { /* index entry: ['attach', '--read-only', 'a'] → attach('a', { readOnly: true }) → args include '-r' */ });
```

- [ ] **Step 2: Run them, they fail**

Run: `pnpm --filter @ledge/fleet test -- fleet` and `pnpm --filter @paradow/ledge test -- attach tmux`
Expected: FAIL. `shellCommand` is not exported, `readOnly` is ignored.

- [ ] **Step 3: Implement**

- `shellCommand` builds the script `cd ${quote(dir)} 2>/dev/null || cd; exec <login> -l`. Locally `<login>` is `$(getent passwd $(id -un) | cut -d: -f7)`, run through `['sh', '-c', script]`. Remotely it is `$SHELL`, through `['ssh', '-t', '--', machine.ssh, script]`. The result is `null` unless `dir !== ''` and every element passes `wslArg`. Neither script contains a `"`, so `wslArg` accepts them.
- `AttachOptions` gains `readOnly?: boolean`. The CLI takes `--read-only` anywhere in `rest`, and the id is the first argument that does not start with `--`. The usage line becomes `ledge attach [--read-only] <id>`.

- [ ] **Step 4: Run them, they pass**

Same commands. Expected: PASS. `pnpm typecheck` is clean.

- [ ] **Step 5: Commit**

`git commit -m "feat(fleet): argv for a shell in the agent's folder and a read-only attach"`

---

### Task 2: A pseudo-terminal in the Tauri process

**Files:**
- Create: `crates/ledge-native/src/pty.rs`
- Modify: `crates/ledge-native/Cargo.toml` (`portable-pty = "0.9"`, all targets), `crates/ledge-native/src/lib.rs` (`pub mod pty;`)
- Create: `apps/desktop/src-tauri/src/pty.rs` (commands + `PtyState`)
- Modify: `apps/desktop/src-tauri/src/main.rs` (`mod pty;`, `.manage(pty::PtyState::default())`, `invoke_handler` around line 209)

**Interfaces:**
- Produces (Rust, ledge-native):
  - `pub fn wsl_command(argv: &[String]) -> Option<Vec<String>>` returns `["--exec", ..argv]`, or `None` when `argv` is empty or any element fails `terminal::wsl_arg_ok`.
  - `pub struct Pty`, with `pub fn spawn(program: &str, args: &[String], cols: u16, rows: u16, on_data: impl FnMut(&[u8]) + Send + 'static, on_exit: impl FnOnce(Option<u32>) + Send + 'static) -> io::Result<Pty>`
  - `Pty` methods `write(&self, &[u8]) -> io::Result<()>`, `resize(&self, cols, rows) -> io::Result<()>` and `kill(&self)`. `Drop` kills the child.
- Produces (Tauri commands; JS names in camelCase):
  - `pty_open(argv: Vec<String>, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>, on_exit: Channel<Option<u32>>) -> Result<u32, String>` sends each chunk as `InvokeResponseBody::Raw`.
  - `pty_write(id: u32, data: String)`, `pty_resize(id: u32, cols: u16, rows: u16)` and `pty_close(id: u32)` return `Result<(), String>`. An unknown id is `Ok(())`.

- [ ] **Step 1: Write the failing tests** (in `crates/ledge-native/src/pty.rs`; `spawn` takes any program, so the tests use `sh` and run on Linux)

```rust
#[test] fn wsl_command_refuses_what_wsl_would_mangle() {
    assert_eq!(wsl_command(&["sh".into(), "-c".into(), "cd '/w' || cd".into()]), Some(vec!["--exec".into(), "sh".into(), "-c".into(), "cd '/w' || cd".into()]));
    assert_eq!(wsl_command(&[]), None);
    assert_eq!(wsl_command(&["a\"b".into()]), None);
}
#[test] fn streams_output_then_exit_code() { /* spawn("sh", ["-c","printf hi; exit 3"]) → collected bytes contain b"hi", on_exit gets Some(3) */ }
#[test] fn input_reaches_the_child() { /* spawn("cat") → write(b"ping\n") → output contains b"ping" */ }
#[test] fn kill_ends_it() { /* spawn("sleep", ["30"]) → kill() → on_exit within 2 s */ }
```

- [ ] **Step 2: Run them, they fail**

Run: `cargo test -p ledge-native pty`
Expected: FAIL to compile, because `pty` does not exist.

- [ ] **Step 3: Implement**

- `spawn` uses `native_pty_system().openpty(PtySize { rows, cols, .. })` and `CommandBuilder::new(program).args(args)`.
- One reader thread reads 16 KiB at a time and calls `on_data`.
- A wait thread calls `on_exit(status.exit_code())` on exit, or `None` when killed through `kill`.
- `PtyState(Mutex<HashMap<u32, Pty>>)` uses an `AtomicU32` id.
- `pty_open` validates with `wsl_command`, spawns `wsl.exe` with it, removes the entry on exit and sends `on_exit`. Run `pty_open` with `spawn_blocking`, like `daemon_token`.
- Off Windows, the Tauri command returns `Err("windows only")`.

- [ ] **Step 4: Run them, they pass**

Run: `cargo test -p ledge-native`, then `cargo xwin check -p ledge-desktop --target x86_64-pc-windows-msvc` (the no-admin cross-compile setup of `windows-overlay-build.md`).
Expected: PASS, and the check is clean.

- [ ] **Step 5: Commit**

`git commit -m "feat(native): a pseudo-terminal the desktop app spawns wsl.exe in"`

---

### Task 3: The webview's PTY backend

**Files:**
- Create: `apps/desktop/src/term/backend.ts`
- Modify: `apps/desktop/src/tauri/bridge.ts` (header comment lists the four `pty_*` commands; `openPty`)
- Modify: `apps/desktop/src/main.tsx:16-18` (e2e fake, beside `__ledgeToasts`)
- Test: `apps/desktop/test/bridge.test.ts`, `apps/desktop/test/term-backend.test.ts`

**Interfaces:**
- Consumes: the Task 2 commands.
- Produces:

```ts
export interface PtyHandle { write(data: string): void; resize(cols: number, rows: number): void; close(): void }
export interface PtyEvents { data(bytes: Uint8Array): void; exit(code: number | null): void }
export interface PtyBackend { open(argv: string[], size: { cols: number; rows: number }, on: PtyEvents): Promise<PtyHandle | null> }
// bridge.ts
export function openPty(argv: string[], size: { cols: number; rows: number }, on: PtyEvents): Promise<PtyHandle | null>
// backend.ts — Tauri's openPty in the app, the e2e fake (window.__ledgeFakePty) in the e2e build, null in the browser build
export function ptyBackend(): PtyBackend | null
```

- [ ] **Step 1: Write the failing tests**

```ts
// bridge.test.ts: Channel is mocked from '@tauri-apps/api/core' with an onmessage the test drives
it('opens a pty with the Rust argument names and streams raw bytes', async () => {
  inTauri(); core.invoke.mockResolvedValueOnce(7);
  const data = vi.fn(), exit = vi.fn();
  const pty = await openPty(['sh'], { cols: 80, rows: 24 }, { data, exit });
  expect(core.invoke).toHaveBeenCalledWith('pty_open', expect.objectContaining({ argv: ['sh'], cols: 80, rows: 24 }));
  channels[0]!.onmessage(new Uint8Array([104, 105]).buffer); expect(data).toHaveBeenCalledWith(new Uint8Array([104, 105]));
  channels[1]!.onmessage(3); expect(exit).toHaveBeenCalledWith(3);
  pty!.write('ls\r'); expect(core.invoke).toHaveBeenCalledWith('pty_write', { id: 7, data: 'ls\r' });
});
it('null when the shell refuses, and outside the app', async () => { /* invoke rejects → null; no __TAURI_INTERNALS__ → null, invoke not called */ });
// term-backend.test.ts
it('no backend in the browser build', () => { expect(ptyBackend()).toBeNull(); });
```

- [ ] **Step 2: Run them, they fail**

Run: `pnpm --filter desktop test -- bridge term-backend`
Expected: FAIL, because `openPty` is not exported.

- [ ] **Step 3: Implement**

Follow the `onOpenTarget` pattern: once `close()` has run, a `disposed` flag stops further `data` calls. `close` invokes `pty_close`.

The e2e fake is `{ open }`. It echoes what is written after a `$ ` prompt and records each write in `window.__ledgePtyWrites`. It is installed only under `import.meta.env.VITE_LEDGE_E2E`.

- [ ] **Step 4: Run them, they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(desktop): the webview's side of the pseudo-terminal"`

---

### Task 4: The terminal surface: xterm, theme, keys

**Files:**
- Modify: `apps/desktop/package.json` (the four `@xterm/*` packages, exact versions from Tech Stack)
- Create: `apps/desktop/src/term/surface.ts` (xterm wrapper), `apps/desktop/src/term/keys.ts`, `apps/desktop/src/term/theme.ts`
- Modify: the stylesheet that defines `--well` for both themes: add `--term-ansi-0` … `--term-ansi-15`, `--term-cursor` and `--term-selection`
- Test: `apps/desktop/test/term-keys.test.ts`, `apps/desktop/test/term-theme.test.ts`, `apps/desktop/test/term-surface.test.ts` (`@xterm/xterm` and its addons mocked with `vi.mock`)

**Interfaces:**
- Produces:

```ts
// surface.ts — one xterm and the element it lives in; the element is moved between containers, never re-created
export interface TermSurface { host: HTMLElement; write(b: Uint8Array | string): void; onInput(fn: (data: string) => void): void; onResize(fn: (cols: number, rows: number) => void): void;
  size(): { cols: number; rows: number }; fit(): void; focus(): void; setReadOnly(on: boolean): void; setTheme(t: TermTheme): void; dispose(): void }
export function createSurface(opts: { theme: TermTheme; onThread(): void }): TermSurface
// keys.ts
export type TermKey = 'thread' | 'copy' | 'paste' | 'pass';
export function termKey(e: Pick<KeyboardEvent, 'type' | 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, hasSelection: boolean): TermKey
export function backquoteLabel(): Promise<string>   // navigator.keyboard layout map's 'Backquote', else '`'
// theme.ts
export type TermTheme = import('@xterm/xterm').ITheme;
export function termTheme(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): TermTheme
```

- [ ] **Step 1: Write the failing tests**

```ts
const k = (o: Partial<KeyboardEvent>) => ({ type: 'keydown', code: '', key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
it('Ctrl + the key left of 1 gives the keyboard back, on any layout', () => {
  expect(termKey(k({ ctrlKey: true, code: 'Backquote', key: '²' }), false)).toBe('thread');
});
it('Ctrl C copies a selection, else interrupts; Ctrl Shift C always copies', () => {
  expect(termKey(k({ ctrlKey: true, code: 'KeyC', key: 'c' }), true)).toBe('copy');
  expect(termKey(k({ ctrlKey: true, code: 'KeyC', key: 'c' }), false)).toBe('pass');
  expect(termKey(k({ ctrlKey: true, shiftKey: true, code: 'KeyC', key: 'C' }), false)).toBe('copy');
});
it('Ctrl V and Ctrl Shift V paste; Ctrl K, Escape and the rest go to the terminal', () => {
  expect(termKey(k({ ctrlKey: true, code: 'KeyV', key: 'v' }), false)).toBe('paste');
  expect(termKey(k({ ctrlKey: true, shiftKey: true, code: 'KeyV', key: 'V' }), false)).toBe('paste');
  for (const e of [k({ ctrlKey: true, code: 'KeyK', key: 'k' }), k({ code: 'Escape', key: 'Escape' }), k({ ctrlKey: true, code: 'KeyR', key: 'r' })]) expect(termKey(e, false)).toBe('pass');
});
it('the theme comes from the tokens', () => {
  const s = { getPropertyValue: (n: string) => ({ '--well': '#101112', '--text': '#eee', '--term-ansi-1': '#c33' } as Record<string, string>)[n] ?? '' };
  expect(termTheme(s)).toMatchObject({ background: '#101112', foreground: '#eee', red: '#c33' });
});
// term-surface.test.ts
it('Ctrl V pastes the clipboard as one paste; an empty clipboard sends the raw byte', async () => {
  /* clipboard 'a\nb' → fake Terminal.paste('a\nb'), onInput never called with 'a\nb'; clipboard '' → onInput('\x16') */
});
it('the focus key leaves the terminal without reaching the window', () => { /* handler(Ctrl+Backquote) → onThread called, stopPropagation called, returns false */ });
```

- [ ] **Step 2: Run them, they fail**

Run: `pnpm --filter desktop test -- term-keys term-theme term-surface`
Expected: FAIL, the modules are missing.

- [ ] **Step 3: Implement**

- `createSurface` creates `new Terminal({ scrollback: 5000, fontFamily: 'Geist Mono, monospace' })` and loads fit, web-links, and WebGL with a fallback to the DOM renderer when `onContextLoss` fires or the WebGL addon throws.
- `attachCustomKeyEventHandler` maps `termKey` to actions:
  - `thread` calls `onThread()` and `e.stopPropagation()`, because focus has already left the terminal when the event reaches `useKeys`, which would otherwise send it straight back;
  - `copy` writes `getSelection()` to the clipboard, then clears the selection;
  - `paste` reads the clipboard, calls `term.paste(text)` when there is text, and otherwise sends `'\x16'` through the input callbacks;
  - these three return `false` and `preventDefault()`. `pass` returns `true`.
- `setReadOnly(true)` drops input and hides the cursor.
- The host element carries `data-terminal`.

- [ ] **Step 4: Run them, they pass**

Same command. Expected: PASS. `pnpm typecheck` is clean.

- [ ] **Step 5: Commit**

`git commit -m "feat(desktop): an xterm surface themed from Ledge's tokens, with Windows Terminal's copy and paste"`

---

### Task 5: The terminal store: tabs, shells, the agent's attachment

**Files:**
- Create: `apps/desktop/src/term/mode.ts`, `apps/desktop/src/term/store.ts`, `apps/desktop/src/term/useTerms.ts`
- Test: `apps/desktop/test/term-mode.test.ts`, `apps/desktop/test/term-store.test.ts`

**Interfaces:**
- Consumes: `PtyBackend` (Task 3), `TermSurface` (Task 4), and the fleet's `terminal` and `shell` (Task 1).
- Produces:

```ts
// mode.ts — what the agent tab can be
export type AgentMode =
  | { kind: 'live' } | { kind: 'parent'; parentId: string }        // a subagent: its parent, read-only
  | { kind: 'offline' } | { kind: 'preview'; why: 'outside' | 'ended' } | { kind: 'browser' };
export function agentMode(s: Session, helper: { id: string } | null, hasBackend: boolean): AgentMode
// order: browser → offline (s.offline) → preview ended (isArchived(s) || s.state === 'exited') → preview outside (s.tmuxSession === null) → parent (helper) → live
export function reconnectDelay(attempt: number): number   // 1000, 2000, 4000, 8000, then 15000 for every later attempt

// store.ts
export type Tab = { kind: 'agent'; id: string }
  | { kind: 'shell'; id: string; n: number; dir: string; remote: boolean; status: 'idle' | 'running' | 'ended' | 'unavailable'; end?: { code: number | null; lost: boolean } };
export type AgentLink = { state: 'attached' | 'reconnecting' | 'off'; attempt: number; retryAt?: number };
export const agentTabId = (sessionId: string): string => `${sessionId}#agent`;
export interface TermDeps { backend: PtyBackend | null; surface(): TermSurface; agentArgv(id: string, readOnly: boolean): string[] | null; shellArgv(id: string): string[] | null; now?(): number; setTimeout?: typeof setTimeout }
export class TermStore {
  constructor(deps: TermDeps)
  tabs(sessionId: string): readonly Tab[]          // first call: [agent, shell 1 (idle)]
  active(sessionId: string): string                // in memory only; default the agent tab
  select(sessionId: string, tabId: string): void   // an idle shell starts here
  addShell(sessionId: string, dir: string, remote: boolean): string
  close(sessionId: string, tabId: string): void    // kills the shell, no confirm; the agent tab cannot close
  reopen(sessionId: string, tabId: string): void   // an ended shell starts again in the same tab
  showAgent(sessionId: string, mode: AgentMode): void   // the pane shows this session: attach (live / parent) or detach
  hideAgent(): void                                 // the pane is hidden or another session is shown: detach, cancel any retry
  retryNow(sessionId: string): void
  link(sessionId: string): AgentLink
  offlineSince(sessionId: string): number | undefined   // first time this run saw it offline (showAgent with 'offline'); cleared when live again
  surface(tabId: string): TermSurface | undefined
  subscribe(fn: () => void): () => void
}
// useTerms.ts — useSyncExternalStore over the store, from a context App provides
export const TermStoreContext: React.Context<TermStore | null>;
export function useTerms(sessionId: string): { tabs: readonly Tab[]; active: string; link: AgentLink; store: TermStore }
```

- [ ] **Step 1: Write the failing tests** (a fake backend records opens and lets the test drive `data` and `exit`; a fake surface records writes; fake timers)

```ts
it('the agent tab is live, a subagent sees its parent, an offline or launched-elsewhere session gets the preview', () => {
  expect(agentMode(live, null, true)).toEqual({ kind: 'live' });
  expect(agentMode(live, { id: 'h1' }, true)).toEqual({ kind: 'parent', parentId: live.id });
  expect(agentMode({ ...live, offline: true }, { id: 'h1' }, true)).toEqual({ kind: 'offline' });
  expect(agentMode({ ...live, tmuxSession: null }, null, true)).toEqual({ kind: 'preview', why: 'outside' });
  expect(agentMode({ ...live, state: 'exited' }, null, true)).toEqual({ kind: 'preview', why: 'ended' });
  expect(agentMode(live, null, false)).toEqual({ kind: 'browser' });
});
it('backs off 1, 2, 4, 8 then 15 s', () => { expect([1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]); });
it('a shell starts when first shown and survives hiding the pane and other sessions', () => {
  const st = store(); const [, shell] = st.tabs('local:a');
  expect(backend.opens).toHaveLength(0);
  st.select('local:a', shell!.id); expect(backend.opens.at(-1)!.argv).toEqual(shellArgv('local:a'));
  st.hideAgent(); st.showAgent('local:b', { kind: 'live' });
  expect(backend.closed).not.toContain(shell!.id);
});
it('closing a shell kills it at once; « + » numbers the next', () => { /* close → handle.close called; addShell → n = 2 */ });
it('an ssh shell whose connection drops ends with « lost », and is never restarted by itself', () => {
  /* remote shell, exit(255) → status 'ended', end { code: 255, lost: true }; advance 60 s → no new open; reopen → new open */
});
it('the agent tab attaches read-only for a subagent', () => { /* showAgent(id, {kind:'parent'}) → agentArgv called with readOnly true, surface.setReadOnly(true) */ });
it('the agent reconnects with backoff, and stops when the session is left', () => {
  /* live attach, exit(255) → link reconnecting attempt 1, retryAt now+1000; advance 1000 → one new open;
     exit again → attempt 2; hideAgent() → advance 60 s → no further open; retryNow while hidden → nothing */
});
it('a machine going offline stops the retries; coming back attaches again', () => { /* showAgent(id, {kind:'offline'}) → off, timer cleared; showAgent(id, {kind:'live'}) → one open */ });
it('a shell with no argv is unavailable, not crashed', () => { /* shellArgv → null; select → status 'unavailable', no open */ });
it('the session ends: its shells stay open until their tab closes', () => { /* running shell; showAgent(id, {kind:'preview', why:'ended'}) → shell still 'running', handle not closed */ });
```

- [ ] **Step 2: Run them, they fail**

Run: `pnpm --filter desktop test -- term-mode term-store`
Expected: FAIL, the modules are missing.

- [ ] **Step 3: Implement**

The rules come from the spec:
- Every exit of a live agent attachment counts as a dropped connection while the session is still live. tmux redraws on re-attach, so the agent tab detaches cheaply when it is not shown. Shells never detach.
- `lost` is set when the shell is remote and exits with code 255, which is `ssh`'s code for a connection failure.
- Each surface's `onInput` goes to its handle's `write`, and `onResize` goes to `resize`.
- `showAgent` for the same session and the same mode does nothing, so re-renders open no second attachment.

- [ ] **Step 4: Run them, they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(desktop): a terminal store that keeps shells alive and reconnects the agent's screen"`

---

### Task 6: The pane: heading, tabs, banners, footer

**Files:**
- Create: `apps/desktop/src/session/TermPane.tsx` (replaces `TerminalPane.tsx`). Delete `TerminalPane.tsx` and move its preview body into `TermPane`'s preview mode.
- Modify: `apps/desktop/src/i18n/fr.ts` and `en.ts`: the `session.terminal` block around line 486 gains the keys below
- Modify: `apps/desktop/src/styles/session.css` (pane heading tabs, banner, footer)
- Test: `apps/desktop/test/term-pane.test.tsx` (TermStore with fake deps; `TermSurface` stubbed)

**Interfaces:**
- Consumes: `useTerms` and `agentMode` (Task 5), and `openSessionTerminal` (`session/terminal.ts`).
- Produces: `TermPane(p: { client: DaemonClient; session: Session; helper: { id: string; name: string } | null; notify(text: string): void; maxed: boolean; onMax(): void; onClose(): void; onGoParent(): void }): JSX.Element`. On a subagent's page `session` is the parent, so the parent's name is `session.name`.

Copy. French is fixed below; `en.ts` translates it in the same keys:

| key | fr |
|---|---|
| `agentTab(n)` | `${n} · agent` |
| `shellTab(n, dir)` | `${n === 1 ? 'Shell' : `Shell ${n}`} · ${dir}` |
| `addShell` | `Nouveau shell` |
| `closeTab(label)` | `Fermer ${label}` |
| `local` | `wsl` |
| `remote(host)` | `ssh · ${host}` |
| `external` | `Ouvrir dans un terminal externe` |
| `max` / `unmax` | `Agrandir le terminal` / `Réduire le terminal` |
| `attached` / `attachedSsh` / `reconnecting` / `readOnly` / `offline` / `preview` | `Attaché` / `Attaché par SSH` / `Reconnexion…` / `Lecture seule` / `Hors ligne` / `Aperçu · lecture seule` |
| `noTmux` | `aucune session tmux` |
| `lost(host, s, attempt, name)` | `Connexion à ${host} perdue. Nouvelle tentative dans ${s} s (essai ${attempt}). ${name} continue de travailler sur le serveur.` |
| `reconnect` | `Reconnecter` |
| `offlineBanner(host, time)` | `${host} ne répond plus depuis ${time}. Dernière sortie conservée ; rien ne peut être tapé.` (no time known: `${host} ne répond plus. Dernière sortie conservée ; rien ne peut être tapé.`) |
| `retry` | `Réessayer` |
| `subagent(h, p)` | `${h} est un sous-agent de ${p} et n’a pas de terminal à lui : voici l’écran de ${p}, en lecture seule.` |
| `goParent(p)` | `Aller à ${p}` |
| `outside(n)` | `${n} a été lancée hors de Ledge : pas d’écran à rattacher. Voici ses dernières lignes, en lecture seule. Votre shell reste disponible.` |
| `ended(n)` | `${n} est terminée : voici ses dernières lignes, en lecture seule. Votre shell reste disponible.` |
| `shellIntro(n, dir)` / `shellIntroSsh(host, n, dir)` | `Shell ouvert dans le dossier de ${n} : ${dir}` / `Shell sur ${host}, dans le dossier de ${n} : ${dir}` |
| `shellEnded(code)` / `shellLost` | `Shell terminé (code ${code})` / `Shell terminé : connexion perdue` |
| `reopen` | `Rouvrir` |
| `shellUnavailable` | `Ce dossier ne peut pas être ouvert dans un shell.` |
| `toTerminal(k)` / `toThread(k)` | `Donner le clavier au terminal · Ctrl ${k}` / `Le clavier va au terminal · revenir au fil : Ctrl ${k}` |

- [ ] **Step 1: Write the failing tests**

```ts
it('heading: agent tab, shell tab, « + », machine chip, external, enlarge, close', () => {
  render(<Pane session={nova} />);
  expect(screen.getByRole('tab', { name: 'Nova · agent' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' })).toBeInTheDocument();
  expect(screen.getByText('wsl')).toBeInTheDocument();
  for (const n of ['Nouveau shell', 'Ouvrir dans un terminal externe', 'Agrandir le terminal']) expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
});
it('footer says attached, by ssh on a remote machine', () => { /* local → 'Attaché' + 'ledge-<id>'; remote → 'Attaché par SSH' + chip 'ssh · build-01' */ });
it('a lost connection shows the countdown and « Reconnecter » retries now', () => { /* drive exit(255) → banner text lost('build-01', 1, 1, 'Mira'); click → backend.opens grows */ });
it('a subagent sees its parent read-only, with « Aller à Nova »', () => { /* banner subagent('Iris','Nova'); footer 'Lecture seule'; click → onGoParent */ });
it('offline: frozen preview lines, no input, « Réessayer »', () => { /* session.offline → preview lines from useDaemon().previews; 'Hors ligne'; Réessayer calls client.fleet.retry(machineId) */ });
it('launched outside Ledge: the preview and its banner; the shell tab still works', () => { /* tmuxSession null → outside('Nova'), 'aucune session tmux'; click shell tab → backend open */ });
it('an ended shell offers « Rouvrir »; a lost ssh one says so', () => { /* exit(0) → 'Shell terminé (code 0)'; remote exit(255) → 'Shell terminé : connexion perdue'; Rouvrir → open */ });
it('a folder that cannot open says so in its tab', () => { /* shellArgv → null; click shell tab → shellUnavailable text, no open */ });
it('the browser build keeps the read-only preview', () => { /* backend null → no tabs, preview lines, footer 'Lecture seule' as today */ });
```

- [ ] **Step 2: Run them, they fail**

Run: `pnpm --filter desktop test -- term-pane`
Expected: FAIL.

- [ ] **Step 3: Implement**

The pane follows the mockup's `TermPane`: heading (tabs with `role="tablist"`), optional banner, body, footer.
- The body mounts the active tab's `surface(tabId).host` into a container `ref` with `appendChild`. It never re-creates the surface, and it calls `fit()` on mount and through a `ResizeObserver`.
- Preview modes render today's preview lines.
- The shell tab's first line is the intro, written to the surface before the shell's own output.
- The external button calls `openSessionTerminal` and notifies `openFailed` on failure. Remove the now unused `open` key.

- [ ] **Step 4: Run them, they pass**

Same command, plus `pnpm --filter desktop test` (the whole suite: `session-workspace` and `session-pane` must stay green). Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(desktop): the terminal pane, its tabs and its states, as in the mockup"`

---

### Task 7: The column: width, enlarge, wiring in Workspace and App

**Files:**
- Modify: `apps/desktop/src/session/prefs.ts` (`termWidth`)
- Modify: `apps/desktop/src/session/Workspace.tsx` (TermPane, the drag handle, `maxed`, `showAgent`/`hideAgent`)
- Modify: `apps/desktop/src/App.tsx` (create the `TermStore` once, provide `TermStoreContext`)
- Modify: `apps/desktop/src/styles/session.css:12,30-31` (grid from `termWidth`; `maxed` hides the conversation)
- Test: `apps/desktop/test/session-workspace.test.tsx`, `apps/desktop/test/session.test.tsx` (prefs)

**Interfaces:**
- Consumes: `TermPane` (Task 6) and `TermStore` (Task 5).
- Produces:
  - `SessionPrefs { terminal: boolean; split: number; termWidth: number }`
  - `clampTermWidth(v: number): number` with `TERM_MIN = 0.28`, `TERM_MAX = 0.7` and a default of `0.46` (today's `1fr` next to `1.15fr`).
  - Workspace sets the CSS variable `--term-width` on `.conversation-workspace`.

- [ ] **Step 1: Write the failing tests**

```ts
it('the width persists and is clamped; old prefs get the default', () => {
  expect(loadSessionPrefs().termWidth).toBe(0.46);            // stored { terminal: true, split: 0.5 }
  expect(clampTermWidth(0.9)).toBe(0.7); expect(clampTermWidth(0.1)).toBe(0.28);
});
it('dragging or arrowing the handle resizes the column', () => {
  /* role=separator aria-label 'Largeur du terminal'; ArrowLeft → setPrefs termWidth + 0.02 (the column grows to the left) */
});
it('enlarging hides the thread, the button reduces it again', () => { /* click 'Agrandir le terminal' → .conversation hidden; 'Réduire le terminal' */ });
it('the agent attaches while the pane shows the session, and detaches when hidden', () => {
  /* render with prefs.terminal → store.showAgent(id, mode) called; rerender terminal false → hideAgent */
});
```

- [ ] **Step 2: Run them, they fail**

Run: `pnpm --filter desktop test -- session-workspace session`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `maxed` is component state, not persisted, and resets when the pane is hidden.
- The 1000px and 850px media rules keep stacking the pane under the thread, and the handle is hidden there.
- The handle copy is `resize: 'Largeur du terminal'` in fr and en.
- `App` builds `new TermStore({ backend: ptyBackend(), surface: () => createSurface(...), agentArgv: (id, ro) => client.fleet?.terminal(id, { readOnly: ro }) ?? null, shellArgv: id => client.fleet?.shell(id) ?? null })`. On a subagent's page, `session` is already the parent, so `parent` mode attaches to `session.id` read-only. The store's surfaces follow the theme: on a theme change, every surface gets `setTheme(termTheme(getComputedStyle(document.documentElement)))`.

- [ ] **Step 4: Run them, they pass**

Same commands plus `pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(desktop): the terminal as a resizable column beside the thread"`

---

### Task 8: The keyboard: the focus key, Ledge's shortcuts stand down

**Files:**
- Modify: `apps/desktop/src/nav/useKeys.ts` (inside-terminal guard and `Ctrl` + Backquote)
- Modify: `apps/desktop/src/App.tsx` (passes `toTerminal` into the `useKeys` context)
- Modify: `apps/desktop/src/session/SessionPage.tsx` (the thread scroller gets `data-thread-focus` and `tabIndex={-1}`)
- Modify: `apps/desktop/src/shell/ShortcutsHelp.tsx:12`, `apps/desktop/src/i18n/fr.ts:312` and `en.ts` (shortcut row)
- Test: `apps/desktop/test/keys.test.tsx`

**Interfaces:**
- Consumes: `backquoteLabel` (Task 4) and the store's active surface (Task 5).
- Produces: the `useKeys` context gains `toTerminal?(): boolean`. That callback shows the pane when it is hidden, then focuses the active tab's surface, and returns `false` when there is no session place. The surface's `onThread` focuses `[data-thread-focus]`.

- [ ] **Step 1: Write the failing tests**

```ts
it('inside the terminal, Ledge keeps its hands off: Ctrl K, Ctrl , and Escape do nothing', () => {
  /* focus an element inside [data-terminal]; fire Ctrl+K, Ctrl+',', Escape, Alt+1, '?' → dispatch never called */
});
it('Ctrl + the key left of 1 takes the keyboard to the terminal, on AZERTY too', () => {
  /* fire { ctrlKey: true, code: 'Backquote', key: '²' } → toTerminal called, preventDefault */
});
it('the shortcuts help names the key of the user\'s layout', async () => {
  /* navigator.keyboard.getLayoutMap → Map([['Backquote','²']]) → row 'Ctrl ²' 'Passer du fil au terminal et retour' */
});
```

- [ ] **Step 2: Run them, they fail**

Run: `pnpm --filter desktop test -- keys`
Expected: FAIL.

- [ ] **Step 3: Implement**

- In `useKeys`, the guard comes right after the `isComposing` line: when `document.activeElement?.closest('[data-terminal]')`, return. Then `mod && e.code === 'Backquote'` calls `toTerminal()` and prevents the default. Inside the terminal the key never gets here: xterm's handler owns it and stops it (Task 4).
- The row is `['Ctrl `', 'Passer du fil au terminal et retour']` (en: `'Move between the thread and the terminal'`), placed after the `O` row. `ShortcutsHelp` replaces the keys text `` Ctrl ` `` with `Ctrl ${label}`.
- Update the `useKeys` doc comment, which says Ctrl/⌘ K, Ctrl , and Escape always work.

- [ ] **Step 4: Run them, they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(desktop): Ctrl+² moves the keyboard to the terminal and back; Ledge's keys stand down inside it"`

---

### Task 9: Every « terminal » entry point opens the pane

**Files:**
- Modify: `apps/desktop/src/manage/useSessionMenu.ts:43-46` (`terminal` calls `showTerminal`; the offline guard goes, since offline now shows the frozen pane)
- Modify: `apps/desktop/src/chat/ChatPanel.tsx:76` (the launch card's « Terminal » calls `showTerminal`)
- Modify: `apps/desktop/src/App.tsx:93,152-154,231` (`showTerminal(id)`; `onOpenTarget` with `kind: 'terminal'`)
- Modify: `apps/overlay/src/surface/Surface.tsx:686` (`focusTab`: `openInLedge({ kind: 'terminal', id })` replaces `openTab(id)`; `session.focus` stays)
- Test: `apps/desktop/test/menu.test.tsx`, `apps/desktop/test/open-target.test.ts`, `apps/desktop/test/shell.test.tsx`, `apps/overlay/test/tauri.test.tsx`

**Interfaces:**
- Consumes: `TermStore.select` (Task 5) and `SessionPrefs.terminal` (Task 7).
- Produces: `showTerminal(id: string): void` in App. It does `dispatch({ type: 'open', id })`, then `setSessionPrefs(x => ({ ...x, terminal: true }))`, then `store.select(id, agentTabId(id))`. It is passed down where `onTerminal` is today.

- [ ] **Step 1: Write the failing tests**

```ts
it('the menu\'s « Terminal » opens the pane in Ledge, on the agent tab, offline too', () => { /* onShowTerminal called with s.id; openTerminal (bridge) never called */ });
it('« Voir l\'onglet du terminal » from the island opens the session with its pane', () => {
  /* App with onOpenTarget delivering '{"kind":"terminal","id":"local:a"}' → place session local:a, prefs.terminal true, agent tab active */
});
it('the island asks Ledge, not Windows Terminal', () => { /* overlay: key o on a session → invoke('open_in_ledge', { target: '{"kind":"terminal","id":…}' }); open_terminal not invoked */ });
```

- [ ] **Step 2: Run them, they fail**

Run: `pnpm --filter desktop test -- menu open-target shell` and `pnpm --filter overlay test -- tauri`
Expected: FAIL.

- [ ] **Step 3: Implement**

`targetAction` stays `{ type: 'open', id }`, so its test is unchanged. Only App's `onOpenTarget` handler adds the pane and the tab when `target.kind === 'terminal'`.

Grep both apps for `openSessionTerminal(`, `openTerminal(` and `focusTerminal(`. Afterwards, the only callers left are the pane's external button and `useAlerts` (`foregroundIsTerminal`).

- [ ] **Step 4: Run them, they pass**

Same commands. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: every terminal entry point opens the pane in Ledge"`

---

### Task 10: No sound while you are watching the agent in Ledge

**Files:**
- Modify: `apps/desktop/src/notify/useAlerts.ts:14,75-81` (`AlertDeps.watching`)
- Modify: `apps/desktop/src/App.tsx:86` (passes `watching`)
- Modify: `apps/desktop/src/i18n/fr.ts:155` and `en.ts` (`behindHint`)
- Test: `apps/desktop/test/use-alerts.test.tsx`

**Interfaces:**
- Consumes: the `TermStore.active` value (Task 5), the place and `SessionPrefs.terminal`.
- Produces: `AlertDeps.watching?: () => string | null`. App's version returns the shown session's id when all of these hold: `document.hasFocus()`, `prefs.terminal`, the place is a session, and that session's active tab is the agent tab. Otherwise it returns `null`.

- [ ] **Step 1: Write the failing tests**

```ts
it('« only when the terminal is behind »: no sound for the session whose screen Ledge shows', () => {
  /* onlyWhenTerminalBehind on, watching → 'local:a'; local:a asks → player not called; local:b asks → played */
});
it('the setting off, or another tab, still plays', () => { /* onlyWhenTerminalBehind off → played; watching → null → played */ });
```

- [ ] **Step 2: Run them, they fail**

Run: `pnpm --filter desktop test -- use-alerts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Before `strongestCue`, and when `sounds.onlyWhenTerminalBehind` is on, drop the changes whose `id` (from `SessionChange`) equals `watching()`. Leave the toasts as they are: they already wait for the window to lose focus.

The new `behindHint` reads: « Si Windows Terminal est au premier plan, ou si Ledge montre l’écran de l’agent, vous regardez déjà : pas de son, la bulle s’affiche quand même. »

- [ ] **Step 4: Run them, they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(desktop): the agent's screen in Ledge counts as the terminal in front"`

---

### Task 11: End to end, and the check on Windows

**Files:**
- Create: `apps/desktop/e2e/terminal.spec.ts` (fake PTY from Task 3, fake daemon from `e2e/daemon.ts`)

- [ ] **Step 1: Write the e2e test**

```ts
test('O shows the terminal, the keyboard goes to it and back, keys reach the shell', async ({ page }) => {
  /* open a session; press O → region 'Terminal' visible with tab 'Nova · agent';
     Ctrl+Backquote → focus inside [data-terminal]; type 'ls' + Enter → window.__ledgePtyWrites contains 'ls\r';
     press Control+k → the search dialog does not open; Ctrl+Backquote → focus on [data-thread-focus];
     click 'Nouveau shell' → tab 'Shell 2 · …'; reload → the pane is still open at the same width */
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter desktop e2e -- terminal`
Expected: PASS. The other e2e specs (`pnpm --filter desktop e2e`) stay green.

- [ ] **Step 3: Check by hand on Windows**

Build the app as in the memory note `windows-overlay-build.md`. Never touch the Windows PATH. Then check, and write each result in the PR description:
- Claude Code's TUI renders as in Windows Terminal: colours, box drawing, the cursor, `esc to interrupt`, shift+tab cycling.
- Typing into the agent's screen works.
- `cargo build` output stays fluid.
- With Windows Terminal attached at the same time, tmux's default `window-size latest` makes the window follow whichever client typed last. Write down what the user's other view does. Ledge sets no `window-size`.
- An SSH session: cut the network, and the banner counts down; restore it, and the pane re-attaches.
- An SSH shell after the cut shows « Shell terminé : connexion perdue ».
- Ctrl+² on AZERTY moves the keyboard. Ctrl+C with and without a selection, and Ctrl+V with an image in the clipboard (Claude Code's image paste), behave as in Windows Terminal.

- [ ] **Step 4: Commit**

`git commit -m "test(desktop): the embedded terminal end to end"`

# Windows installer with the bundled runtime: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The snapshot Ledge Desktop installer carries everything Ledge needs on a PC with nothing installed: a pinned Node, the built Ledge daemon and CLI with their production dependencies (`node-pty`'s Windows prebuild included), and PortableGit. A Desktop update never breaks running agents and moves the daemon to the new version.

**Architecture:**
- **Assembly script.** `scripts/windows-runtime/assemble.mjs` builds `apps/desktop/src-tauri/runtime/` with three parts:
  - `node.exe`;
  - `ledge/`: `dist`, `package.json` and `node_modules`;
  - `git/`: PortableGit.

  Each download is pinned by version and SHA-256.
- **Bundling.** A Tauri config overlay (`tauri.runtime.conf.json`) adds that folder as a bundle resource. Only the snapshot workflow passes it, so the stable release and dev builds are unchanged.
- **Copy before use.** At launch in native mode, Desktop never runs the runtime from its install folder. It first copies it once per version to `%USERPROFILE%\.ledge\runtime\<version>` and runs it from there. An update can therefore replace the install folder while the daemon and the pane host still run from the old copy.
- **Moving to the new version.** When the daemon Desktop adopts is older than the runtime it carries, Desktop stops it over the protocol and starts the new one. The agents stay in the pane host.
- **Pruning.** Copies no longer in use are removed.

**Tech Stack:** Node 22 (assembly script, vitest for its pure parts), Rust (`ledge-native`, `ledge-desktop`), Tauri 2 bundle resources, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-03-windows-native-design.md`, §4.2 item 5 (installer) and §4.3 (the snapshot build). This round's open items are left to the builder in §6: install-folder layout, pane-host survival across updates, the pinned Node version, the token ACL.

## Global Constraints

- **Pinned versions:**
  - Node `22.23.3` (win-x64). Spec: « 22 LTS or later ».
  - PortableGit `2.56.0.windows.4` 64-bit, the version the spike measured.
  - Each pinned with its SHA-256 in the script. A mismatch stops the build.
- **Ledge in the runtime is this commit's `packages/ledge`:**
  - its `dist` built by `tsup`;
  - production dependencies from npm, `node-pty`'s win32-x64 prebuild included;
  - no dev dependencies, no workspace links (`@ledge/protocol` is already bundled into `dist`).
- **Only the snapshot workflow bundles the runtime.**
  - `release.yml`, `tauri dev` and the WSL users' stable installer do not change. Nothing reaches stable before the snapshot passes the acceptance bar (spec §4.3).
- **No admin rights:** per-user only. The copy goes to the user's own `%USERPROFILE%\.ledge\runtime\<version>`.
- **Never `%LOCALAPPDATA%\Ledge`:** the NSIS pre-install hook deletes that folder, which belonged to the old island app.
- **Running agents are never stopped** by an update or by moving the daemon to the new version. The pane host keeps the old copy alive until it exits.
- **Claude Code uses the bundled Git Bash:** the daemon starts with `CLAUDE_CODE_GIT_BASH_PATH` pointing to the copy's `git\bin\bash.exe`, unless the environment already sets it. The copy's `git\cmd` comes first on the daemon's PATH.
- **`LEDGE_NODE` / `LEDGE_CLI` keep overriding everything,** for tests.

## Review Focus

1. **Two Desktop windows racing on a first launch, or a crash in the middle of a copy.** A half-copied runtime is never run. The copy goes to a temporary folder, is marked complete, and is then renamed. Test: `a partial copy is never used` (Task 2).
2. **An update while agents run.** The old copy is not removed while a process runs from it. Removal failing on a locked file means « in use, keep it ». Test: `pruning keeps a copy whose files are locked` (Task 2, on the PC).
3. **The adopted daemon is the same version, or its version cannot be read.** In both cases Desktop does not restart it: only a known, different version moves it. Test: `moves to the new version only when the running one is known and different` (Task 3).
4. **The bundled `node-pty` failing to load on the target** (a missing prebuild, a native-module ABI mismatch). The assembly step loads it with the bundled `node.exe` and fails the build. Test: the assembly self-check (Task 1).
5. **The token's rights.** `%USERPROFILE%\.ledge\token` must be readable only by the user (plus SYSTEM and Administrators, as the profile folder's inherited ACL gives). Checked on the PC (Task 5). Code changes only if the check fails.

---

### Task 1: `scripts/windows-runtime/assemble.mjs`, the runtime folder

**Files:**
- Create: `scripts/windows-runtime/assemble.mjs`
- Create: `scripts/windows-runtime/pins.mjs`
- Create: `test/windows-runtime.test.ts` (repo-level scripts tests, `vitest.scripts.config.ts`)

**Interfaces:**
- `pins.mjs` exports:
  - `NODE = { version: '22.23.3', url, sha256 }`
  - `PORTABLE_GIT = { version: '2.56.0.windows.4', url, sha256 }`
  - `layout(out: string) => { node, ledge, cli, git, bash, gitCmd, version }`: the files the Rust side expects. The `version` field is the path of the version file `runtime/VERSION`, which holds the Ledge package version.
  - `verifySha256(buf: Buffer, expected: string): void`: throws `checksum mismatch for <what>`.
- `assemble.mjs <out>` (Windows only, Node 22):
  1. Download Node's win-x64 zip and PortableGit's `.7z.exe` into `<out>/../.cache` (reused when its SHA-256 matches), and verify both.
  2. Extract `node.exe`. Windows' `tar` reads the zip.
  3. Self-extract PortableGit with `-y -o<out>/git`.
  4. Build `packages/ledge` (`pnpm --filter @paradow/ledge build`). Copy `dist`, `assets` and `package.json` to `<out>/ledge`, then run `npm install --omit=dev --no-audit --no-fund` there.
  5. Write `VERSION`.
  6. **Self-check** with the bundled `node.exe`:
     - `node.exe ledge/dist/cli/index.js --version` prints `VERSION`;
     - `node.exe -e "require('<out>/ledge/node_modules/node-pty')"` exits 0;
     - `git/bin/bash.exe -c "echo ok"` prints `ok`.

     Any failure exits non-zero.

- [ ] **Step 1: Write the failing tests** for the pure parts:

```ts
it('layout names the files the Desktop side runs', () => {
  const l = layout('C:\\r');
  expect(l.node).toBe(join('C:\\r', 'node.exe')); expect(l.cli).toBe(join('C:\\r', 'ledge', 'dist', 'cli', 'index.js'));
  expect(l.bash).toBe(join('C:\\r', 'git', 'bin', 'bash.exe')); expect(l.gitCmd).toBe(join('C:\\r', 'git', 'cmd'));
});
it('verifySha256 accepts the pinned hash and refuses another', () => {
  const b = Buffer.from('ledge'); const h = createHash('sha256').update(b).digest('hex');
  expect(() => verifySha256(b, h, 'x')).not.toThrow(); expect(() => verifySha256(b, '0'.repeat(64), 'x')).toThrow('checksum mismatch for x');
});
it('the pins are exact versions with 64-hex hashes', () => {
  for (const p of [NODE, PORTABLE_GIT]) { expect(p.sha256).toMatch(/^[0-9a-f]{64}$/); expect(p.url).toContain(p.version.replace('.windows.', '.')); }
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run -c vitest.scripts.config.ts test/windows-runtime.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
  - The SHA-256 values are computed once on the PC from the official downloads (Node from its `SHASUMS256.txt`, checked against the hash computed locally; PortableGit from the file the spike already used) and written into `pins.mjs`.
  - `--version` must be a CLI answer. If `ledge --version` does not exist, add it to `packages/ledge/src/cli/index.ts`, with its own test in `packages/ledge/test/cli-version.test.ts`, printing the package version.
- [ ] **Step 4: Run the tests (Linux), then the script on the PC** (`node scripts\windows-runtime\assemble.mjs apps\desktop\src-tauri\runtime` in the Windows clone). Expected: tests pass; the script ends with « runtime ready » and its three self-checks pass. Note the folder size in the ledger.
- [ ] **Step 5: Commit** `feat(windows): assemble the runtime the installer carries (Node, Ledge, PortableGit)`. Add `apps/desktop/src-tauri/runtime/` and `.cache/` to `.gitignore`.

### Task 2: copy the runtime before use, prune old copies (Rust)

**Files:**
- Modify: `crates/ledge-native/src/native.rs`
  - `Runtime` gains `git_bash: Option<PathBuf>`, `git_cmd: Option<PathBuf>` and `version: Option<String>`.
  - Add `stage_runtime`, `prune_runtimes` and `runtime_from_dir`.
- Modify: `apps/desktop/src-tauri/src/main.rs`. `start_native` stages the bundled runtime when there is no override, and prunes after the daemon is up.
- Modify: `crates/ledge-native/src/supervisor.rs`. `windows_ops` spawns with:
  - `CLAUDE_CODE_GIT_BASH_PATH`, unless already set;
  - `git_cmd` prepended to PATH.

**Interfaces:**
- `pub fn runtime_from_dir(dir: &Path, exists: &dyn Fn(&Path) -> bool) -> Option<Runtime>`: reads the layout of Task 1. `version` comes from `VERSION`.
- `pub fn stage_runtime(bundled: &Path, home: &Path) -> io::Result<PathBuf>`:
  - Reads the version, then returns `<home>/runtime/<version>`.
  - When that folder holds `.complete`, it is returned as is.
  - Otherwise the bundle is copied into `<home>/runtime/<version>.tmp-<pid>`. `.complete` is written last, then the folder is renamed. If the rename fails because the target exists (another Desktop won the race), the temporary copy is removed and the existing one is used.
- `pub fn prune_runtimes(home: &Path, keep: &str) -> Vec<String>`: removes every `<home>/runtime/*` except `keep`. A folder whose removal fails (files in use) is kept. Returns what was removed.
- `runtime()` order of precedence:
  1. the `LEDGE_NODE`/`LEDGE_CLI` override;
  2. the staged copy of `<resource_dir>/runtime`;
  3. none.

- [ ] **Step 1: Write the failing tests** (tempdirs, run on the PC):
  - `stage_runtime copies once and reuses`: the second call does not copy. Check by the mtime of a marker file.
  - `a partial copy is never used`: a `<version>.tmp-1` folder without `.complete`, and a `<version>` folder without `.complete`, are both ignored, and a fresh copy is made.
  - `pruning removes old copies and keeps the current`.
  - `pruning keeps a copy whose files are locked`: a file is held open with no sharing (`std::fs::OpenOptions` plus `share_mode(0)` through `std::os::windows::fs::OpenOptionsExt`). Skipped off Windows.
  - `runtime_from_dir reads version, bash and git cmd`.
  - `the daemon is spawned with the bundled Git Bash unless one is set`: a pure `fn daemon_env(base: &[(String, String)], rt: &Runtime) -> Vec<(String, String)>` gives `CLAUDE_CODE_GIT_BASH_PATH` and a PATH starting with `git_cmd`, and keeps an existing `CLAUDE_CODE_GIT_BASH_PATH`.
- [ ] **Step 2: Run** `cargo test -p ledge-native` (PC). Expected: FAIL.
- [ ] **Step 3: Implement.** The recursive copy uses `std::fs` only.
- [ ] **Step 4: Run** `cargo test -p ledge-native -p ledge-desktop` (PC). Expected: pass.
- [ ] **Step 5: Commit** `feat(desktop-native): run the bundled runtime from a per-version copy, prune old ones`.

### Task 3: move the adopted daemon to the bundled version

**Files:** `crates/ledge-native/src/supervisor.rs`, `apps/desktop/src-tauri/src/main.rs`

**Interfaces:**
- `Ops` gains `fn running_version(&self) -> Option<String>`. It is the daemon's `snapshot.daemon.version`, read over the same authenticated WebSocket as `send_stop`.
- `pub fn needs_move(running: Option<&str>, bundled: Option<&str>) -> bool`: true only when both are `Some` and they differ.
- In the loop, right after adopting:
  - if `needs_move(ops.running_version(), bundled)`, log `moving the daemon from <a> to <b>`, send `daemon.stop`, then start the bundled one on the next turn, without the backoff delay (a planned move is not a crash);
  - the move is attempted once per Desktop launch.

- [ ] **Step 1: Write the failing tests** (fake `Ops`):
  - `moves to the new version only when the running one is known and different`: cover `needs_move` for (Some a, Some b), (Some a, Some a), (None, Some b) and (Some a, None).
  - `an adopted older daemon is stopped and the bundled one started without a backoff sleep`: the fake answers `port_open` true then false. The calls are `open 42`, `stop`, then `spawn`, with no `sleep 2s` between `stop` and `spawn`.
  - `the same version is adopted and left alone`.
- [ ] **Step 2: Run** `cargo test -p ledge-native supervisor::` (PC). Expected: FAIL.
- [ ] **Step 3: Implement.** The bundled version is `Runtime.version`, passed to `Supervisor::start`.
- [ ] **Step 4: Run** `cargo test -p ledge-native -p ledge-desktop` (PC). Expected: pass.
- [ ] **Step 5: Commit** `feat(desktop-native): an update moves the daemon to the bundled version, the agents stay`.

### Task 4: the snapshot workflow bundles the runtime

**Files:**
- Create `apps/desktop/src-tauri/tauri.runtime.conf.json`. It holds `{ "bundle": { "resources": { "runtime/": "runtime/" } } }`.
- Modify `.github/workflows/snapshot.yml`, job `windows-installer`, before « Build the snapshot installer »:
  - a step `node scripts/windows-runtime/assemble.mjs apps/desktop/src-tauri/runtime`;
  - the build becomes `pnpm tauri build --config src-tauri/tauri.runtime.conf.json`;
  - a check that the installer is under 300 MB, printing its size.
- Test: `test/snapshot-workflow.test.ts` (scripts tests).

- [ ] **Step 1: Write the failing test.** Parse the YAML with `yaml`, as the repo's scripts do. It checks that:
  - the `windows-installer` job runs `assemble.mjs` before the step running `tauri build`;
  - that step passes `--config src-tauri/tauri.runtime.conf.json`;
  - `release.yml` passes no such config.
- [ ] **Step 2: Run** `pnpm exec vitest run -c vitest.scripts.config.ts test/snapshot-workflow.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the scripts tests. On the PC, run the same two commands as the workflow (`assemble.mjs`, then `pnpm tauri build --config src-tauri/tauri.runtime.conf.json`). The NSIS installer must be produced and its size noted. Open it with 7-Zip if present, or check that `target/release/runtime/node.exe` exists after the build. Expected: an installer with `runtime\node.exe`, `runtime\ledge\…` and `runtime\git\…`.
- [ ] **Step 5: Commit** `ci(snapshot): the Windows installer carries the runtime`.

### Task 5: verify on the Windows PC

With the release build of Task 4 run in place (`target\release\ledge-desktop.exe`, its resources next to it), native mode forced, `LEDGE_PORT=27832`, and **no `LEDGE_NODE`/`LEDGE_CLI`**:
- ask the user before quitting their installed Desktop;
- back up `settings.json` and restore it afterwards.

1. **First launch.** `desktop.log` shows the copy to `%USERPROFILE%\.ledge\runtime\<version>` (the spike's `LEDGE_HOME`) and `setup`. The hooks in `settings.json` name the copied `node.exe`. The daemon starts from the copy.
2. **Claude with the bundled Git Bash.** Launch Claude in the « Spike » project with a harmless prompt. It answers. The `claude.exe` process environment carries `CLAUDE_CODE_GIT_BASH_PATH` pointing to the copy's `bash.exe`.
3. **An update while the agent runs.**
   - Quit Desktop (kill).
   - Change `VERSION` in the bundled runtime to simulate a new version, and relaunch.
   - `desktop.log` shows a second copy, then `moving the daemon from <a> to <b>`. The daemon restarts from the new copy. The Claude session is still alive and attached (pane host from the old copy).
   - The old copy is **not** pruned while the pane host runs from it.
4. **Pruning.** Stop the pane host, relaunch, and the old copy is removed.
5. **Token ACL.** `icacls %USERPROFILE%\.ledge\token` (the spike's `LEDGE_HOME`) lists only the user, SYSTEM and Administrators. If another principal appears, add a task: the daemon sets the ACL on Windows.
6. **Cleanup.**
   - Restore `settings.json`.
   - Stop the daemon and the pane host.
   - Remove the test copies.
   - Restart the user's Desktop.

- [ ] **Commit** `docs(spec): the installer's runtime verified on the PC`, recording each check in the spike report under « Installer (step 5) ».

## Not in this plan

- **Installing the NSIS installer itself on a PC.** It would replace the user's installed Desktop. That is the snapshot run on the PO's PC (spec §4.3).
- **Code signing:** decided by that run (SmartScreen, AppLocker).
- **Claude and Codex installed on demand from Desktop** (spec §4.2 item 6): the next plan.
- **The stable release bundling the runtime:** after the snapshot passes the acceptance bar.

# Claude Code and Codex installed from Ledge Desktop: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a Windows PC without WSL, Ledge Desktop shows whether Claude Code and Codex are installed, and installs a missing one for the user (no admin) from its official Windows installer. The PO then launches it from « New session ».

**Architecture:**
- **The daemon checks and installs.** It runs on the PC with the user's environment.
  - `agents.status` answers, for each of `claude` and `codex`, whether its binary is found on the agents' PATH, where, and its version.
  - `agents.install` runs the publisher's own PowerShell installer, one install at a time, and answers with the result and the tail of its output.
  - On Windows, the agents' PATH gains the two per-user install folders, so a fresh install is found even before the user's PATH is refreshed.
- **Desktop asks only when the local daemon offers it** (`DaemonInfo.agents`, set on win32).
  - Settings › General gains an « Agents » card: each agent's state, and « Installer » with progress and errors.
  - In native mode, the launch form offers only Claude Code and Codex. A missing one says so and links to the card.

**Tech Stack:** TypeScript (protocol, daemon, fleet, Desktop), zod, vitest. Rust does not change.

**Spec:** `docs/superpowers/specs/2026-11-03-windows-native-design.md`, §4.2 item 6: « Desktop shows whether each is found and offers to install it per user from its official Windows build ». Acceptance bar §1.

## Global Constraints

- **Official installers only, per user, no admin.** Checked on 2026-11-04 against the official pages:
  - **Claude Code:** `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`.
    - The official installer verifies the binary against its checksum manifest.
    - It installs to `%USERPROFILE%\.local\bin\claude.exe`.
    - It updates itself.
    - The `stable` channel skips releases with major regressions.
  - **Codex:** `https://chatgpt.com/codex/install.ps1 -Release <version>`, saved to a temp file and run with `powershell -NoProfile -ExecutionPolicy Bypass -File`. It installs to `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` and the User PATH. The version is pinned in Ledge (`CODEX_RELEASE = '0.166.0'`, the version the spike measured), as OpenAI's Windows deployment guide recommends.
- **Install is offered only on native Windows** (`process.platform === 'win32'`). Elsewhere `agents.install` is refused and the card does not show.
- **One install at a time**, with a 10 min limit. A failure answers the exit code and the last 20 lines of output, never a stack trace. The card then also shows the command to run by hand.
- **Nothing is installed without the user's click.**
- **Login stays the agent's own.** After an install, the card says that the first session asks the user to log in, in its terminal.
- **The WSL mode and Linux daemons are unchanged.** The new messages are new types; old daemons never receive them, because the front asks only when `daemon.agents` is set.

## Review Focus

1. **The installer blocked by policy** (PowerShell `ConstrainedLanguage`, AppLocker, a proxy). The card shows the failure, the output tail and the manual command. The daemon stays usable. Test: `a failed install answers its exit code and output tail` (Task 1).
2. **An install already running when the user clicks again,** or on the other agent: the second is refused with `busy`, the first goes on. Test: `one install at a time` (Task 1).
3. **Claude installed but its folder not on PATH** (a known installer issue). It is still found through the per-user folders added to the agents' PATH, and a launch works. Test: `the per-user install folders are on the agents' PATH on Windows` (Task 1).
4. **A daemon without the feature** (Linux, an older Windows daemon): no card, no request sent. Test: `the card shows only when the local daemon offers it` (Task 2).
5. **A launch of an agent that is not installed:** the form says so before sending, rather than ending in a timeout. Test: `the launch form says Codex is missing and links to the card` (Task 2).

---

### Task 1: protocol and daemon: `agents.status`, `agents.install`

**Files:**
- Create: `packages/protocol/src/agents.ts`:
  - `AgentStatusSchema = { tool: 'claude' | 'codex', found: boolean, path?: string, version?: string }`;
  - client messages `{ type: 'agents.status', requestId }` and `{ type: 'agents.install', requestId, tool }`;
  - server messages `{ type: 'agents.listing', requestId, agents: AgentStatus[] }` and `{ type: 'agents.installed', requestId, tool, ok, code?, output?, error?: 'busy' | 'not_offered' | 'failed' }`.
- Modify: `packages/protocol/src/messages.ts`:
  - wire them into the client and server unions;
  - add `DaemonInfo.agents?: boolean`.
- Create: `packages/ledge/src/daemon/agents.ts`:
  - `INSTALLERS`;
  - `agentStatus(tool, env, run)`;
  - `createAgentInstaller({ run, platform, timeoutMs })`;
  - `windowsAgentDirs(env)`.
- Modify:
  - `packages/ledge/src/daemon/server.ts`: handle the two messages; set `agents: true` in the snapshot's daemon info when win32.
  - `packages/ledge/src/shell-path.ts`: the agents' env gains `windowsAgentDirs` on win32.
- Test: `packages/protocol/test/agents.test.ts`, `packages/ledge/test/agents.test.ts`.

**Interfaces:**
- `export const CODEX_RELEASE = '0.166.0'`.
- `export function installCommand(tool: 'claude' | 'codex', tmpScript: string): { file: string; args: string[]; download?: string }`:
  - `file` is `powershell.exe`;
  - for Codex, `download` is the installer URL that the daemon saves to `tmpScript` before running it.
- `export function windowsAgentDirs(env): string[]` returns `[%USERPROFILE%\.local\bin, %LOCALAPPDATA%\Programs\OpenAI\Codex\bin]`.
- `export async function agentStatus(tool, env, run): Promise<AgentStatus>`:
  - resolves `claude`/`codex` with `resolveCommand` along the env's PATH;
  - runs `<path> --version` with a 10 s limit;
  - `found: false` when it does not resolve to an existing file.
- `createAgentInstaller(...)` returns `{ install(tool): Promise<Installed>; busy(): boolean }`.

- [ ] **Step 1: Write the failing tests:**
  - `installCommand gives the official per-user installers` checks the exact arguments:
    - Claude: `['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', "& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable"]`;
    - Codex: `['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpScript, '-Release', '0.166.0']`, with `download: 'https://chatgpt.com/codex/install.ps1'`.
  - `agentStatus finds a binary and reads its version`, with a fake `run` and a temp `codex.exe` on PATH. `found: true`, the path, and the version line trimmed.
  - `agentStatus says not found` when PATH has no binary.
  - `a failed install answers its exit code and output tail`: a fake run exits 1 after 30 lines, giving `ok: false`, `code: 1` and the last 20 lines.
  - `one install at a time`: a second `install` while the first is pending gives `error: 'busy'`.
  - `install is refused off Windows` (`error: 'not_offered'`).
  - `the per-user install folders are on the agents' PATH on Windows`: `windowsAgentDirs` with `USERPROFILE`/`LOCALAPPDATA`, then the env overlay on win32 ends with them. A folder already there is not added twice.
  - Server test: `agents.status answers a listing; the snapshot says agents only on win32`, run with `platform` injected.
  - Protocol test: the new messages parse, and an unknown tool is refused.
- [ ] **Step 2: Run:**
  - `pnpm --filter @ledge/protocol exec vitest run test/agents.test.ts`;
  - `pnpm --filter @paradow/ledge exec vitest run test/agents.test.ts`.

  Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The Codex installer is downloaded with `fetch` to `os.tmpdir()`, then run, then deleted.
  - The run goes through an injected `run(file, args, { timeoutMs })` that returns `{ code, output }`. The real one is `execFile` with `windowsHide: true` and both streams combined.
- [ ] **Step 4: Run** both suites, then the full protocol and ledge suites. Expected: pass (ledge: its known failures only).
- [ ] **Step 5: Commit:** `feat(windows): the daemon tells which agents are installed and installs one with its official installer`.

### Task 2: Desktop: the « Agents » card and the launch form

**Files:**
- Modify: `packages/fleet/src/fleet.ts`: route `agents.status` and `agents.install` to the local machine; relay the answers.
- Create: `apps/desktop/src/settings/Agents.tsx`, rendered in `settings/General.tsx` when `localDaemon?.agents`.
- Modify: `apps/desktop/src/launch/LaunchComposer.tsx`. In native mode, `TOOLS` is `['claude', 'codex']`. When the chosen tool's status says not found, the form shows a note `t.agents.missing(name)` with a link « Installer » that dispatches `{ type: 'settings', section: 'general' }`, and « Lancer » is disabled.
- Modify: `apps/desktop/src/i18n/fr.ts` and `en.ts`, adding `agents.*`.
- Test: `apps/desktop/test/agents.test.tsx`.

**Card states:**
- Each row: « Claude Code » and « Codex », the version or « Non installé », and « Installer » when missing.
- While installing: « Installation… » and the button disabled.
- On success: the new status, then « Au premier lancement, connectez-vous dans le terminal de la session ».
- On failure: the message, the output tail (`<pre>`) and the manual command (`irm https://claude.ai/install.ps1 | iex`, or the Codex one).
- On `busy`: « Une installation est déjà en cours ».

- [ ] **Step 1: Write the failing tests** (mock daemon with `extras.daemon.agents = true` and scripted answers):
  - `the card shows only when the local daemon offers it`: without `agents`, no card and no `agents.status` sent.
  - `the card lists Claude and Codex with their state`.
  - `Installer sends agents.install, shows progress, then the new state and the login hint`.
  - `a failure shows the output tail and the manual command`.
  - `the launch form says Codex is missing and links to the card` (native mode). « Lancer » is disabled.
  - `native mode offers only Claude Code and Codex in the launch form`.
- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/agents.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the desktop and fleet suites, and `tsc --noEmit` for desktop and fleet. Expected: pass, the known flaky test aside.
- [ ] **Step 5: Commit:** `feat(desktop-native): an Agents card installs Claude Code or Codex, the launch form says what is missing`.

### Task 3: verify on the Windows PC

Setup:
- The branch's debug Desktop in native mode, with `LEDGE_PORT=27832` and the spike's `LEDGE_HOME`.
- A test profile: `USERPROFILE` and `LOCALAPPDATA` pointed to an empty folder under `%TEMP%`, so the installers install there and not into the user's real profile.
- **Back up `HKCU\Environment\Path` first:** both installers may add their folder to the user's PATH. Restore it afterwards.
- **Ask the user before quitting their installed Desktop.**

Checks:
1. With the test profile, the card shows Claude Code and Codex as « Non installé » (the system ones are hidden by the profile's PATH).
2. « Installer » Claude Code: it finishes, and the card shows its version. A session launched from Desktop opens Claude, which shows its login or theme screen. Nothing is answered: the screen is only observed.
3. « Installer » Codex: the same, with `0.166.0`.
4. A failure case: the network blocked for `powershell.exe` is not simulated. A temporary environment variable `LEDGE_AGENTS_INSTALL_FAIL=1` is not added either. **Ruling at execution:** the failure path is covered by Task 1/2 tests only.
5. Cleanup:
   - restore `HKCU\Environment\Path`;
   - remove the test profile;
   - stop the test daemon and pane host;
   - restart the user's Desktop.

- [ ] **Commit:** `docs(spec): installing the agents from Desktop verified on the PC`, recorded in the spike report under « Agents on demand (step 6) ».

## Not in this plan

- Logging in from Desktop (the agent's own screen does it).
- Updating Codex past the pinned version from Desktop (a Ledge release bumps `CODEX_RELEASE`).
- **The Codex sandbox choice.** OpenAI now recommends `mxc` (`[features] prefer_mxc = true`), which needs no admin. `ledge setup` writes `unelevated`. Revisit with the PO's PC run.

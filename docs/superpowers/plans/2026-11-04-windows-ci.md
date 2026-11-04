# The daemon's suite on Windows, in CI: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/ledge`'s test suite passes on Windows. A Windows CI job runs it on every pull request to `snapshot` and `main`, so a change that breaks native Windows is seen before it ships.

**Architecture:**
- **Failure inventory.** On the PC, at `snapshot` 551d…+#200, 149 tests fail in 42 files (`docs/superpowers/specs/data/2026-11-04-windows-test-failures.txt`). Each failing test falls into one of five classes, and each class gets one treatment.
- **Explicit guards in one place.** A helper `packages/ledge/test/platform.ts` states the guards (`linuxOnly`, `needsSymlinks`, `posixModes`), so every skip says why.
- **CI.** A new workflow, `.github/workflows/windows.yml`, runs on `windows-latest`.

**Tech Stack:** vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-03-windows-native-design.md`, §4.2 item 8: « the Windows CI job runs the daemon's suite on `windows-latest`; Linux-only tests (tmux, systemd, signals, symlinks) are skipped there by an explicit platform guard ». Also §4.2.2: « the real-path bugs the test run exposed in features that stay hidden … wait for the round that enables them ».

## Global Constraints

- **Linux runs exactly the tests it runs today.** Every guard is a no-op off Windows, and the Linux suite's count of passing tests does not drop.
- **No silent skip.** Each skip goes through `platform.ts`, with a reason from a closed list:
  - `tmux`;
  - `posix-signals`;
  - `posix-modes`;
  - `symlinks`;
  - `hidden-in-native` (a feature outside native mode's first round, spec §1);
  - `linux-flow` (the test pins a Linux behaviour; it gets `platform: 'linux'` injected rather than a skip where the code takes it).
- **A real bug in a feature shown in native mode is fixed, not skipped,** with its test RED first on the PC. Native mode shows sessions, launch, the terminal, setup and hooks, folders and projects, and the SSH link.
- **The Windows job blocks nothing yet.** It runs on PRs to `snapshot` and `main`, without being required, until it has been green for a week.

## The five classes (from the inventory)

| Class | Files (first error) | Treatment |
|---|---|---|
| tmux | `launch`, `attach`, `tmux`, `tmux-scope`, `e2e` (`process.getuid`), `mobile-terminal`, `preview`, `mobile-phone-e2e` | `linuxOnly('tmux')` |
| POSIX signals and modes | `omp-rpc`, `omp-host`, `omp-server` (SIGKILL); `mobile-files`, `mobile-service` (0o600 → 438) | `linuxOnly('posix-signals' / 'posix-modes')`, on the assertion where possible |
| Symlinks | `scan`, `uninstall`, `documents`, `folders`, `chat-notes` (EPERM without Developer Mode) | `needsSymlinks`: a probe at load; it runs on CI runners (admin), and skips on a PC without the right |
| Linux flows | `setup`, `hook`, `update-run`, `update-self`, `shell-path` | Inject `platform: 'linux'` (the code already takes it), or skip with `linux-flow` |
| POSIX path literals | `transcript`, `models`, `openrig`, `openrig-roles`, `rig-spec`, `chat-*`, `tool-images`, `tui-images`, `omp-owner` | Expectations built with `path.join` where the code is platform-neutral. Otherwise `hidden-in-native` (chat, OpenRig roles and rig specs, OMP) |
| To investigate | `server` (document.content timeout), `broadcast` (timeouts), `history` (`locked`), `openrig` (`null` vs `/opt/rig`) | Debug on the PC. Product bug in a shown feature: fix with RED/GREEN. Hidden feature: `hidden-in-native` with the finding written in the test |

## Review Focus

1. **A skip that hides a real Windows bug in a shown feature** (sessions, launch, terminal, setup, projects, SSH). Each `hidden-in-native` and `linux-flow` skip is listed in the task's commit message, and the reviewer checks it against spec §1.
2. **The Linux count drops** (a guard that skips on Linux too). Test: the Linux suite's passed count before and after, recorded in the ledger (Task 3).
3. **The Windows job green only because everything was skipped.** The job prints the number of skipped tests, and it must stay under a stated ceiling (Task 4).
4. **The symlink probe leaving files behind,** or wrong on the CI runner. It runs in the OS temp folder and cleans up, and the CI log shows « symlinks: yes ».
5. **A flaky Windows test** (timing, file locks). Each test that only failed once is rerun three times on the PC before being classed.

---

### Task 1: `test/platform.ts` and the mechanical classes (tmux, signals, modes, symlinks)

**Files:** create `packages/ledge/test/platform.ts`; modify the test files of the first three classes.

**Interfaces:**
- `export const isWindows: boolean`
- `export type SkipReason = 'tmux' | 'posix-signals' | 'posix-modes' | 'symlinks' | 'hidden-in-native' | 'linux-flow'`
- `export function linuxOnly(reason: SkipReason): typeof it`: `it.skipIf(isWindows)`, with the reason in the test title, so it shows in the report
- `export function linuxOnlySuite(reason: SkipReason): typeof describe`
- `export const canSymlink: boolean`: probed once by creating a link in `os.tmpdir()`
- `export const needsSymlinks: typeof it`: `it.skipIf(!canSymlink)`

- [ ] **Step 1:** test the helper (`test/platform.test.ts`):
  - `linuxOnly` runs on Linux;
  - `canSymlink` is true on Linux;
  - the reason appears in the skipped test's name.
- [ ] **Step 2:** apply the guards to the tmux, signals, modes and symlinks files listed above.
- [ ] **Step 3:** run on the PC (`pnpm --filter @paradow/ledge exec vitest run <those files>`). Expected: those files have no failures, and skips are counted. Run on Linux: the same pass count as the baseline.
- [ ] **Step 4:** commit `test(windows): explicit guards for tmux, POSIX signals and modes, symlinks`.

### Task 2: Linux flows and POSIX path literals

- [ ] **Step 1:**
  - `setup`, `hook`, `update-run`, `update-self`, `shell-path`: inject `platform: 'linux'` where the code takes it; otherwise use `linuxOnly('linux-flow')`.
  - `transcript`, `models`, `tool-images`, `tui-images`: make the expectations portable with `path.join` / `path.sep` when the code under test is platform-neutral.
  - `chat-*`, `openrig-roles`, `rig-spec`, `omp-owner`: `linuxOnly('hidden-in-native')`.
- [ ] **Step 2:** run on the PC and on Linux, as in Task 1.
- [ ] **Step 3:** commit `test(windows): Linux flows pinned to Linux, portable paths, hidden features guarded`. The message lists every `hidden-in-native` skip.

### Task 3: the failures to investigate

- [ ] For each of `server` (`document.content`), `broadcast`, `history` (`locked`) and `openrig` (`/opt/rig`):
  1. Rerun it three times on the PC (Review Focus 5).
  2. Find the cause.
  3. Classify it:
     - a product bug in a feature native mode shows: a failing test first, then the fix;
     - a hidden feature: `hidden-in-native`, with the cause in a comment;
     - a test artifact: fix the test.
- [ ] Run the whole suite on the PC. Expected: 0 failures, and the skip count recorded. Run it on Linux: the baseline pass count.
- [ ] Commit per finding.

### Task 4: the Windows CI job

**Files:**
- Create `.github/workflows/windows.yml`:
  - `on: pull_request: branches: [snapshot, main]` and `workflow_dispatch`;
  - `runs-on: windows-latest`, with setup-node 22 and pnpm;
  - `pnpm install --frozen-lockfile`, then `pnpm --filter @paradow/ledge test`;
  - a step that prints the skip count and fails above `MAX_WINDOWS_SKIPS` (set to the count of Task 3, plus 5).
- Test: `test/windows-workflow.test.ts` (repo scripts tests). It checks the triggers, the runner and the test command, as the snapshot workflow test does.

- [ ] Write the test, watch it fail, add the workflow, watch it pass.
- [ ] Open the PR. The workflow runs on it: green, with « symlinks: yes » and the skip count in the log.
- [ ] Commit `ci(windows): the daemon's suite on windows-latest for every PR`.

## Not in this plan

- **The Desktop, fleet, protocol and ui suites on Windows.** They are browser code under jsdom, the same on both systems. Add them later if needed.
- **Fixing the bugs of hidden features.** That waits for the round that enables them (spec §4.2.2).

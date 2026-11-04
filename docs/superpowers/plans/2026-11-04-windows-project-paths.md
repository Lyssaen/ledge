# Windows paths in projects and launch: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On native Windows, a person creates a project with a folder such as `C:\Users\po\work` in Ledge Desktop, launches Claude or Codex in it from « New session », and sees the session grouped under that project. Every POSIX path keeps exactly today's behaviour.

**Architecture:**
- One browser-safe path module in `packages/protocol` (`paths.ts`) knows both path shapes.
  - A path is Windows-shaped when it starts with a drive letter (`C:\` or `C:/`) or is a UNC path (`\\server\share`). Every other path is POSIX, as today.
  - Windows paths are normalized to `C:\a\b`: backslashes, upper-case drive letter, no repeated or trailing separator except at the root.
  - Windows paths compare case-insensitively.
- `normalizePath`, `PathSchema`, `projectOf` and the duplicate checks go through this module.
- The daemon, fleet and Desktop replace their hand-written `split('/')`, `lastIndexOf('/')` and `${dir}/${name}` with its helpers.

**Tech Stack:** TypeScript, zod, vitest. Rust does not change.

**Spec:** `docs/superpowers/specs/2026-11-03-windows-native-design.md`. Acceptance bar §1: « from Desktop launches a Claude or Codex session in a project folder ». This plan fixes the blocker found in step 4's PC run (spike report, « Desktop native mode »). Inventory of the affected code: this plan's file list.

## Global Constraints

- **POSIX behaviour is unchanged.**
  - `normalizePath` on a POSIX path returns exactly what it returns today.
  - `PathSchema` accepts exactly the POSIX paths it accepts today.
  - Every existing test stays green on Linux.
- **The shape is read from the string, not from the machine.** A POSIX absolute path starts with `/`. A Windows path starts with `X:` or `\\`. The two never overlap, so no `daemon.platform` lookup is needed.
- **Windows comparisons are case-insensitive and separator-insensitive** (`c:/users/PO/work/` is the same folder as `C:\Users\po\work`). POSIX comparisons stay exact.
- **What is stored** (projects, rules) **is the normalized form, never the raw input.**
- **Drive listing is out of scope.** Another drive is reached by typing its path (`D:\…`).
- No `node:path` in protocol, fleet or Desktop code: they run in the browser.

## Review Focus

1. **A Windows path typed or listed in any spelling.** `C:/Users/po/work/`, `c:\users\po\work`, `C:\Users\po\\work` must store as one normalized form and match the session's `cwd`, which the daemon resolves on its own. Tests: `normalizePath windows forms` (Task 1) and `a launch in a typed spelling is answered and grouped` (Task 4).
2. **A session in a subfolder of a Windows repo** (`C:\Users\po\work\api`) is grouped under the project. A sibling folder sharing a prefix (`C:\Users\po\workshop`) is not. Test: `under windows` (Task 1).
3. **A drive root or UNC share as a repo** (`C:\`, `\\nas\share`). It holds everything below it, and the picker's crumbs end at the root without a fake `/` crumb. Tests: `under windows roots` (Task 1) and `crumbs windows` (Task 1).
4. **A folder name Windows refuses** (`a:b`, `con`, `x.`) is refused with the usual « invalid name » message on Windows, but still accepted on Linux as today. Test: `badFolderName per shape` (Task 1) and `createFolder refuses a Windows-invalid name` (Task 2).
5. **An older daemon reading a `projects.json` that holds a Windows path** would reset it to empty (`readProjects` falls back to `DEFAULT_PROJECTS`). That can only happen on the Windows PC, where only this version runs. Recorded, not fixed (see the last section).

---

### Task 1: `packages/protocol/src/paths.ts` and projects through it

**Files:**
- Create: `packages/protocol/src/paths.ts`
- Create: `packages/protocol/test/paths.test.ts`
- Modify: `packages/protocol/src/projects.ts`. Change `normalizePath` (delegate), `PathSchema`, `under`, the `projectsProblems` keys, and `projectOf`.
- Modify: `packages/protocol/src/index.ts` (`export * from './paths.js'`)
- Modify: `packages/protocol/test/projects.test.ts` (Windows cases)

**Interfaces:**
- Produces, all pure and browser-safe:
  - `isWindowsPath(p: string): boolean`: `/^[A-Za-z]:([\\/]|$)/` or `/^[\\/]{2}[^\\/]/`
  - `normalizePath(raw: string): string`
    - POSIX: today's body.
    - Windows: trim; `/` becomes `\`; repeated `\` collapsed except the UNC prefix; drive letter upper-cased; a trailing `\` dropped except at the drive root `C:\`. A bare `C:` becomes `C:\`.
  - `isAbsolutePath(p: string): boolean`: POSIX `startsWith('/')`, or Windows drive/UNC.
  - `pathKey(p: string): string`: `normalizePath(p)`, lower-cased when Windows.
  - `samePath(a: string, b: string): boolean`: compares the keys.
  - `pathUnder(path: string, folder: string): boolean`
    - True when `path` is `folder` or below it.
    - POSIX: today's rule, with `/` holding everything.
    - Windows: compares keys with `\`; a drive root or UNC share root holds everything on it.
  - `baseName(p: string): string`: the last segment. A root returns itself: `/` gives `/`, `C:\` gives `C:\`.
  - `parentPath(p: string): string | null`: null at a root.
  - `joinPath(dir: string, name: string): string`: uses the separator of `dir`'s shape.
  - `pathCrumbs(p: string): { label: string; path: string }[]`
    - POSIX: `[{label:'/',path:'/'}, …]`.
    - Windows: `[{label:'C:',path:'C:\\'}, {label:'Users',path:'C:\\Users'}, …]`.
  - `badFolderName(name: string, parent: string): boolean`
    - Always refused: empty, `.`, `..`, and names containing `/` or `\0`.
    - Also refused when `parent` is Windows: `\ : * ? " < > |`, a trailing `.` or space, and reserved device names (`CON PRN AUX NUL COM1-9 LPT1-9`, case-insensitive, with or without an extension).
  - `homeShort(path: string, home: string | undefined): string`: `~` or `~` followed by the rest of the path, using `pathUnder` and the shape's separator. This replaces Desktop's `tildeHome`.

- [ ] **Step 1: Write the failing tests** (`paths.test.ts`, then additions to `projects.test.ts`)

```ts
it('normalizePath windows forms', () => {
  for (const raw of ['C:\\Users\\po\\work', 'C:/Users/po/work/', 'c:\\Users\\po\\\\work\\', ' C:\\Users\\po\\work ']) expect(normalizePath(raw)).toBe('C:\\Users\\po\\work');
  expect(normalizePath('c:')).toBe('C:\\'); expect(normalizePath('C:\\')).toBe('C:\\');
  expect(normalizePath('\\\\nas\\share\\x\\')).toBe('\\\\nas\\share\\x'); expect(normalizePath('//nas/share')).toBe('\\\\nas\\share');
});
it('normalizePath posix unchanged', () => {
  for (const [raw, out] of [['/a//b/', '/a/b'], ['/', '/'], [' /x ', '/x'], ['rel/x/', 'rel/x']]) expect(normalizePath(raw)).toBe(out);
});
it('under windows', () => {
  expect(pathUnder('C:\\Users\\po\\work\\api', 'c:/users/PO/work')).toBe(true);
  expect(pathUnder('C:\\Users\\po\\workshop', 'C:\\Users\\po\\work')).toBe(false);
  expect(pathUnder('C:\\Users\\po\\work', 'C:\\Users\\po\\work')).toBe(true);
  expect(pathUnder('/home/po/work', 'C:\\Users\\po\\work')).toBe(false);
});
it('under windows roots', () => {
  expect(pathUnder('C:\\x\\y', 'C:\\')).toBe(true); expect(pathUnder('D:\\x', 'C:\\')).toBe(false);
  expect(pathUnder('\\\\nas\\share\\a', '\\\\NAS\\share')).toBe(true);
});
it('crumbs windows', () => {
  expect(pathCrumbs('C:\\Users\\po')).toEqual([{ label: 'C:', path: 'C:\\' }, { label: 'Users', path: 'C:\\Users' }, { label: 'po', path: 'C:\\Users\\po' }]);
  expect(pathCrumbs('/home/po')).toEqual([{ label: '/', path: '/' }, { label: 'home', path: '/home' }, { label: 'po', path: '/home/po' }]);
});
it('join, base, parent per shape', () => {
  expect(joinPath('C:\\Users\\po', 'work')).toBe('C:\\Users\\po\\work'); expect(joinPath('C:\\', 'x')).toBe('C:\\x');
  expect(joinPath('/home', 'po')).toBe('/home/po'); expect(joinPath('/', 'x')).toBe('/x');
  expect(baseName('C:\\Users\\po\\work')).toBe('work'); expect(baseName('C:\\')).toBe('C:\\'); expect(baseName('/w/ledge')).toBe('ledge');
  expect(parentPath('C:\\Users')).toBe('C:\\'); expect(parentPath('C:\\')).toBeNull(); expect(parentPath('/w')).toBe('/'); expect(parentPath('/')).toBeNull();
});
it('badFolderName per shape', () => {
  for (const n of ['a:b', 'con', 'NUL.txt', 'x.', 'x ', 'a\\b', 'q?']) expect(badFolderName(n, 'C:\\w')).toBe(true);
  for (const n of ['a:b', 'con', 'x.']) expect(badFolderName(n, '/w')).toBe(false);
  for (const n of ['', '.', '..', 'a/b']) { expect(badFolderName(n, '/w')).toBe(true); expect(badFolderName(n, 'C:\\w')).toBe(true); }
});
it('homeShort', () => {
  expect(homeShort('C:\\Users\\po\\work', 'C:\\Users\\po')).toBe('~\\work'); expect(homeShort('c:\\users\\po', 'C:\\Users\\po')).toBe('~');
  expect(homeShort('/home/po/w', '/home/po')).toBe('~/w'); expect(homeShort('/srv', '/home/po')).toBe('/srv');
});
// projects.test.ts
it('a project takes a Windows folder and holds its sessions, any spelling', () => {
  const state = ProjectsSchema.parse({ projects: [{ id: 'w', name: 'W', color: 'blue', description: '', repos: [{ machine: 'local', path: 'C:\\Users\\po\\work' }] }], rules: [] });
  expect(projectOf({ machineId: 'local', cwd: 'c:\\users\\po\\work\\api' }, state)).toBe('w');
  expect(projectOf({ machineId: 'local', cwd: 'C:\\Users\\po\\workshop' }, state)).toBeNull();
});
it('a Windows path must be stored normalized; duplicates are found across spellings', () => {
  const repo = (path: string) => ({ id: 'w', name: 'W', color: 'blue', description: '', repos: [{ machine: 'local', path }] });
  expect(ProjectsSchema.safeParse({ projects: [repo('C:/Users/po/work/')], rules: [] }).success).toBe(false);
  expect(projectsProblems({ projects: [{ ...repo('C:\\Users\\po\\work'), repos: [{ machine: 'local', path: 'C:\\Users\\po\\work' }, { machine: 'local', path: 'C:\\USERS\\po\\work' }] }], rules: [] }).map(p => p.code)).toEqual(['duplicate_repo']);
});
```

- [ ] **Step 2: Run** `pnpm --filter @ledge/protocol exec vitest run test/paths.test.ts test/projects.test.ts`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement `paths.ts`.**
  - `projects.ts` imports `normalizePath` from it and keeps re-exporting it, so callers do not change.
  - `PathSchema`: `isAbsolutePath(p) && p === normalizePath(p)`.
  - `under` is `pathUnder`.
  - The duplicate keys use `pathKey`.
- [ ] **Step 4: Run** the protocol suite with `pnpm --filter @ledge/protocol exec vitest run`. Expected: all pass, the existing POSIX cases included.
- [ ] **Step 5: Commit** with the message `feat(protocol): Windows paths in projects (one browser-safe path module)`.

### Task 2: the daemon stores and compares Windows paths the same way

**Files:**
- Modify `packages/ledge/src/daemon/server.ts`: normalize the hook-only session `cwd`, with `normalizePath` on the cwd read near line 1284.
- Modify `packages/ledge/src/daemon/store.ts`: `touchRecent` dedupes by `pathKey`.
- Modify `packages/ledge/src/daemon/folders.ts`:
  - `createFolder` refuses `badFolderName(name, parent)`.
  - `resolveExact` also expands `~\`.
- Modify `packages/ledge/src/daemon/repos.ts`:
  - `repos.inspect` answers each path in the form it was asked (the front keys by it).
  - Expand `~\` as `~/` is.
- Test: `packages/ledge/test/windows-paths.test.ts`.

**Interfaces:** consumes Task 1's `normalizePath`, `pathKey` and `badFolderName`.

- [ ] **Step 1: Write the failing tests**:
  - `createFolder refuses a Windows-invalid name`: `createFolder('C:\\w', 'a:b')` and `createFolder('C:\\w', 'con')` are refused with the existing invalid-name error, without touching the disk. The injected `mkdir` is never called.
  - `touchRecent keeps one entry per Windows folder`: `C:\Users\po\work` then `c:/users/po/work` leaves one recent, the latest.
  - `a hook-only session's Windows cwd is stored normalized`: a hook with `cwd: 'c:/users/po/work/'` gives a session `cwd` of `C:\Users\po\work`.
  - `~\ expands like ~/`: test `resolveExact` with an injected home.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/windows-paths.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Where a function needs the platform or the home directory to be testable on Linux, take it as a parameter, as `userEnv` does.
- [ ] **Step 4: Run** the ledge suite and compare with the baseline taken before Task 1 (same known failures only).
- [ ] **Step 5: Commit** with the message `fix(daemon): Windows paths stored and compared one way (hooks, recents, new folders)`.

### Task 3: fleet uses the path module

**Files:**
- `packages/fleet/src/fleet.ts`: line ~630 builds the created folder with `joinPath(msg.parent, name)`.
- `packages/fleet/src/projects.ts`: `sameFolder` becomes `samePath`; `withRule` is unchanged (it already normalizes).
- `packages/fleet/src/groups.ts`: group by `pathKey(s.repoPath ?? s.cwd)`, keeping the first spelling seen as the label.
- `packages/fleet/src/proposals.ts`: `under`, `basename` and `parentOf` become `pathUnder`, `baseName` and `parentPath`. `HOME` also matches `X:\Users\<name>`, and the root guard uses `parentPath(p) === null`.
- Tests: extend `packages/fleet/test/projects.test.ts`, `groups.test.ts` and `proposals.test.ts` with one Windows case each (create the file if absent).

- [ ] **Step 1: Write the failing tests**:
  - `a created Windows folder is matched to its answer`: `folder.created` for parent `C:\w`, name `new`, gives `created: 'C:\\w\\new'`.
  - `two spellings of one Windows folder make one group`.
  - `proposals group Windows folders by their real parent, not "C"`: repos `C:\a\x` and `C:\b\y` get two different parents.
- [ ] **Step 2: Run** `pnpm --filter @ledge/fleet exec vitest run`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the fleet suite. Expected: all pass.
- [ ] **Step 5: Commit** with the message `fix(fleet): Windows folders grouped, created and proposed by their real path`.

### Task 4: Desktop: the folder picker, the project editor, launch and display

**Files:**
- `apps/desktop/src/projects/FolderPicker.tsx`:
  - `baseName`, `childOf` and `crumbsOf` become `baseName`, `joinPath` and `pathCrumbs`.
  - The root crumb label comes from `pathCrumbs`. The `c.root` label stays for `/`.
  - `badName` becomes `badFolderName(name, dir)`.
  - `dotted` splits on both separators.
  - `addTyped` checks `isAbsolutePath(normalizePath(typed))` instead of `startsWith('/')`.
- `apps/desktop/src/projects/ProjectEditor.tsx`: `baseName` comes from protocol; `taken` uses `samePath`.
- `apps/desktop/src/projects/draft.ts`: comparisons use `pathKey` instead of the raw `normalizePath` strings.
- `apps/desktop/src/launch/useLaunch.ts`: `answers` uses `samePath`.
- `apps/desktop/src/term/home.ts`: `tildeHome` delegates to `homeShort`.
- `apps/desktop/src/settings/Projects.tsx`, `apps/desktop/src/settings/Suggestions.tsx`, `apps/desktop/src/shell/sidebar/RigGroups.tsx`, `apps/desktop/src/session/changedFiles.ts` (`nameOf`, `relativeTo` with `pathUnder` and the shape's separator) and `packages/ui/src/chat/ProjectCard.tsx`: use `baseName`.
- `apps/desktop/src/chat/projectReview.ts`: `holdsOther` uses `pathUnder`.
- `apps/desktop/src/projects/ProjectEditor.tsx`: « Demander à Ledge » is hidden when `!useFeatures().chat`. Native mode has no Ledge chat.
- Tests: `apps/desktop/test/windows-paths.test.tsx`.

- [ ] **Step 1: Write the failing tests.** Each runs on a mock daemon whose `folder.list` answers Windows paths (`path: 'C:\\Users\\po'`, `parent: 'C:\\'`, `entries: ['work']`) and whose `repos.inspect` says they exist.
  - `the picker lists and adds a Windows folder`. Open the project editor. The crumbs read `C: / Users / po`. Add `work`. The repo row reads `work` with the path `C:\Users\po\work`. Saving sends `projects.set` with path `C:\Users\po\work`.
  - `a typed Windows path is accepted in any spelling and stored normalized`. Typing `c:/users/po/work/` stores `C:\Users\po\work`.
  - `a launch in a typed spelling is answered and grouped`. The project holds `C:\Users\po\work`. Launch from the composer. The mock daemon answers `session.launched` with a session whose `cwd` is `c:\users\po\work`. The composer closes (answered), and the session shows under the project in the sidebar.
  - `a new folder with a Windows-invalid name is refused in the picker`: `a:b` under `C:\Users\po` shows the invalid-name error.
  - `home is shortened on Windows`: `tildeHome('C:\\Users\\po\\work', 'C:\\Users\\po')` gives `~\work`.
  - `native mode hides « Demander à Ledge » in the project editor`.
- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/windows-paths.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the desktop suite (`pnpm --filter desktop exec vitest run`), then `tsc --noEmit` for desktop, fleet, protocol and ui. Expected: all pass, the step-4 baseline included.
- [ ] **Step 5: Commit** with the message `fix(desktop): Windows folders in the picker, the project editor and launch`.

### Task 5: verify on the Windows PC

Same setup as step 4 (spike report, « Desktop native mode »):
- the branch's debug build, run with `LEDGE_DESKTOP_MODE=native`, `LEDGE_PORT=27832` and the spike folders;
- the page driven over CDP;
- **ask the user before quitting their installed Desktop**;
- back up `settings.json` and restore it afterwards.

Checks, recorded in the spike report under « Windows paths in projects »:
1. **Create a project by browsing.** Use « Nouveau projet » and the picker to reach `%TEMP%\ledge-spike\work`. The crumbs show the drive, the row shows `work`, and saving succeeds.
2. **Launch Claude in that project.** Use « Lancer une session », choose the project and send a harmless prompt. The composer closes, and the session shows under the project in the sidebar and reaches idle.
3. **Repeat with Codex.**
4. **A typed path** (`c:/users/<user>/appdata/local/temp/ledge-spike/work/`) is stored normalized and matches.
5. **Cleanup:** restore `settings.json`, stop the daemon and the pane host, and restart the user's Desktop.

- [ ] **Commit** with the message `docs(spec): Windows paths in projects verified on the PC`.

## Not in this plan (recorded)

- **Listing drives** (a level above `C:\`). Another drive is reached by typing its path.
- **Hidden and system folders in the picker** (`AppData`, `$Recycle.Bin`, junctions such as `Application Data` that answer EPERM). They are listed; opening a junction shows the existing listing error.
- **An older daemon reading a `projects.json` that holds a Windows path resets it.** This happens only on the Windows PC after a downgrade.
- **Off the launch path:**
  - tool-call paths in the thread (`packages/ui/src/thread/tools.ts`);
  - document links (`SidePane`, hidden in native mode);
  - chat context (`packages/ledge/src/chat/context.ts`, chat hidden);
  - POSIX `quote` and `shellCommand` for a Windows machine reached over ssh.

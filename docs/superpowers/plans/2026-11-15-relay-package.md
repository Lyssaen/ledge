# A relay anyone can launch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/relay` into the npm package `@paradow/ledge-relay`, whose `ledge-relay launch` asks for what it
needs on first run, stores it, and runs a production relay on an embedded pglite database, serving the phone app.

**Architecture:** `loadConfig` learns an embedded-database option and a forced production mode. The start-up code
leaves `main.ts` for a `run.ts` both entries share. A new `src/launch/` folder holds the data directory, the merge of
the config file under the environment, the first-launch questions and the GitHub id lookup. `src/cli.ts` is the `bin`.
The release packs the package with the phone build of the same job, and publishes it only once it has a licence.

**Tech Stack:** Node ≥ 22, TypeScript, tsup, vitest, `@electric-sql/pglite` 0.5.10 (pinned), `pg`, `node:readline`,
`node:util` `parseArgs`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-14-relay-package-design.md`

## Global Constraints

- The relay never decrypts, stores or logs a body, nor logs a token or secret. This covers the OAuth client secret, the
  VAPID private key and the config file's content: error messages name a setting, never its value.
- `launch` always runs with the production rules: https public URL, phone build present, VAPID present. It never falls
  back to dev tokens.
- The environment variables documented in `apps/relay/README.md` override the config file, which overrides defaults.
- `DATABASE_URL` set: Postgres. Unset under `launch`: pglite in `<data dir>/db`.
- Data directory: `--data`, else `LEDGE_RELAY_HOME`, else `~/.ledge-relay`. Directory mode `0700`, `config.json` mode
  `0600`.
- `launch` listens on `127.0.0.1` unless `--host`. `node dist/main.js` (the Docker image) keeps listening on every
  interface, configured by the environment only, exactly as today.
- The database directory is never deleted or rewritten when it cannot be opened.
- Package name `@paradow/ledge-relay`, bin `ledge-relay`, `"license": "UNLICENSED"` until the owner picks one.
- The release publishes the relay only when its `license` is set and is not `UNLICENSED`; otherwise it runs
  `npm pack --dry-run` and the step succeeds (the `production` job depends on the `npm` job).
- The packed `web/build.json` is byte-identical to the `apps/mobile/dist/build.json` the same job uploads as
  `pwa-build`.
- Prompts and messages of `ledge-relay` are in English, like the relay's existing stderr messages. The i18n rule covers
  the screens (Desktop, island, phone, TUI); `ledge-relay` has none.
- Relative imports end in `.js`. Comments are full prose sentences saying what a thing is for or why.
- Tests: `pnpm --filter @paradow/ledge-relay test` (after Task 5's rename; `@ledge/relay` before), and
  `pnpm vitest run --config vitest.scripts.config.ts` for root scripts. Run `pnpm install` once in the worktree first.

## Review Focus

1. **A hand-edited `config.json` that is not valid JSON or fails the schema.** Expected: exit 1 naming the file and
   suggesting `ledge-relay launch --setup`; the file is left as it is. Test: Task 3.
2. **The public URL typed with a trailing slash, a path or in `http:`.** Expected: the question is asked again with
   the reason, not a crash and not a stored bad value. Test: Task 4.
3. **The GitHub login does not exist, or GitHub cannot be reached, during setup.** Expected: the question is asked
   again, saying a numeric id also works. Test: Task 4.
4. **Ctrl-C or end of input in the middle of the questions.** Expected: nothing written, exit 1. Test: Task 4 (the
   dialogue rejects) and Task 5 (the CLI writes nothing).
5. **The port is already taken.** Expected: the existing one-line message `cannot listen on port <p>: EADDRINUSE`,
   exit 1. Test: Task 2.

---

### Task 1: Config — embedded database and forced production

**Files:**
- Modify: `apps/relay/src/config.ts`
- Modify: `apps/relay/src/main.ts:38-44` (reads `cfg.database`)
- Modify: `apps/relay/test/config.test.ts`, `apps/relay/test/app.test.ts:18` (fixture uses `database`)

**Interfaces:**
- Produces:
  - `export type DatabaseConfig = { kind: 'postgres'; url: string } | { kind: 'pglite'; dir: string }`
  - `AccountsConfig.database: DatabaseConfig`, which replaces `databaseUrl`.
  - `export function loadConfig(env: NodeJS.ProcessEnv, opts?: { production?: boolean; pgliteDir?: string }): Config`.
    `production` defaults to `env.NODE_ENV === 'production'`. Accounts mode applies when `DATABASE_URL` is set
    (`postgres`, which wins) or `pgliteDir` is given (`pglite`).
  - `export function parsePublicUrl(raw: string, production: boolean): string` (now exported, unchanged behaviour).

- [ ] **Step 1: Write the failing tests** in `config.test.ts`:
  - `loadConfig({ ...productionEnv(), DATABASE_URL: undefined }, { pgliteDir: '/d' })` gives `mode: 'accounts'` and
    `database: { kind: 'pglite', dir: '/d' }`.
  - With both `DATABASE_URL` and `pgliteDir`, `database` is `{ kind: 'postgres', url: FULL.DATABASE_URL }`.
  - `loadConfig({ ...productionEnv(), NODE_ENV: undefined }, { production: true, pgliteDir: '/d' })` with
    `LEDGE_RELAY_PUBLIC_URL: 'http://relay.example'` throws `LEDGE_RELAY_PUBLIC_URL must be https when NODE_ENV=production`.
  - `loadConfig({ LEDGE_RELAY_DEV_TOKENS: '{}' }, { production: true })` throws
    `DATABASE_URL is not set: refusing to start with dev tokens in production`.
  - Update the existing `toEqual` at line 51 to `database: { kind: 'postgres', url: FULL.DATABASE_URL }`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/relay test config` → FAIL (`database` undefined).
- [ ] **Step 3: Implement** the interfaces above in `config.ts`. Only the selection of the mode and `production` change.
  Every message stays word for word.
- [ ] **Step 4: Update** `main.ts` (`connectionString: cfg.database.url`, after narrowing on `kind === 'postgres'`; a
  `pglite` config cannot reach it yet, since `main.ts` passes no `pgliteDir`) and the `app.test.ts` fixture
  (`database: { kind: 'postgres', url: 'unused' }`).
- [ ] **Step 5: Run** `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck` → PASS.
- [ ] **Step 6: Commit** `refactor(relay): the config selects postgres or an embedded pglite database`.

### Task 2: Shared start-up — open the database, listen

**Files:**
- Create: `apps/relay/src/database.ts`, `apps/relay/src/run.ts`
- Modify: `apps/relay/src/main.ts` (becomes: load env config, `startRelay`, map errors to `die`)
- Modify: `apps/relay/package.json`: move `@electric-sql/pglite` to `dependencies` as exactly `"0.5.10"`
- Test: `apps/relay/test/run.test.ts`

**Interfaces:**
- Consumes: `Config`, `DatabaseConfig` (Task 1); `startAccountsRelay` (`src/app.ts`); `createRelay`, `devTokens`,
  `staticRoutes`, `githubHttp`, as `main.ts` uses them today.
- Produces:
  - `database.ts`:
    - `export class DatabaseOpenError extends Error { constructor(readonly dir: string) }`
    - `export async function openDatabase(c: DatabaseConfig): Promise<{ db: Db; close(): Promise<void> }>`.
      For `postgres`, it is the `pg.Pool` of today's `main.ts`, with the same timeouts and the idle-error handler. For
      `pglite`, it creates `c.dir` (recursive) and runs `await PGlite.create(c.dir)`. Any failure there throws
      `DatabaseOpenError(c.dir)`, and nothing in `c.dir` is touched.
  - `run.ts`:
    - `export class ListenError extends Error { constructor(readonly port: number, readonly code: string) }`
    - `export class DatabaseUnreachableError extends Error { constructor(readonly code?: string) }`. It is thrown when
      `startAccountsRelay` (the migration) fails on Postgres.
    - `export async function startRelay(cfg: Config, opts?: { host?: string; github?: GitHub; log?: RelayLog }): Promise<{ server: http.Server; port: number; close(): Promise<void> }>`.
      It builds the dev or accounts relay as `main.ts` does today, listens on `cfg.port` (and `opts.host` when given),
      and resolves once listening, with the actual port. `opts.github` replaces `githubHttp` (for tests). `close()`
      closes the relay, then the database. On a listen error it closes the database and rejects with `ListenError`.
- `main.ts` keeps its outputs: the JSON `listening` line, `cannot listen on port ${port}: ${code}`, and
  `cannot start: the database is unreachable or its migration failed (${code})`. It adds
  `cannot open the embedded database at <dir>: move this directory aside to start a fresh one (accounts, sessions, linked phones and push subscriptions are then lost)`
  for `DatabaseOpenError`.

- [ ] **Step 1: Write the failing tests** in `run.test.ts`. Each test uses a fresh `mkdtemp` directory and builds an
  accounts `Config` by hand with `database: { kind: 'pglite', dir }` and `port: 0`, started with
  `startRelay(cfg, { host: '127.0.0.1', github: fakeGitHub() })`:
  - `starts on pglite, and a session survives a restart`. Sign in through `/auth/device/start` and `/auth/device/poll`
    as `app.test.ts` does, then `close()`. Start again on the same directory: `GET /auth/me` with the bearer token
    answers 200.
  - `refuses a database directory it cannot open, and leaves it untouched`. The directory holds a `PG_VERSION` file
    containing `99\n` and a file `base/x`. Expect a rejection with `DatabaseOpenError` whose `dir` is that directory,
    and the same directory listing and bytes afterwards. If pglite 0.5.10 happens to accept that directory, build an
    unreadable one another way (e.g. a corrupted `global/pg_control`) and note it in the test's comment. The assertion
    on untouched bytes stays.
  - `reports a taken port`. Start a first relay, then a second one with the first one's port: `ListenError` with
    `code === 'EADDRINUSE'`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/relay test run` → FAIL (module not found).
- [ ] **Step 3: Implement** `database.ts` and `run.ts`, then reduce `main.ts` to `loadConfig(process.env)` →
  `startRelay(cfg)` → the listening line, with `die` mapping `ConfigError`, `ListenError`, `DatabaseUnreachableError`
  and `DatabaseOpenError` to the lines above, and the SIGINT/SIGTERM handlers calling `close()`.
- [ ] **Step 4: Run** `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck && pnpm --filter @ledge/relay build`
  → PASS. Then `LEDGE_RELAY_DEV_TOKENS='{"tok-pc-0123456789abcdef":{"accountId":"me","peer":"pc"}}' node apps/relay/dist/main.js`
  prints the JSON `listening` line with `"mode":"dev"`. Stop it.
- [ ] **Step 5: Commit** `refactor(relay): one start-up shared by the env entry and the launcher, pglite included`.

### Task 3: Data directory and config file

**Files:**
- Create: `apps/relay/src/launch/home.ts`, `apps/relay/src/launch/vapid.ts`
- Test: `apps/relay/test/launch-home.test.ts`

**Interfaces:**
- Produces:
  - `export const LaunchFileSchema` (zod, every field optional, unknown keys refused): `publicUrl: string`,
    `githubClientId: string`, `githubClientSecret: string`, `allowedGithubIds: string[]`,
    `vapid: { publicKey: string; privateKey: string; subject: string }`. `export type LaunchFile = z.infer<…>`.
  - `export function relayHome(o: { data?: string; env: NodeJS.ProcessEnv; homedir: string }): string`
  - `export class LaunchFileError extends Error { constructor(readonly path: string) }`. Its message is
    `<path> is not a valid ledge-relay config: fix it, or run \`ledge-relay launch --setup\``. The file's content never
    goes into it.
  - `export function readLaunchFile(home: string): LaunchFile`: `{}` when `config.json` is absent; `LaunchFileError`
    on bad JSON or schema.
  - `export function writeLaunchFile(home: string, f: LaunchFile): void`: creates `home` with mode `0700`, writes
    `config.json.tmp` with mode `0600`, then renames it over `config.json`.
  - `export function launchEnv(f: LaunchFile, env: NodeJS.ProcessEnv, webDir: string): NodeJS.ProcessEnv`. It maps
    `publicUrl` → `LEDGE_RELAY_PUBLIC_URL`, `githubClientId` → `GITHUB_CLIENT_ID`, `githubClientSecret` →
    `GITHUB_CLIENT_SECRET`, `allowedGithubIds` → `LEDGE_RELAY_ALLOWED_GITHUB_IDS` (joined with `,`), and `vapid` → the
    three `LEDGE_RELAY_VAPID_*`. It sets `LEDGE_RELAY_WEB_DIR` to `webDir`. Every value already set and non-empty in
    `env` wins.
  - `export const SETTINGS: ReadonlyArray<{ env: string; label: string }>`. It lists the four settings `launch` asks
    for, in question order: `LEDGE_RELAY_PUBLIC_URL` "public URL", `GITHUB_CLIENT_ID` "GitHub OAuth App client id",
    `GITHUB_CLIENT_SECRET` "GitHub OAuth App client secret", `LEDGE_RELAY_ALLOWED_GITHUB_IDS` "allowed GitHub account".
  - `export function missingSettings(merged: NodeJS.ProcessEnv): string[]`: the `label (ENV)` of each empty one.
  - `vapid.ts`: `export function generateVapid(subject: string): { publicKey: string; privateKey: string; subject: string }`.
    It uses the same derivation as `scripts/vapid-keys.mjs`, which stays as it is: it must run without
    `pnpm install`.

- [ ] **Step 1: Write the failing tests**:
  - `relayHome`: `data` wins, then `env.LEDGE_RELAY_HOME`, then `join(homedir, '.ledge-relay')`.
  - `writeLaunchFile` then `readLaunchFile` round-trips. `statSync(home).mode & 0o777` is `0o700` and the file's mode
    is `0o600` (skip both mode checks on `win32`).
  - `readLaunchFile` on `{"publicUrl":` and on `{"nope":1}` throws `LaunchFileError`. The message holds the path,
    does not hold `nope`, and the file's bytes are unchanged.
  - `launchEnv({ publicUrl: 'https://a.example' }, { LEDGE_RELAY_PUBLIC_URL: 'https://b.example' }, '/w')` gives
    `https://b.example` and `LEDGE_RELAY_WEB_DIR: '/w'`. An empty-string env value does not win.
  - `missingSettings(launchEnv({ publicUrl: 'https://a.example' }, {}, '/w'))` equals the three remaining labels, in
    order.
  - `generateVapid('mailto:a@b.c')` feeds `loadConfig` without error: a complete production env plus those three
    variables loads, so the pair is valid.
- [ ] **Step 2: Run** `pnpm --filter @ledge/relay test launch-home` → FAIL.
- [ ] **Step 3: Implement** `home.ts` and `vapid.ts`.
- [ ] **Step 4: Run** `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(relay): the launcher's data directory and config file`.

### Task 4: First-launch questions and the GitHub id lookup

**Files:**
- Create: `apps/relay/src/launch/github-id.ts`, `apps/relay/src/launch/setup.ts`
- Test: `apps/relay/test/launch-setup.test.ts`

**Interfaces:**
- Consumes: `LaunchFile` (Task 3), `parsePublicUrl` (Task 1), `generateVapid` (Task 3).
- Produces:
  - `export async function resolveGithubId(input: string, o?: { apiBase?: string; fetch?: typeof fetch }): Promise<{ id: string; login?: string }>`.
    A numeric `input` (`/^[1-9][0-9]*$/`) is returned as `{ id: input }` with no call. Otherwise it calls
    `GET ${apiBase ?? 'https://api.github.com'}/users/${encodeURIComponent(input)}` with `user-agent: ledge-relay` and a
    10 s timeout. A 200 answer with a numeric `id` gives `{ id: String(id), login }`. Anything else throws
    `GithubIdError('not_found' | 'unavailable')`.
  - `export interface SetupIo { ask(question: string, o?: { secret?: boolean; default?: string }): Promise<string>; say(line: string): void }`.
    `ask` rejects on end of input or Ctrl-C.
  - `export async function runSetup(io: SetupIo, current: LaunchFile, deps?: { resolveId?: typeof resolveGithubId }): Promise<LaunchFile>`.
    In order:
    1. the public URL, checked with `parsePublicUrl(raw, true)`; on error the `ConfigError` message is said and the
       question asked again;
    2. the OAuth App block, said as lines: homepage `<publicUrl>`, callback `<publicUrl>/auth/github/callback`, tick
       "Enable Device Flow", no permission needed; then the client id, then the client secret with `secret: true`;
    3. the GitHub login or numeric id, resolved and said back (`GitHub account <login> = id <id>`); on
       `GithubIdError` it says why and that a numeric id also works, then asks again;
    4. a contact for Web Push, `mailto:` address, default `<publicUrl>`. A bare address gets `mailto:` prefixed, and
       anything else must match `^(mailto:|https:\/\/)\S+$`.

    Each question offers the `current` value as its `default`, except the secret: when one is set, an empty answer
    keeps it. The result carries `vapid` from `current` when present with the same subject; otherwise it carries
    `generateVapid(subject)`.

- [ ] **Step 1: Write the failing tests** with a scripted `SetupIo` (a queue of answers; `say` lines and asked
  questions recorded) and a stubbed `resolveId`:
  - The happy path gives the expected `LaunchFile`, and the said lines contain
    `https://relay.example/auth/github/callback`.
  - `https://relay.example/`, then `http://relay.example`, then `https://relay.example`: the public URL is asked three
    times, and two said lines carry the `ConfigError` messages.
  - `resolveId` throwing `not_found`, then answering: asked twice, and one said line mentions a numeric id.
  - The secret question is asked with `secret: true`, and no said line contains the secret's value.
  - With a `current` holding a secret, an empty answer keeps it.
  - The scripted `ask` rejecting at question 3: `runSetup` rejects (the caller writes nothing; see Task 5).
  - `resolveGithubId('12345')` makes no fetch call. `resolveGithubId('octo', { fetch })`, with a fetch answering 404,
    throws `not_found`; with a rejecting fetch, it throws `unavailable`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/relay test launch-setup` → FAIL.
- [ ] **Step 3: Implement** `github-id.ts` and `setup.ts`.
- [ ] **Step 4: Run** `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(relay): first-launch questions for a self-hosted relay`.

### Task 5: The `ledge-relay` command and the package rename

**Files:**
- Create: `apps/relay/src/cli.ts` (starts with `#!/usr/bin/env node`), `apps/relay/src/launch/terminal.ts`
- Modify: `apps/relay/tsup.config.ts` (`entry: ['src/main.ts', 'src/cli.ts']`)
- Modify: `apps/relay/package.json`: `name: "@paradow/ledge-relay"`; drop `private`; add
  `bin: { "ledge-relay": "dist/cli.js" }`, `files: ["dist", "web"]`, `license: "UNLICENSED"`, and `repository`
  (`directory: "apps/relay"`) / `homepage` as in `packages/ledge/package.json`
- Modify: `apps/relay/Dockerfile` (3 `--filter`), root `AGENTS.md` (table row), `apps/relay/AGENTS.md` (title and
  commands)
- Test: `apps/relay/test/cli.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3 and 4.
- Produces:
  - `terminal.ts`: `export function terminalIo(input: NodeJS.ReadStream, output: NodeJS.WriteStream): SetupIo & { close(): void }`,
    on `node:readline`. With `secret: true`, the typed characters are not echoed. Ctrl-C and end of input reject `ask`.
  - `cli.ts`:
    - `export async function main(argv: string[], deps: CliDeps): Promise<number>`, where
      `CliDeps = { env: NodeJS.ProcessEnv; homedir: string; isTTY: boolean; io: () => SetupIo & { close(): void }; out: (line: string) => void; err: (line: string) => void; webDir: string; github?: GitHub; waitForStop: () => Promise<void> }`.
    - The file's last lines call `main(process.argv.slice(2), realDeps)` and set `process.exitCode`. `webDir` is
      `fileURLToPath(new URL('../web', import.meta.url))`. `waitForStop` resolves on SIGINT or SIGTERM.
  - Arguments (`parseArgs`, strict): `--version` prints the package version and returns 0. `launch` takes `--port`,
    `--host` (default `127.0.0.1`), `--data` and `--setup`. Anything else prints a usage line on `err` and returns 2.
  - The `launch` flow:
    1. `home = relayHome(…)`, `file = readLaunchFile(home)`.
    2. When `--setup` is given, or `missingSettings(launchEnv(file, env, webDir))` is not empty: with `isTTY`, run
       `runSetup(io(), file)`, then `writeLaunchFile`. A rejection writes nothing and returns 1. Without `isTTY`,
       print `ledge-relay: missing settings: <list>; run \`ledge-relay launch\` once in a terminal, or set these environment variables`
       and return 1.
    3. When `vapid` is missing from both the file and the env, generate it with subject `publicUrl` and write it to the
       file. This needs no question, even without a terminal.
    4. `cfg = loadConfig({ ...launchEnv(file, env, webDir), ...(port ? { PORT: port } : {}) }, { production: true, pgliteDir: join(home, 'db') })`.
    5. Call `startRelay(cfg, { host, github })`. Print
       `ledge-relay <version> listening on http://<host>:<port> — public URL <publicUrl>: put an HTTPS proxy in front, then enter this URL in Ledge Desktop › Settings › Mobile access`,
       then the existing JSON `listening` line (with `"mode":"accounts"`). `await waitForStop()`, `close()`, return 0.
    6. `ConfigError`, `LaunchFileError`, `ListenError`, `DatabaseOpenError` and `DatabaseUnreachableError` print one
       `ledge-relay: …` line on `err` (the same texts as `main.ts`) and return 1.

- [ ] **Step 1: Write the failing tests** in `cli.test.ts`, with a temp home, `webDir` pointing at a temp directory
  holding the four phone build files, `fakeGitHub()`, `--port 0`, and `waitForStop` resolved by the test:
  - `--version` prints the `version` of `package.json`.
  - A complete env (`LEDGE_RELAY_PUBLIC_URL`, the GitHub id and secret, `LEDGE_RELAY_ALLOWED_GITHUB_IDS`) with
    `isTTY: false`: it starts, and `config.json` now holds only `vapid`, with subject `https://relay.example`. After
    stopping, start again: same VAPID public key. `<home>/db` exists.
  - An empty env with `isTTY: false`: returns 1. The `err` line names the four labels, and no `config.json` is written.
  - An empty env with `isTTY: true` and a scripted io that rejects at the second question: returns 1, and no
    `config.json` is written.
  - An empty env with `isTTY: true` and a complete scripted io: `config.json` holds the answers, and no `out` or
    `err` line contains the client secret.
  - A `config.json` holding `{"publicUrl":` → returns 1 with the `LaunchFileError` line, and the file is unchanged.
  - `LEDGE_RELAY_PUBLIC_URL=http://relay.example` → returns 1 with the https message, even with `NODE_ENV` unset.
- [ ] **Step 2: Run** `pnpm --filter @ledge/relay test cli` → FAIL.
- [ ] **Step 3: Implement** `terminal.ts` and `cli.ts`, and add the tsup entry.
- [ ] **Step 4: Rename** the package: update `package.json`, run `pnpm install` (the lockfile's importer key follows),
  and replace `@ledge/relay` with `@paradow/ledge-relay` in `apps/relay/Dockerfile`, root `AGENTS.md`,
  `apps/relay/AGENTS.md` and `apps/relay/README.md`. Historical plans under `docs/superpowers/plans/` are left as they
  are.
- [ ] **Step 5: Run** `pnpm --filter @paradow/ledge-relay test && pnpm --filter @paradow/ledge-relay typecheck && pnpm --filter @paradow/ledge-relay build`
  → PASS. Then `node apps/relay/dist/cli.js --version` prints the version, and `git grep -n "@ledge/relay" -- ':!docs/superpowers'`
  prints nothing.
- [ ] **Step 6: Commit** `feat(relay): ledge-relay launch, published as @paradow/ledge-relay`.

### Task 6: Packing with the phone build, and the release

**Files:**
- Create: `apps/relay/scripts/copy-web.mjs`, `scripts/relay-pack.mjs`, `test/relay-pack.test.ts`
- Modify: `apps/relay/package.json` (script `"pack:web": "node scripts/copy-web.mjs"`), `.gitignore`
  (`apps/relay/web/`), `scripts/set-version.mjs` (target `apps/relay/package.json`, `JSON_VERSION`; header comment
  mentions the relay), `test/version.test.ts` (`FILES` and the "same version" assertion include
  `apps/relay/package.json`), `.github/workflows/release.yml`, `apps/relay/package.json` `version` set to the
  current release version (the one in `packages/ledge/package.json`)

**Interfaces:**
- Produces:
  - `copy-web.mjs`: replaces `apps/relay/web/` with a copy of `apps/mobile/dist/`. It exits 1 with
    `copy-web: apps/mobile/dist/build.json is missing: build @ledge/mobile first` when that file is absent.
  - `scripts/relay-pack.mjs`, run as `node scripts/relay-pack.mjs check <npm pack --json file>` or
    `node scripts/relay-pack.mjs publishable`. It exports:
    - `export function relayPublishable(pkg: { license?: string }): boolean`: true only for a non-empty license other
      than `UNLICENSED`.
    - `export function checkRelayPack(o: { files: string[]; packedBuild: string; mobileBuild: string }): string[]`.
      It returns the problems: `dist/cli.js`, `dist/main.js`, `web/index.html`, `web/sw.js`, `web/build.json` or
      `web/manifest.webmanifest` missing from `files`, or `packedBuild !== mobileBuild`.
    - The `check` command reads `apps/relay/web/build.json` and `apps/mobile/dist/build.json`, prints each problem and
      exits 1 if there is any. `publishable` prints `true` or `false`.

- [ ] **Step 1: Write the failing tests** in `test/relay-pack.test.ts`:
  - `relayPublishable({ license: 'UNLICENSED' })`, `({})` and `({ license: '' })` → false; `({ license: 'MIT' })` →
    true.
  - `checkRelayPack` with every file and equal builds → `[]`. Without `web/build.json` → one problem naming it. With
    different builds → one problem.
  - `version.test.ts`: the relay's `version` equals the daemon's.
- [ ] **Step 2: Run** `pnpm vitest run --config vitest.scripts.config.ts` → FAIL.
- [ ] **Step 3: Implement** both scripts, the set-version target and the version bump.
- [ ] **Step 4: Release workflow.** In the `npm` job, after `pnpm --filter @ledge/mobile build` and its upload, add:
  1. `pnpm --filter @paradow/ledge-relay test`.
  2. `pnpm --filter @paradow/ledge-relay build`.
  3. `pnpm --filter @paradow/ledge-relay pack:web`.
  4. **Check the relay package**: in `apps/relay`, run `npm pack --dry-run --json > "$RUNNER_TEMP/relay-pack.json"`,
     then `node scripts/relay-pack.mjs check "$RUNNER_TEMP/relay-pack.json"` from the root.
  5. **Publish the relay to npm**, with `if: env.PUBLISH == 'true'`. It is a shell step: when
     `node scripts/relay-pack.mjs publishable` prints `false`, it echoes
     `@paradow/ledge-relay not published: no licence yet` and exits 0. Otherwise, in `apps/relay`, it runs the
     daemon's "already published" guard with `@paradow/ledge-relay@$v`, then `npm publish --access public --provenance`.
     The daemon's publish step already installs `npm@11`, and this step runs after it.

  A comment above the publish step states the two one-time owner actions (licence, then first manual publish and
  Trusted Publisher) and points to the README.
- [ ] **Step 5: Verify locally:** `pnpm vitest run --config vitest.scripts.config.ts` → PASS.
  `pnpm --filter @ledge/mobile build && pnpm --filter @paradow/ledge-relay build && pnpm --filter @paradow/ledge-relay pack:web`,
  then `p=$(mktemp) && (cd apps/relay && npm pack --dry-run --json) > "$p" && node scripts/relay-pack.mjs check "$p"`
  → no output, exit 0. `node scripts/relay-pack.mjs publishable` → `false`.
- [ ] **Step 6: Smoke test the packed package:** `cd apps/relay && npm pack`. Install the tarball into a temp prefix
  (`npm i -g --prefix <tmp> <tgz>`). Run `<tmp>/bin/ledge-relay launch --port 0 --data <tmp>/home` with a complete env
  and no TTY. It prints the human line and `"mode":"accounts"`, and `curl` on its port answers `ok` on `/healthz` and
  serves `/build.json`. Stop it.
- [ ] **Step 7: Commit** `ci(release): pack the relay with the phone build; publish it once it has a licence`.

### Task 7: Docs

**Files:**
- Modify: `apps/relay/README.md`, `docs/ledge-guide.md`, `apps/relay/AGENTS.md`

- [ ] **Step 1: README.** Title `@paradow/ledge-relay`. The first section, "Run your own relay", covers:
  1. requirements: Node ≥ 22, a domain, an HTTPS proxy;
  2. `npm i -g @paradow/ledge-relay`;
  3. `ledge-relay launch`, and what it asks, including the OAuth App values;
  4. the Caddy example `relay.example.com {\n  reverse_proxy 127.0.0.1:8787\n}`;
  5. a systemd unit (`ExecStart=<path of ledge-relay> launch`, `Restart=on-failure`, `User=` a dedicated user);
  6. in Ledge Desktop: Réglages › Accès mobile, relay address, sign in with GitHub;
  7. data directory and options;
  8. the allow-list (edit `allowedGithubIds`, restart);
  9. "If the database cannot be opened after an upgrade" (move `<data>/db` aside; what is lost).

  The existing sections follow, unchanged apart from the rename. A "Publishing (owner)" note covers: choose a licence
  and set `license`; publish once by hand (`pnpm --filter @ledge/mobile build`, build, `pack:web`, `npm publish --access public`
  in `apps/relay`); set the Trusted Publisher on npmjs.com for `release.yml`; from then on, releases publish it.
- [ ] **Step 2: Guide.** In `docs/ledge-guide.md` › Ledge mobile, add one line in French: the relay can be your own
  (`ledge-relay launch`, see `apps/relay/README.md`).
- [ ] **Step 3: AGENTS.** `apps/relay/AGENTS.md` gets the `ledge-relay launch` entry, the data directory, and the rule
  that the launcher never prints a secret.
- [ ] **Step 4: Verify:** `pnpm test && pnpm typecheck` → PASS. Under load, `hook.test` failures also happen on
  `main` (root `AGENTS.md`).
- [ ] **Step 5: Commit** `docs(relay): run your own relay`.

import { isArchived, type ForgeAction, type ForgeKind, type ForgeStateMessage, type ForgeStatus, type PrDetail, type PullRequest, type Session } from '@ledge/protocol';
import type { Store } from '../store.js';
import { log } from '../../log.js';
import { githubReader } from './github.js';
import { gitlabReader } from './gitlab.js';
import { execForge, forgeOf, type ForgeCli, type ForgeRepo, type ForgeRun } from './run.js';
import { blockerText, mergeBlockersOf, targetKey, type BranchTarget, ForgeError, ForgeRefusal, type ForgeReader, type ReadPr } from './types.js';

/**
 * The pull and merge requests of the machine's sessions and OpenRig seats (lot 8a). What is followed (R1): the source branch of a
 * session or seat not archived, on its `origin` repository (`repoId`); default branches and detached heads left out. One list call
 * per repository, every 60 s, or 15 s while a followed pipeline runs or waits (R2); at once after an action and when a session
 * changes branch. A forge in error waits 2, 4, 8 then 10 minutes, its host alone.
 */

export const SLOW_MS = 60_000;
export const FAST_MS = 15_000;
export const BACKOFF_MAX_MS = 10 * 60_000;
export const DETAIL_TTL_MS = 30_000;
const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop']);
/** A detached head: the poller stores the short sha as the branch. */
const DETACHED = /^[0-9a-f]{7,40}$/;

export interface ForgeService {
  state(): ForgeStateMessage;
  onChange(cb: () => void): () => void;
  refresh(): Promise<void>;
  start(): void;
  stop(): void;
  /** Kept 30 s. Throws ForgeRefusal (`unavailable`: not a followed request) or ForgeError. */
  detail(prId: string, opts: { log?: string }): Promise<PrDetail>;
  /** Re-reads the request, applies R5 and R6, acts, then reads the list again. Throws ForgeRefusal or ForgeError. */
  act(prId: string, action: ForgeAction): Promise<{ command: string }>;
}

interface Followed { repo: ForgeRepo; targets: Map<string, { target: BranchTarget; sessions: Session[] }> }
/** Where a session's branch is pushed, read in its folder's git configuration (R1, review of d266f114). */
interface Head { key: string; at: number; head: string; branch: string }
const HEAD_TTL_MS = 5 * 60_000;

/**
 * The repository and branch name a local branch is pushed to: its push remote (`branch.<b>.pushRemote`, `remote.pushDefault`),
 * else its upstream (`branch.<b>.remote`, the upstream's name from `branch.<b>.merge`), else `origin`. Read from
 * `git config -z --get-regexp`. A remote on another host than the listed repository, or no answer: the listed repository.
 */
export function headOf(config: string, branch: string, listed: ForgeRepo): { head: string; branch: string } {
  const cfg = new Map<string, string>();
  for (const entry of config.split('\0')) {
    const nl = entry.indexOf('\n');
    if (nl > 0) cfg.set(entry.slice(0, nl), entry.slice(nl + 1));
  }
  const push = cfg.get(`branch.${branch}.pushremote`) ?? cfg.get('remote.pushdefault');
  const remote = push ?? cfg.get(`branch.${branch}.remote`) ?? 'origin';
  const merge = cfg.get(`branch.${branch}.merge`);
  const name = !push && merge?.startsWith('refs/heads/') ? merge.slice('refs/heads/'.length) : branch;
  const url = cfg.get(`remote.${remote}.url`);
  const f = url ? forgeOf(url) : null;
  return { head: f && f.host === listed.host ? f.path : listed.path, branch: name || branch };
}
interface Entry { pr: ReadPr; repo: ForgeRepo }
const kindOf = (cli: ForgeCli): ForgeKind => (cli === 'gh' ? 'github' : 'gitlab');
const hostKey = (repo: ForgeRepo): string => `${repo.cli}:${repo.host}`;
const strip = ({ blockers: _b, head: _h, ...pr }: ReadPr, sessions: string[]): PullRequest => ({ ...pr, sessions });

export function createForgeService(deps: { store: Store; run?: ForgeRun; env?: () => Promise<NodeJS.ProcessEnv>; now?: () => number; readers?: Partial<Record<ForgeCli, ForgeReader>> }): ForgeService {
  const run = deps.run ?? execForge(deps.env ?? (async () => process.env));
  const now = deps.now ?? Date.now;
  const readers: Record<ForgeCli, ForgeReader> = { gh: deps.readers?.gh ?? githubReader(run), glab: deps.readers?.glab ?? gitlabReader(run) };
  /** Each followed request, by id, with the repository it was read from. */
  let entries = new Map<string, Entry>();
  /** The requests read per repository, kept while its forge is in error. */
  const byRepo = new Map<string, ReadPr[]>();
  const statuses = new Map<string, ForgeStatus>();
  const backoff = new Map<string, { failures: number; until: number }>();
  const defaults = new Map<string, string | null>();
  const details = new Map<string, { at: number; detail: PrDetail }>();
  const listeners = new Set<() => void>();
  let last = '';
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let started = false;
  let followedKey = '';
  /** Per session, where its branch is pushed (read again when its folder or branch changes, or after 5 minutes). */
  const heads = new Map<string, Head>();

  const candidate = (s: Session): ForgeRepo | null => {
    if (isArchived(s) || !s.repoId || !s.branch || s.branch === 'HEAD' || DETACHED.test(s.branch) || DEFAULT_BRANCHES.has(s.branch)) return null;
    const repo = forgeOf(`https://${s.repoId}`);
    return repo && defaults.get(repo.repo) !== s.branch ? repo : null;
  };
  async function resolveHeads(): Promise<void> {
    await Promise.all(deps.store.all().map(async s => {
      const repo = candidate(s);
      if (!repo) { heads.delete(s.id); return; }
      const dir = s.workdir || s.cwd, key = `${dir}\n${s.branch}\n${s.repoId}`;
      const had = heads.get(s.id);
      if (had && had.key === key && now() - had.at < HEAD_TTL_MS) return;
      const r = dir ? await run('git', ['config', '-z', '--get-regexp', '^(branch|remote)\\.'], { cwd: dir, timeoutMs: 5000 }) : null;
      const h = headOf(r && r.code === 0 ? r.stdout : '', s.branch!, repo);
      heads.set(s.id, { key, at: now(), ...h });
    }));
  }
  /** The repositories to read, and per target (head repository, branch) its sessions, most recently active first (R12). */
  function followed(): Map<string, Followed> {
    const out = new Map<string, Followed>();
    for (const s of deps.store.all()) {
      const repo = candidate(s);
      if (!repo) continue;
      const h = heads.get(s.id);
      const target: BranchTarget = { branch: h?.branch ?? s.branch!, head: h?.head ?? repo.path };
      let f = out.get(repo.repo);
      if (!f) out.set(repo.repo, (f = { repo, targets: new Map() }));
      const k = targetKey(target);
      const t = f.targets.get(k) ?? { target, sessions: [] };
      t.sessions.push(s);
      f.targets.set(k, t);
    }
    for (const f of out.values()) for (const t of f.targets.values()) t.sessions.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    return out;
  }
  const keyOf = (fl: Map<string, Followed>): string => JSON.stringify([...fl].map(([r, f]) => [r, [...f.targets].map(([k, t]) => [k, t.sessions.map(s => s.id)])]).sort());
  /** What decides the targets, before their heads are read: a session's repository, branch and folder. */
  const sourceKey = (): string => JSON.stringify(deps.store.all().flatMap(s => (candidate(s) ? [[s.id, s.repoId, s.branch, s.workdir || s.cwd]] : [])));

  function setStatus(repo: ForgeRepo, status: ForgeStatus['status'], message?: string): void {
    const k = hostKey(repo), had = statuses.get(k);
    if (had && had.status === status && had.message === message) return;
    statuses.set(k, { forge: kindOf(repo.cli), host: repo.host, status, ...(message ? { message } : {}), at: new Date(now()).toISOString() });
  }

  async function readRepo(f: Followed): Promise<void> {
    const reader = readers[f.repo.cli], k = hostKey(f.repo);
    const b = backoff.get(k);
    if (b && now() < b.until) return;
    try {
      if (!defaults.has(f.repo.repo)) defaults.set(f.repo.repo, await reader.defaultBranch(f.repo).catch(() => null));
      const targets = [...f.targets.values()].map(t => t.target).filter(t => t.branch !== defaults.get(f.repo.repo));
      byRepo.set(f.repo.repo, await reader.list(f.repo, targets));
      backoff.delete(k);
      setStatus(f.repo, 'ok');
    } catch (e) {
      const failures = (b?.failures ?? 0) + 1;
      backoff.set(k, { failures, until: now() + Math.min(BACKOFF_MAX_MS, SLOW_MS * 2 ** failures) });
      const status = e instanceof ForgeError ? e.status : 'error';
      const message = e instanceof Error ? e.message : String(e);
      setStatus(f.repo, status, message);
      log(`forge: ${f.repo.host}/${f.repo.path} not read (${status}): ${message}`);
    }
  }

  function rebuild(fl: Map<string, Followed>): void {
    const next = new Map<string, Entry>();
    for (const [r, f] of fl) {
      for (const pr of byRepo.get(r) ?? []) {
        if (!f.targets.has(targetKey(pr))) continue;
        next.set(pr.id, { pr, repo: f.repo });
      }
    }
    for (const r of [...byRepo.keys()]) if (!fl.has(r)) byRepo.delete(r);
    entries = next;
    const msg = state();
    const s = JSON.stringify(msg);
    if (s !== last) { last = s; for (const cb of listeners) cb(); }
  }

  function sessionsOf(pr: ReadPr, fl = followed()): string[] {
    return (fl.get(forgeOf(`https://${pr.host}/${pr.repo}`)?.repo ?? '')?.targets.get(targetKey(pr))?.sessions ?? []).map(s => s.id);
  }

  function state(): ForgeStateMessage {
    const fl = followed();
    const prs = [...entries.values()].map(e => strip(e.pr, sessionsOf(e.pr, fl))).filter(p => p.sessions.length).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const used = new Set([...fl.values()].map(f => hostKey(f.repo)));
    return { type: 'forge.state', prs, forges: [...statuses].filter(([k]) => used.has(k)).map(([, s]) => s) };
  }

  async function refreshOnce(): Promise<void> {
    await resolveHeads();
    const fl = followed();
    followedKey = keyOf(fl);
    await Promise.all([...fl.values()].map(readRepo));
    rebuild(followed());
  }
  /** One refresh at a time; a call during one runs another right after. */
  function refresh(): Promise<void> {
    if (running) { again = true; return running; }
    running = (async () => {
      try { do { again = false; await refreshOnce(); } while (again); }
      finally { running = null; }
    })();
    return running;
  }

  /** 15 s while a followed pipeline runs or waits on a forge not in error, 60 s otherwise. */
  function delay(): number {
    const busy = [...entries.values()].some(e => (e.pr.pipeline === 'run' || e.pr.pipeline === 'wait') && e.pr.state !== 'merged' && e.pr.state !== 'closed' && !backoff.has(hostKey(e.repo)));
    return busy ? FAST_MS : SLOW_MS;
  }
  function schedule(ms = delay()): void {
    if (!started) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void refresh().finally(() => schedule()); }, ms);
    timer.unref();
  }

  const unsubscribe = { fn: (): void => undefined };

  async function fresh(prId: string): Promise<Entry> {
    const e = entries.get(prId);
    if (!e) throw new ForgeRefusal('unavailable', 'this request is not followed on this machine');
    const read = (await readers[e.repo.cli].list(e.repo, [{ branch: e.pr.branch, head: e.pr.head }])).find(p => p.id === prId);
    if (!read) throw new ForgeRefusal('unavailable', 'the request is no longer there');
    return { pr: read, repo: e.repo };
  }

  return {
    state,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    refresh,
    start() {
      if (started) return;
      started = true;
      // A session that changes branch, appears or is archived: read at once (a short pause gathers a burst of changes).
      let sources = sourceKey();
      unsubscribe.fn = deps.store.onChange(() => {
        const k = keyOf(followed()), src = sourceKey();
        if (k !== followedKey || src !== sources) { followedKey = k; sources = src; rebuild(followed()); schedule(500); }
      });
      void refresh().finally(() => schedule());
    },
    stop() {
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
      unsubscribe.fn();
    },

    async detail(prId, opts) {
      const e = entries.get(prId);
      if (!e) throw new ForgeRefusal('unavailable', 'this request is not followed on this machine');
      const key = `${prId}|${opts.log ?? ''}`;
      const hit = details.get(key);
      if (hit && now() - hit.at < DETAIL_TTL_MS) return hit.detail;
      const d = await readers[e.repo.cli].detail(e.repo, e.pr.number, opts);
      const detail: PrDetail = { ...d, pr: strip(d.pr, sessionsOf(e.pr)) };
      details.set(key, { at: now(), detail });
      return detail;
    },

    async act(prId, action) {
      const e = await fresh(prId);
      const pr = e.pr;
      if (action.kind === 'merge') {
        if (pr.headSha !== action.headSha) throw new ForgeRefusal('stale', 'the request has new commits since you saw it');
        const blockers = mergeBlockersOf(pr);
        if (blockers.length) throw new ForgeRefusal('not_offered', blockerText(blockers));
      }
      if (action.kind === 'rerun' && (pr.pipeline === 'run' || pr.pipeline === 'wait')) throw new ForgeRefusal('busy', 'the pipeline is still running');
      const { blockers: _b, ...core } = pr;
      const r = await readers[e.repo.cli].act(e.repo, core, action);
      for (const k of [...details.keys()]) if (k.startsWith(`${prId}|`)) details.delete(k);
      void refresh().finally(() => schedule());
      return r;
    }
  };
}

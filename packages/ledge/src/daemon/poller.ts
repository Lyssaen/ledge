import { createHash } from 'node:crypto';
import type { Session } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Tmux } from '../tmux.js';
import { adapterFor as defaultAdapterFor, buildPreview, PREVIEW_CAPTURE_LINES } from '../adapters/index.js';
import { log } from '../log.js';
import { gitInfo as defaultGitInfo } from './git.js';
import { claudePlan } from './transcript.js';

export { PREVIEW_LINES } from '../adapters/index.js';
/** Prompt detection reads the pane's last lines: a dialog with a long diff or many options is taller than 30 lines. */
export const DETECT_LINES = 60;
/** How long the pane must stay at rest before the session is called idle: a turn starting has time to show itself. */
export const REST_MS = 2000;
/** Finished helpers leave the live session after five minutes; their thread stays in history. */
export const HELPER_RETENTION_MS = 5 * 60 * 1000;

export function startPoller(opts: {
  store: Store; tmux: Tmux; adapterFor?: typeof defaultAdapterFor;
  intervalMs?: number; deadCheckMs?: number; retireMs?: number; now?: () => string;
  broadcastPreview?: (id: string, lines: string[]) => void;
  gitInfo?: typeof defaultGitInfo;
  /** Retries the resume labels that waited for a Claude process to end. */
  labelExited?: () => void;
}) {
  const { store, tmux } = opts;
  const adapterFor = opts.adapterFor ?? defaultAdapterFor;
  const git = opts.gitInfo ?? defaultGitInfo;
  const now = opts.now ?? (() => new Date().toISOString());
  const deadCheckMs = opts.deadCheckMs ?? 5000;
  const retireMs = opts.retireMs ?? 10 * 60 * 1000;
  const hashes = new Map<string, string>();
  /** The last preview sent per session, so an unchanged one is not sent again. */
  const previews = new Map<string, string>();
  const matches = new Map<string, NonNullable<ReturnType<ReturnType<typeof defaultAdapterFor>['detectPrompt']>>>();
  /** The last pane title emitted per session, so each distinct title is sent once. */
  const titles = new Map<string, string>();
  /** Since when each pane has been at rest (the agent waiting for a prompt), as read on its last change. */
  const restSince = new Map<string, number>();
  /** Sessions whose repository has been read once; later refreshes ride the dead check. */
  const gitSeen = new Set<string>();
  const forget = (id: string) => { hashes.delete(id); matches.delete(id); previews.delete(id); restSince.delete(id); titles.delete(id); gitSeen.delete(id); };
  let lastDeadCheck = 0;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return; running = true;
    try {
      const t = Date.parse(now());
      const deadCheck = t - lastDeadCheck >= deadCheckMs;
      if (deadCheck) lastDeadCheck = t;
      for (const id of previews.keys()) if (!store.get(id)) previews.delete(id);
      try { opts.labelExited?.(); } catch (e) { log(`resume labels failed: ${(e as Error).message}`); }
      for (const snapshot of store.all()) {
        // Earlier sessions yield while reading Git/the terminal. Hooks and removals may have
        // changed this one meanwhile: never clean up or republish the stale snapshot.
        const s = store.get(snapshot.id);
        if (!s) continue;
        try { await pollOne(s, t, deadCheck); }
        catch (e) { log(`poll failed for ${s.id}: ${(e as Error).message}`); }
      }
    } finally { running = false; }
  }

  async function pollOne(s: Session, t: number, deadCheck: boolean): Promise<void> {
    // Also clean up archived and hook-only sessions. Old journals have no helper finish date: the
    // parent's last recorded activity is a conservative fallback, persisted on this first pass.
    const helpers = s.helpers.flatMap(h => {
      if (s.pending?.helperId === h.id || (h.state !== 'exited' && s.state !== 'exited')) return [h];
      const finishedAt = h.finishedAt ?? s.exitedAt ?? s.lastActivityAt;
      if (t - Date.parse(finishedAt) >= HELPER_RETENTION_MS) return [];
      return h.finishedAt && h.state === 'exited' ? [h] : [{ ...h, state: 'exited' as const, finishedAt }];
    });
    if (helpers.length !== s.helpers.length || helpers.some((h, i) => h !== s.helpers[i])) {
      s = { ...s, helpers };
      store.upsert(s);
    }
    if (s.state === 'exited') {
      forget(s.id);
      // A restore restarts the clock: the later of the exit and the restore counts.
      if (!s.archivedAt && s.exitedAt) {
        const since = Math.max(Date.parse(s.exitedAt), s.restoredAt ? Date.parse(s.restoredAt) : -Infinity);
        if (t - since > retireMs) store.archive(s.id, now());
      }
      return;
    }
    // The repository can change under the agent (checkout, new worktree): first sight, then every dead check.
    if ((deadCheck || !gitSeen.has(s.id)) && s.cwd) { gitSeen.add(s.id); const g = await git(s.cwd); if (g) store.patch(s.id, { ...g, repoId: g.repoId }); }
    if (!s.tmuxSession) return;
    if (deadCheck && !(await tmux.hasSession(s.tmuxSession))) {
      store.apply(s.id, { name: 'PaneGone', at: now(), source: 'daemon' });
      forget(s.id);
      return;
    }
    // One capture serves both: the preview reads the whole screen and some scrollback, prompt
    // detection reads only its last DETECT_LINES (what a DETECT_LINES capture would have returned).
    const full = await tmux.capture(s.tmuxSession, PREVIEW_CAPTURE_LINES);
    if (full === null) return; // capture failed: not a content change
    const pane = full.split('\n').slice(-DETECT_LINES).join('\n');
    const h = createHash('sha1').update(full).digest('hex');
    const prev = hashes.get(s.id);
    if (prev === h) {
      // Unchanged pane: re-apply a remembered prompt only if nothing is pending (a hook may have
      // shadowed it inside the priority window). The reducer keeps no-ops identical.
      const m = matches.get(s.id);
      if (m && !store.get(s.id)?.pending) store.apply(s.id, { name: 'PanePrompt', at: now(), source: 'pane', kind: m.kind, text: m.text, options: m.options, ...(m.optionDetails ? { optionDetails: m.optionDetails } : {}), ...withBody(s, m) });
      rested(s.id, t);
      return;
    }
    hashes.set(s.id, h);
    if (prev !== undefined) store.apply(s.id, { name: 'PaneChanged', at: now(), source: 'pane' });
    let adapter; try { adapter = adapterFor(s.tool); } catch { adapter = null; }
    // Sent on the first sighting too, so a client has a preview before the agent writes again.
    const lines = buildPreview(full, adapter);
    const key = lines.join('\n');
    if (previews.get(s.id) !== key) { previews.set(s.id, key); opts.broadcastPreview?.(s.id, lines); }
    if (!adapter) return;
    const title = adapter.paneTitle?.(pane) ?? null;
    if (title && title !== titles.get(s.id)) { titles.set(s.id, title); store.apply(s.id, { name: 'PaneTitle', at: now(), source: 'pane', text: title }); }
    if (adapter.atRest?.(pane)) { if (!restSince.has(s.id)) restSince.set(s.id, t); }
    else restSince.delete(s.id);
    const m = adapter.detectPrompt(pane);
    if (!m) { matches.delete(s.id); rested(s.id, t); return; }
    matches.set(s.id, m);
    store.apply(s.id, { name: 'PanePrompt', at: now(), source: 'pane', kind: m.kind, text: m.text, options: m.options, ...(m.optionDetails ? { optionDetails: m.optionDetails } : {}), ...withBody(s, m) });
  }

  /** A plan read in the pane carries its text when the pane shows it (Cursor); Claude Code's is read from its transcript. */
  function withBody(s: Session, m: NonNullable<ReturnType<ReturnType<typeof defaultAdapterFor>['detectPrompt']>>): { body?: string } {
    const body = m.body ?? (m.kind === 'plan' && s.tool === 'claude' && s.transcriptPath ? claudePlan(s.transcriptPath) : undefined);
    return body ? { body } : {};
  }

  /** A pane at rest for REST_MS reports it; the reducer decides what that ends (and keeps no-ops identical). */
  function rested(id: string, t: number): void {
    const since = restSince.get(id);
    if (since !== undefined && t - since >= REST_MS) store.apply(id, { name: 'PaneIdle', at: now(), source: 'pane' });
  }

  const timer = setInterval(() => { void tick(); }, opts.intervalMs ?? 1000);
  return { stop: () => clearInterval(timer), tick };
}

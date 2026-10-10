import { createHash } from 'node:crypto';
import type { Session } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Tmux } from '../tmux.js';
import { adapterFor as defaultAdapterFor } from '../adapters/index.js';
import { log } from '../log.js';

export const PREVIEW_LINES = 30;
/** Prompt detection reads more than the preview: a dialog with a long diff or many options is taller than 30 lines. */
export const DETECT_LINES = 60;

export function startPoller(opts: {
  store: Store; tmux: Tmux; adapterFor?: typeof defaultAdapterFor;
  intervalMs?: number; deadCheckMs?: number; retireMs?: number; now?: () => string;
  broadcastPreview?: (id: string, lines: string[]) => void;
}) {
  const { store, tmux } = opts;
  const adapterFor = opts.adapterFor ?? defaultAdapterFor;
  const now = opts.now ?? (() => new Date().toISOString());
  const deadCheckMs = opts.deadCheckMs ?? 5000;
  const retireMs = opts.retireMs ?? 10 * 60 * 1000;
  const hashes = new Map<string, string>();
  const matches = new Map<string, NonNullable<ReturnType<ReturnType<typeof defaultAdapterFor>['detectPrompt']>>>();
  let lastDeadCheck = 0;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return; running = true;
    try {
      const t = Date.parse(now());
      const deadCheck = t - lastDeadCheck >= deadCheckMs;
      if (deadCheck) lastDeadCheck = t;
      for (const s of store.all()) {
        try { await pollOne(s, t, deadCheck); }
        catch (e) { log(`poll failed for ${s.id}: ${(e as Error).message}`); }
      }
    } finally { running = false; }
  }

  async function pollOne(s: Session, t: number, deadCheck: boolean): Promise<void> {
    if (s.state === 'exited') {
      hashes.delete(s.id); matches.delete(s.id);
      if (s.exitedAt && t - Date.parse(s.exitedAt) > retireMs) store.remove(s.id);
      return;
    }
    if (!s.tmuxSession) return;
    if (deadCheck && !(await tmux.hasSession(s.tmuxSession))) {
      store.apply(s.id, { name: 'PaneGone', at: now(), source: 'daemon' });
      hashes.delete(s.id); matches.delete(s.id);
      return;
    }
    const pane = await tmux.capture(s.tmuxSession, DETECT_LINES);
    if (pane === null) return; // capture failed: not a content change
    const h = createHash('sha1').update(pane).digest('hex');
    const prev = hashes.get(s.id);
    if (prev === h) {
      // Unchanged pane: re-apply a remembered prompt only if nothing is pending (a hook may have
      // shadowed it inside the priority window). The reducer keeps no-ops identical.
      const m = matches.get(s.id);
      if (m && !store.get(s.id)?.pending) store.apply(s.id, { name: 'PanePrompt', at: now(), source: 'pane', kind: m.kind, text: m.text, options: m.options });
      return;
    }
    hashes.set(s.id, h);
    if (prev !== undefined) {
      store.apply(s.id, { name: 'PaneChanged', at: now(), source: 'pane' });
      opts.broadcastPreview?.(s.id, pane.split('\n').slice(-PREVIEW_LINES));
    }
    let adapter; try { adapter = adapterFor(s.tool); } catch { return; }
    const m = adapter.detectPrompt(pane);
    if (!m) { matches.delete(s.id); return; }
    matches.set(s.id, m);
    store.apply(s.id, { name: 'PanePrompt', at: now(), source: 'pane', kind: m.kind, text: m.text, options: m.options });
  }

  const timer = setInterval(() => { void tick(); }, opts.intervalMs ?? 1000);
  return { stop: () => clearInterval(timer), tick };
}

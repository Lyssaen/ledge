import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import type { Tmux } from '../tmux.js';
import { adapterFor as defaultAdapterFor } from '../adapters/index.js';
import { log } from '../log.js';

export const PREVIEW_LINES = 30;

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
  let lastDeadCheck = 0;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return; running = true;
    try {
      const t = Date.parse(now());
      const deadCheck = t - lastDeadCheck >= deadCheckMs;
      if (deadCheck) lastDeadCheck = t;
      for (const s of store.all()) {
        if (s.state === 'exited') {
          hashes.delete(s.id);
          if (s.exitedAt && t - Date.parse(s.exitedAt) > retireMs) store.remove(s.id);
          continue;
        }
        if (!s.tmuxSession) continue;
        if (deadCheck && !(await tmux.hasSession(s.tmuxSession))) { store.apply(s.id, { name: 'PaneGone', at: now(), source: 'daemon' }); hashes.delete(s.id); continue; }
        const pane = await tmux.capture(s.tmuxSession, PREVIEW_LINES);
        const h = createHash('sha1').update(pane).digest('hex');
        if (hashes.get(s.id) === h) continue;
        hashes.set(s.id, h);
        store.apply(s.id, { name: 'PaneChanged', at: now(), source: 'pane' });
        opts.broadcastPreview?.(s.id, pane.split('\n'));
        let adapter; try { adapter = adapterFor(s.tool); } catch { continue; }
        const m = adapter.detectPrompt(pane);
        if (m) store.apply(s.id, { name: 'PanePrompt', at: now(), source: 'pane', kind: m.kind, text: m.text, options: m.options });
      }
    } catch (e) { log(`poll failed: ${(e as Error).message}`); }
    finally { running = false; }
  }

  const timer = setInterval(() => { void tick(); }, opts.intervalMs ?? 1000);
  return { stop: () => clearInterval(timer), tick };
}

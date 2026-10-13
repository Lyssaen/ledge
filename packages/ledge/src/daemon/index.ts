import { writeFile, rm } from 'node:fs/promises';
import { Store } from './store.js';
import { History } from './history.js';
import { startServer } from './server.js';
import { startPoller } from './poller.js';
import { realTmux, type Tmux } from '../tmux.js';
import { ensureLedgeDir, paths } from '../paths.js';
import { log } from '../log.js';
import { daemonInfo } from '../update/self.js';
import { createDaemonUpdater, realUpdaterDeps } from '../update/run-update.js';

export async function startDaemon(opts: { port?: number; tmux?: Tmux; tmuxSocket?: string } = {}): Promise<{ stop(): Promise<void>; port: number }> {
  await ensureLedgeDir();
  const store = new Store();
  await store.load();
  const tmux = opts.tmux ?? realTmux(opts.tmuxSocket ?? 'ledge');
  let live: Set<string> | null = null;
  try { live = new Set(await tmux.listSessions()); }
  catch (e) { log(`startup prune skipped, tmux unavailable: ${(e as Error).message}`); }
  if (live) for (const s of store.all()) {
    if (s.tmuxSession && !live.has(s.tmuxSession)) store.remove(s.id);
  }
  const daemon = await daemonInfo();
  const updater = createDaemonUpdater(realUpdaterDeps({ info: daemon, save: () => store.save() }));
  const history = new History();
  await history.load();
  const server = await startServer({ store, tmux, port: opts.port, daemon, updater, history });
  const poller = startPoller({ store, tmux, broadcastPreview: server.preview });
  await writeFile(paths().pid, String(process.pid));
  log(`daemon started on ${server.port} with ${store.all().length} sessions`);
  let stopping: Promise<void> | null = null;
  const stop = () => stopping ??= (async () => {
    process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
    poller.stop(); await server.close(); await store.save(); await history.flush(); await rm(paths().pid, { force: true }); log('daemon stopped');
  })();
  const onSignal = () => { stop().finally(() => process.exit(0)); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  return { stop, port: server.port };
}

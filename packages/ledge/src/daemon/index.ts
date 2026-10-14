import { writeFile, rm } from 'node:fs/promises';
import { Store } from './store.js';
import { HistoryStore } from './history.js';
import { startServer, type ServerHandle } from './server.js';
import { startPoller } from './poller.js';
import { realTmux, type Tmux } from '../tmux.js';
import { ensureLedgeDir, paths } from '../paths.js';
import { log, quote } from '../log.js';
import { DeviceStore, type MobileControl } from './devices.js';
import { createPairing } from './pairing.js';
import { startRemoteListener, type RemoteListener } from './remote/listener.js';
import { loadMobileConfig, parseOrigin, saveMobileConfig, type MobileConfig } from '../mobile/config.js';
import { daemonInfo } from '../update/self.js';
import { createDaemonUpdater, realUpdaterDeps } from '../update/run-update.js';

/**
 * Mobile access (decisions D1 and D8): the remote entry runs only while `~/.ledge/mobile.json` names an origin, and
 * `mobile.configure` starts, restarts or stops it without touching the local port. The daemon owns the listener and
 * closes it before the server.
 */
function mobileControl(o: { config: MobileConfig | null; devices: DeviceStore; server: () => ServerHandle; remotePort?: number }): MobileControl & { start(): Promise<void>; stop(): Promise<void> } {
  let config = o.config;
  let remote: RemoteListener | null = null;
  let queue: Promise<void> = Promise.resolve();
  const pairing = createPairing({ config: () => config, devices: o.devices });
  /** One change at a time: two quick `mobile.configure` must not race for the port. */
  const serial = (fn: () => Promise<void>) => { const run = queue.then(fn); queue = run.catch(() => undefined); return run; };
  const stopRemote = async () => { if (!remote) return; const r = remote; remote = null; await r.close(); log('remote entry stopped'); };
  const startRemote = async () => {
    if (!config) return;
    try {
      remote = await startRemoteListener({ server: o.server(), config, devices: o.devices, pairing, port: o.remotePort });
      log(`remote entry listening on 127.0.0.1:${remote.port} for ${config.origin}`);
    } catch (e) { log(`remote entry not started: ${quote((e as Error).message)}`); }
  };
  return {
    devices: o.devices,
    pairing,
    state: () => ({ origin: config?.origin ?? null, listening: remote !== null }),
    configure: origin => serial(async () => {
      const next = origin === null ? null : parseOrigin(origin);
      await saveMobileConfig(next);
      const changed = next?.origin !== config?.origin;
      config = next;
      log(next ? `mobile access configured for ${next.origin}` : 'mobile access disabled');
      if (changed || !remote) { await stopRemote(); await startRemote(); }
    }),
    start: () => serial(startRemote),
    stop: () => serial(stopRemote)
  };
}

export async function startDaemon(opts: { port?: number; tmux?: Tmux; tmuxSocket?: string; remotePort?: number } = {}): Promise<{ stop(): Promise<void>; port: number }> {
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
  await new HistoryStore().prune(new Set(store.all().map(s => s.id)));
  const daemon = await daemonInfo();
  const updater = createDaemonUpdater(realUpdaterDeps({ info: daemon, save: () => store.save() }));
  const devices = new DeviceStore();
  await devices.load();
  // The remote entry attaches its phones to the server, which needs the control for its device commands: started after both exist.
  let handle: ServerHandle | undefined;
  const mobile = mobileControl({ config: await loadMobileConfig(), devices, server: () => handle!, remotePort: opts.remotePort });
  const server = handle = await startServer({ store, tmux, port: opts.port, daemon, updater, mobile });
  await mobile.start();
  const poller = startPoller({ store, tmux, broadcastPreview: server.preview });
  await writeFile(paths().pid, String(process.pid));
  log(`daemon started on ${server.port} with ${store.all().length} sessions`);
  let stopping: Promise<void> | null = null;
  const stop = () => stopping ??= (async () => {
    process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
    poller.stop(); await mobile.stop(); await server.close(); await store.save(); await rm(paths().pid, { force: true }); log('daemon stopped');
  })();
  const onSignal = () => { stop().finally(() => process.exit(0)); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  return { stop, port: server.port };
}

import { existsSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { backendOf } from '@ledge/protocol';
import { join } from 'node:path';
import { reapOwner } from './omp/owner.js';
import { Store } from './store.js';
import { History } from './history.js';
import { AttachmentStore } from './attachments.js';
import { startServer } from './server.js';
import { startPoller } from './poller.js';
import { realTmux, type Tmux } from '../tmux.js';
import { ensureLedgeDir, paths } from '../paths.js';
import { log } from '../log.js';
import { daemonInfo } from '../update/self.js';
import { createDaemonUpdater, realUpdaterDeps } from '../update/run-update.js';
import { ledgePeer, readPeers } from './peers.js';
import { createMobileService, type MobileService } from '../mobile/service.js';
import { fileJournal } from './mailbox.js';
import { asksJournal } from './asks.js';
import { createBridge } from './openrig/bridge.js';
import { loginShellEnv } from '../shell-path.js';
import { homedir } from 'node:os';

/** What older Ledge versions left under the Ledge dir: never read, never removed, told once at startup (spec §7). */
const OLD_TEAM_DATA = ['tasks.json', 'teams-live.json', 'teams', 'roles'] as const;
export function logIgnoredTeamData(dir: string, log: (line: string) => void): void {
  for (const name of OLD_TEAM_DATA) {
    const path = join(dir, name);
    if (existsSync(path)) log(`ignored ${path}: Ledge teams, roles and tasks were removed (2026-10-30-ledge-openrig-orchestrator-design §7)`);
  }
}

export async function startDaemon(opts: { port?: number; tmux?: Tmux; tmuxSocket?: string } = {}): Promise<{ stop(): Promise<void>; port: number }> {
  await ensureLedgeDir();
  logIgnoredTeamData(paths().dir, log);
  const store = new Store();
  const loaded = await store.load();
  const tmux = opts.tmux ?? realTmux(opts.tmuxSocket ?? 'ledge');
  let live: Set<string> | null = null;
  try { live = new Set(await tmux.listSessions()); }
  catch (e) { log(`startup prune skipped, tmux unavailable: ${(e as Error).message}`); }
  if (live) for (const s of store.all()) {
    if (s.tmuxSession && !live.has(s.tmuxSession)) store.apply(s.id, { name: 'PaneGone', at: new Date().toISOString(), source: 'daemon' });
  }
  // An OMP process lives and dies with this daemon: after a restart its session is over, resumable from its journal.
  for (const s of store.all()) {
    if (backendOf(s) !== 'omp-rpc') continue;
    // A process the dead daemon left running must not go on writing the journal a resume will continue.
    await reapOwner(join(paths().dir, 'omp', s.id)).catch(() => false);
    if (s.state === 'exited') continue;
    const at = new Date().toISOString();
    store.apply(s.id, { name: 'StopFailure', at, source: 'daemon', text: 'Ledge restarted: the OMP process ended with it' });
    store.apply(s.id, { name: 'SessionEnd', at, source: 'daemon', exitCode: null });
  }
  const daemon = await daemonInfo();
  let ompLive = () => 0;
  const updater = createDaemonUpdater(realUpdaterDeps({ info: daemon, save: () => store.save(), ownedLive: () => ompLive() }));
  // One store for the thread's image refs and the server's attachment requests.
  const attachments = new AttachmentStore(paths().attachments);
  await attachments.load().catch(e => log(`attachments not loaded: ${(e as Error).message}`));
  const history = new History({ peerOf: t => ledgePeer(t, readPeers(), store.all())?.id, refOf: id => attachments.ref(id) });
  try { await history.load(); } catch (e) { log(`history not loaded: ${(e as Error).message}`); }
  // Threads of sessions the store no longer holds (deleted, or past the archive cap) go now; only when the journal was
  // read whole: a session it lost is not a deleted one, and its thread must stay.
  if (loaded.clean) { for (const id of history.ids()) if (!store.get(id)) history.forget(id); }
  else log(`history cleanup skipped: ${loaded.reason}`);
  // Mobile access is optional: a failure here (the PC's key unreadable and not writable) leaves the rest of the daemon up.
  let mobile: MobileService | undefined;
  let mobileUnavailable: string | undefined;
  try { mobile = await createMobileService(); }
  catch (e) { log(`mobile access not available: ${(e as Error).message}`); mobileUnavailable = (e as Error).message.slice(0, 200); }
  const mail = fileJournal(paths().mail);
  const askJournal = asksJournal(paths().asks);
  // One agent environment for the agents and for `rig` (facts: OpenRig runs under the user's login shell).
  const agentEnv = async () => ({ ...process.env, ...(await loginShellEnv()) });
  // The bridge reads the server's asks and projects only once started, after startServer: lazy adapters over `server`.
  const bridge = createBridge({ env: agentEnv, projects: () => server.projects(), home: homedir(), sessionName: id => store.get(id)?.name,
    asks: { all: () => server.asks.all(), onChange: f => server.asks.onChange(f) } });
  const server = await startServer({ store, tmux, port: opts.port, daemon, updater, history, mobile, mobileUnavailable, mail, asks: askJournal, attachments, agentEnv, openrig: bridge });
  await bridge.start();
  ompLive = () => server.omp.liveCount();
  const poller = startPoller({ store, tmux, broadcastPreview: server.preview, labelExited: server.labelExited });
  await writeFile(paths().pid, String(process.pid));
  log(`daemon started on ${server.port} with ${store.all().length} sessions`);
  let stopping: Promise<void> | null = null;
  const stop = () => stopping ??= (async () => {
    process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
    poller.stop(); await bridge.stop(); await server.close(); await mobile?.stop(); await store.save(); await history.flush(); await mail.flush(); await askJournal.flush(); await rm(paths().pid, { force: true }); log('daemon stopped');
  })();
  const onSignal = () => { stop().finally(() => process.exit(0)); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  return { stop, port: server.port };
}

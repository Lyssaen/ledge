import { writeFile, rm } from 'node:fs/promises';
import { backendOf } from '@ledge/protocol';
import { join } from 'node:path';
import { reapOwner } from './omp/owner.js';
import { Store } from './store.js';
import { History } from './history.js';
import { AttachmentStore } from './attachments.js';
import { startServer } from './server.js';
import { startPoller } from './poller.js';
import { realTmux, routedTmux, type Tmux } from '../tmux.js';
import { ensureLedgeDir, paths } from '../paths.js';
import { log } from '../log.js';
import { daemonInfo } from '../update/self.js';
import { createDaemonUpdater, realUpdaterDeps } from '../update/run-update.js';
import { ledgePeer, readPeers } from './peers.js';
import { createMobileService, type MobileService } from '../mobile/service.js';
import { fileJournal } from './mailbox.js';
import { tasksJournal } from './tasks.js';
import { createUsage } from './usage/service.js';
import { createForgeService } from './forge/service.js';
import { homedir } from 'node:os';
import { loginShellEnv } from '../shell-path.js';
import { NO_SIZE, SIZE_MARK, keptOf } from '../term/windowSize.js';

/** A shell born beside the daemon (`sh-` and 12 hex): its watch died with the last daemon, nobody can reach it again. */
export const BORN_SHELL = /^sh-[0-9a-f]{12}$/;

/**
 * What a daemon that stopped without closing its desktop terminals left behind: shells nobody watches, and windows
 * still held at a desktop's size (`window-size manual`). Both are undone before anything watches again.
 * A window Ledge held carries its own size and dimensions in `@ledge_window_size` (term/windowSize.ts): it gets exactly those back, an OpenRig
 * seat's included, and only such a window is touched on a seat's server. A Ledge session held by an older daemon (no mark) has
 * its option removed, as before.
 */
export async function settleTerminals(tmux: Pick<Tmux, 'killSession' | 'unsetWindowOption' | 'windowOption' | 'setWindowOption' | 'resizeWindow'>, live: Set<string>, sessions: readonly { tmuxSession?: string | null }[]): Promise<void> {
  for (const name of live) if (BORN_SHELL.test(name)) await tmux.killSession(name).catch(e => log(`stale shell ${name} not killed: ${(e as Error).message}`));
  const given = new Set<string>();
  for (const name of live) {
    if (BORN_SHELL.test(name)) continue;
    const mark = await tmux.windowOption?.(name, SIZE_MARK).catch(() => null);
    if (mark === null || mark === undefined) continue;
    const own = keptOf(mark);
    try {
      // Dimensions first: `resize-window` sets `manual` itself, and the window's own value then replaces it.
      if (own.cols && own.rows) await tmux.resizeWindow?.(name, own.cols, own.rows);
      if (own.size === NO_SIZE) await tmux.unsetWindowOption?.(name, 'window-size');
      else await tmux.setWindowOption?.(name, 'window-size', own.size);
      await tmux.unsetWindowOption?.(name, SIZE_MARK);
      given.add(name);
      log(`window of ${name} given back its own size (${own.size === NO_SIZE ? 'none' : own.size}${own.cols ? `, ${own.cols}x${own.rows}` : ''})`);
    } catch (e) { log(`window of ${name} not given back: ${(e as Error).message}`); }
  }
  for (const s of sessions) {
    if (!s.tmuxSession || !live.has(s.tmuxSession) || s.tmuxSession.includes('@') || given.has(s.tmuxSession)) continue;
    await tmux.unsetWindowOption?.(s.tmuxSession, 'window-size').catch(() => undefined);
  }
}

export async function startDaemon(opts: { port?: number; tmux?: Tmux; tmuxSocket?: string } = {}): Promise<{ stop(): Promise<void>; port: number }> {
  await ensureLedgeDir();
  const store = new Store();
  const loaded = await store.load();
  const tmux = opts.tmux ?? routedTmux(realTmux(opts.tmuxSocket ?? 'ledge'), realTmux(null));
  let live: Set<string> | null = null;
  try { live = new Set(await tmux.listSessions()); }
  catch (e) { log(`startup prune skipped, tmux unavailable: ${(e as Error).message}`); }
  if (live) for (const s of store.all()) {
    if (s.tmuxSession && !live.has(s.tmuxSession)) store.apply(s.id, { name: 'PaneGone', at: new Date().toISOString(), source: 'daemon' });
  }
  if (live) await settleTerminals(tmux, live, store.all());
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
  const history = new History({ peerOf: t => ledgePeer(t, readPeers(), store.all())?.id ?? store.all().find(s => s.rig?.seat === t && !s.archivedAt)?.id, refOf: id => attachments.ref(id) });
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
  const taskJournal = tasksJournal(paths().tasks);
  // Each harness's account limits: Claude Code's from Anthropic's usage API (read-only token, the login shell's proxy), Codex's from its transcripts.
  const usage = createUsage({ home: homedir(), env: async () => ({ ...process.env, ...(await loginShellEnv()) }), file: join(paths().dir, 'usage.json') });
  // The pull and merge requests of the sessions' branches (lot 8a): gh and glab with the login shell's sign-in and proxy, no token through Ledge.
  // The login shell's environment is read once per 5 minutes: a refresh runs several gh / glab calls.
  let shellEnv: { at: number; env: Promise<Record<string, string>> } | null = null;
  const forgeEnv = async (): Promise<NodeJS.ProcessEnv> => {
    if (!shellEnv || Date.now() - shellEnv.at > 300_000) shellEnv = { at: Date.now(), env: loginShellEnv() };
    return { ...process.env, ...(await shellEnv.env) };
  };
  const forge = createForgeService({ store, env: forgeEnv });
  const server = await startServer({ store, tmux, port: opts.port, daemon, updater, history, mobile, mobileUnavailable, mail, tasks: taskJournal, attachments, usage, forge, operator: true });
  usage.start();
  forge.start();
  ompLive = () => server.omp.liveCount();
  const poller = startPoller({ store, tmux, broadcastPreview: server.preview, labelExited: server.labelExited });
  await writeFile(paths().pid, String(process.pid));
  log(`daemon started on ${server.port} with ${store.all().length} sessions`);
  let stopping: Promise<void> | null = null;
  const stop = () => stopping ??= (async () => {
    process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
    poller.stop(); usage.stop(); forge.stop(); await server.close(); await mobile?.stop(); await store.save(); await history.flush(); await mail.flush(); await taskJournal.flush(); await rm(paths().pid, { force: true }); log('daemon stopped');
  })();
  const onSignal = () => { stop().finally(() => process.exit(0)); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  return { stop, port: server.port };
}

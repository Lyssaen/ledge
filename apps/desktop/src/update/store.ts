import { useSyncExternalStore } from 'react';
import { appVersion, checkForUpdate, relaunchApp, type AvailableUpdate } from './bridge';

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'installing'; version: string; percent: number | null }
  | { kind: 'failed'; during: 'check' | 'install' };
export interface UpdateSnapshot { phase: UpdatePhase; auto: boolean; checkedAt: number | null; app: string | null; latest: string | null }
export interface UpdaterDeps {
  check?: () => Promise<AvailableUpdate | null>; relaunch?: () => Promise<void>; version?: () => Promise<string | null>;
  now?: () => number; every?: (fn: () => void, ms: number) => () => void;
}
export interface Updater {
  get(): UpdateSnapshot; subscribe(fn: () => void): () => void;
  start(): Promise<void>; check(): Promise<void>; install(): Promise<void>; setAuto(on: boolean): void; stop(): void;
}
export const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* in-memory only */ } };
const loadCheckedAt = () => { const v = Number(get('desktop.update.checkedAt')); return Number.isFinite(v) && v > 0 ? v : null; };
const realEvery = (fn: () => void, ms: number) => { const t = setInterval(fn, ms); return () => clearInterval(t); };

/**
 * Desktop's updater (spec §9.4, §11, decision 1 of the lot 7 plan): checks `latest-desktop.json` at start-up and every
 * 6 hours while `desktop.update.auto` is not '0', and installs **only** on `install()`, i.e. the user's click. One check
 * and one download at a time; a check during the install is ignored. Never throws.
 */
export function createUpdater(deps: UpdaterDeps = {}): Updater {
  let snap: UpdateSnapshot = { phase: { kind: 'idle' }, auto: get('desktop.update.auto') !== '0', checkedAt: loadCheckedAt(), app: null, latest: null };
  let held: AvailableUpdate | null = null;
  let checking: Promise<void> | null = null;
  let started = false;
  let stopTimer = () => {};
  const listeners = new Set<() => void>();
  const put = (patch: Partial<UpdateSnapshot>) => { snap = { ...snap, ...patch }; for (const fn of [...listeners]) fn(); };

  const installBusy = () => snap.phase.kind === 'installing' || (snap.phase.kind === 'failed' && snap.phase.during === 'install');

  const check = (): Promise<void> => {
    if (snap.phase.kind === 'installing') return Promise.resolve();
    if (checking) return checking;
    const found = snap.phase.kind === 'available';   // a recheck never hides an update already found
    if (!found) put({ phase: { kind: 'checking' } });
    checking = (async () => {
      try {
        const u = await (deps.check ?? checkForUpdate)();
        const at = (deps.now ?? Date.now)();
        set('desktop.update.checkedAt', String(at));
        if (installBusy()) { put({ checkedAt: at, latest: u?.version ?? null }); return; }   // an install started meanwhile: phase and held stay
        held = u;
        put({ checkedAt: at, latest: u?.version ?? null, phase: u ? { kind: 'available', version: u.version, notes: u.notes } : { kind: 'current' } });
      } catch {
        if (!found && !installBusy()) put({ phase: { kind: 'failed', during: 'check' } });   // offline or unreachable: shown, retried by the next check
      } finally { checking = null; }
    })();
    return checking;
  };

  const install = async (): Promise<void> => {
    const p = snap.phase;
    const ready = p.kind === 'available' || (p.kind === 'failed' && p.during === 'install');
    if (!ready || !held) return;
    const u = held;
    put({ phase: { kind: 'installing', version: u.version, percent: null } });
    try {
      if (snap.app) set('desktop.update.from', snap.app);
      await u.downloadAndInstall((done, total) => put({ phase: { kind: 'installing', version: u.version, percent: total ? Math.min(100, Math.round((done / total) * 100)) : null } }));
      await (deps.relaunch ?? relaunchApp)();
    } catch {
      put({ phase: { kind: 'failed', during: 'install' } });
    }
  };

  return {
    get: () => snap,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async start() {
      if (started) return;
      started = true;
      set('desktop.update.attempted', null);   // lot 3's silent install marker: no longer used
      stopTimer = (deps.every ?? realEvery)(() => { if (snap.auto) void check(); }, UPDATE_EVERY_MS);
      const app = await (deps.version ?? appVersion)().catch(() => null);
      put({ app });
      if (snap.auto) await check();
    },
    check,
    install,
    setAuto(on) {
      set('desktop.update.auto', on ? '1' : '0');
      put({ auto: on });
      if (on) void check();
    },
    stop() { stopTimer(); stopTimer = () => {}; }
  };
}

/** The app's updater, started by `main.tsx`. */
export const updater = createUpdater();
export const useUpdate = (u: Updater = updater): UpdateSnapshot => useSyncExternalStore(u.subscribe, u.get, u.get);
/** The ⚙ button's pip: a newer Desktop waits for the user's click. */
export const updateReady = (s: UpdateSnapshot): boolean => s.phase.kind === 'available';

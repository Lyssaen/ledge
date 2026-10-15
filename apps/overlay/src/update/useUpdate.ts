import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { DaemonClient } from '../daemon/client';
import { daemonStore } from '../daemon/store';
import { appVersion, checkForUpdate, relaunchApp, type AvailableUpdate } from './bridge';
import { cardView, gearPip, initialUpdate, LOCAL, pipTone, reduceUpdate, type CardView, type PipTone, type RemoteDaemon, type UpdateEvent, type UpdateState } from './machine';
import { loadAuto, loadCheckedAt, loadDismissed, saveAuto, saveCheckedAt, saveDismissed, saveUpdatedFrom, takeUpdatedFrom } from './prefs';

declare global { interface Window { __LEDGE_FAKE_UPDATE__?: AvailableUpdate } }

/** Dev-only injection point for the e2e specs and the screenshots: the browser has no updater. */
const fakeCheck = (): Promise<AvailableUpdate | null> => Promise.resolve(window.__LEDGE_FAKE_UPDATE__ ?? null);
const defaultCheck = (): typeof checkForUpdate => (import.meta.env.DEV && window.__LEDGE_FAKE_UPDATE__ ? fakeCheck : checkForUpdate);

export interface UpdateController {
  state: UpdateState; card: CardView; pip: PipTone; gear: boolean; auto: boolean;
  start(): void; later(): void; retry(): void; ackUpdated(): void; checkNow(): void; setAuto(on: boolean): void;
}
export interface UpdateDeps { check?: typeof checkForUpdate; relaunch?: typeof relaunchApp; version?: typeof appVersion; now?: () => number; everyMs?: number; waitMs?: number; stallMs?: number; checkMs?: number }

const SIX_HOURS = 6 * 60 * 60 * 1000;
const WAIT_MS = 45_000;
/** Longer than the daemon's own 3-minute npm timeout: past it, the daemon will not answer any more. */
const STALL_MS = 4 * 60_000;
const CHECK_MS = 60_000;

/** `p`, or a rejection once `ms` passed without it settling. */
export function withinMs<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

export function useUpdate(client: DaemonClient, deps: UpdateDeps = {}): UpdateController {
  const [state, rawDispatch] = useReducer(reduceUpdate, undefined, () => initialUpdate(loadDismissed(), loadCheckedAt()));
  const [auto, setAutoState] = useState(loadAuto);
  const stateRef = useRef(state); stateRef.current = state;
  const depsRef = useRef(deps); depsRef.current = deps;
  const clientRef = useRef(client); clientRef.current = client;
  const mounted = useRef(true);
  const available = useRef<AvailableUpdate | null>(null);
  const downloadingFor = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Async callbacks (check, download, timers) must not touch state after unmount.
  const dispatch = useCallback((e: UpdateEvent) => { if (mounted.current) rawDispatch(e); }, []);

  // The running app's version, and the one it was before an install (read once).
  useEffect(() => {
    void (depsRef.current.version ?? appVersion)().then(version => dispatch({ type: 'app', version, updatedFrom: takeUpdatedFrom() }), () => {});
  }, [dispatch]);

  const checkNow = useCallback(() => {
    const d = depsRef.current;
    void (d.check ?? defaultCheck())().then(u => {
      if (!mounted.current) return;
      available.current = u;
      const at = (d.now ?? Date.now)();
      saveCheckedAt(at);
      dispatch({ type: 'checked', at, latest: u ? { version: u.version, notes: u.notes } : null });
    }, () => { /* offline or unreachable: try again at the next tick */ });
  }, [dispatch]);

  // At startup, then every 6 hours; only when automatic checks are on.
  useEffect(() => {
    if (!auto) return;
    checkNow();
    const t = setInterval(checkNow, deps.everyMs ?? SIX_HOURS);
    return () => clearInterval(t);
  }, [auto, checkNow, deps.everyMs]);

  // The daemon store: snapshots, update progress, disconnects, removed sessions.
  useEffect(() => {
    const fleet = clientRef.current.fleet;
    if (fleet) {
      const primary = fleet.primary;
      const snapshot = fleet.localSnapshot();
      if (snapshot) dispatch({ type: 'snapshot', daemon: snapshot.daemon ?? null, ids: snapshot.sessions.map(s => s.id) });
      const offMessage = primary.onMessage(m => {
        if (m.type === 'snapshot') dispatch({ type: 'snapshot', daemon: m.daemon ?? null, ids: m.sessions.map(s => s.id) });
        if (m.type === 'session.removed') dispatch({ type: 'removed', id: m.id });
        if (m.type === 'update.progress') dispatch({ type: 'progress', step: m.step });
        if (m.type === 'update.failed') dispatch({ type: 'failed', reason: m.reason, detail: m.detail, command: m.command });
      });
      let was = primary.status();
      const offStatus = primary.onStatus(s => { if (was === 'open' && s !== 'open') dispatch({ type: 'disconnected' }); was = s; });
      // The connected remotes: their daemons are updated first, and each one must come back like the local one.
      const offRemote = fleet.onMachineMessage((machine, m) => {
        if (machine === LOCAL) return;
        if (m.type === 'session.removed') dispatch({ type: 'removed', machine, id: m.id });
        if (m.type === 'update.progress') dispatch({ type: 'progress', machine, step: m.step });
        if (m.type === 'update.failed') dispatch({ type: 'failed', machine, reason: m.reason, detail: m.detail, command: m.command });
      });
      let seen = '';
      const remotes = () => {
        const list: RemoteDaemon[] = fleet.machines().filter(m => m.id !== LOCAL && m.ready)
          .map(m => ({ id: m.id, label: m.label, daemon: m.daemon ?? null, sessions: m.sessions.map(x => ({ id: x.id, name: x.name })) }));
        // The fleet changes with every session update: only a change of what the updater reads is dispatched.
        const key = JSON.stringify(list);
        if (key !== seen) { seen = key; dispatch({ type: 'remotes', remotes: list }); }
      };
      remotes();
      const offFleet = fleet.subscribe(remotes);
      return () => { offMessage(); offStatus(); offRemote(); offFleet(); };
    }
    let snapshotSeq = 0; let updateSeq = daemonStore.getState().lastUpdate?.seq ?? 0;
    let status = daemonStore.getState().status;
    const onChange = () => {
      const s = daemonStore.getState();
      if (s.snapshotSeq !== snapshotSeq) { snapshotSeq = s.snapshotSeq; if (snapshotSeq > 0) dispatch({ type: 'snapshot', daemon: s.daemon, ids: s.sessions.map(x => x.id) }); }
      if (s.lastUpdate && s.lastUpdate.seq !== updateSeq) {
        updateSeq = s.lastUpdate.seq;
        const m = s.lastUpdate.msg;
        dispatch(m.type === 'update.progress' ? { type: 'progress', step: m.step } : { type: 'failed', reason: m.reason, detail: m.detail, command: m.command });
      }
      if (status === 'open' && s.status !== 'open') dispatch({ type: 'disconnected' });
      status = s.status;
    };
    onChange();
    const off = daemonStore.subscribe(onChange);
    // A removal is only ever the daemon's own `session.removed`: a reconnect snapshot that clears the store is not one.
    const offMsg = clientRef.current.onMessage(m => { if (m.type === 'session.removed') dispatch({ type: 'removed', id: m.id }); });
    return () => { off(); offMsg(); };
  }, [dispatch]);

  // The restarted daemon gets a limited time to answer, counted from the disconnect (npm alone may take minutes).
  const kind = state.phase.kind;
  const machine = state.phase.kind === 'daemon' || state.phase.kind === 'waiting' ? state.phase.machine : null;
  useEffect(() => {
    if (kind !== 'waiting') return;
    const t = setTimeout(() => dispatch({ type: 'timeout' }), deps.waitMs ?? WAIT_MS);
    return () => clearTimeout(t);
  }, [kind, machine, deps.waitMs, dispatch]);

  // While a daemon holds the request: a watchdog, so a silent daemon never leaves the card running forever.
  useEffect(() => {
    if (kind !== 'daemon') return;
    const t = setTimeout(() => dispatch({ type: 'stalled' }), deps.stallMs ?? STALL_MS);
    return () => clearTimeout(t);
  }, [kind, machine, deps.stallMs, dispatch]);

  // Each daemon's turn sends its request, once per entry: a second one would only be refused as busy.
  const sendTo = state.phase.kind === 'daemon' && state.phase.step === 'sent' ? state.phase.machine : null;
  const sentTo = useRef<string | null>(null);
  useEffect(() => {
    if (!sendTo) { sentTo.current = null; return; }
    const target = stateRef.current.target;
    if (sentTo.current === sendTo || !target) return;
    sentTo.current = sendTo;
    const msg = { type: 'update.daemon', version: target } as const;
    const fleet = clientRef.current.fleet;
    if (sendTo === LOCAL) clientRef.current.send(msg);
    // Gone since the plan was made: nothing was sent, so nothing will answer.
    else if (!fleet?.sendTo(sendTo, msg)) dispatch({ type: 'stalled' });
  }, [sendTo, dispatch]);

  // Entering the download phase installs the app, once per entry.
  useEffect(() => {
    if (kind !== 'downloading') { downloadingFor.current = false; return; }
    if (downloadingFor.current) return;
    downloadingFor.current = true;
    const app = stateRef.current.app;
    const target = stateRef.current.target;
    void (async () => {
      try {
        // No update held (checks off or failed): look once more, and only install exactly the target.
        const u = available.current ?? await withinMs((depsRef.current.check ?? defaultCheck())(), depsRef.current.checkMs ?? CHECK_MS);
        if (!mounted.current) return;
        if (!u || u.version !== target) { dispatch({ type: 'download-failed' }); return; }
        available.current = u;
        if (app) saveUpdatedFrom(app);
        await u.downloadAndInstall((done, total) => dispatch({ type: 'download', done, total }));
        dispatch({ type: 'downloaded' });
        await (depsRef.current.relaunch ?? relaunchApp)();
      } catch { dispatch({ type: 'download-failed' }); }
    })();
  }, [kind, dispatch]);

  const start = useCallback(() => {
    // A click while the socket is closed would be dropped by the client and leave the phase stuck.
    const fleet = clientRef.current.fleet;
    if ((fleet?.primary ?? clientRef.current).status() !== 'open') return;
    const sessions = (fleet ? fleet.localSnapshot()?.sessions ?? [] : daemonStore.getState().sessions).map(x => ({ id: x.id, name: x.name }));
    rawDispatch({ type: 'start', sessions });
  }, []);
  const later = useCallback(() => {
    const next = reduceUpdate(stateRef.current, { type: 'dismiss' });
    rawDispatch({ type: 'dismiss' });
    if (next.dismissed) saveDismissed(next.dismissed);
  }, []);
  const retry = useCallback(() => dispatch({ type: 'retry' }), [dispatch]);
  const ackUpdated = useCallback(() => dispatch({ type: 'ack-updated' }), [dispatch]);
  const setAuto = useCallback((on: boolean) => { saveAuto(on); setAutoState(on); }, []);

  return { state, card: cardView(state), pip: pipTone(state), gear: gearPip(state), auto, start, later, retry, ackUpdated, checkNow, setAuto };
}

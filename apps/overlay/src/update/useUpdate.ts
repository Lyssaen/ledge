import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { DaemonClient } from '../daemon/client';
import { daemonStore } from '../daemon/store';
import { appVersion, checkForUpdate, relaunchApp, type AvailableUpdate } from './bridge';
import { cardView, gearPip, initialUpdate, pipTone, reduceUpdate, type CardView, type PipTone, type UpdateEvent, type UpdateState } from './machine';
import { loadAuto, loadCheckedAt, loadDismissed, saveAuto, saveCheckedAt, saveDismissed, saveUpdatedFrom, takeUpdatedFrom } from './prefs';

export interface UpdateController {
  state: UpdateState; card: CardView; pip: PipTone; gear: boolean; auto: boolean;
  start(): void; later(): void; retry(): void; ackUpdated(): void; checkNow(): void; setAuto(on: boolean): void;
}
export interface UpdateDeps { check?: typeof checkForUpdate; relaunch?: typeof relaunchApp; version?: typeof appVersion; now?: () => number; everyMs?: number; waitMs?: number }

const SIX_HOURS = 6 * 60 * 60 * 1000;
const WAIT_MS = 45_000;

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
    void (d.check ?? checkForUpdate)().then(u => {
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
  useEffect(() => {
    if (kind !== 'waiting') return;
    const t = setTimeout(() => dispatch({ type: 'timeout' }), deps.waitMs ?? WAIT_MS);
    return () => clearTimeout(t);
  }, [kind, deps.waitMs, dispatch]);

  // Entering the download phase installs the app, once per entry.
  useEffect(() => {
    if (kind !== 'downloading') { downloadingFor.current = false; return; }
    if (downloadingFor.current) return;
    downloadingFor.current = true;
    const u = available.current;
    if (!u) return;
    const app = stateRef.current.app;
    if (app) saveUpdatedFrom(app);
    void (async () => {
      try {
        await u.downloadAndInstall((done, total) => dispatch({ type: 'download', done, total }));
        dispatch({ type: 'downloaded' });
        await (depsRef.current.relaunch ?? relaunchApp)();
      } catch { dispatch({ type: 'download-failed' }); }
    })();
  }, [kind, dispatch]);

  const start = useCallback(() => {
    const sessions = daemonStore.getState().sessions.map(x => ({ id: x.id, name: x.name }));
    const event: UpdateEvent = { type: 'start', sessions };
    const next = reduceUpdate(stateRef.current, event);
    rawDispatch(event);
    if (next.phase.kind === 'daemon' && next.target) clientRef.current.send({ type: 'update.daemon', version: next.target });
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

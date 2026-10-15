import type { DaemonInfo, UpdateFailure } from '@ledge/protocol';
import { compareVersions } from './semver';

export type Failure = UpdateFailure | 'daemon-timeout' | 'sessions-lost' | 'download';
export const LOCAL = 'local';
/** A connected remote machine, as its daemon last described it. */
export interface RemoteDaemon { id: string; label: string; daemon: DaemonInfo | null; sessions: Array<{ id: string; name: string }> }
type Before = Record<string, { ids: string[]; names: Record<string, string> }>;
export type Phase =
  | { kind: 'idle' }
  | { kind: 'daemon'; machine: string; step: 'sent' | 'installing' | 'restarting' }
  | { kind: 'waiting'; machine: string }
  | { kind: 'downloading'; done: number; total: number | null }
  | { kind: 'installing' }
  | { kind: 'failed'; reason: Failure; detail?: string; command?: string; missing?: string[]; machine?: string };
export interface UpdateState {
  app: string | null; daemon: DaemonInfo | null; latest: { version: string; notes: string } | null;
  /** The connected remote machines; `plan`, the ones this update goes through first, in order. */
  remotes: RemoteDaemon[]; plan: Array<{ id: string; label: string }>;
  phase: Phase; target: string | null; before: Before | null;
  dismissed: string | null; justUpdated: string | null; checkedAt: number | null;
}
export type UpdateEvent =
  | { type: 'app'; version: string | null; updatedFrom: string | null }
  | { type: 'checked'; at: number; latest: { version: string; notes: string } | null }
  | { type: 'snapshot'; daemon: DaemonInfo | null; ids: string[] }
  | { type: 'remotes'; remotes: RemoteDaemon[] }
  | { type: 'removed'; id: string; machine?: string }
  | { type: 'start'; sessions: Array<{ id: string; name: string }> }
  | { type: 'progress'; step: 'installing' | 'restarting'; machine?: string }
  | { type: 'failed'; reason: UpdateFailure; detail?: string; command?: string; machine?: string }
  | { type: 'disconnected'; machine?: string } | { type: 'timeout' } | { type: 'stalled' }
  | { type: 'download'; done: number; total: number | null } | { type: 'downloaded' } | { type: 'download-failed' }
  | { type: 'dismiss' } | { type: 'ack-updated' } | { type: 'retry' };
export type CardView =
  | { kind: 'hidden' }
  | { kind: 'available'; version: string; current: string; notes: string[]; servers?: Array<{ label: string; version: string }> }
  | { kind: 'manual'; version: string; command: string | null; canInstallApp: boolean }
  | { kind: 'running'; steps: Array<{ key: 'remote' | 'daemon' | 'restart' | 'download' | 'install'; status: 'done' | 'run' | 'todo'; label?: string; meta?: string; progress?: number }> }
  | { kind: 'failed'; reason: Failure; detail?: string; command?: string; missing?: string[]; machine?: string }
  | { kind: 'updated'; version: string };
export type PipTone = 'new' | 'busy' | 'bad' | 'ok' | null;

export const initialUpdate = (dismissed: string | null, checkedAt: number | null): UpdateState =>
  ({ app: null, daemon: null, latest: null, remotes: [], plan: [], phase: { kind: 'idle' }, target: null, before: null, dismissed, justUpdated: null, checkedAt });

const behind = (v: string | null | undefined, t: string) => !!v && compareVersions(v, t) < 0;
/** The remotes the button updates: installed from npm and behind. A clone, or a daemon too old to describe itself, is left to its owner. */
export const remotesBehind = (s: Pick<UpdateState, 'remotes'>, t: string) => s.remotes.filter(r => r.daemon?.install === 'npm' && behind(r.daemon.version, t));

/** The version both halves should run: the latest release, when one half is behind it. Never a version no release provides. */
export function targetOf(s: UpdateState): string | null {
  // An unknown daemon (absent from the snapshot, so older than the auto-update) gets no update at all: spec §5.
  if (!s.daemon || !s.latest) return null;
  const t = s.latest.version;
  return behind(s.app, t) || behind(s.daemon.version, t) || remotesBehind(s, t).length > 0 ? t : null;
}
export const needsDaemon = (s: UpdateState, t = s.target ?? targetOf(s)) => !!t && !!s.daemon && compareVersions(s.daemon.version, t) < 0;
export const needsApp = (s: UpdateState, t = s.target ?? targetOf(s)) => !!t && !!s.app && compareVersions(s.app, t) < 0;
const running = (p: Phase) => p.kind === 'daemon' || p.kind === 'waiting' || p.kind === 'downloading' || p.kind === 'installing';

const label = (s: UpdateState, machine: string) => machine === LOCAL ? undefined : s.plan.find(r => r.id === machine)?.label ?? machine;
const updating = (p: Phase, machine: string) => (p.kind === 'daemon' || p.kind === 'waiting') && p.machine === machine;

/** The next step from `plan[from]` on: the remotes, then this machine's daemon, then the app. */
function advance(s: UpdateState, from: number): UpdateState {
  const remote = s.plan[from];
  if (remote) return { ...s, phase: { kind: 'daemon', machine: remote.id, step: 'sent' } };
  if (needsDaemon(s) && s.daemon?.install === 'npm') return { ...s, phase: { kind: 'daemon', machine: LOCAL, step: 'sent' } };
  return needsApp(s) ? { ...s, phase: { kind: 'downloading', done: 0, total: null } } : { ...s, phase: { kind: 'idle' }, target: null, before: null, plan: [] };
}

/** After a daemon came back: every session it had must be there, or nothing further is updated. */
function afterDaemon(s: UpdateState, machine: string, ids: string[]): UpdateState {
  const before = s.before?.[machine];
  const missing = (before?.ids ?? []).filter(id => !ids.includes(id)).map(id => before?.names[id] ?? id);
  const where = label(s, machine);
  if (missing.length) return { ...s, phase: { kind: 'failed', reason: 'sessions-lost', missing, ...(where ? { machine: where } : {}) } };
  return advance(s, machine === LOCAL ? s.plan.length : s.plan.findIndex(r => r.id === machine) + 1);
}
const sessionsOf = (list: Array<{ id: string; name: string }>) => ({ ids: list.map(x => x.id), names: Object.fromEntries(list.map(x => [x.id, x.name])) });

export function reduceUpdate(s: UpdateState, e: UpdateEvent): UpdateState {
  switch (e.type) {
    case 'app': return { ...s, app: e.version, justUpdated: e.updatedFrom && e.version && e.updatedFrom !== e.version ? e.version : null };
    case 'checked': return { ...s, latest: e.latest, checkedAt: e.at };
    // A session closed before the restart is not lost; one closed during or after it is still missing.
    case 'removed': {
      const machine = e.machine ?? LOCAL; const b = s.before?.[machine];
      return b && s.phase.kind === 'daemon' && s.phase.machine === machine && s.phase.step !== 'restarting' ? { ...s, before: { ...s.before, [machine]: { ...b, ids: b.ids.filter(id => id !== e.id) } } } : s;
    }
    case 'snapshot': {
      const next = { ...s, daemon: e.daemon };
      if (updating(s.phase, LOCAL) && s.target && e.daemon && compareVersions(e.daemon.version, s.target) >= 0) return afterDaemon(next, LOCAL, e.ids);
      return next;
    }
    case 'remotes': {
      const next = { ...s, remotes: e.remotes };
      const p = s.phase;
      if ((p.kind !== 'daemon' && p.kind !== 'waiting') || p.machine === LOCAL || !s.target) return next;
      const r = e.remotes.find(x => x.id === p.machine);
      // Gone from the connected machines: it is restarting (the SSH bridge closes with its daemon).
      if (!r) return p.kind === 'daemon' ? { ...next, phase: { kind: 'waiting', machine: p.machine } } : next;
      return r.daemon && compareVersions(r.daemon.version, s.target) >= 0 ? afterDaemon(next, p.machine, r.sessions.map(x => x.id)) : next;
    }
    case 'start': {
      const target = targetOf(s);
      if (!target || running(s.phase)) return s;
      if (needsDaemon(s, target) && s.daemon?.install !== 'npm') return s;
      const plan = remotesBehind(s, target).map(r => ({ id: r.id, label: r.label }));
      const before: Before = { [LOCAL]: sessionsOf(e.sessions), ...Object.fromEntries(s.remotes.map(r => [r.id, sessionsOf(r.sessions)])) };
      const next = advance({ ...s, target, before, plan }, 0);
      return next.phase.kind === 'idle' ? s : next;
    }
    case 'progress': return s.phase.kind === 'daemon' && s.phase.machine === (e.machine ?? LOCAL) ? { ...s, phase: { kind: 'daemon', machine: s.phase.machine, step: e.step } } : s;
    case 'failed': {
      if (s.phase.kind !== 'daemon' || s.phase.machine !== (e.machine ?? LOCAL)) return s;
      const where = label(s, s.phase.machine);
      return { ...s, phase: { kind: 'failed', reason: e.reason, detail: e.detail, command: e.command, ...(where ? { machine: where } : {}) } };
    }
    case 'disconnected': return s.phase.kind === 'daemon' && s.phase.machine === (e.machine ?? LOCAL) ? { ...s, phase: { kind: 'waiting', machine: s.phase.machine } } : s;
    case 'timeout': return s.phase.kind === 'waiting' ? timedOut(s, s.phase.machine) : s;
    // The daemon took the request but neither failed, nor restarted, nor dropped the socket.
    case 'stalled': return s.phase.kind === 'daemon' ? timedOut(s, s.phase.machine) : s;
    case 'download': return s.phase.kind === 'downloading' ? { ...s, phase: { kind: 'downloading', done: e.done, total: e.total } } : s;
    case 'downloaded': return s.phase.kind === 'downloading' ? { ...s, phase: { kind: 'installing' } } : s;
    case 'download-failed': return s.phase.kind === 'downloading' || s.phase.kind === 'installing' ? { ...s, phase: { kind: 'failed', reason: 'download' } } : s;
    case 'dismiss': { const t = targetOf(s); return t ? { ...s, dismissed: t } : s; }
    case 'ack-updated': return { ...s, justUpdated: null };
    case 'retry': return s.phase.kind === 'failed' ? { ...s, phase: { kind: 'idle' }, target: null, before: null, plan: [] } : s;
  }
}
function timedOut(s: UpdateState, machine: string): UpdateState {
  const where = label(s, machine);
  return { ...s, phase: { kind: 'failed', reason: 'daemon-timeout', ...(where ? { machine: where } : {}) } };
}

const noteLines = (notes: string) => notes.split('\n').map(l => l.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean).slice(0, 3);
const isDismissed = (s: UpdateState, t: string) => !!s.dismissed && compareVersions(s.dismissed, t) >= 0;

export function cardView(s: UpdateState): CardView {
  const p = s.phase;
  if (p.kind === 'failed') return { kind: 'failed', reason: p.reason, ...(p.detail ? { detail: p.detail } : {}), ...(p.command ? { command: p.command } : {}), ...(p.missing ? { missing: p.missing } : {}), ...(p.machine ? { machine: p.machine } : {}) };
  if (running(p)) {
    const at = p.kind === 'daemon' || p.kind === 'waiting' ? s.plan.findIndex(r => r.id === p.machine) : -1;
    const onLocal = at < 0;
    const daemonDone = onLocal && p.kind !== 'daemon';
    const restarting = onLocal && p.kind === 'daemon' && p.step === 'restarting';
    const restarted = p.kind === 'downloading' || p.kind === 'installing';
    const n = s.before?.[LOCAL]?.ids.length ?? 0;
    const meta = s.target ? { meta: s.target } : {};
    return { kind: 'running', steps: [
      ...s.plan.map((r, i) => ({ key: 'remote' as const, label: r.label, status: onLocal || i < at ? 'done' as const : i === at ? 'run' as const : 'todo' as const, ...meta })),
      { key: 'daemon', status: !onLocal ? 'todo' : daemonDone || restarting ? 'done' : 'run', ...meta },
      { key: 'restart', status: restarted ? 'done' : daemonDone || restarting ? 'run' : 'todo', ...(restarted ? { meta: `${n}/${n}` } : {}) },
      { key: 'download', status: p.kind === 'installing' ? 'done' : p.kind === 'downloading' ? 'run' : 'todo', ...(p.kind === 'downloading' && p.total ? { progress: p.done / p.total } : {}) },
      { key: 'install', status: p.kind === 'installing' ? 'run' : 'todo' }
    ] };
  }
  if (s.justUpdated) return { kind: 'updated', version: s.justUpdated };
  const t = targetOf(s);
  if (!t || isDismissed(s, t)) return { kind: 'hidden' };
  if (needsDaemon(s, t) && s.daemon?.install !== 'npm') return { kind: 'manual', version: t, command: s.daemon?.manual ?? null, canInstallApp: false };
  if (!needsDaemon(s, t) && s.daemon && s.daemon.install !== 'npm' && needsApp(s, t)) return { kind: 'manual', version: t, command: s.daemon.manual ?? null, canInstallApp: true };
  const servers = remotesBehind(s, t).map(r => ({ label: r.label, version: r.daemon!.version }));
  return { kind: 'available', version: t, current: s.app ?? s.daemon?.version ?? '', notes: noteLines(s.latest?.notes ?? ''), ...(servers.length ? { servers } : {}) };
}

export function pipTone(s: UpdateState): PipTone {
  const v = cardView(s);
  return v.kind === 'running' ? 'busy' : v.kind === 'failed' ? 'bad' : v.kind === 'updated' ? 'ok' : v.kind === 'hidden' ? null : 'new';
}
/** Gear pip: stays after « Plus tard », so the pending update is still findable. */
export const gearPip = (s: UpdateState): boolean => !!targetOf(s);

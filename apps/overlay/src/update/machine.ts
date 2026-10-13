import type { DaemonInfo, UpdateFailure } from '@ledge/protocol';
import { compareVersions } from './semver';

export type Failure = UpdateFailure | 'daemon-timeout' | 'sessions-lost' | 'download';
export type Phase =
  | { kind: 'idle' }
  | { kind: 'daemon'; step: 'sent' | 'installing' | 'restarting' }
  | { kind: 'waiting' }
  | { kind: 'downloading'; done: number; total: number | null }
  | { kind: 'installing' }
  | { kind: 'failed'; reason: Failure; detail?: string; command?: string; missing?: string[] };
export interface UpdateState {
  app: string | null; daemon: DaemonInfo | null; latest: { version: string; notes: string } | null;
  phase: Phase; target: string | null; before: { ids: string[]; names: Record<string, string> } | null;
  dismissed: string | null; justUpdated: string | null; checkedAt: number | null;
}
export type UpdateEvent =
  | { type: 'app'; version: string | null; updatedFrom: string | null }
  | { type: 'checked'; at: number; latest: { version: string; notes: string } | null }
  | { type: 'snapshot'; daemon: DaemonInfo | null; ids: string[] }
  | { type: 'removed'; id: string }
  | { type: 'start'; sessions: Array<{ id: string; name: string }> }
  | { type: 'progress'; step: 'installing' | 'restarting' }
  | { type: 'failed'; reason: UpdateFailure; detail?: string; command?: string }
  | { type: 'disconnected' } | { type: 'timeout' } | { type: 'stalled' }
  | { type: 'download'; done: number; total: number | null } | { type: 'downloaded' } | { type: 'download-failed' }
  | { type: 'dismiss' } | { type: 'ack-updated' } | { type: 'retry' };
export type CardView =
  | { kind: 'hidden' }
  | { kind: 'available'; version: string; current: string; notes: string[] }
  | { kind: 'manual'; version: string; command: string | null; canInstallApp: boolean }
  | { kind: 'running'; steps: Array<{ key: 'daemon' | 'restart' | 'download' | 'install'; status: 'done' | 'run' | 'todo'; meta?: string; progress?: number }> }
  | { kind: 'failed'; reason: Failure; detail?: string; command?: string; missing?: string[] }
  | { kind: 'updated'; version: string };
export type PipTone = 'new' | 'busy' | 'bad' | 'ok' | null;

export const initialUpdate = (dismissed: string | null, checkedAt: number | null): UpdateState =>
  ({ app: null, daemon: null, latest: null, phase: { kind: 'idle' }, target: null, before: null, dismissed, justUpdated: null, checkedAt });

/** The version both halves should run: the latest release, when one half is behind it. Never a version no release provides. */
export function targetOf(s: UpdateState): string | null {
  // An unknown daemon (absent from the snapshot, so older than the auto-update) gets no update at all: spec §5.
  if (!s.daemon || !s.latest) return null;
  const t = s.latest.version;
  const behind = (v: string | null | undefined) => !!v && compareVersions(v, t) < 0;
  return behind(s.app) || behind(s.daemon.version) ? t : null;
}
export const needsDaemon = (s: UpdateState, t = s.target ?? targetOf(s)) => !!t && !!s.daemon && compareVersions(s.daemon.version, t) < 0;
export const needsApp = (s: UpdateState, t = s.target ?? targetOf(s)) => !!t && !!s.app && compareVersions(s.app, t) < 0;
const running = (p: Phase) => p.kind === 'daemon' || p.kind === 'waiting' || p.kind === 'downloading' || p.kind === 'installing';

/** After the daemon came back: every session it had must be there, or the app is left alone. */
function afterDaemon(s: UpdateState, ids: string[]): UpdateState {
  const missing = (s.before?.ids ?? []).filter(id => !ids.includes(id)).map(id => s.before?.names[id] ?? id);
  if (missing.length) return { ...s, phase: { kind: 'failed', reason: 'sessions-lost', missing } };
  return needsApp(s) ? { ...s, phase: { kind: 'downloading', done: 0, total: null } } : { ...s, phase: { kind: 'idle' }, target: null, before: null };
}

export function reduceUpdate(s: UpdateState, e: UpdateEvent): UpdateState {
  switch (e.type) {
    case 'app': return { ...s, app: e.version, justUpdated: e.updatedFrom && e.version && e.updatedFrom !== e.version ? e.version : null };
    case 'checked': return { ...s, latest: e.latest, checkedAt: e.at };
    // A session closed before the restart is not lost; one closed during or after it is still missing.
    case 'removed': return s.before && s.phase.kind === 'daemon' && s.phase.step !== 'restarting' ? { ...s, before: { ...s.before, ids: s.before.ids.filter(id => id !== e.id) } } : s;
    case 'snapshot': {
      const next = { ...s, daemon: e.daemon };
      if ((s.phase.kind === 'waiting' || s.phase.kind === 'daemon') && s.target && e.daemon && compareVersions(e.daemon.version, s.target) >= 0) return afterDaemon(next, e.ids);
      return next;
    }
    case 'start': {
      const target = targetOf(s);
      if (!target || running(s.phase)) return s;
      const before = { ids: e.sessions.map(x => x.id), names: Object.fromEntries(e.sessions.map(x => [x.id, x.name])) };
      const t = { ...s, target, before };
      if (needsDaemon(t, target)) return s.daemon?.install === 'npm' ? { ...t, phase: { kind: 'daemon', step: 'sent' } } : s;
      return needsApp(t, target) ? { ...t, phase: { kind: 'downloading', done: 0, total: null } } : s;
    }
    case 'progress': return s.phase.kind === 'daemon' ? { ...s, phase: { kind: 'daemon', step: e.step } } : s;
    case 'failed': return s.phase.kind === 'daemon' ? { ...s, phase: { kind: 'failed', reason: e.reason, detail: e.detail, command: e.command } } : s;
    case 'disconnected': return s.phase.kind === 'daemon' ? { ...s, phase: { kind: 'waiting' } } : s;
    case 'timeout': return s.phase.kind === 'waiting' ? { ...s, phase: { kind: 'failed', reason: 'daemon-timeout' } } : s;
    // The daemon took the request but neither failed, nor restarted, nor dropped the socket.
    case 'stalled': return s.phase.kind === 'daemon' ? { ...s, phase: { kind: 'failed', reason: 'daemon-timeout' } } : s;
    case 'download': return s.phase.kind === 'downloading' ? { ...s, phase: { kind: 'downloading', done: e.done, total: e.total } } : s;
    case 'downloaded': return s.phase.kind === 'downloading' ? { ...s, phase: { kind: 'installing' } } : s;
    case 'download-failed': return s.phase.kind === 'downloading' || s.phase.kind === 'installing' ? { ...s, phase: { kind: 'failed', reason: 'download' } } : s;
    case 'dismiss': { const t = targetOf(s); return t ? { ...s, dismissed: t } : s; }
    case 'ack-updated': return { ...s, justUpdated: null };
    case 'retry': return s.phase.kind === 'failed' ? { ...s, phase: { kind: 'idle' }, target: null, before: null } : s;
  }
}

const noteLines = (notes: string) => notes.split('\n').map(l => l.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean).slice(0, 3);
const isDismissed = (s: UpdateState, t: string) => !!s.dismissed && compareVersions(s.dismissed, t) >= 0;

export function cardView(s: UpdateState): CardView {
  const p = s.phase;
  if (p.kind === 'failed') return { kind: 'failed', reason: p.reason, ...(p.detail ? { detail: p.detail } : {}), ...(p.command ? { command: p.command } : {}), ...(p.missing ? { missing: p.missing } : {}) };
  if (running(p)) {
    const daemonDone = p.kind !== 'daemon';
    const restarted = p.kind === 'downloading' || p.kind === 'installing';
    const n = s.before?.ids.length ?? 0;
    return { kind: 'running', steps: [
      { key: 'daemon', status: daemonDone || (p.kind === 'daemon' && p.step === 'restarting') ? 'done' : 'run', ...(s.target ? { meta: s.target } : {}) },
      { key: 'restart', status: restarted ? 'done' : daemonDone || (p.kind === 'daemon' && p.step === 'restarting') ? 'run' : 'todo', ...(restarted ? { meta: `${n}/${n}` } : {}) },
      { key: 'download', status: p.kind === 'installing' ? 'done' : p.kind === 'downloading' ? 'run' : 'todo', ...(p.kind === 'downloading' && p.total ? { progress: p.done / p.total } : {}) },
      { key: 'install', status: p.kind === 'installing' ? 'run' : 'todo' }
    ] };
  }
  if (s.justUpdated) return { kind: 'updated', version: s.justUpdated };
  const t = targetOf(s);
  if (!t || isDismissed(s, t)) return { kind: 'hidden' };
  if (needsDaemon(s, t) && s.daemon?.install !== 'npm') return { kind: 'manual', version: t, command: s.daemon?.manual ?? null, canInstallApp: false };
  if (!needsDaemon(s, t) && s.daemon && s.daemon.install !== 'npm' && needsApp(s, t)) return { kind: 'manual', version: t, command: s.daemon.manual ?? null, canInstallApp: true };
  return { kind: 'available', version: t, current: s.app ?? s.daemon?.version ?? '', notes: noteLines(s.latest?.notes ?? '') };
}

export function pipTone(s: UpdateState): PipTone {
  const v = cardView(s);
  return v.kind === 'running' ? 'busy' : v.kind === 'failed' ? 'bad' : v.kind === 'updated' ? 'ok' : v.kind === 'hidden' ? null : 'new';
}
/** Gear pip: stays after « Plus tard », so the pending update is still findable. */
export const gearPip = (s: UpdateState): boolean => !!targetOf(s);

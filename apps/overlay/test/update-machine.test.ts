import { describe, it, expect } from 'vitest';
import { initialUpdate, reduceUpdate, cardView, pipTone, gearPip, targetOf, type UpdateEvent, type UpdateState } from '../src/update/machine';

const NPM = { version: '0.2.2', install: 'npm' as const, systemd: true };
const run = (events: UpdateEvent[], s: UpdateState = initialUpdate(null, null)) => events.reduce(reduceUpdate, s);
const base: UpdateEvent[] = [
  { type: 'app', version: '0.2.2', updatedFrom: null },
  { type: 'snapshot', daemon: NPM, ids: ['a', 'b'] },
  { type: 'checked', at: 1, latest: { version: '0.3.0', notes: '- Une\n- Deux\n- Trois\n- Quatre' } }
];
const START: UpdateEvent = { type: 'start', sessions: [{ id: 'a', name: 'Otto' }, { id: 'b', name: 'Nova' }] };

describe('update machine', () => {
  it('offers a newer release with its first three notes', () => {
    const s = run(base);
    expect(targetOf(s)).toBe('0.3.0');
    expect(cardView(s)).toEqual({ kind: 'available', version: '0.3.0', current: '0.2.2', notes: ['Une', 'Deux', 'Trois'] });
    expect(pipTone(s)).toBe('new'); expect(gearPip(s)).toBe(true);
  });
  it('shows nothing when everything is current', () => {
    const s = run([base[0]!, { type: 'snapshot', daemon: { ...NPM }, ids: [] }, { type: 'checked', at: 1, latest: null }]);
    expect(cardView(s)).toEqual({ kind: 'hidden' }); expect(pipTone(s)).toBeNull(); expect(gearPip(s)).toBe(false);
  });
  it('"later" hides the card and the island pip until a newer version, the gear pip stays', () => {
    const s = run([...base, { type: 'dismiss' }]);
    expect(cardView(s)).toEqual({ kind: 'hidden' }); expect(pipTone(s)).toBeNull(); expect(gearPip(s)).toBe(true);
    expect(cardView(run([{ type: 'checked', at: 2, latest: { version: '0.3.1', notes: '' } }], s)).kind).toBe('available');
  });
  it('walks daemon, reconnect, download, install when all sessions come back', () => {
    let s = run([...base, START]);
    expect(s.phase).toEqual({ kind: 'daemon', step: 'sent' });
    s = run([{ type: 'progress', step: 'installing' }, { type: 'progress', step: 'restarting' }, { type: 'disconnected' }], s);
    expect(s.phase.kind).toBe('waiting');
    s = run([{ type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: ['a', 'b'] }], s);
    expect(s.phase).toEqual({ kind: 'downloading', done: 0, total: null });
    s = run([{ type: 'download', done: 5, total: 10 }], s);
    expect(cardView(s)).toMatchObject({ kind: 'running', steps: [{ key: 'daemon', status: 'done' }, { key: 'restart', status: 'done', meta: '2/2' }, { key: 'download', status: 'run', progress: 0.5 }, { key: 'install', status: 'todo' }] });
    expect(pipTone(s)).toBe('busy');
    s = run([{ type: 'downloaded' }], s);
    expect(s.phase.kind).toBe('installing');
  });
  it('fails with sessions-lost and does not touch the app when a session is missing', () => {
    const s = run([...base, START, { type: 'disconnected' }, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: ['a'] }]);
    expect(s.phase).toEqual({ kind: 'failed', reason: 'sessions-lost', missing: ['Nova'] });
    expect(pipTone(s)).toBe('bad');
  });
  it('a session removed before the restart is not lost', () => {
    const s = run([...base, START, { type: 'removed', id: 'b' }, { type: 'disconnected' }, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: ['a'] }]);
    expect(s.phase.kind).toBe('downloading');
  });
  it('keeps waiting while the old daemon answers, then times out', () => {
    let s = run([...base, START, { type: 'disconnected' }, { type: 'snapshot', daemon: NPM, ids: ['a', 'b'] }]);
    expect(s.phase.kind).toBe('waiting');
    s = run([{ type: 'timeout' }], s);
    expect(s.phase).toMatchObject({ kind: 'failed', reason: 'daemon-timeout' });
  });
  it('turns a daemon refusal into a failure with its command', () => {
    const s = run([...base, START, { type: 'failed', reason: 'npm-failed', detail: 'EACCES', command: 'npm i -g @paradow/ledge@0.3.0' }]);
    expect(cardView(s)).toEqual({ kind: 'failed', reason: 'npm-failed', detail: 'EACCES', command: 'npm i -g @paradow/ledge@0.3.0' });
  });
  it('retry goes back to available', () => {
    const s = run([...base, START, { type: 'failed', reason: 'sessions-at-risk' }, { type: 'retry' }]);
    expect(cardView(s).kind).toBe('available');
  });
  it('skips the daemon step when it already runs the target', () => {
    const s = run([base[0]!, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: ['a'] }, base[2]!, START]);
    expect(s.phase.kind).toBe('downloading');
  });
  it('offers the app alone when the daemon is ahead', () => {
    const s = run([base[0]!, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: [] }, { type: 'checked', at: 1, latest: null }]);
    expect(targetOf(s)).toBe('0.3.0'); expect(cardView(s).kind).toBe('available');
  });
  it('a clone shows the manual command; the app button wakes up once the daemon has the target', () => {
    const git = { version: '0.2.2', install: 'git' as const, systemd: true, manual: 'cd /c && git pull' };
    let s = run([base[0]!, { type: 'snapshot', daemon: git, ids: [] }, base[2]!]);
    expect(cardView(s)).toEqual({ kind: 'manual', version: '0.3.0', command: 'cd /c && git pull', canInstallApp: false });
    s = run([{ type: 'snapshot', daemon: { ...git, version: '0.3.0' }, ids: [] }], s);
    expect(cardView(s)).toEqual({ kind: 'manual', version: '0.3.0', command: 'cd /c && git pull', canInstallApp: true });
  });
  it('says the app was updated after the relaunch, until acknowledged', () => {
    let s = run([{ type: 'app', version: '0.3.0', updatedFrom: '0.2.2' }, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: [] }]);
    expect(cardView(s)).toEqual({ kind: 'updated', version: '0.3.0' }); expect(pipTone(s)).toBe('ok');
    s = run([{ type: 'ack-updated' }], s);
    expect(cardView(s)).toEqual({ kind: 'hidden' });
  });
  it('ignores a start while not available, and progress outside an update', () => {
    const idle = run([base[0]!, { type: 'snapshot', daemon: NPM, ids: [] }, { type: 'checked', at: 1, latest: null }]);
    expect(run([START, { type: 'progress', step: 'installing' }], idle).phase).toEqual({ kind: 'idle' });
  });
  it('an unknown daemon (absent from the snapshot) shows nothing and refuses a start: the app is never updated alone', () => {
    const s = run([base[0]!, { type: 'snapshot', daemon: null, ids: ['a'] }, { type: 'checked', at: 1, latest: { version: '0.3.0', notes: '' } }]);
    expect(cardView(s)).toEqual({ kind: 'hidden' }); expect(gearPip(s)).toBe(false);
    const started = run([START], s);
    expect(started.phase).toEqual({ kind: 'idle' }); expect(started.target).toBeNull();
    expect(cardView(started)).toEqual({ kind: 'hidden' });
  });
  it('a session removed once the daemon restarts is not forgiven: its absence is still sessions-lost', () => {
    let s = run([...base, START, { type: 'progress', step: 'restarting' }, { type: 'disconnected' }]);
    expect(s.phase.kind).toBe('waiting');
    s = run([{ type: 'removed', id: 'b' }, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: ['a'] }], s);
    expect(s.phase).toEqual({ kind: 'failed', reason: 'sessions-lost', missing: ['Nova'] });
  });
  it('a timeout while the daemon has not yet restarted is ignored; it counts only once waiting', () => {
    let s = run([...base, START, { type: 'timeout' }]);
    expect(s.phase).toEqual({ kind: 'daemon', step: 'sent' });
    s = run([{ type: 'disconnected' }, { type: 'timeout' }], s);
    expect(s.phase).toMatchObject({ kind: 'failed', reason: 'daemon-timeout' });
  });
  it('a dismissal with no target does not erase an earlier one', () => {
    const dismissed = run([...base, { type: 'dismiss' }]);
    expect(dismissed.dismissed).toBe('0.3.0');
    const cleared = run([{ type: 'checked', at: 2, latest: null }, { type: 'dismiss' }], dismissed);
    expect(targetOf(cleared)).toBeNull();
    expect(cleared.dismissed).toBe('0.3.0');
  });
});

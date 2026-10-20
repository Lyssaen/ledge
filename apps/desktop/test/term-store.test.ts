import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyBackend, PtyEvents } from '../src/term/backend';
import type { TermSurface } from '../src/term/surface';
import { TermStore, agentTabId, type Tab, type TermDeps } from '../src/term/store';

type Open = { argv: string[]; on: PtyEvents; closed: boolean; writes: string[]; sizes: [number, number][]; resolve(ok: boolean): void };
type FakeSurface = TermSurface & { written: (Uint8Array | string)[]; readOnly: boolean; disposed: boolean; type(d: string): void; resized(c: number, r: number): void };

function fakeBackend() {
  const opens: Open[] = [];
  let hold = false;
  const backend: PtyBackend & { opens: Open[]; hold(on: boolean): void } = {
    opens,
    hold: on => { hold = on; },
    open: (argv, _size, on) => new Promise(res => {
      const o: Open = { argv, on, closed: false, writes: [], sizes: [], resolve: ok => res(ok ? {
        write: d => { o.writes.push(d); },
        resize: (c, r) => { o.sizes.push([c, r]); },
        close: () => { o.closed = true; }
      } : null) };
      opens.push(o);
      if (!hold) o.resolve(true);
    })
  };
  return backend;
}

function fakeSurface(): FakeSurface {
  const inputs: ((d: string) => void)[] = []; const resizes: ((c: number, r: number) => void)[] = [];
  const s: FakeSurface = {
    host: document.createElement('div'), written: [], readOnly: false, disposed: false,
    write: b => { s.written.push(b); }, onInput: fn => { inputs.push(fn); }, onResize: fn => { resizes.push(fn); },
    size: () => ({ cols: 80, rows: 24 }), fit: () => {}, focus: () => {},
    setReadOnly: on => { s.readOnly = on; }, setTheme: () => {}, dispose: () => { s.disposed = true; },
    type: d => { for (const fn of inputs) fn(d); }, resized: (c, r) => { for (const fn of resizes) fn(c, r); }
  };
  return s;
}

const shellArgv = (id: string) => ['sh', '-c', `shell ${id}`];
const agentArgv = (id: string, ro: boolean) => ['ledge', 'attach', ...(ro ? ['--read-only'] : []), id];
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

let backend: ReturnType<typeof fakeBackend>;
let agentCalls: [string, boolean][];
let placeCalls: string[];
const shellPlace = (id: string) => { placeCalls.push(id); return id.startsWith('ssh:') ? { dir: '/srv/app', remote: true } : { dir: '/r/.worktrees/x', remote: false }; };
function store(over: Partial<TermDeps> = {}) {
  agentCalls = []; placeCalls = [];
  return new TermStore({
    backend, surface: fakeSurface, shellArgv, shellPlace,
    agentArgv: (id, ro) => { agentCalls.push([id, ro]); return agentArgv(id, ro); },
    now: () => Date.now(), ...over
  });
}
const shellOf = (st: TermStore, sid: string, id: string) => st.tabs(sid).find(t => t.id === id) as Extract<Tab, { kind: 'shell' }>;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T10:00:00Z')); backend = fakeBackend(); });
afterEach(() => { vi.useRealTimers(); });

describe('TermStore tabs and shells', () => {
  it('the first view is the agent tab and one idle shell, the agent tab selected', () => {
    const st = store();
    const tabs = st.tabs('local:a');
    expect(tabs).toEqual([{ kind: 'agent', id: agentTabId('local:a') }, expect.objectContaining({ kind: 'shell', n: 1, status: 'idle' })]);
    expect(st.tabs('local:a')).toBe(tabs);
    expect(st.active('local:a')).toBe('local:a#agent');
  });

  it('shell 1 opens where the session works, on its machine, asked once', () => {
    const st = store();
    expect(st.tabs('local:a')[1]).toMatchObject({ dir: '/r/.worktrees/x', remote: false });
    expect(st.tabs('ssh:b')[1]).toMatchObject({ dir: '/srv/app', remote: true });
    st.tabs('local:a'); st.select('local:a', 'local:a#shell-1'); st.link('ssh:b');
    expect(placeCalls).toEqual(['local:a', 'ssh:b']);
  });

  it('shell 1 of an ssh session that loses its connection ends « lost »', async () => {
    const st = store(); const [, shell] = st.tabs('ssh:b');
    st.select('ssh:b', shell!.id); await tick();
    backend.opens[0]!.on.exit(255);
    expect(shellOf(st, 'ssh:b', shell!.id).end).toEqual({ code: 255, lost: true });
  });

  it('a shell starts when first shown and survives hiding the pane and other sessions', async () => {
    const st = store(); const [, shell] = st.tabs('local:a');
    expect(backend.opens).toHaveLength(0);
    st.select('local:a', shell!.id); expect(backend.opens.at(-1)!.argv).toEqual(shellArgv('local:a'));
    expect(st.active('local:a')).toBe(shell!.id);
    await tick();
    expect(shellOf(st, 'local:a', shell!.id).status).toBe('running');
    st.hideAgent(); st.showAgent('local:b', { kind: 'live' }); await tick();
    expect(backend.opens[0]!.closed).toBe(false);
    st.select('local:a', shell!.id);
    expect(backend.opens.filter(o => o.argv[2] === 'shell local:a')).toHaveLength(1);
  });

  it('keys typed in a shell reach its process, and its output and size follow', async () => {
    const st = store(); const [, shell] = st.tabs('local:a');
    st.select('local:a', shell!.id); await tick();
    const s = st.surface(shell!.id) as FakeSurface;
    s.type('ls\r'); s.resized(100, 30);
    backend.opens[0]!.on.data(new Uint8Array([104, 105]));
    expect(backend.opens[0]!.writes).toEqual(['ls\r']);
    expect(backend.opens[0]!.sizes).toEqual([[80, 24], [100, 30]]);
    expect(s.written).toEqual([new Uint8Array([104, 105])]);
  });

  it('closing a shell kills it at once; « + » numbers the next', async () => {
    const st = store(); const [, shell] = st.tabs('local:a');
    st.select('local:a', shell!.id); await tick();
    const s = st.surface(shell!.id) as FakeSurface;
    st.close('local:a', shell!.id);
    expect(backend.opens[0]!.closed).toBe(true);
    expect(s.disposed).toBe(true);
    expect(st.surface(shell!.id)).toBeUndefined();
    expect(st.tabs('local:a').map(t => t.id)).toEqual(['local:a#agent']);
    expect(st.active('local:a')).toBe('local:a#agent');
    const id = st.addShell('local:a', '/r', false);
    expect(shellOf(st, 'local:a', id)).toMatchObject({ n: 2, dir: '/r', remote: false, status: 'idle' });
  });

  it('the agent tab cannot close', () => {
    const st = store(); st.tabs('local:a');
    st.close('local:a', agentTabId('local:a'));
    expect(st.tabs('local:a')[0]).toEqual({ kind: 'agent', id: 'local:a#agent' });
  });

  it('a shell closed while it is still opening is killed as soon as it opens, and never adopted', async () => {
    const st = store(); const [, shell] = st.tabs('local:a');
    backend.hold(true);
    st.select('local:a', shell!.id);
    st.close('local:a', shell!.id);
    backend.opens[0]!.resolve(true); await tick();
    expect(backend.opens[0]!.closed).toBe(true);
    expect(st.surface(shell!.id)).toBeUndefined();
  });

  it('a shell that exits ends with its code, and « Rouvrir » starts it again in the same tab', async () => {
    const st = store(); const [, shell] = st.tabs('local:a');
    st.select('local:a', shell!.id); await tick();
    const s = st.surface(shell!.id);
    backend.opens[0]!.on.exit(0);
    expect(shellOf(st, 'local:a', shell!.id)).toMatchObject({ status: 'ended', end: { code: 0, lost: false } });
    st.reopen('local:a', shell!.id); await tick();
    expect(backend.opens).toHaveLength(2);
    expect(shellOf(st, 'local:a', shell!.id).status).toBe('running');
    expect(shellOf(st, 'local:a', shell!.id).end).toBeUndefined();
    expect(st.surface(shell!.id)).toBe(s);
  });

  it('an ssh shell whose connection drops ends with « lost », and is never restarted by itself', async () => {
    const st = store(); st.tabs('ssh:b');
    const id = st.addShell('ssh:b', '/srv', true);
    st.select('ssh:b', id); await tick();
    backend.opens[0]!.on.exit(255);
    expect(shellOf(st, 'ssh:b', id)).toMatchObject({ status: 'ended', end: { code: 255, lost: true } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.opens).toHaveLength(1);
    st.reopen('ssh:b', id); await tick();
    expect(backend.opens).toHaveLength(2);
  });

  it('a local shell exiting with 255 is not « lost »', async () => {
    const st = store(); const [, shell] = st.tabs('local:a');
    st.select('local:a', shell!.id); await tick();
    backend.opens[0]!.on.exit(255);
    expect(shellOf(st, 'local:a', shell!.id).end).toEqual({ code: 255, lost: false });
  });

  it('a shell with no argv is unavailable, not crashed', () => {
    const st = store({ shellArgv: () => null }); const [, shell] = st.tabs('local:a');
    st.select('local:a', shell!.id);
    expect(shellOf(st, 'local:a', shell!.id).status).toBe('unavailable');
    expect(backend.opens).toHaveLength(0);
  });

  it('a shell the backend refuses to open is unavailable', async () => {
    const st = store(); const [, shell] = st.tabs('local:a');
    backend.hold(true);
    st.select('local:a', shell!.id);
    backend.opens[0]!.resolve(false); await tick();
    expect(shellOf(st, 'local:a', shell!.id).status).toBe('unavailable');
  });

  it('the session ends: its shells stay open until their tab closes', async () => {
    const st = store(); const [, shell] = st.tabs('local:a');
    st.showAgent('local:a', { kind: 'live' }); await tick();
    st.select('local:a', shell!.id); await tick();
    const opened = backend.opens.at(-1)!;
    st.showAgent('local:a', { kind: 'preview', why: 'ended' }); await tick();
    expect(shellOf(st, 'local:a', shell!.id).status).toBe('running');
    expect(opened.closed).toBe(false);
  });

  it('a new theme reaches every xterm still open', async () => {
    const made: (FakeSurface & { themes: unknown[] })[] = [];
    const st = store({ surface: () => { const s = Object.assign(fakeSurface(), { themes: [] as unknown[] }); s.setTheme = t => { s.themes.push(t); }; made.push(s); return s; } });
    const [, one] = st.tabs('local:a');
    st.select('local:a', one!.id);
    const two = st.addShell('local:a', '/r', false); st.select('local:a', two);
    st.showAgent('local:a', { kind: 'live' }); await tick();
    st.close('local:a', two);
    st.setTheme({ background: '#ffffff' });
    expect(made).toHaveLength(3);
    expect(made.map(s => s.themes)).toEqual([[{ background: '#ffffff' }], [], [{ background: '#ffffff' }]]);
  });

  it('notifies subscribers on changes, until they unsubscribe', async () => {
    const st = store(); const fn = vi.fn();
    const off = st.subscribe(fn); const [, shell] = st.tabs('local:a');
    st.select('local:a', shell!.id); await tick();
    expect(fn).toHaveBeenCalled();
    off(); fn.mockClear();
    st.addShell('local:a', '/r', false);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('TermStore agent attachment', () => {
  it('the agent tab attaches to the session, with keys going to the agent', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    expect(agentCalls).toEqual([['local:a', false]]);
    expect(backend.opens[0]!.argv).toEqual(agentArgv('local:a', false));
    expect(st.link('local:a')).toEqual({ state: 'attached', attempt: 0 });
    const s = st.surface(agentTabId('local:a')) as FakeSurface;
    expect(s.readOnly).toBe(false);
    s.type('y');
    expect(backend.opens[0]!.writes).toEqual(['y']);
  });

  it('showing the same session in the same mode opens no second attachment', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    expect(backend.opens).toHaveLength(1);
  });

  it('the agent tab attaches read-only for a subagent', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'parent', parentId: 'local:a' }); await tick();
    expect(agentCalls).toEqual([['local:a', true]]);
    expect((st.surface(agentTabId('local:a')) as FakeSurface).readOnly).toBe(true);
  });

  it('with no argv for the agent, nothing opens and the link is off', async () => {
    const st = store({ agentArgv: () => null });
    expect(() => st.showAgent('local:a', { kind: 'live' })).not.toThrow();
    expect(() => st.showAgent('local:a', { kind: 'parent', parentId: 'local:a' })).not.toThrow();
    await tick();
    expect(backend.opens).toHaveLength(0);
    expect(st.link('local:a')).toEqual({ state: 'off', attempt: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.opens).toHaveLength(0);
  });

  it('the agent reconnects with backoff, and stops when the session is left', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    backend.opens[0]!.on.exit(255);
    expect(st.link('local:a')).toEqual({ state: 'reconnecting', attempt: 1, retryAt: Date.now() + 1000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(backend.opens).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.opens).toHaveLength(2);
    backend.opens[1]!.on.exit(255);
    expect(st.link('local:a')).toEqual({ state: 'reconnecting', attempt: 2, retryAt: Date.now() + 2000 });
    st.hideAgent();
    expect(st.link('local:a')).toEqual({ state: 'off', attempt: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.opens).toHaveLength(2);
    st.retryNow('local:a'); await tick();
    expect(backend.opens).toHaveLength(2);
  });

  it('« Reconnecter » retries at once, and the old timer does not open a second one', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    backend.opens[0]!.on.exit(255);
    st.retryNow('local:a'); await tick();
    expect(backend.opens).toHaveLength(2);
    expect(st.link('local:a').state).toBe('attached');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.opens).toHaveLength(2);
  });

  it('an attachment that held for a while starts the backoff over when it drops', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    backend.opens[0]!.on.exit(255);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(60_000);
    backend.opens[1]!.on.exit(255);
    expect(st.link('local:a').attempt).toBe(1);
  });

  it('an agent screen the backend refuses to open is retried like a drop', async () => {
    const st = store(); backend.hold(true);
    st.showAgent('local:a', { kind: 'live' });
    backend.opens[0]!.resolve(false); await tick();
    expect(st.link('local:a')).toMatchObject({ state: 'reconnecting', attempt: 1 });
  });

  it('a machine going offline stops the retries; coming back attaches again', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    backend.opens[0]!.on.exit(255);
    st.showAgent('local:a', { kind: 'offline' });
    expect(st.link('local:a')).toEqual({ state: 'off', attempt: 0 });
    expect(st.offlineSince('local:a')).toBe(Date.now());
    expect((st.surface(agentTabId('local:a')) as FakeSurface).readOnly).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.opens).toHaveLength(1);
    st.showAgent('local:a', { kind: 'live' }); await tick();
    expect(backend.opens).toHaveLength(2);
    expect(st.offlineSince('local:a')).toBeUndefined();
  });

  it('offlineSince keeps the first time it was seen offline', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'offline' });
    const first = Date.now();
    await vi.advanceTimersByTimeAsync(5000);
    st.hideAgent(); st.showAgent('local:a', { kind: 'offline' });
    expect(st.offlineSince('local:a')).toBe(first);
  });

  it('another session shown detaches the first one', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    st.showAgent('local:b', { kind: 'live' }); await tick();
    expect(backend.opens[0]!.closed).toBe(true);
    expect(st.link('local:a')).toEqual({ state: 'off', attempt: 0 });
    expect(st.link('local:b').state).toBe('attached');
  });

  it('an attachment dropped while it is still opening is closed when it opens, and never adopted', async () => {
    const st = store(); backend.hold(true);
    st.showAgent('local:a', { kind: 'live' });
    st.hideAgent();
    backend.opens[0]!.resolve(true); await tick();
    expect(backend.opens[0]!.closed).toBe(true);
    expect(st.link('local:a')).toEqual({ state: 'off', attempt: 0 });

    st.showAgent('local:a', { kind: 'live' });
    st.showAgent('local:a', { kind: 'parent', parentId: 'local:a' });
    backend.opens[1]!.resolve(true); backend.opens[2]!.resolve(true); await tick();
    expect(backend.opens[1]!.closed).toBe(true);
    expect(backend.opens[2]!.closed).toBe(false);
  });

  it('switching sessions during a reconnect never leaves two attachments', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    backend.opens[0]!.on.exit(255);
    backend.hold(true);
    await vi.advanceTimersByTimeAsync(1000);
    st.showAgent('local:b', { kind: 'live' });
    backend.opens[1]!.resolve(true); backend.opens[2]!.resolve(true); await tick();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.opens.filter(o => !o.closed).map(o => o.argv.at(-1))).toEqual(['local:b']);
  });

  it('output of a detached attachment is not written to the screen', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'live' }); await tick();
    st.hideAgent();
    backend.opens[0]!.on.data(new Uint8Array([1]));
    backend.opens[0]!.on.exit(0);
    expect((st.surface(agentTabId('local:a')) as FakeSurface).written).toEqual([]);
    expect(st.link('local:a').state).toBe('off');
  });

  it('a preview or browser mode opens nothing', async () => {
    const st = store();
    st.showAgent('local:a', { kind: 'preview', why: 'outside' });
    st.showAgent('local:b', { kind: 'browser' }); await tick();
    expect(backend.opens).toHaveLength(0);
  });
});

describe('TermStore size at open', () => {
  /** A surface whose pane gets its real size while the open is pending: the fit has no handle to resize yet. */
  const sizedSurface = () => {
    let s!: FakeSurface; let size = { cols: 80, rows: 24 };
    const make = () => { s = fakeSurface(); s.size = () => size; return s; };
    return { make, fit: (cols: number, rows: number) => { size = { cols, rows }; s.resized(cols, rows); } };
  };

  it('a shell takes the pane\'s size once its process is there', async () => {
    backend.hold(true);
    const sz = sizedSurface(); const st = store({ surface: sz.make });
    const [, shell] = st.tabs('local:a');
    st.select('local:a', shell!.id);
    sz.fit(120, 40);
    backend.opens[0]!.resolve(true); await tick();
    expect(backend.opens[0]!.sizes).toEqual([[120, 40]]);
  });

  it('the agent attachment takes the pane\'s size once it is attached', async () => {
    backend.hold(true);
    const sz = sizedSurface(); const st = store({ surface: sz.make });
    st.showAgent('local:a', { kind: 'live' });
    sz.fit(60, 50);
    backend.opens[0]!.resolve(true); await tick();
    expect(backend.opens[0]!.sizes).toEqual([[60, 50]]);
  });
});

describe('a native session (OMP): shells only', () => {
  const place = (id: string) => ({ dir: '/w/x', remote: false, native: id.startsWith('omp') });
  it('has no agent tab: its first shell is the active tab, and showing the agent attaches nothing', async () => {
    const st = store({ shellPlace: place });
    expect(st.tabs('omp1').map(t => t.kind)).toEqual(['shell']);
    expect(st.active('omp1')).toBe('omp1#shell-1');
    st.showAgent('omp1', { kind: 'native' });
    expect(backend.opens).toHaveLength(0); expect(agentCalls).toEqual([]);
    expect(st.tabs('claude1').map(t => t.kind)).toEqual(['agent', 'shell']); // the others are as they were
  });
  it('closing its last shell leaves a fresh one, not started, rather than an empty pane', async () => {
    const st = store({ shellPlace: place });
    st.select('omp1', 'omp1#shell-1'); await tick();
    expect(backend.opens).toHaveLength(1);
    st.close('omp1', 'omp1#shell-1');
    expect(backend.opens[0]!.closed).toBe(true);
    expect(st.tabs('omp1')).toEqual([expect.objectContaining({ kind: 'shell', id: 'omp1#shell-2', status: 'idle' })]);
    expect(st.active('omp1')).toBe('omp1#shell-2');
  });
});

describe('TermStore input while opening', () => {
  // ConPTY asks for the cursor (ESC [ 6 n) as it starts and prints nothing, reads no key, until the xterm answers.
  const REPORT = '\x1b[1;1R';

  it('the agent screen\'s answer, sent before the attachment opens, reaches it once open, before later keys', async () => {
    backend.hold(true);
    const st = store();
    st.showAgent('local:a', { kind: 'live' });
    const s = st.surface(agentTabId('local:a')) as FakeSurface;
    s.type(REPORT);
    backend.opens[0]!.resolve(true); await tick();
    s.type('y');
    expect(backend.opens[0]!.writes).toEqual([REPORT, 'y']);
  });

  it('a shell\'s answer, sent before it opens, reaches it once open', async () => {
    backend.hold(true);
    const st = store();
    const [, shell] = st.tabs('local:a');
    st.select('local:a', shell!.id);
    (st.surface(shell!.id) as FakeSurface).type(REPORT);
    backend.opens[0]!.resolve(true); await tick();
    expect(backend.opens[0]!.writes).toEqual([REPORT]);
  });

  it('what was sent to an attachment that never opened does not go to the next one', async () => {
    backend.hold(true);
    const st = store();
    st.showAgent('local:a', { kind: 'live' });
    (st.surface(agentTabId('local:a')) as FakeSurface).type('lost');
    backend.opens[0]!.resolve(false); await tick();
    await vi.advanceTimersByTimeAsync(1000);
    backend.opens[1]!.resolve(true); await tick();
    expect(backend.opens[1]!.writes).toEqual([]);
  });
});

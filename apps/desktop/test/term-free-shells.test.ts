import { describe, expect, it } from 'vitest';
import type { NativeShell, PtyBackend, PtyEvents } from '../src/term/backend';
import type { TermSurface } from '../src/term/surface';
import { TermStore, type TermDeps } from '../src/term/store';

type Open = { argv: string[]; native?: NativeShell; on: PtyEvents; closed: boolean; writes: string[]; resolve(): void };
type FakeSurface = TermSurface & { disposed: boolean; type(d: string): void };

function fakeBackend() {
  const opens: Open[] = [];
  let hold = false;
  const backend: PtyBackend & { opens: Open[]; hold(on: boolean): void } = {
    opens,
    hold: on => { hold = on; },
    open: (argv, _size, on, native) => new Promise(res => {
      const o: Open = { argv, native, on, closed: false, writes: [], resolve: () => res({ write: d => { o.writes.push(d); }, resize: () => {}, close: () => { o.closed = true; } }) };
      opens.push(o);
      if (!hold) o.resolve();
    })
  };
  return backend;
}

const surfaces: FakeSurface[] = [];
function fakeSurface(): FakeSurface {
  const inputs: ((d: string) => void)[] = [];
  const s: FakeSurface = {
    host: document.createElement('div'), disposed: false,
    write: () => {}, onInput: fn => { inputs.push(fn); }, onResize: () => {},
    size: () => ({ cols: 80, rows: 24 }), fit: () => {}, focus: () => {},
    setReadOnly: () => {}, setTheme: () => {}, dispose: () => { s.disposed = true; },
    type: d => { for (const fn of inputs) fn(d); }
  };
  surfaces.push(s);
  return s;
}

const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function make(over: Partial<TermDeps> = {}) {
  const backend = fakeBackend();
  const calls: [string, string][] = [];
  const st = new TermStore({
    backend, surface: fakeSurface, agentArgv: () => null, shellArgv: () => null, shellPlace: () => ({ dir: '/', remote: false }),
    freeLaunch: (kind, dir) => { calls.push([kind, dir]); return kind === 'powershell' ? { native: 'powershell' } : kind === 'nope' as never ? null : { argv: ['sh', kind, dir] }; },
    freeTitle: (kind, n) => `${kind} ${n}`,
    ...over
  });
  return { st, backend, calls };
}

describe('TermStore free shells', () => {
  it('opens at once with the launch argv, id shell:<n>, one counter', async () => {
    const { st, backend } = make();
    const a = st.openFree('wsl', '/w');
    const b = st.openFree('ssh:srv', '');
    await tick();
    expect([a, b]).toEqual(['shell:1', 'shell:2']);
    expect(st.free(a)).toMatchObject({ kind: 'wsl', n: 1, title: 'wsl 1', dir: '/w', status: 'running' });
    expect(st.free(b)?.title).toBe('ssh:srv 2');
    expect(backend.opens[0]!.argv).toEqual(['sh', 'wsl', '/w']);
    expect(st.surface(a)).toBeDefined();
    expect(st.free(a)).toBe(st.free(a));
  });

  it('a native shell opens with an empty argv and its kind', async () => {
    const { st, backend } = make();
    st.openFree('powershell', '');
    await tick();
    expect(backend.opens[0]!).toMatchObject({ argv: [], native: 'powershell' });
  });

  it('no launch, or no backend: unavailable', () => {
    const none = make({ freeLaunch: () => null });
    expect(none.st.free(none.st.openFree('wsl', '/w'))?.status).toBe('unavailable');
    const nb = make({ backend: null });
    expect(nb.st.free(nb.st.openFree('wsl', '/w'))?.status).toBe('unavailable');
  });

  it('exit ends it, 255 over ssh is lost, nothing restarts', async () => {
    const { st, backend } = make();
    const a = st.openFree('wsl', '/w');
    const b = st.openFree('ssh:srv', '');
    await tick();
    backend.opens[0]!.on.exit(0);
    backend.opens[1]!.on.exit(255);
    expect(st.free(a)).toMatchObject({ status: 'ended', end: { code: 0, lost: false } });
    expect(st.free(b)).toMatchObject({ status: 'ended', end: { code: 255, lost: true } });
    expect(backend.opens).toHaveLength(2);
  });

  it('reopen of an ended one: a new open, same surface', async () => {
    const { st, backend } = make();
    const a = st.openFree('wsl', '/w');
    await tick();
    const s = st.surface(a);
    st.reopenFree(a);
    expect(backend.opens).toHaveLength(1);
    backend.opens[0]!.on.exit(1);
    st.reopenFree(a);
    await tick();
    expect(backend.opens).toHaveLength(2);
    expect(st.free(a)).toMatchObject({ status: 'running', end: undefined });
    expect(st.surface(a)).toBe(s);
  });

  it('close kills the process and disposes the xterm', async () => {
    const { st, backend } = make();
    const a = st.openFree('wsl', '/w');
    await tick();
    const s = st.surface(a) as FakeSurface;
    st.closeFree(a);
    expect(backend.opens[0]!.closed).toBe(true);
    expect(s.disposed).toBe(true);
    expect(st.free(a)).toBeUndefined();
  });

  it('what is typed before the handle arrives is kept, in order', async () => {
    const { st, backend } = make();
    backend.hold(true);
    const a = st.openFree('wsl', '/w');
    (st.surface(a) as FakeSurface).type('l');
    (st.surface(a) as FakeSurface).type('s');
    backend.opens[0]!.resolve();
    await tick();
    expect(backend.opens[0]!.writes).toEqual(['l', 's']);
  });

  it('notifies subscribers', () => {
    const { st } = make();
    let n = 0;
    st.subscribe(() => { n += 1; });
    st.openFree('wsl', '/w');
    expect(n).toBeGreaterThan(0);
  });

  it('a surface that cannot be made leaves the shell unavailable, and the id is still returned', () => {
    const { st } = make({ surface: () => { throw new Error('no xterm'); } });
    let n = 0;
    st.subscribe(() => { n += 1; });
    const id = st.openFree('wsl', '/w');
    expect(id).toBe('shell:1');
    expect(st.free(id)?.status).toBe('unavailable');
    expect(n).toBeGreaterThan(0);
  });

  it('a launch that throws leaves the shell unavailable', () => {
    const { st } = make({ freeLaunch: () => { throw new Error('boom'); } });
    expect(st.free(st.openFree('wsl', '/w'))?.status).toBe('unavailable');
  });

  it('close during a pending open: the late handle is closed', async () => {
    const { st, backend } = make();
    backend.hold(true);
    const a = st.openFree('wsl', '/w');
    st.closeFree(a);
    backend.opens[0]!.on.data(new Uint8Array([1]));
    backend.opens[0]!.resolve();
    await tick();
    expect(backend.opens[0]!.closed).toBe(true);
    expect(backend.opens[0]!.writes).toEqual([]);
    expect(st.free(a)).toBeUndefined();
  });

  it('exit before the handle resolves: ended, and the late handle is closed', async () => {
    const { st, backend } = make();
    backend.hold(true);
    const a = st.openFree('wsl', '/w');
    backend.opens[0]!.on.exit(2);
    backend.opens[0]!.resolve();
    await tick();
    expect(st.free(a)).toMatchObject({ status: 'ended', end: { code: 2, lost: false } });
    expect(backend.opens[0]!.closed).toBe(true);
  });
});

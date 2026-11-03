import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { BrowserFrame, BrowserLive, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { findBrowsers, type ProcFs } from '../src/daemon/browser/proc.js';
import { CDP_ALLOWED, CdpRefused, connectCdp, type Cdp, type CdpEvent } from '../src/daemon/browser/cdp.js';
import { createBrowserLive } from '../src/daemon/browser/live.js';

// ---- a process table: a pane, the agent under it, its browsers

interface Proc { ppid: number; args: string[] }
function procOf(procs: Record<number, Proc>, files: Record<string, string> = {}): ProcFs & { procs: Record<number, Proc>; files: Record<string, string> } {
  return {
    procs, files,
    async pids() { return Object.keys(procs).map(Number); },
    async ppid(pid) { return procs[pid]?.ppid ?? null; },
    async cmdline(pid) { return procs[pid]?.args ?? null; },
    async read(path) { return files[path] ?? null; }
  };
}
const PLAYWRIGHT_PROFILE = '/home/u/.cache/ms-playwright-mcp/mcp-chrome-b2a7625';
const OMP_PROFILE = '/home/u/.openrig/state/omp/design-maquettiste@dev-omp/.omp/run/daemons/96e8/omp.browser.headless.profile';
/** Claude in pane 100: its Playwright MCP server, a Chrome on a pipe (Playwright's default), that Chrome's renderer. */
const claudeTree = (chromeArgs: string[]): Record<number, Proc> => ({
  100: { ppid: 1, args: ['bash', '-l'] },
  101: { ppid: 100, args: ['/home/u/.local/bin/claude'] },
  102: { ppid: 101, args: ['npm', 'exec', '@playwright/mcp@latest'] },
  103: { ppid: 102, args: ['node', '/home/u/.npm/_npx/x/node_modules/.bin/playwright-mcp'] },
  104: { ppid: 103, args: ['/opt/google/chrome/chrome', '--disable-field-trial-config', `--user-data-dir=${PLAYWRIGHT_PROFILE}`, ...chromeArgs, 'about:blank'] },
  105: { ppid: 104, args: ['/opt/google/chrome/chrome', '--type=renderer', `--user-data-dir=${PLAYWRIGHT_PROFILE}`] },
  // Another session's browser, outside this pane.
  900: { ppid: 1, args: ['/opt/google/chrome/chrome', '--remote-debugging-port=0', '--user-data-dir=/elsewhere'] }
});

describe('findBrowsers: the agent\'s Chrome under its pane', () => {
  it('Claude\'s Playwright Chrome on a pipe only: found, not watchable', async () => {
    const fs = procOf(claudeTree(['--remote-debugging-pipe']));
    expect(await findBrowsers(100, fs)).toEqual([{ pid: 104, userDataDir: PLAYWRIGHT_PROFILE, pipeOnly: true }]);
  });

  it('with a port as well (« Activer le direct »): its endpoint, from DevToolsActivePort', async () => {
    const fs = procOf(claudeTree(['--remote-debugging-port=0', '--remote-debugging-pipe']), { [`${PLAYWRIGHT_PROFILE}/DevToolsActivePort`]: '40712\n/devtools/browser/b4b49a0c-0bc1-4521-ae96-65a1a7e1b832\n' });
    expect(await findBrowsers(100, fs)).toEqual([{ pid: 104, userDataDir: PLAYWRIGHT_PROFILE, pipeOnly: false, port: 40712, path: '/devtools/browser/b4b49a0c-0bc1-4521-ae96-65a1a7e1b832' }]);
  });

  it('an OMP seat\'s headless browser, deep under the runner; a port file that is not Chrome\'s own is ignored', async () => {
    const procs: Record<number, Proc> = {
      200: { ppid: 1, args: ['bash', '-l'] },
      201: { ppid: 200, args: ['node', 'pi-runner.js', '--runtime', 'omp'] },
      202: { ppid: 201, args: ['bun', 'cli.js', '--mode', 'rpc'] },
      203: { ppid: 202, args: ['bun', 'cli.js', '__omp_worker_daemon_broker'] },
      204: { ppid: 203, args: ['/usr/bin/google-chrome-stable', '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${OMP_PROFILE}`] }
    };
    expect(await findBrowsers(200, procOf(procs, { [`${OMP_PROFILE}/DevToolsActivePort`]: '41556\n/devtools/browser/7d591d76\n' })))
      .toEqual([{ pid: 204, userDataDir: OMP_PROFILE, pipeOnly: false, port: 41556, path: '/devtools/browser/7d591d76' }]);
    for (const bad of ['41556\n/json/version\n', '99999\n/devtools/browser/x\n', 'x\n/devtools/browser/x\n', '41556\n/devtools/browser/../../x\n'])
      expect((await findBrowsers(200, procOf(procs, { [`${OMP_PROFILE}/DevToolsActivePort`]: bad })))[0]).not.toHaveProperty('port');
  });

  it('Chrome\'s rewritten title (its arguments in one string): read the same', async () => {
    const one = `/opt/google/chrome/chrome --headless=new --remote-debugging-port=0 --user-data-dir=${OMP_PROFILE} --no-first-run --use-angle=swiftshader-webgl about:blank`;
    const pipe = `/opt/google/chrome/chrome --user-data-dir=${PLAYWRIGHT_PROFILE} --remote-debugging-pipe about:blank`;
    const fs = procOf({ 1: { ppid: 0, args: ['init'] }, 300: { ppid: 1, args: ['bash'] }, 301: { ppid: 300, args: [one] }, 302: { ppid: 300, args: [pipe] },
      303: { ppid: 301, args: [`/opt/google/chrome/chrome --type=renderer --user-data-dir=${OMP_PROFILE} --remote-debugging-port=0`] } },
    { [`${OMP_PROFILE}/DevToolsActivePort`]: '41730\n/devtools/browser/feddcf35\n' });
    expect(await findBrowsers(300, fs)).toEqual(expect.arrayContaining([
      { pid: 301, userDataDir: OMP_PROFILE, pipeOnly: false, port: 41730, path: '/devtools/browser/feddcf35' },
      { pid: 302, userDataDir: PLAYWRIGHT_PROFILE, pipeOnly: true }]));
    expect(await findBrowsers(300, fs)).toHaveLength(2);
  });

  it('nothing but Chrome\'s main process: neither its renderers, nor another program, nor a Chrome outside the pane', async () => {
    const fs = procOf({ 100: { ppid: 1, args: ['bash'] }, 101: { ppid: 100, args: ['node', 'chrome-like.js', '--user-data-dir=/x'] }, 900: claudeTree([])[900]! });
    expect(await findBrowsers(100, fs)).toEqual([]);
  });
});

// ---- the CDP allow-list, on a real WebSocket

describe('connectCdp: only the commands of the allow-list ever leave Ledge', () => {
  let wss: WebSocketServer; let received: string[]; let url: string;
  beforeEach(async () => {
    received = [];
    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(r => wss.once('listening', () => r()));
    wss.on('connection', ws => ws.on('message', data => {
      const m = JSON.parse(String(data)) as { id: number; method: string };
      received.push(m.method);
      ws.send(JSON.stringify({ id: m.id, result: { ok: m.method } }));
      if (m.method === 'Target.setDiscoverTargets') ws.send(JSON.stringify({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'T1', type: 'page', url: 'about:blank', title: '' } } }));
    }));
    url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}/devtools/browser/x`;
  });
  afterEach(() => new Promise<void>(r => wss.close(() => r())));

  it('sends an allowed command and gets its answer and the browser\'s events', async () => {
    const cdp = await connectCdp(url);
    const events: CdpEvent[] = [];
    cdp.onEvent(e => events.push(e));
    expect(await cdp.call('Target.setDiscoverTargets', { discover: true })).toEqual({ ok: 'Target.setDiscoverTargets' });
    await vi.waitFor(() => expect(events).toEqual([{ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'T1', type: 'page', url: 'about:blank', title: '' } } }]));
    cdp.close();
  });

  it('refuses, without sending anything, every command that could click, type, run a script or change the page', async () => {
    const cdp = await connectCdp(url);
    for (const m of ['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Runtime.evaluate', 'Runtime.callFunctionOn', 'Page.navigate', 'Page.reload', 'DOM.setAttributeValue', 'Emulation.setDeviceMetricsOverride', 'Target.closeTarget', 'Target.createTarget', 'Browser.close'])
      await expect(cdp.call(m)).rejects.toBeInstanceOf(CdpRefused);
    await cdp.call('Target.getTargets');
    expect(received).toEqual(['Target.getTargets']);
    for (const m of CDP_ALLOWED) expect(m).toMatch(/^(Target\.(getTargets|setDiscoverTargets|attachToTarget|detachFromTarget)|Page\.(startScreencast|stopScreencast|screencastFrameAck|captureScreenshot))$/);
    cdp.close();
  });

  it('tells when the browser goes', async () => {
    const cdp = await connectCdp(url);
    const closed = new Promise<void>(r => cdp.onClose(r));
    for (const c of wss.clients) c.terminate();
    await closed;
    await expect(cdp.call('Target.getTargets')).rejects.toThrow(/closed/);
  });
});

// ---- the service, over a fake browser

/** A browser as CDP shows it: its tabs, what Ledge sent it (all through the real allow-list), and its events on demand. */
function fakeBrowser(pages: { id: string; url: string; title: string }[] = []) {
  const calls: { method: string; params: Record<string, unknown>; sessionId?: string }[] = [];
  const listeners: ((e: CdpEvent) => void)[] = [];
  const closes: (() => void)[] = [];
  let closed = false, next = 0, shot = 0;
  const cdp: Cdp = {
    async call(method, params = {}, sessionId) {
      if (!CDP_ALLOWED.has(method)) throw new CdpRefused(method);
      if (closed) throw new Error('CDP connection closed');
      calls.push({ method, params, ...(sessionId ? { sessionId } : {}) });
      if (method === 'Target.getTargets') return { targetInfos: pages.map(p => ({ targetId: p.id, type: 'page', url: p.url, title: p.title })) };
      if (method === 'Target.attachToTarget') return { sessionId: `S${++next}` };
      if (method === 'Page.captureScreenshot') return { data: `/9j/shot${++shot}` };
      return {};
    },
    onEvent(fn) { listeners.push(fn); },
    onClose(fn) { if (closed) fn(); else closes.push(fn); },
    close() { if (closed) return; closed = true; for (const fn of closes) fn(); }
  };
  return {
    cdp, calls,
    emit(e: CdpEvent) { for (const fn of listeners) fn(e); },
    tab(method: 'Target.targetCreated' | 'Target.targetInfoChanged', id: string, url: string, title = '', type = 'page') {
      const i = pages.findIndex(p => p.id === id);
      if (type === 'page') { if (i === -1) pages.push({ id, url, title }); else pages[i] = { id, url, title }; }
      this.emit({ method, params: { targetInfo: { targetId: id, type, url, title } } });
    },
    destroy(id: string) { const i = pages.findIndex(p => p.id === id); if (i !== -1) pages.splice(i, 1); this.emit({ method: 'Target.targetDestroyed', params: { targetId: id } }); },
    /** A title the page set itself, that Chrome does not announce. */
    retitle(id: string, title: string) { const p = pages.find(x => x.id === id); if (p) p.title = title; },
    gone() { cdp.close(); },
    methods: () => calls.map(c => c.method)
  };
}

const T0 = Date.parse('2026-11-03T15:00:00.000Z');
const session = (o: Partial<Session> = {}): Session => ({ id: 'otto', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto', tmuxSession: 'ledge-otto', state: 'working', helpers: [],
  startedAt: '2026-11-03T14:00:00.000Z', lastActivityAt: '2026-11-03T14:00:00.000Z', source: 'launcher', ...o });

describe('createBrowserLive: the agent\'s browser, followed', () => {
  let store: Store; let emitted: BrowserLive[]; let clock: number;
  beforeEach(() => { vi.useFakeTimers(); clock = T0; store = new Store(); emitted = []; });
  afterEach(() => { vi.useRealTimers(); });
  const now = () => clock;
  const advance = async (ms: number) => { clock += ms; await vi.advanceTimersByTimeAsync(ms); };
  const last = () => emitted.at(-1);

  function service(fs: ProcFs, browser?: ReturnType<typeof fakeBrowser>, panes: Record<string, number> = { 'ledge-otto': 100 }) {
    const connected: string[] = [];
    const svc = createBrowserLive({ store, panePid: async n => panes[n] ?? null, emit: m => emitted.push(m), procfs: fs, now, intervalMs: 5000, debounceMs: 1000, captureMinMs: 5000, stillMs: 3000,
      connect: async url => { connected.push(url); if (!browser) throw new Error('ECONNREFUSED'); return browser.cdp; } });
    return { svc, connected };
  }

  it('Claude with Playwright on a pipe only: « off »; once gone, nothing', async () => {
    store.upsert(session());
    const fs = procOf(claudeTree(['--remote-debugging-pipe']));
    const { svc, connected } = service(fs);
    await svc.tick();
    expect(last()).toMatchObject({ type: 'browser.live', id: 'otto', state: 'off', tabs: 0, since: '2026-11-03T15:00:00.000Z' });
    expect(connected).toEqual([]);
    delete fs.procs[104]; delete fs.procs[105];
    await svc.tick();
    expect(last()).toMatchObject({ state: 'none' });
    svc.stop();
  });

  it('Claude with the port: live on its tab, an image kept after the agent\'s actions (grouped, at most one per 5 s), closed with it', async () => {
    store.upsert(session());
    const fs = procOf(claudeTree(['--remote-debugging-port=0', '--remote-debugging-pipe']), { [`${PLAYWRIGHT_PROFILE}/DevToolsActivePort`]: '40712\n/devtools/browser/b4b4\n' });
    const b = fakeBrowser([{ id: 'T1', url: 'about:blank', title: 'about:blank' }]);
    const { svc, connected } = service(fs, b);
    await svc.tick();
    expect(connected).toEqual(['ws://127.0.0.1:40712/devtools/browser/b4b4']);
    expect(last()).toMatchObject({ state: 'live', tabs: 1, url: 'about:blank', since: '2026-11-03T15:00:00.000Z' });
    // The agent goes to its mockup: the tab changes, then its hook says it acted.
    b.tab('Target.targetInfoChanged', 'T1', 'http://localhost:8733/ledge-openrig-omp.html', 'Ledge · OpenRig');
    expect(last()).toMatchObject({ state: 'live', url: 'http://localhost:8733/ledge-openrig-omp.html', title: 'Ledge · OpenRig' });
    svc.poke('otto');
    await advance(1200);
    const shots = () => b.methods().filter(m => m === 'Page.captureScreenshot').length;
    expect(shots()).toBe(1);
    // The poke's search (0.2 s), then the agent's actions grouped over 1 s.
    expect(last()?.image).toEqual({ at: '2026-11-03T15:00:01.200Z', url: 'http://localhost:8733/ledge-openrig-omp.html', title: 'Ledge · OpenRig' });
    // The capture attaches to the tab and leaves it at once.
    expect(b.methods().slice(-3)).toEqual(['Target.attachToTarget', 'Page.captureScreenshot', 'Target.detachFromTarget']);
    // Three more actions within a second: one image, not before 5 s after the first.
    svc.poke('otto'); await advance(300); svc.poke('otto'); await advance(300); svc.poke('otto');
    await advance(2000);
    expect(shots()).toBe(1);
    await advance(3000);
    expect(shots()).toBe(2);
    // The agent closes its browser (Playwright: the tab, then the browser): closed, the browser, keeping the last image.
    b.destroy('T1');
    expect(last()).toMatchObject({ state: 'closed', closed: 'tabs' });
    b.gone();
    expect(last()).toMatchObject({ state: 'closed', closed: 'browser', closedAt: expect.any(String), tabs: 0, url: 'http://localhost:8733/ledge-openrig-omp.html', image: { at: expect.any(String) } });
    // Its session ends soon after: it stopped with it.
    store.upsert({ ...store.get('otto')!, state: 'exited', exitedAt: new Date(clock).toISOString() });
    await svc.tick();
    expect(last()).toMatchObject({ state: 'closed', closed: 'stopped' });
    expect(new Set(b.methods()).size).toBeGreaterThan(0);
    for (const m of b.methods()) expect(CDP_ALLOWED.has(m)).toBe(true);
    svc.stop();
  });

  it('an OMP seat: its browser open with no tab is nothing; a tab makes it live, its last tab closed is « tabs », the seat stopping is « stopped »', async () => {
    store.upsert(session({ id: 'mia', name: 'Mia', tool: 'omp', tmuxSession: 'design-maquettiste@dev-omp', source: 'rig', rig: { seat: 'design-maquettiste@dev-omp', name: 'dev-omp' } }));
    const fs = procOf({ 200: { ppid: 1, args: ['bash'] }, 201: { ppid: 200, args: ['/usr/bin/google-chrome-stable', '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${OMP_PROFILE}`] } },
      { [`${OMP_PROFILE}/DevToolsActivePort`]: '41556\n/devtools/browser/7d59\n' });
    const b = fakeBrowser([]);
    const { svc } = service(fs, b, { 'design-maquettiste@dev-omp': 200 });
    await svc.tick();
    expect(emitted).toEqual([]);
    expect(svc.states()).toEqual([]);
    // Mia opens a tab and fills it with setContent: about:blank, its title from the page.
    b.tab('Target.targetCreated', 'M1', 'about:blank', 'about:blank');
    b.tab('Target.targetInfoChanged', 'M1', 'about:blank', 'ST7-251 · lien');
    expect(last()).toMatchObject({ id: 'mia', state: 'live', tabs: 1, url: 'about:blank', title: 'ST7-251 · lien' });
    // Chrome's own pages never count.
    b.tab('Target.targetCreated', 'X', 'chrome://omnibox-popup.top-chrome/', '');
    expect(last()).toMatchObject({ tabs: 1 });
    await advance(1100);
    expect(last()?.image).toMatchObject({ title: 'ST7-251 · lien' });
    b.destroy('M1');
    expect(last()).toMatchObject({ state: 'closed', closed: 'tabs', tabs: 0, title: 'ST7-251 · lien', image: { title: 'ST7-251 · lien' } });
    // A new tab later: live again.
    b.tab('Target.targetCreated', 'M2', 'about:blank', 'about:blank');
    expect(last()).toMatchObject({ state: 'live', tabs: 1 });
    expect(last()).not.toHaveProperty('closed');
    // The seat stops: its browser goes with it.
    b.gone();
    expect(last()).toMatchObject({ state: 'closed', closed: 'stopped' });
    svc.stop();
  });

  it('a port file left by an earlier browser: no connection, no state, tried again later', async () => {
    store.upsert(session());
    const fs = procOf(claudeTree(['--remote-debugging-port=0']), { [`${PLAYWRIGHT_PROFILE}/DevToolsActivePort`]: '40712\n/devtools/browser/old\n' });
    const { svc, connected } = service(fs);
    await svc.tick(); await svc.tick();
    expect(connected).toHaveLength(2);
    expect(emitted).toEqual([]);
    svc.stop();
  });

  it('a session forgotten by Ledge takes its browser state with it', async () => {
    store.upsert(session());
    const fs = procOf(claudeTree(['--remote-debugging-port=0']), { [`${PLAYWRIGHT_PROFILE}/DevToolsActivePort`]: '40712\n/devtools/browser/b\n' });
    const b = fakeBrowser([{ id: 'T1', url: 'http://localhost/a', title: 'A' }]);
    const { svc } = service(fs, b);
    await svc.tick();
    store.remove('otto');
    await svc.tick();
    expect(last()).toEqual({ type: 'browser.live', id: 'otto', state: 'none', tabs: 0 });
    expect(svc.states()).toEqual([]);
    svc.stop();
  });

  describe('watching', () => {
    async function liveOtto() {
      store.upsert(session());
      const fs = procOf(claudeTree(['--remote-debugging-port=0']), { [`${PLAYWRIGHT_PROFILE}/DevToolsActivePort`]: '40712\n/devtools/browser/b\n' });
      const b = fakeBrowser([{ id: 'T1', url: 'http://localhost/a', title: 'A' }]);
      const { svc } = service(fs, b);
      await svc.tick();
      return { svc, b };
    }
    const sinkOf = () => { const got: (BrowserLive | BrowserFrame)[] = []; return { got, sink: (m: BrowserLive | BrowserFrame) => { got.push(m); } }; };

    it('a front gets the state, the last image, then the film of the agent\'s tab; it stops when nobody watches', async () => {
      const { svc, b } = await liveOtto();
      await advance(1100);
      const { got, sink } = sinkOf();
      svc.watch('otto', sink);
      expect(got[0]).toMatchObject({ type: 'browser.live', state: 'live', url: 'http://localhost/a' });
      expect(got[1]).toMatchObject({ type: 'browser.frame', live: false, data: '/9j/shot1' });
      await vi.waitFor(() => expect(b.methods()).toContain('Page.startScreencast'));
      const film = b.calls.find(c => c.method === 'Page.startScreencast')!;
      b.emit({ method: 'Page.screencastFrame', sessionId: film.sessionId, params: { data: '/9j/frame1', sessionId: 7, metadata: { deviceWidth: 1280, deviceHeight: 800 } } });
      expect(got.at(-1)).toMatchObject({ type: 'browser.frame', id: 'otto', data: '/9j/frame1', live: true, width: 1280, height: 800 });
      await vi.waitFor(() => expect(b.calls).toContainEqual({ method: 'Page.screencastFrameAck', params: { sessionId: 7 }, sessionId: film.sessionId }));
      // A frame of another attachment (a capture) is not the film.
      b.emit({ method: 'Page.screencastFrame', sessionId: 'S99', params: { data: '/9j/other', sessionId: 8 } });
      expect(got.filter(m => m.type === 'browser.frame' && m.live)).toHaveLength(1);
      svc.unwatch('otto', sink);
      await vi.waitFor(() => expect(b.methods().slice(-2)).toEqual(['Page.stopScreencast', 'Target.detachFromTarget']));
      b.emit({ method: 'Page.screencastFrame', sessionId: film.sessionId, params: { data: '/9j/late', sessionId: 9 } });
      expect(got.filter(m => m.type === 'browser.frame' && m.live)).toHaveLength(1);
      for (const m of b.methods()) expect(CDP_ALLOWED.has(m)).toBe(true);
      svc.stop();
    });

    it('follows the tab the agent works in; a front gone stops its film', async () => {
      const { svc, b } = await liveOtto();
      const { sink } = sinkOf();
      svc.watch('otto', sink);
      await vi.waitFor(() => expect(b.methods()).toContain('Page.startScreencast'));
      await advance(10);
      b.tab('Target.targetCreated', 'T2', 'http://localhost/b', 'B');
      await vi.waitFor(() => expect(b.calls.filter(c => c.method === 'Target.attachToTarget').map(c => c.params.targetId)).toContain('T2'));
      await vi.waitFor(() => expect(b.methods().filter(m => m === 'Page.startScreencast')).toHaveLength(2));
      svc.unwatchAll(sink);
      await vi.waitFor(() => expect(b.methods().filter(m => m === 'Page.stopScreencast')).toHaveLength(2));
      svc.stop();
    });

    it('a tab that sends no frame (standing still, or held hidden): one image every few seconds, marked live, never the same twice', async () => {
      const { svc, b } = await liveOtto();
      const { got, sink } = sinkOf();
      svc.watch('otto', sink);
      await vi.waitFor(() => expect(b.methods()).toContain('Page.startScreencast'));
      await advance(3100);
      await vi.waitFor(() => expect(got.filter(m => m.type === 'browser.frame' && m.live)).toHaveLength(1));
      expect(got.at(-1)).toMatchObject({ type: 'browser.frame', live: true });
      svc.stop();
    });

    it('an unknown session is « none »; watching a closed browser gives its last image', async () => {
      const { svc, b } = await liveOtto();
      const a = sinkOf();
      svc.watch('nobody', a.sink);
      expect(a.got).toEqual([{ type: 'browser.live', id: 'nobody', state: 'none', tabs: 0 }]);
      await advance(1100);
      b.gone();
      const c = sinkOf();
      svc.watch('otto', c.sink);
      expect(c.got.map(m => m.type === 'browser.frame' ? `frame:${m.live}` : m.state)).toEqual(['closed', 'frame:false']);
      expect(b.methods().filter(m => m === 'Page.startScreencast')).toEqual([]);
      svc.stop();
    });
  });
});

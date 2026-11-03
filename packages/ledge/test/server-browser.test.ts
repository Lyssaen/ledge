import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserFrame, BrowserLive, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import type { BrowserLiveService, BrowserSink } from '../src/daemon/browser/live.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

const tmux: Tmux = {
  async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
  async hasSession() { return true; }, async listSessions() { return ['ledge-a']; }, async setOption() {}, async killSession() {}, attachArgs: n => ['attach', n]
};
const session: Session = { id: 'a', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto', tmuxSession: 'ledge-a', state: 'working', helpers: [],
  startedAt: '2026-11-03T15:00:00.000Z', lastActivityAt: '2026-11-03T15:00:00.000Z', source: 'launcher' };
const LIVE: BrowserLive = { type: 'browser.live', id: 'a', state: 'live', tabs: 1, url: 'http://localhost:8733/m.html', title: 'Maquette', since: '2026-11-03T15:01:00.000Z' };

/** The service as the server drives it: what it was asked, and the fronts that watch. */
function fakeService() {
  const pokes: string[] = [], watched: [string, BrowserSink][] = [], gone: BrowserSink[] = [];
  const svc: BrowserLiveService = {
    tick: async () => {}, start() {}, stop() {},
    poke(id) { pokes.push(id); },
    watch(id, sink) { watched.push([id, sink]); sink(LIVE); },
    unwatch() {},
    unwatchAll(sink) { gone.push(sink); },
    states: () => [LIVE]
  };
  return { svc, pokes, watched, gone };
}

describe('server: the agent\'s browser, live', () => {
  let home: string, store: Store;
  beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); home = mkdtempSync(join(tmpdir(), 'ledge-home-')); store = new Store(); store.upsert(session); });

  it('says it knows the browser, sends each browser after the snapshot, then films for the front that watches', async () => {
    const f = fakeService();
    const srv = await startServer({ store, tmux, port: 0, home, browserLive: f.svc, daemon: { version: '0.41.0', install: 'npm', systemd: false } });
    const c = await connect({ port: srv.port });
    const snap = await c.next('snapshot') as { daemon?: { browserLive?: boolean } };
    expect(snap.daemon?.browserLive).toBe(true);
    expect(await c.next('browser.live')).toEqual(LIVE);
    c.send({ type: 'browser.watch', id: 'a' });
    expect(await c.next('browser.live')).toEqual(LIVE);
    const sink = f.watched[0]![1];
    const frame: BrowserFrame = { type: 'browser.frame', id: 'a', data: '/9j/frame', at: '2026-11-03T15:02:00.000Z', live: true, width: 1280, height: 800 };
    sink(frame);
    expect(await c.next('browser.frame')).toEqual(frame);
    // The front gone: it watches nothing any more.
    c.close();
    await vi.waitFor(() => expect(f.gone).toContain(sink));
    await srv.close();
  });

  it('the agent\'s Playwright tool, in its hooks, has its browser looked for at once; another tool does not', async () => {
    const f = fakeService();
    const srv = await startServer({ store, tmux, port: 0, home, browserLive: f.svc });
    const c = await connect({ port: srv.port });
    await c.next('snapshot');
    const ev = (name: string, tool: string) => c.send({ type: 'session.event', id: 'a', event: { name: name as 'PostToolUse', at: '2026-11-03T15:03:00.000Z', source: 'hook', tool } });
    ev('PostToolUse', 'Bash');
    ev('PreToolUse', 'mcp__plugin_playwright_playwright__browser_navigate');
    ev('PostToolUse', 'mcp__playwright__browser_click');
    await vi.waitFor(() => expect(f.pokes).toEqual(['a', 'a']));
    c.close(); await srv.close();
  });

  it('« Activer le direct » only with the person\'s confirmation, on the config Claude Code loads', async () => {
    const f = fakeService();
    const config = join(home, '.config', 'playwright-mcp', 'config.json');
    mkdirSync(join(home, '.claude')); mkdirSync(join(home, '.config', 'playwright-mcp'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { PLAYWRIGHT_MCP_CONFIG: '~/.config/playwright-mcp/config.json' } }));
    writeFileSync(config, '{"browser":{"launchOptions":{"args":["--disable-software-rasterizer"]}}}');
    const srv = await startServer({ store, tmux, port: 0, home, browserLive: f.svc });
    const c = await connect({ port: srv.port });
    await c.next('snapshot');
    c.send({ type: 'browser.enable', rid: 'r1' } as never);
    expect(await c.next('error')).toMatchObject({ code: 'invalid', request: 'browser.enable' });
    expect(readFileSync(config, 'utf8')).not.toContain('remote-debugging');
    c.send({ type: 'browser.enable', rid: 'r2', confirmed: true });
    expect(await c.next('browser.enabled')).toEqual({ type: 'browser.enabled', rid: 'r2', outcome: 'enabled', path: config });
    expect(JSON.parse(readFileSync(config, 'utf8')).browser.launchOptions.args).toEqual(['--disable-software-rasterizer', '--remote-debugging-port=0']);
    c.close(); await srv.close();
  });
});

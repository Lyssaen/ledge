import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paneHostClient } from '../src/panes/client.js';
import { startPaneHost, type PaneHost } from '../src/panes/host.js';
import { panehostPath } from '../src/panes/protocol.js';
import { usesPaneHost } from '../src/panes/pick.js';

const pty = await import('node-pty').then(() => true, () => false);
const TOKEN = 'c'.repeat(64);
const node = process.execPath;
const hosts: PaneHost[] = [];
const clients: Array<{ close(): void }> = [];
afterEach(async () => { for (const c of clients.splice(0)) c.close(); for (const h of hosts.splice(0)) await h.close(); });
const until = async (pred: () => boolean | Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return; await new Promise(r => setTimeout(r, 30)); }
  throw new Error('timeout');
};
const freshPath = () => panehostPath(process.platform, {}, mkdtempSync(join(tmpdir(), 'ledge-client-')));
/** `start` as the daemon's, but in this process: a host on `path`; a second one on a live path fails, as a second process would. */
const starter = (path: string, calls: { n: number }) => () => { calls.n++; void startPaneHost({ path, token: TOKEN }).then(h => { hosts.push(h); }, () => {}); };
const make = (path: string, calls: { n: number }) => { const c = paneHostClient({ path, token: () => TOKEN, start: starter(path, calls) }); clients.push(c); return c; };

describe('usesPaneHost', () => {
  it('on Windows, or when asked', () => {
    expect(usesPaneHost('win32', {})).toBe(true);
    expect(usesPaneHost('linux', { LEDGE_PANES: 'panehost' })).toBe(true);
    expect(usesPaneHost('linux', {})).toBe(false);
    expect(usesPaneHost('linux', { LEDGE_PANES: 'conpty' })).toBe(false);
  });
});

describe('paneHostClient', () => {
  it('starts the host when none answers', async () => {
    const path = freshPath(); const calls = { n: 0 };
    const c = make(path, calls);
    expect(await c.listSessions()).toEqual([]);
    expect(calls.n).toBe(1);
    expect(await c.hasSession('nope')).toBe(false);
    expect(calls.n).toBe(1);
  });

  it('says so when the host never comes', async () => {
    const path = freshPath();
    const c = paneHostClient({ path, token: () => TOKEN, start: () => {}, connectMs: 300 }); clients.push(c);
    await expect(c.listSessions()).rejects.toThrow('pane host not reachable');
  });

  it('a wrong token is refused', async () => {
    const path = freshPath(); const calls = { n: 0 };
    make(path, calls); await make(path, calls).listSessions();
    const bad = paneHostClient({ path, token: () => 'd'.repeat(64), start: () => {} }); clients.push(bad);
    await expect(bad.listSessions()).rejects.toThrow('unauthorized');
  });

  it('two clients starting at once share one host', async () => {
    const path = freshPath(); const calls = { n: 0 };
    const [a, b] = [make(path, calls), make(path, calls)];
    expect(await Promise.all([a.listSessions(), b.listSessions()])).toEqual([[], []]);
    await until(() => hosts.length >= 1);
    await new Promise(r => setTimeout(r, 200));
    expect(hosts.filter(h => !h.isClosed())).toHaveLength(1);
  });

  it('rejects in-flight requests when the host goes away, then reconnects', async () => {
    const path = freshPath(); const calls = { n: 0 };
    const c = make(path, calls);
    await c.listSessions();
    const pending = c.capture('x', 10);
    await hosts[0]!.close();
    await expect(pending).rejects.toThrow(/closed|not reachable/);
    expect(await c.listSessions()).toEqual([]);
    expect(calls.n).toBe(2);
  });

  it.skipIf(!pty)('drives a pane end to end', async () => {
    const path = freshPath(); const calls = { n: 0 };
    const c = make(path, calls);
    await c.newSession({ name: 'e', cwd: tmpdir(), env: process.env as Record<string, string>, command: [node, '-e', "process.stdin.setRawMode(true); let b=''; process.stdin.on('data', d => { b += d; if (b.includes('\\r')) { console.log('\\ngot:' + b.trim()); process.exit(4); } })"] });
    await new Promise(r => setTimeout(r, 400));
    await c.sendText('e', 'hi'); await c.sendKeys('e', ['Enter']);
    await until(async () => (await c.exitCode('e')) === 4);
    expect(await c.hasSession('e')).toBe(false);
  });
});

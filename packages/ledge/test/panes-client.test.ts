import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paneHostClient, startDetachedHost } from '../src/panes/client.js';
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
const freshPath = () => panehostPath(process.platform, mkdtempSync(join(tmpdir(), 'ledge-client-')), TOKEN);
/** `start` as the daemon's, but in this process: a host on `path`; a second one on a live path fails, as a second process would. */
const starter = (path: string, calls: { n: number }) => () => { calls.n++; void startPaneHost({ path, token: TOKEN }).then(h => { hosts.push(h); }, () => {}); };
const make = (path: string, calls: { n: number }) => { const c = paneHostClient({ path: () => path, token: () => TOKEN, start: starter(path, calls) }); clients.push(c); return c; };

describe('usesPaneHost', () => {
  it('on Windows, or when asked', () => {
    expect(usesPaneHost('win32', {})).toBe(true);
    expect(usesPaneHost('linux', { LEDGE_PANES: 'panehost' })).toBe(true);
    expect(usesPaneHost('linux', {})).toBe(false);
    expect(usesPaneHost('linux', { LEDGE_PANES: 'conpty' })).toBe(false);
  });
});

describe('startDetachedHost', () => {
  it('starts ledge panehost detached, in the Ledge folder (not the daemon\'s cwd, which an update may replace)', () => {
    const calls: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];
    startDetachedHost('/l/.ledge', ((cmd: string, args: string[], opts: Record<string, unknown>) => { calls.push({ cmd, args, opts }); return { unref() {} }; }) as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe(process.execPath);
    expect(calls[0]!.args.at(-1)).toBe('panehost');
    expect(calls[0]!.opts).toMatchObject({ cwd: '/l/.ledge', detached: true, stdio: 'ignore', windowsHide: true });
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
    const c = paneHostClient({ path: () => path, token: () => TOKEN, start: () => {}, connectMs: 300 }); clients.push(c);
    await expect(c.listSessions()).rejects.toThrow('pane host not reachable');
  });

  it('a client with another token and the host part at the first step', async () => {
    const path = freshPath(); const calls = { n: 0 };
    make(path, calls); await make(path, calls).listSessions();
    const bad = paneHostClient({ path: () => path, token: () => 'd'.repeat(64), start: () => {} }); clients.push(bad);
    // Holding another token, it sees a host that cannot prove its token: it stops there, before proving anything.
    await expect(bad.listSessions()).rejects.toThrow('pane host could not prove the token');
  });

  it('never gives the token to a socket that cannot prove it holds it (another account squatting the name)', async () => {
    const path = freshPath(); let heard = '';
    const squatter = createServer(sock => sock.on('data', d => {
      heard += String(d);
      for (const line of String(d).split('\n').filter(Boolean)) {
        const m = JSON.parse(line) as { id: number };
        sock.write(JSON.stringify({ id: m.id, ok: true, value: { protocol: 1, nonce: 'm'.repeat(32), proof: '0'.repeat(64) } }) + '\n');
      }
    }));
    await new Promise<void>(r => squatter.listen(path, r));
    const c = paneHostClient({ path: () => path, token: () => TOKEN, start: () => {} }); clients.push(c);
    await expect(c.listSessions()).rejects.toThrow('pane host could not prove the token');
    await new Promise(r => setTimeout(r, 100));
    expect(heard).not.toContain(TOKEN);
    expect(heard).not.toMatch(/"op":"(auth|newSession|sendText)"/);
    await new Promise<void>(r => squatter.close(() => r()));
  });

  it('a line it cannot read fails the connection, not the daemon', async () => {
    const path = freshPath();
    const garbage = createServer(sock => sock.on('data', () => sock.write('not json\n')));
    await new Promise<void>(r => garbage.listen(path, r));
    const c = paneHostClient({ path: () => path, token: () => TOKEN, start: () => {}, connectMs: 300 }); clients.push(c);
    await expect(c.listSessions()).rejects.toThrow();
    await new Promise<void>(r => garbage.close(() => r()));
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

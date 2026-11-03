import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attach } from '../src/cli/attach.js';
import { paneHostClient } from '../src/panes/client.js';
import { startPaneHost, type PaneHost } from '../src/panes/host.js';
import { panehostPath } from '../src/panes/protocol.js';

// `ledge attach` on the pane host (Windows): the pane streamed through the host, no tmux.
const pty = await import('node-pty').then(() => true, () => false);
const TOKEN = 'e'.repeat(64);
const node = process.execPath;
const ECHO = "process.stdin.setRawMode(true); let b=''; process.stdin.on('data', d => { b += d; if (b.includes('\\r')) { const t = b.trim(); b=''; console.log('\\ngot:' + t); if (t === 'quit') process.exit(5); } }); console.log('ready')";
let host: PaneHost | undefined;
afterEach(async () => { await host?.close(); host = undefined; });

async function setup() {
  const path = panehostPath(process.platform, mkdtempSync(join(tmpdir(), 'ledge-attach-')), TOKEN);
  host = await startPaneHost({ path, token: TOKEN });
  const client = paneHostClient({ path: () => path, token: () => TOKEN, start: () => {} });
  await client.newSession({ name: 'ledge-ab12', cwd: tmpdir(), env: process.env as Record<string, string>, command: [node, '-e', ECHO] });
  const end = Date.now() + 5000;
  while (Date.now() < end && !(await client.capture('ledge-ab12', 20))?.includes('ready')) await new Promise(r => setTimeout(r, 50));
  const input = new PassThrough(), output = new PassThrough();
  let seen = ''; output.on('data', d => { seen += String(d); });
  return { client, input, output, seen: () => seen };
}
const until = async (pred: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!pred()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 30)); } };

describe.skipIf(!pty)('ledge attach on the pane host', () => {
  it('attaches to a pane: the screen first, then typed input reaches the agent', async () => {
    const s = await setup();
    const done = attach('ab12', { paneHost: s.client, io: { input: s.input, output: s.output }, port: 1 });
    await until(() => s.seen().includes('ready'));
    s.input.write('hello\r');
    await until(() => s.seen().includes('got:hello'));
    s.input.write('quit\r');
    expect(await done).toBe(5);
  });

  it('attach ends when the pane ends, with the agent\'s exit code', async () => {
    const s = await setup();
    const done = attach('ab12', { paneHost: s.client, io: { input: s.input, output: s.output }, port: 1 });
    await until(() => s.seen().includes('ready'));
    await s.client.sendText('ledge-ab12', 'quit'); await s.client.sendKeys('ledge-ab12', ['Enter']);
    expect(await done).toBe(5);
  });

  it('--read-only sends no input', async () => {
    const s = await setup();
    const done = attach('ab12', { paneHost: s.client, io: { input: s.input, output: s.output }, readOnly: true, port: 1 });
    await until(() => s.seen().includes('ready'));
    s.input.write('typed\r');
    await new Promise(r => setTimeout(r, 400));
    expect(await s.client.capture('ledge-ab12', 20)).not.toContain('got:typed');
    await s.client.killSession('ledge-ab12');
    // A killed pane ends with what the OS gives it (0 after SIGKILL here, 1 after taskkill /F on Windows): attach passes it on.
    expect(await done).toEqual(expect.any(Number));
  });

  it('says there is no such session', async () => {
    const s = await setup();
    expect(await attach('zz99', { paneHost: s.client, io: { input: s.input, output: s.output }, port: 1 })).toBe(1);
  });
});

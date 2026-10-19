import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDaemonToken, hostAllowed, readDaemonToken, requestAuthorized, selectDaemonProtocol, tokenEquals } from '../src/auth.js';
import { paths } from '../src/paths.js';

describe('daemon token file', () => {
  beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-auth-')); });

  it('creates a 0600 token of 64 hex chars', async () => {
    await ensureDaemonToken();
    expect(statSync(paths().token).mode & 0o777).toBe(0o600);
    expect(readFileSync(paths().token, 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
  });

  it('keeps the same secret across starts', async () => {
    expect(await ensureDaemonToken()).toBe(await ensureDaemonToken());
  });

  it('replaces a malformed file', async () => {
    writeFileSync(paths().token, 'nope\n');
    const token = await ensureDaemonToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toBe('nope');
  });

  it('two concurrent starts publish one secret', async () => {
    const [a, b] = await Promise.all([ensureDaemonToken(), ensureDaemonToken()]);
    expect(a).toBe(b);
    expect(readFileSync(paths().token, 'utf8').trim()).toBe(a);
  });

  it('reads nothing from a bad file', () => {
    expect(readDaemonToken()).toBeUndefined();
    writeFileSync(paths().token, '');
    expect(readDaemonToken()).toBeUndefined();
    writeFileSync(paths().token, `${'a'.repeat(63)}\n`);
    expect(readDaemonToken()).toBeUndefined();
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-auth-'));
    mkdirSync(paths().token);
    expect(readDaemonToken()).toBeUndefined();
  });
});

describe('token comparison, host and request', () => {
  const t = 'cd'.repeat(32);

  it('compares tokens', () => {
    expect(tokenEquals(t, t)).toBe(true);
    expect(tokenEquals(t.slice(1), t)).toBe(false);
    expect(tokenEquals('', t)).toBe(false);
    expect(tokenEquals('x'.repeat(10_000), t)).toBe(false);
  });

  it('accepts loopback hosts only', () => {
    for (const h of ['localhost', '127.0.0.1:47831', '[::1]:47831', 'LOCALHOST']) expect(hostAllowed(h)).toBe(true);
    for (const h of [undefined, '', 'evil.example', '127.0.0.1.evil.example', 'localhost.', '[::1]x', '127.0.0.1:abc']) expect(hostAllowed(h)).toBe(false);
  });

  it('authorizes Bearer or subprotocol', () => {
    expect(requestAuthorized({ authorization: `Bearer ${t}` }, t)).toBe(true);
    expect(requestAuthorized({ 'sec-websocket-protocol': `ledge.${t}` }, t)).toBe(true);
    expect(requestAuthorized({ 'sec-websocket-protocol': `other, ledge.${t}` }, t)).toBe(true);
    expect(requestAuthorized({ authorization: 'Bearer wrong' }, t)).toBe(false);
    expect(requestAuthorized({ 'sec-websocket-protocol': 'ledge.wrong' }, t)).toBe(false);
    expect(requestAuthorized({}, t)).toBe(false);
  });

  it('echoes only the matching subprotocol', () => {
    expect(selectDaemonProtocol(new Set([`ledge.${t}`]), t)).toBe(`ledge.${t}`);
    expect(selectDaemonProtocol(new Set(['ledge.wrong']), t)).toBe(false);
    expect(selectDaemonProtocol(new Set(['other']), t)).toBe(false);
  });
});

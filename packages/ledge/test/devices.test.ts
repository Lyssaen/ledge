import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceStore, type StoredCredential } from '../src/daemon/devices.js';

const cred: StoredCredential = { id: 'cred1', publicKey: 'pk', counter: 0 };
let p: string; let store: DeviceStore;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-dev-'));
  process.env.LEDGE_HOME = dir;
  p = join(dir, 'devices.json');
  store = new DeviceStore({ path: p, now: () => '2026-10-14T18:00:00.000Z' });
});

describe('DeviceStore', () => {
  it('returns the token once and never writes it to disk', async () => {
    const { token, device } = await store.create('iPhone', cred);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(p, 'utf8')).not.toContain(token);
    expect(device.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(store.byToken(token)?.id).toBe(device.id);
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });
  it('an unknown token finds nothing', async () => {
    await store.create('iPhone', cred);
    expect(store.byToken('x'.repeat(43))).toBeUndefined();
    expect(store.byToken('')).toBeUndefined();
  });
  it('lists devices without secrets, with the key flag', async () => {
    await store.create('iPhone', cred);
    const [d] = store.list();
    expect(d).toEqual({ id: expect.any(String), name: 'iPhone', createdAt: '2026-10-14T18:00:00.000Z', hasKey: true });
  });
  it('revoke removes the device and its token; a second revoke is false', async () => {
    const { token, device } = await store.create('iPhone', cred);
    let changes = 0; store.onChange(() => { changes++; });
    expect(await store.revoke(device.id)).toBe(true);
    expect(store.byToken(token)).toBeUndefined();
    expect(store.list()).toEqual([]);
    expect(await store.revoke(device.id)).toBe(false);
    expect(changes).toBe(1);
  });
  it('touch and setCounter persist', async () => {
    const { device } = await store.create('iPhone', cred);
    await store.touch(device.id); await store.setCounter(device.id, 7);
    const again = new DeviceStore({ path: p }); await again.load();
    expect(again.get(device.id)).toMatchObject({ lastSeenAt: '2026-10-14T18:00:00.000Z', credential: { counter: 7 } });
  });
  it('keeps devices across a reload; a corrupt file starts empty and is logged', async () => {
    const { token, device } = await store.create('iPhone', cred);
    const again = new DeviceStore({ path: p }); await again.load();
    expect(again.byToken(token)?.id).toBe(device.id);
    writeFileSync(p, '{not json');
    const broken = new DeviceStore({ path: p }); await broken.load();
    expect(broken.list()).toEqual([]);
    expect(readFileSync(join(process.env.LEDGE_HOME!, 'daemon.log'), 'utf8')).toContain('devices file unreadable');
  });
  it('a missing file is an empty registry', async () => {
    await store.load();
    expect(store.list()).toEqual([]);
  });
});

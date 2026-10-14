import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { DeviceStore } from '../src/daemon/devices.js';
import { createPairing, PairError, type Pairing } from '../src/daemon/pairing.js';
import type { MobileConfig } from '../src/mobile/config.js';
import { createSoftAuthenticator } from './soft-authenticator.js';

const cfg: MobileConfig = { origin: 'https://pc.t.ts.net', rpID: 'pc.t.ts.net' };
const code = '482913';
let t: number; const now = () => t;
let config: MobileConfig | null;
let devices: DeviceStore; let pairing: Pairing;
const soft = () => createSoftAuthenticator(cfg);

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-pair-'));
  process.env.LEDGE_HOME = dir;
  t = Date.parse('2026-10-14T18:00:00.000Z');
  config = cfg;
  devices = new DeviceStore({ path: join(dir, 'devices.json') });
  pairing = createPairing({ config: () => config, devices, now, randomCode: () => code });
});

const reason = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (e instanceof PairError ? e.reason : `other: ${String(e)}`));

describe('pairing window', () => {
  it('begin gives six digits for 120 s and a /m/#/pair url', () => {
    const real = createPairing({ config: () => config, devices, now });
    const w = real.begin();
    expect(w.code).toMatch(/^\d{6}$/);
    expect(Date.parse(w.expiresAt) - now()).toBe(120_000);
    expect(w.url).toBe('https://pc.t.ts.net/m/#/pair');
  });

  it('begin without mobile config throws not_configured', () => {
    config = null;
    expect(() => pairing.begin()).toThrow(PairError);
    try { pairing.begin(); } catch (e) { expect((e as PairError).reason).toBe('not_configured'); }
  });

  it('no window before begin', async () => {
    expect(await reason(pairing.options(code))).toBe('no_window');
  });

  it('the fifth wrong code locks the window, even with the right code afterwards', async () => {
    pairing.begin();
    const got: string[] = [];
    for (let i = 0; i < 5; i++) got.push(await reason(pairing.options('000000')));
    expect(got).toEqual(['invalid_code', 'invalid_code', 'invalid_code', 'invalid_code', 'locked']);
    expect(await reason(pairing.options(code))).toBe('locked');
    expect(await reason(pairing.complete(code, 'iPhone', {}))).toBe('locked');
  });

  it('a new begin replaces a locked window', async () => {
    pairing.begin();
    for (let i = 0; i < 5; i++) await reason(pairing.options('000000'));
    pairing.begin();
    await expect(pairing.options(code)).resolves.toMatchObject({ expiresAt: '2026-10-14T18:02:00.000Z' });
  });

  it('wrong codes at complete count too', async () => {
    pairing.begin();
    for (let i = 0; i < 4; i++) await reason(pairing.options('000000'));
    expect(await reason(pairing.complete('111111', 'iPhone', {}))).toBe('locked');
  });

  it('an expired code is refused', async () => {
    pairing.begin();
    t += 120_000;
    await expect(pairing.options(code)).resolves.toBeTruthy();
    t += 1;
    expect(await reason(pairing.options(code))).toBe('expired');
  });

  it('registers the key, returns a token once, and the code cannot be reused', async () => {
    pairing.begin();
    const a = soft();
    const { options, expiresAt } = await pairing.options(code);
    expect(expiresAt).toBe('2026-10-14T18:02:00.000Z');
    expect(options).toMatchObject({ rp: { name: 'Ledge', id: 'pc.t.ts.net' }, attestation: 'none', timeout: 60_000, authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' } });
    const r = await pairing.complete(code, '  Mon iPhone  ', a.register(options));
    const dev = devices.byToken(r.token);
    expect(dev?.id).toBe(r.deviceId);
    expect(dev?.name).toBe('Mon iPhone');
    expect(dev?.credential.id).toBeTruthy();
    expect(await reason(pairing.options(code))).toBe('no_window');
    expect(await reason(pairing.complete(code, 'iPhone', a.register(options)))).toBe('no_window');
    expect(devices.list()).toHaveLength(1);
  });

  it('the stored key verifies a later assertion from the same authenticator', async () => {
    pairing.begin();
    const a = soft();
    const { options } = await pairing.options(code);
    const r = await pairing.complete(code, 'iPhone', a.register(options));
    const cred = devices.byToken(r.token)!.credential;
    const auth = await generateAuthenticationOptions({ rpID: cfg.rpID, userVerification: 'required' });
    const v = await verifyAuthenticationResponse({
      response: a.assert(auth), expectedChallenge: auth.challenge, expectedOrigin: cfg.origin, expectedRPID: cfg.rpID, requireUserVerification: true,
      credential: { id: cred.id, publicKey: isoBase64URL.toBuffer(cred.publicKey), counter: cred.counter }
    });
    expect(v.verified).toBe(true);
  });

  it('names are cut at 60 characters and default to iPhone', async () => {
    pairing.begin();
    let { options } = await pairing.options(code);
    const long = await pairing.complete(code, 'x'.repeat(80), soft().register(options));
    expect(devices.byToken(long.token)?.name).toBe('x'.repeat(60));
    pairing.begin();
    ({ options } = await pairing.options(code));
    const blank = await pairing.complete(code, '   ', soft().register(options));
    expect(devices.byToken(blank.token)?.name).toBe('iPhone');
  });

  it('complete needs the challenge issued by options for this window', async () => {
    pairing.begin();
    const { options } = await pairing.options(code);
    pairing.begin();
    expect(await reason(pairing.complete(code, 'iPhone', soft().register(options)))).toBe('webauthn_failed');
    expect(devices.list()).toEqual([]);
  });

  it('a challenge serves once: a failed complete needs new options', async () => {
    pairing.begin();
    const a = soft();
    const { options } = await pairing.options(code);
    expect(await reason(pairing.complete(code, 'iPhone', a.register(options, { uv: false })))).toBe('webauthn_failed');
    expect(await reason(pairing.complete(code, 'iPhone', a.register(options)))).toBe('webauthn_failed');
    const again = await pairing.options(code);
    await expect(pairing.complete(code, 'iPhone', a.register(again.options))).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('refuses a registration without user verification', async () => {
    pairing.begin();
    const { options } = await pairing.options(code);
    expect(await reason(pairing.complete(code, 'iPhone', soft().register(options, { uv: false })))).toBe('webauthn_failed');
    expect(devices.list()).toEqual([]);
  });

  it('refuses a registration made for another origin', async () => {
    pairing.begin();
    const { options } = await pairing.options(code);
    const evil = createSoftAuthenticator({ origin: 'https://evil.ts.net', rpID: cfg.rpID });
    expect(await reason(pairing.complete(code, 'iPhone', evil.register(options)))).toBe('webauthn_failed');
    const evilRp = createSoftAuthenticator({ origin: cfg.origin, rpID: 'evil.ts.net' });
    pairing.begin();
    const fresh = await pairing.options(code);
    expect(await reason(pairing.complete(code, 'iPhone', evilRp.register(fresh.options)))).toBe('webauthn_failed');
    expect(devices.list()).toEqual([]);
  });

  it('refuses a malformed registration', async () => {
    pairing.begin();
    await pairing.options(code);
    expect(await reason(pairing.complete(code, 'iPhone', { id: 'x' }))).toBe('webauthn_failed');
    expect(devices.list()).toEqual([]);
  });
});

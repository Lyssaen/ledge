// Passkey recovery through the mobile service over the real relay: a reinstalled app comes back as the same device.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { b64u, fingerprint, randomNonce, recoverChallenge, recoveryUserId } from '@ledge/seal';
import type { MobileRecoveryEvent, SealedFrame } from '@ledge/protocol';
import { createMobileService, type MobileService } from '../src/mobile/service.js';
import { readDevices, readRecovery, writeMobileConfig, writeRelaySession } from '../src/mobile/files.js';
import { deviceChatDir } from '../src/chat/threads.js';
import { paths } from '../src/paths.js';
import { startTestRelay, TEST_ACCOUNT } from './mobile-relay-harness.js';
import { fakeDevice, type FakeDevice } from './mobile-fake-device.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';

const OLD_PEER = 'd_aaaaaaaaaaaaaaaa';
const NEW_PEER = 'd_cccccccccccccccc';

async function until(cond: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 5));
  }
}

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  let s = '';
  for await (const c of req) s += String(c);
  return s ? JSON.parse(s) : undefined;
};

const cleanups: Array<() => Promise<void> | void> = [];
const ledgeHome = process.env.LEDGE_HOME;
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-recover-')); });
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  if (ledgeHome === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = ledgeHome;
});

/** The service on the real relay (as `localhost`, so a passkey has a relying party), an iPad paired with a recovery passkey, then gone. */
async function reinstalled() {
  const revoked: string[] = [];
  const relay = await startTestRelay({
    auth: async (req, res, control) => {
      if (req.method !== 'POST' || new URL(req.url ?? '/', 'http://relay').pathname !== '/auth/devices/revoke') return false;
      const { peer } = (await readBody(req)) as { peer: string };
      revoked.push(peer);
      control.kick(TEST_ACCOUNT, peer as `d_${string}`, 4001, 'signed_out');
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"revoked":1}');
      return true;
    }
  });
  cleanups.push(() => relay.relay.close());
  const pcUrl = relay.url.replace('127.0.0.1', 'localhost');
  writeMobileConfig({ enabled: true, relayUrl: pcUrl });
  writeRelaySession({ token: relay.pcToken, accountId: TEST_ACCOUNT, login: 'octocat', relayUrl: pcUrl });
  const s: MobileService = await createMobileService();
  cleanups.push(() => s.stop());
  await until(() => s.state().link.state === 'online', 'link online');
  const events: MobileRecoveryEvent[] = [];
  s.onRecovery(e => events.push(e));

  const old = await fakeDevice({ relayUrl: relay.url, token: relay.deviceToken(OLD_PEER), peer: OLD_PEER, label: 'iPad' });
  cleanups.push(() => old.close());
  const { result } = await old.pair();
  await until(() => s.state().pairings[0]?.state === 'confirm', 'pairing to confirm');
  await s.handle({ type: 'mobile.pairing.approve', id: s.state().pairings[0]!.id });
  expect(await result).toBe('ok');
  await old.hello();
  const oldId = await fingerprint(old.publicKey);
  await until(() => s.state().devices[0]?.online === true, 'iPad linked');

  // What the iPad was on the PC: a name, a passkey made for this PC, a thread with Ledge.
  const rp = { rpId: 'localhost', origin: new URL(pcUrl).origin };
  const passkey = softAuthenticator();
  s.setCredential(oldId, { id: passkey.id, publicKey: passkey.publicKey, alg: -7, counter: 0, rpId: rp.rpId, recover: true });
  s.rename(oldId, 'iPad de G');
  const chat = deviceChatDir(paths().dir, oldId);
  mkdirSync(chat, { recursive: true });
  writeFileSync(join(chat, 'turns.json'), '[]');
  expect(s.state().devices[0]).toMatchObject({ id: oldId, recover: true });

  // The app is deleted: its socket goes, and so does its key.
  old.close();
  await until(() => s.state().devices[0]?.online === false, 'iPad offline');

  const app = await fakeDevice({ relayUrl: relay.url, token: relay.deviceToken(NEW_PEER), peer: NEW_PEER, pcPublicKey: s.pcKey() });
  cleanups.push(() => app.close());
  const userHandle = b64u(await recoveryUserId(s.pcKey()));
  /** The reinstalled app's recovery, as the phone runs it. */
  const recover = async (model?: string): Promise<SealedFrame> => {
    const n = randomNonce();
    const offer = app.waitFor('recover_offer');
    app.sendFrame({ k: 'recover_start', d: app.publicKey, n, ...(model ? { model } : {}) });
    const o = await offer;
    const challenge = await recoverChallenge({ pcPublicKey: o.pc, devicePublicKey: app.publicKey, pcNonce: o.n, deviceNonce: n });
    const done = Promise.race([app.waitFor('recover_ok'), app.waitFor('recover_no')]);
    app.sendFrame({ k: 'recover_proof', assertion: passkey.get(rp, challenge, { counter: 1 }), userHandle });
    return done;
  };
  return { s, relay, revoked, events, old, oldId, app, recover, chat, passkey };
}

describe('passkey recovery through the service', () => {
  it('the reinstalled app comes back as the same device: its name, its passkey, its thread; the old app\'s peer revoked, no tombstone', async () => {
    const t = await reinstalled();
    expect(await t.recover('iPad')).toEqual({ k: 'recover_ok', name: 'iPad de G' });
    const newId = await fingerprint(t.app.publicKey);

    const [d, ...rest] = readDevices();
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ id: newId, publicKey: t.app.publicKey, label: 'iPad', name: 'iPad de G', lastPeer: NEW_PEER, peers: [NEW_PEER],
      credential: { id: t.passkey.id, counter: 1, recover: true }, recovered: { model: 'iPad', pending: true } });
    expect(d).not.toHaveProperty('push');
    expect(existsSync(t.chat)).toBe(false);
    expect(readFileSync(join(deviceChatDir(paths().dir, newId), 'turns.json'), 'utf8')).toBe('[]');
    await until(() => t.revoked.length === 1, 'old peer revoked');
    expect(t.revoked).toEqual([OLD_PEER]);
    expect(readRecovery().tombstones).toEqual([]);
    expect(t.events).toEqual([{ event: 'recovered', id: newId, at: d!.recovered!.at }]);
    expect(t.s.state().devices).toEqual([expect.objectContaining({ id: newId, recover: true, recovered: { at: d!.recovered!.at, model: 'iPad', pending: true } })]);

    // It pins the PC key and says hello as any approved device.
    await t.app.hello();
    await until(() => t.s.state().devices[0]?.online === true, 'back online');

    // « C'était bien moi »: the notice goes, the trace stays.
    await t.s.handle({ type: 'mobile.device.ack', id: newId, what: 'recovered' });
    expect(t.s.state().devices[0]!.recovered).toEqual({ at: d!.recovered!.at, model: 'iPad' });

    // Revoked afterwards, its passkey is remembered for « révoqué le … ».
    await t.s.handle({ type: 'mobile.device.revoke', id: newId });
    expect(readRecovery().tombstones).toEqual([{ credentialId: t.passkey.id, device: 'iPad de G', revokedAt: expect.any(String) }]);
  });

  it('connected: while the iPad is online, another app with its passkey is refused, and the PC keeps a notice until « Compris »', async () => {
    const t = await reinstalled();
    // The iPad is back on its old app: online again.
    const again = await fakeDevice({ relayUrl: t.relay.url, token: t.relay.deviceToken(OLD_PEER), peer: OLD_PEER, pcPublicKey: t.s.pcKey(), identity: t.old.identity });
    cleanups.push(() => again.close());
    await again.hello();
    await until(() => t.s.state().devices[0]?.online === true, 'iPad online');

    expect(await t.recover('iPhone')).toEqual({ k: 'recover_no', why: 'connected', device: 'iPad de G' });
    expect(readDevices().map(x => x.id)).toEqual([t.oldId]);
    expect(t.s.state().devices[0]!.refused).toEqual({ at: expect.any(String), model: 'iPhone' });
    expect(t.events).toEqual([{ event: 'refused', id: t.oldId, at: expect.any(String) }]);
    await t.s.handle({ type: 'mobile.device.ack', id: t.oldId, what: 'refused' });
    expect(t.s.state().devices[0]).not.toHaveProperty('refused');
  });

  it('blocked: the state shows the block and the event is heard; « Débloquer » lifts it', async () => {
    const t = await reinstalled();
    const wrong = softAuthenticator();
    for (let i = 0; i < 3; i++) {
      const n = randomNonce();
      const offer = t.app.waitFor('recover_offer');
      t.app.sendFrame({ k: 'recover_start', d: t.app.publicKey, n });
      const o = await offer;
      const challenge = await recoverChallenge({ pcPublicKey: o.pc, devicePublicKey: t.app.publicKey, pcNonce: o.n, deviceNonce: n });
      const no = t.app.waitFor('recover_no');
      t.app.sendFrame({ k: 'recover_proof', assertion: { ...wrong.get({ rpId: 'localhost', origin: 'x' }, challenge), id: t.passkey.id }, userHandle: b64u(await recoveryUserId(t.s.pcKey())) });
      await no;
    }
    expect(t.app.frames.filter(f => f.k === 'recover_no').map(f => (f as { why: string }).why)).toEqual(['failed', 'failed', 'blocked']);
    expect(t.s.state().recovery).toEqual({ blocked: { since: expect.any(String), failures: 3 } });
    expect(t.events.map(e => e.event)).toEqual(['blocked']);
    await t.s.handle({ type: 'mobile.recovery.unblock' });
    expect(t.s.state()).not.toHaveProperty('recovery');
    expect(await t.recover()).toMatchObject({ k: 'recover_ok' });
  });
});

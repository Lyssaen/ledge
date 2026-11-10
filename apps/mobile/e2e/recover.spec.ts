// A reinstalled app back with its passkey (docs/mockups/ledge-mobile-passkey/passkey-reinstall.html): Chromium's virtual
// authenticator keeps the passkey as iOS's keychain would, the app's keys are wiped as a reinstall wipes them, and the fake
// PC answers the recovery frames as the daemon would (it does not verify the proof: packages/ledge tests do).
// SHOTS=<dir> saves a capture of each screen there.
import { generateKeyPairSync } from 'node:crypto';
import { devices, expect, test, type CDPSession, type Page } from '@playwright/test';
import type { SealedFrame } from '@ledge/protocol';
import { b64u, userHandleMatches } from '@ledge/seal';
import { copy } from '../src/copy';
import { PC_NAME, startHarness, type Harness } from './harness';

const { defaultBrowserType: _phone, ...iPhone13 } = devices['iPhone 13'];
test.use(iPhone13);

let h: Harness;
test.beforeEach(async () => { h = await startHarness(); });
test.afterEach(async () => { await h.close(); });

async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/recover-${name}.png` });
}

/** Deleting the app on iOS: its key store and its storage are gone, the relay's cookie and the passkey are not. */
async function reinstall(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase('ledge'); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: copy.recover.title('iPhone') })).toBeVisible();
}

/** Signs in, pairs with a code, and protects the accepts: the passkey is made, its user.id naming the PC's key. */
async function pairAndEnrol(page: Page, cdp: CDPSession) {
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true }
  });
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  await page.getByRole('button', { name: copy.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await page.getByRole('button', { name: copy.enroll.go }).click();
  await expect(page.getByText(copy.enroll.done)).toBeVisible();
  return authenticatorId;
}

/** Taps « Se reconnecter avec ma passkey » and answers the start with an offer; resolves with the proof the phone sent. */
async function recoverUntilProof(page: Page): Promise<Extract<SealedFrame, { k: 'recover_proof' }>> {
  const start = h.pc.waitFor('recover_start');
  await page.getByRole('button', { name: copy.recover.go }).click();
  await start;
  const proof = h.pc.waitFor('recover_proof', 8_000);
  h.pc.recoverOffer(PC_NAME);
  return proof;
}

test('a reinstalled iPhone comes back with its passkey, without a code', async ({ page }) => {
  test.setTimeout(90_000);
  const cdp = await page.context().newCDPSession(page);
  await pairAndEnrol(page, cdp);
  await page.getByRole('link', { name: copy.compare.seePending }).click();

  await test.step('the app reinstalled: the choice, the passkey first', async () => {
    await reinstall(page);
    await expect(page.getByRole('button')).toHaveText([copy.recover.go, copy.recover.code]);
    await shot(page, 'choose');
  });

  await test.step('the passkey names this PC: the proof leaves, the PC takes the device back, the app is linked', async () => {
    const proof = await recoverUntilProof(page);
    expect(await userHandleMatches(proof.userHandle, h.pc.identity.publicKey)).toBe('ok');
    expect(h.pc.recoverStart).toMatchObject({ model: 'iPhone' });
    h.pc.recoverOk('iPhone');
    await expect(page.getByRole('heading', { name: copy.recover.done.title('iPhone', PC_NAME) })).toBeVisible();
    await expect(page.getByText(copy.recover.done.told(PC_NAME))).toBeVisible();
    await shot(page, 'done');
    await page.getByRole('link', { name: copy.notifications.later }).click();
    await expect(page.getByRole('heading', { name: copy.inbox.title })).toBeVisible();
    await expect.poll(() => h.pc.ready).toBe(true);
  });
});

test('each way a recovery stops: nothing pinned, and the way out offered', async ({ page }) => {
  test.setTimeout(120_000);
  const cdp = await page.context().newCDPSession(page);
  const authenticatorId = await pairAndEnrol(page, cdp);
  await page.getByRole('link', { name: copy.compare.seePending }).click();
  const alert = () => page.getByRole('alert');

  await test.step('the PC refuses: its reason, with its data', async () => {
    const refusals: Array<[SealedFrame, string, string]> = [
      [{ k: 'recover_no', why: 'connected', device: 'iPad' }, copy.recover.no.connected.title('iPad'), 'connected'],
      [{ k: 'recover_no', why: 'revoked', device: 'iPhone', revokedAt: '2026-11-03T10:00:00.000Z' }, copy.recover.no.revoked.title('iPhone'), 'revoked'],
      [{ k: 'recover_no', why: 'blocked' }, copy.recover.no.blocked.title(PC_NAME), 'blocked'],
      [{ k: 'recover_no', why: 'failed' }, copy.recover.no.timeout.title(PC_NAME), 'timeout']
    ];
    for (const [no, title, name] of refusals) {
      await reinstall(page);
      await recoverUntilProof(page);
      h.pc.sendFrame(no);
      await expect(alert().getByRole('heading', { name: title })).toBeVisible();
      await shot(page, name);
    }
    // Rate comes in answer to the start, before any offer.
    await reinstall(page);
    const start = h.pc.waitFor('recover_start');
    await page.getByRole('button', { name: copy.recover.go }).click();
    await start;
    h.pc.sendFrame({ k: 'recover_no', why: 'rate', retryInMs: 2_520_000 });
    await expect(page.getByRole('button', { name: copy.recover.no.rate.retryIn(42) })).toBeDisabled();
    await shot(page, 'rate');
  });

  await test.step('Face ID refused: « Aucune passkey n’a été utilisée », nothing sent', async () => {
    await reinstall(page);
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    const start = h.pc.waitFor('recover_start');
    await page.getByRole('button', { name: copy.recover.go }).click();
    await start;
    const proofs = h.pc.frames.filter(f => f.k === 'recover_proof').length;
    h.pc.recoverOffer(PC_NAME);
    await expect(alert().getByRole('heading', { name: copy.recover.no.none.title })).toBeVisible();
    expect(h.pc.frames.filter(f => f.k === 'recover_proof')).toHaveLength(proofs);
    await shot(page, 'none');
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
  });

  await test.step('an old passkey (no « L1 ») and one made for another PC: the phone stops before sending', async () => {
    const pkcs8 = () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const cases: Array<[Uint8Array, string, string]> = [
      [new Uint8Array(16).fill(7), copy.recover.no.old.title, 'old'],
      [new Uint8Array([0x4c, 0x31, ...new Uint8Array(32).fill(9)]), copy.recover.no.otherPc.title(PC_NAME), 'other-pc']
    ];
    for (const [handle, title, name] of cases) {
      await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
      await cdp.send('WebAuthn.addCredential', {
        authenticatorId,
        credential: { credentialId: b64u(new Uint8Array([1, 2, 3, handle.length])), isResidentCredential: true, rpId: new URL(h.url).hostname, privateKey: pkcs8(), userHandle: Buffer.from(handle).toString('base64'), signCount: 0 }
      });
      await reinstall(page);
      const proofs = h.pc.frames.filter(f => f.k === 'recover_proof').length;
      const start = h.pc.waitFor('recover_start');
      await page.getByRole('button', { name: copy.recover.go }).click();
      await start;
      h.pc.recoverOffer(PC_NAME);
      await expect(alert().getByRole('heading', { name: title })).toBeVisible();
      expect(h.pc.frames.filter(f => f.k === 'recover_proof')).toHaveLength(proofs);
      await shot(page, name);
    }
  });

  await test.step('the PC offline: said before any Face ID, and the recovery starts again once it is back', async () => {
    await reinstall(page);
    await h.pc.disconnect();
    await page.getByRole('button', { name: copy.recover.go }).click();
    await expect(alert().getByRole('heading', { name: copy.recover.no.offline.title(copy.yourPc) })).toBeVisible();
    await shot(page, 'offline');
    const start = h.pc.waitFor('recover_start', 15_000);
    await h.pc.reconnect();
    await start;
  });
});

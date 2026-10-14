import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { fakeDaemon, session } from './daemon';

const TOKEN_KEY = 'ledge.mobile.token';
// WebAuthn needs a real RP ID: an IP address is not one, `localhost` is.
const ORIGIN = 'http://localhost:5299';

const high = (id: string, extra: Partial<NonNullable<Session['pending']>> = {}): Session => {
  const since = new Date(Date.now() - 3 * 60_000).toISOString();
  return session(id, {
    state: 'waiting_permission', name: 'Kai', topic: 'Publication du site', repo: 'ledge-site', branch: 'main', lastActivityAt: since,
    pending: { id: `p-${id}`, version: 1, since, kind: 'permission', text: 'git push --force origin main', source: 'hook', risk: 'high', riskReason: 'pushes', ...extra }
  });
};
const handled = (s: Session): Session => { const { pending: _p, ...rest } = s; return { ...rest, state: 'working' }; };
const of = (received: unknown[], type: string) => received.filter((m): m is Record<string, unknown> => (m as { type?: string }).type === type);

async function authenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { cdp, authenticatorId };
}
/** A passkey for localhost, and the options the daemon would send to use it. */
async function passkeyOptions(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const cred = await navigator.credentials.create({ publicKey: { challenge: new Uint8Array(32), rp: { id: 'localhost', name: 'Ledge' }, user: { id: new Uint8Array(8), name: 'iphone', displayName: 'iPhone' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' } } }) as PublicKeyCredential;
    return { challenge: b64(crypto.getRandomValues(new Uint8Array(32)).buffer), rpId: 'localhost', allowCredentials: [{ id: b64(cred.rawId), type: 'public-key' }], userVerification: 'required', timeout: 60000 };
  });
}
const noOverflow = async (page: Page) => {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
};

async function setup(page: Page, id: string, expiresIn = 60_000) {
  await page.addInitScript(k => localStorage.setItem(k, 't'.repeat(43)), TOKEN_KEY);
  const s = high(id);
  const d = await fakeDaemon(page, [s]);
  await page.goto(`${ORIGIN}/m/#/request/${id}/p-${id}`);
  const device = await authenticator(page);
  const options = await passkeyOptions(page);
  d.onMessage(m => {
    if (m.type === 'decide.prepare') d.send({ type: 'decide.challenge', id: m.id, pendingId: m.pendingId, pendingVersion: m.pendingVersion, decision: 'accept', options, expiresAt: new Date(Date.now() + expiresIn).toISOString() });
    if (m.type === 'session.decide') d.send({ type: 'operation.received', operationId: m.operationId });
  });
  return { s, d, options, device };
}

for (const width of [320, 390, 430]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height: 800 }); });

    test('the consequence is visible in the detail and repeated in the dialog', async ({ page }) => {
      const { d } = await setup(page, 'c');
      await expect(page.getByText('Peut remplacer l’historique distant')).toBeVisible();
      await expect(page.getByText('origin/main', { exact: true })).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/risk-detail-${width}.png` });
      await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
      const dialog = page.getByRole('dialog', { name: 'Confirmer : Peut remplacer l’historique distant' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Autoriser ce push forcé ?' })).toBeVisible();
      await expect(dialog.getByText('Kai · Publication du site · ledge-site')).toBeVisible();
      await expect(dialog.getByText('Peut remplacer l’historique distant')).toBeVisible();
      await expect(dialog.getByText('git push --force origin main')).toBeVisible();
      await expect(dialog.getByText('Une vérification sur votre appareil sera demandée. Elle confirme votre identité, pas la sûreté de la commande.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Confirmer avec mon appareil' })).toBeEnabled();
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/risk-dialog-${width}.png` });
      expect(of(d.received, 'session.decide')).toHaveLength(0);
    });
  });
}

test('the dialog fits a 320 x 568 screen: both buttons reachable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await setup(page, 'small');
  await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Confirmer avec mon appareil' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Revenir à la demande' }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Revenir à la demande' })).toBeInViewport();
  await noOverflow(page);
  await page.screenshot({ path: 'e2e/shots/risk-dialog-320x568.png' });
});

test('closing the confirmation sends nothing and leaves the request pending', async ({ page }) => {
  const { d } = await setup(page, 'close');
  await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Fermer la confirmation' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
  await page.getByRole('button', { name: 'Revenir à la demande' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vérifier et autoriser' })).toBeVisible();
  expect(of(d.received, 'session.decide')).toHaveLength(0);
});

test('cancelled device verification sends no decision', async ({ page }) => {
  const { d, device } = await setup(page, 'cancel');
  // the virtual authenticator fails user verification: the browser raises NotAllowedError
  await device.cdp.send('WebAuthn.setUserVerified', { authenticatorId: device.authenticatorId, isUserVerified: false });
  await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
  await page.getByRole('button', { name: 'Confirmer avec mon appareil' }).click();
  await expect(page.getByText('Vérification annulée. Rien n’a été envoyé.')).toBeVisible();
  expect(of(d.received, 'session.decide')).toHaveLength(0);
  await page.screenshot({ path: 'e2e/shots/risk-cancelled-390.png' });
  await expect(page.getByRole('button', { name: 'Confirmer avec mon appareil' })).toBeEnabled();
});

test('confirm sends decide.prepare then one decide with an assertion', async ({ page }) => {
  const { s, d } = await setup(page, 'ok');
  await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
  await expect.poll(() => of(d.received, 'decide.prepare').length).toBe(1);
  expect(of(d.received, 'decide.prepare')[0]).toMatchObject({ id: 'ok', pendingId: 'p-ok', pendingVersion: 1, decision: 'accept' });
  await page.getByRole('button', { name: 'Confirmer avec mon appareil' }).click();
  await expect(page.getByText('Transmission au PC…')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(of(d.received, 'session.decide')).toHaveLength(1);
  const m = of(d.received, 'session.decide')[0]!;
  expect(m).toMatchObject({ id: 'ok', decision: 'accept', pendingId: 'p-ok', pendingVersion: 1 });
  expect(m.assertion).toMatchObject({ type: 'public-key', response: { authenticatorData: expect.any(String), clientDataJSON: expect.any(String), signature: expect.any(String) } });
  d.upsert(handled(s));
  d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' });
  await expect(page.getByRole('heading', { level: 1, name: 'Autorisation prise en compte' })).toBeVisible();
  expect(of(d.received, 'session.decide')).toHaveLength(1);
});

test('a challenge that expired while held is not used: a new one is requested and another tap is required', async ({ page }) => {
  const { d } = await setup(page, 'old', 1500);
  await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
  await expect(page.getByRole('button', { name: 'Confirmer avec mon appareil' })).toBeEnabled();
  await page.waitForTimeout(1700);
  await page.getByRole('button', { name: 'Confirmer avec mon appareil' }).click();
  await expect(page.getByText('La vérification a expiré. Recommencez.')).toBeVisible();
  expect(of(d.received, 'decide.prepare')).toHaveLength(2);
  expect(of(d.received, 'session.decide')).toHaveLength(0);
  await expect(page.getByRole('dialog')).toBeVisible();
});

for (const [reason, text] of [['assertion_expired', 'La vérification a expiré. Recommencez.'], ['assertion_invalid', 'La vérification n’a pas été acceptée par le PC.']] as const) {
  test(`${reason} from the PC is readable and the request stays pending with a new challenge on demand`, async ({ page }) => {
    const { d } = await setup(page, `r-${reason}`);
    await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
    await page.getByRole('button', { name: 'Confirmer avec mon appareil' }).click();
    await expect.poll(() => of(d.received, 'session.decide').length).toBe(1);
    d.send({ type: 'operation.result', operationId: of(d.received, 'session.decide')[0]!.operationId, status: 'rejected', reason });
    await expect(page.getByText(text)).toBeVisible();
    await page.screenshot({ path: `e2e/shots/risk-${reason}-390.png` });
    await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
    await expect.poll(() => of(d.received, 'decide.prepare').length).toBe(2);
    await page.getByRole('button', { name: 'Confirmer avec mon appareil' }).click();
    await expect.poll(() => of(d.received, 'session.decide').length).toBe(2);
    expect(of(d.received, 'session.decide')[1]!.operationId).not.toBe(of(d.received, 'session.decide')[0]!.operationId);
  });
}

test('a refused prepare shows a message and can be retried', async ({ page }) => {
  const { d } = await setup(page, 'err');
  d.onMessage(m => { if (m.type === 'decide.prepare') d.send({ type: 'error', id: m.id, message: 'invalid' }); });
  await page.getByRole('button', { name: 'Vérifier et autoriser' }).click();
  await expect(page.getByText('La vérification n’a pas pu être préparée. Rien n’a été envoyé.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmer avec mon appareil' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect.poll(() => of(d.received, 'decide.prepare').length).toBe(2);
  expect(of(d.received, 'session.decide')).toHaveLength(0);
});

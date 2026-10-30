// Closing a session from its page, then resuming it, end to end: the passkey made after pairing signs the PC's challenge
// over the session. Chromium's virtual authenticator (CDP) stands for Face ID; the fake PC checks each assertion with
// the daemon's own verifyAssertion, over the relay served at http://localhost:<port> (rpId = 'localhost').
import { devices, expect, test, type Page } from '@playwright/test';
import type { PhoneClientMessage } from '@ledge/protocol';
import { copy } from '../src/copy';
import { createDeviceCheck } from '../test/fakePc';
import { startHarness, waiting, type Harness } from './harness';

const { defaultBrowserType: _chromium, ...pixel } = devices['Pixel 7'];
test.use(pixel);
test.skip(({ browserName }) => browserName !== 'chromium', 'The virtual authenticator is a Chromium DevTools feature');

let h: Harness;
test.beforeAll(async () => {
  h = await startHarness();
  h.daemon.device = createDeviceCheck(h.url);
  h.daemon.sessionClose = true;
  // Otto, free: nothing for the close to cut.
  const { pending: _none, ...free } = waiting();
  h.daemon.sessions = [{ ...free, state: 'idle', topic: 'Pagination de /invoices' }];
});
test.afterAll(async () => { await h?.close(); });

const sent = <T extends PhoneClientMessage['type']>(type: T) => h.pc.received.map((t) => JSON.parse(t) as PhoneClientMessage)
  .filter((m): m is Extract<PhoneClientMessage, { type: T }> => m.type === type);
const S = copy.sessionEnd;
const sheet = (page: Page, title: string) => page.getByRole('dialog', { name: title });

test('a session closed from its page with the passkey, read as ended in the list, then resumed on its conversation', async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  let signedIn = false;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const before = !signedIn && (text.startsWith('WebSocket connection to ') || (text.startsWith('Failed to load resource: ') && m.location().url.endsWith('/auth/me')));
    if (!before) problems.push(`console: ${text} (${m.location().url})`);
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true }
  });

  await test.step('pair, then protect the accepts with a passkey', async () => {
    await page.goto(h.url);
    await page.getByRole('link', { name: copy.login.github }).click();
    const code = await h.pc.code();
    await expect(page.getByLabel(copy.compare.codeLabel(code))).toBeVisible();
    signedIn = true;
    await page.getByRole('button', { name: copy.compare.same }).click();
    h.pc.ok();
    await page.getByRole('button', { name: copy.enroll.go }).click();
    await expect(page.getByText(copy.enroll.done)).toBeVisible();
    expect(h.daemon.device?.registered).toBe(true);
    await page.getByRole('link', { name: copy.compare.seePending }).click();
    await page.getByRole('link', { name: copy.nav.agents, exact: true }).click();
    await page.getByRole('link', { name: /Pagination de \/invoices/ }).click();
  });

  await test.step('a cancelled check on the device sends nothing', async () => {
    await page.getByRole('button', { name: S.close('Otto') }).click();
    await expect(sheet(page, S.closeTitle('Otto'))).toBeVisible();
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await page.getByRole('button', { name: S.goClose }).click();
    await expect(page.getByText(copy.confirm.cancelled)).toBeVisible();
    expect(sent('session.close')).toEqual([]);
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
    await page.getByRole('button', { name: S.cancel }).click();
    await expect(sheet(page, S.closeTitle('Otto'))).toBeHidden();
  });

  await test.step('Fermer → the device → the PC verifies the assertion and closes; the page says the session ended', async () => {
    await page.getByRole('button', { name: S.close('Otto') }).click();
    await page.getByRole('button', { name: S.goClose }).click();
    await expect(page.getByRole('heading', { name: S.ended })).toBeVisible();
    expect(h.daemon.ended).toEqual(['s1']);
    expect(sent('session.close')).toMatchObject([{ id: 's1', assertion: { id: expect.any(String) } }]);
    await expect(page.getByRole('button', { name: S.close('Otto') })).toBeHidden();
    await expect(page.getByText(/^Session fermée depuis le téléphone · \d\d:\d\d$/)).toBeVisible();
  });

  await test.step('the list reads « Terminée » with the time it ended, and offers no resume of its own', async () => {
    await page.getByRole('link', { name: copy.thread.back }).click();
    await expect(page.getByText(copy.agents.state.exited)).toBeVisible();
    await expect(page.getByText(/^à \d\d:\d\d$/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Reprendre/ })).toHaveCount(0);
  });

  await test.step('Reprendre → the device → the PC resumes it, and the composer is back', async () => {
    await page.getByRole('link', { name: /Pagination de \/invoices/ }).click();
    await page.getByRole('button', { name: S.resume('Otto') }).click();
    await page.getByRole('button', { name: S.goResume }).click();
    await expect(page.getByRole('textbox')).toBeVisible();
    expect(h.daemon.resumed).toEqual(['s1']);
    await expect(page.getByRole('button', { name: S.close('Otto') })).toBeVisible();
  });

  await test.step('no error in the browser console', async () => {
    expect(problems).toEqual([]);
  });
});

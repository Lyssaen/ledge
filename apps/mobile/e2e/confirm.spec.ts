// Device confirmation end to end: the phone makes a passkey after pairing and confirms a high-impact accept with it.
// Chromium's virtual authenticator (CDP) stands for Face ID; the fake PC checks the result with the daemon's own
// verifyRegistration / verifyAssertion, over the relay served at http://localhost:<port> (rpId = 'localhost').
import { devices, expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import type { PhoneClientMessage, PhoneSession } from '@ledge/protocol';
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
});
test.afterAll(async () => { await h?.close(); });

const decides = () => h.pc.received.map((t) => JSON.parse(t) as PhoneClientMessage)
  .filter((m): m is Extract<PhoneClientMessage, { type: 'session.decide' }> => m.type === 'session.decide');

/** A request that destroys: the PC wants the device's check for its accept. */
const high = (key: string, text: string): PhoneSession => ({
  ...waiting(),
  pending: { key, kind: 'permission', text, source: 'hook', risk: 'high', riskReason: 'destroys' }
});

const confirmButton = (page: Page) => page.getByRole('button', { name: copy.confirm.go });

test('a passkey protects the high-impact accepts: enrolled at pairing, asked at each accept, refused when the device or the PC says no', async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // Before the sign-in the browser itself logs the refused socket and /auth/me; nothing else is expected.
  let signedIn = false;
  page.on('console', (m: ConsoleMessage) => {
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

  await test.step('pair, then protect the accepts: the PC keeps the passkey', async () => {
    await page.goto(h.url);
    await page.getByRole('link', { name: copy.login.github }).click();
    const code = await h.pc.code();
    await expect(page.getByLabel(copy.compare.codeLabel(code))).toBeVisible();
    signedIn = true;
    await page.getByRole('button', { name: copy.compare.same }).click();
    h.pc.ok();
    await expect(page.getByRole('heading', { name: copy.compare.doneTitle(copy.yourPc) })).toBeVisible();
    await page.getByRole('button', { name: copy.enroll.go }).click();
    await expect(page.getByText(copy.enroll.done)).toBeVisible();
    expect(h.daemon.device?.registered).toBe(true);
    await page.getByRole('link', { name: copy.compare.seePending }).click();
  });

  await test.step('a high-impact accept: the device confirms, the PC verifies the assertion and applies it', async () => {
    await h.daemon.update(high('h1', 'rm -rf build'));
    await page.getByRole('link', { name: /rm -rf build/ }).click();
    await confirmButton(page).click();
    await expect(page.getByText(copy.result.allowed)).toBeVisible();
    const [d] = decides();
    expect(d).toMatchObject({ id: 's1', decision: 'accept', expect: { key: 'h1' }, assertion: { id: expect.any(String) } });
    expect(h.daemon.typed).toEqual([d!.op]);
  });

  await test.step('the request changes between the challenge and the tap: stale, the new request is read, a new confirmation applies', async () => {
    await h.daemon.update(high('h2', 'rm -rf dist'));
    await page.getByText(copy.result.back).click();
    await page.getByRole('link', { name: /rm -rf dist/ }).click();
    await expect(confirmButton(page)).toBeEnabled();
    // The PC replaces the request without telling the phone; the challenge it prepared was for the old one.
    h.daemon.sessions = [high('h3', 'rm -rf node_modules')];
    const asked = decides().length;
    await confirmButton(page).click();
    await expect.poll(() => decides().length).toBe(asked + 1);
    // Refused as stale before the challenge is touched; the phone asks for the new request and shows it.
    await expect(page.getByText(copy.decide.changed).first()).toBeVisible();
    await expect(page.getByText('rm -rf node_modules')).toBeVisible();
    expect(h.daemon.typed).toHaveLength(1);
    await page.getByRole('button', { name: copy.decide.reread }).click();
    await confirmButton(page).click();
    await expect(page.getByText(copy.result.allowed)).toBeVisible();
    expect(decides().at(-1)).toMatchObject({ expect: { key: 'h3' }, assertion: { id: expect.any(String) } });
    expect(h.daemon.typed).toHaveLength(2);
  });

  await test.step('the device does not verify its user: the browser refuses to sign, nothing is sent, and the next tap works', async () => {
    await h.daemon.update(high('h4', 'rm -rf coverage'));
    await page.getByText(copy.result.back).click();
    await page.getByRole('link', { name: /rm -rf coverage/ }).click();
    await expect(confirmButton(page)).toBeEnabled();
    const asked = decides().length;
    // The phone asks for user verification (`required`): without it Chromium signs nothing, so no assertion reaches the PC.
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await confirmButton(page).click();
    await expect(page.getByText(copy.confirm.cancelled)).toBeVisible();
    expect(decides()).toHaveLength(asked);
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
  });

  await test.step('the PC refuses the assertion (its challenge was replaced): assertion_invalid, « Réessayer », then it applies', async () => {
    // A second challenge for the same request replaces the one the phone holds, as another tab of the phone would.
    h.daemon.device?.prepare({ type: 'confirm.prepare', purpose: 'decide', id: 's1', expect: { key: 'h4', kind: 'permission', text: 'rm -rf coverage' } }, true);
    const asked = decides().length;
    await confirmButton(page).click();
    await expect.poll(() => decides().length).toBe(asked + 1);
    await expect(page.getByText(copy.confirm.failed)).toBeVisible();
    expect(h.daemon.typed).toHaveLength(2);
    await page.getByRole('button', { name: copy.confirm.retry }).click();
    await confirmButton(page).click();
    await expect(page.getByText(copy.result.allowed)).toBeVisible();
    expect(h.daemon.typed).toHaveLength(3);
  });

  await test.step('no error in the browser console', async () => {
    expect(problems).toEqual([]);
  });
});

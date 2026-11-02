// The agent's terminal on the phone, end to end in a real browser: xterm draws the pane the fake PC streams, then
// « Prendre la main » asks the passkey (Chromium's virtual authenticator), the PC verifies it, and the keys reach the pane.
import { devices, expect, test } from '@playwright/test';
import type { PhoneClientMessage } from '@ledge/protocol';
import { copy } from '../src/copy';
import { createDeviceCheck } from '../test/fakePc';
import { startHarness, waiting, type Harness } from './harness';

const { defaultBrowserType: _chromium, ...pixel } = devices['Pixel 7'];
// At its own scale: Chromium's emulation reports the canvas's device-pixel box at its CSS size whatever the scale, so
// xterm's canvas would draw its glyphs 2.6 times too large here, as no phone does.
test.use({ ...pixel, deviceScaleFactor: 1 });
test.skip(({ browserName }) => browserName !== 'chromium', 'The virtual authenticator is a Chromium DevTools feature');

let h: Harness;
test.beforeAll(async () => {
  h = await startHarness();
  h.daemon.device = createDeviceCheck(h.url);
  h.daemon.terminal = true;
  const { pending: _none, ...free } = waiting();
  h.daemon.sessions = [{ ...free, state: 'working', topic: 'Pagination de /invoices' }];
});
test.afterAll(async () => { await h?.close(); });

const sent = <T extends PhoneClientMessage['type']>(type: T) => h.pc.received.map((t) => JSON.parse(t) as PhoneClientMessage)
  .filter((m): m is Extract<PhoneClientMessage, { type: T }> => m.type === type);
const L = copy.terminal.live2;

test('the terminal streams at the PC\'s size, then types after the passkey', async ({ page }) => {
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
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true }
  });

  await test.step('pair, protect the accepts, open the terminal', async () => {
    await page.goto(h.url);
    await page.getByRole('link', { name: copy.login.github }).click();
    const code = await h.pc.code();
    await expect(page.getByLabel(copy.compare.codeLabel(code))).toBeVisible();
    signedIn = true;
    await page.getByRole('button', { name: copy.compare.same }).click();
    h.pc.ok();
    await page.getByRole('button', { name: copy.enroll.go }).click();
    await expect(page.getByText(copy.enroll.done)).toBeVisible();
    await page.getByRole('link', { name: copy.compare.seePending }).click();
    await page.getByRole('link', { name: copy.nav.agents, exact: true }).click();
    await page.getByRole('link', { name: /Pagination de \/invoices/ }).click();
    await page.getByRole('link', { name: copy.thread.terminal('Otto') }).click();
  });

  await test.step('xterm draws the pane, read-only, at 120 columns', async () => {
    await expect(page.getByText(L.status.live)).toBeVisible();
    await expect(page.getByText(L.meta('ledge', 120, 30))).toBeVisible();
    await expect(page.locator('.xterm-accessibility-tree')).toContainText('Read(src/routes/invoices.ts)');
    expect(sent('term.open')).toMatchObject([{ id: 's1' }]);
    await page.screenshot({ path: 'test-results/terminal-live.png' });
  });

  await test.step('« Prendre la main » → the device → the PC verifies it; the keys reach the pane', async () => {
    await page.getByRole('button', { name: L.hold }).click();
    await page.getByRole('button', { name: L.go }).click();
    await expect(page.getByText(L.heldTitle('Otto'))).toBeVisible();
    expect(sent('term.hold')).toMatchObject([{ assertion: { id: expect.any(String) } }]);
    await page.keyboard.type('ls');
    await page.getByRole('button', { name: L.keyLabel.enter }).click();
    await expect.poll(() => h.daemon.termTyped.join('')).toBe('ls\r');
    // « / » and the other symbols reach the pane: from a hardware keyboard, and from Samsung's, which on a symbol takes the
    // word back (Backspaces as keyCode 229) and types it again with the symbol as text alone, without a key.
    await page.keyboard.type('/');
    await page.keyboard.type('/truc');
    await page.keyboard.type('abc');
    await expect.poll(() => h.daemon.termTyped.join('')).toBe('ls\r//trucabc');
    await page.locator('.xterm-helper-textarea').evaluate(async (ta: HTMLTextAreaElement) => {
      for (let i = 0; i < 3; i++) {
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 229, bubbles: true, cancelable: true }));
        ta.value = ta.value.slice(0, -1);
        ta.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true, composed: true }));
        ta.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', keyCode: 229, bubbles: true }));
        await new Promise(r => setTimeout(r, 10));
      }
      ta.value += 'abc/';
      ta.dispatchEvent(new InputEvent('input', { data: 'abc/', inputType: 'insertText', bubbles: true, composed: true }));
    });
    await expect.poll(() => h.daemon.termTyped.join('')).toBe('ls\r//trucabc\x7f\x7f\x7fabc/');
    await expect(page.locator('.xterm-accessibility-tree')).toContainText('ls');
    await page.screenshot({ path: 'test-results/terminal-held.png' });
    await page.getByRole('button', { name: L.release }).click();
    await expect(page.getByText(L.status.live)).toBeVisible();
  });

  await test.step('no error in the browser console', async () => {
    expect(problems).toEqual([]);
  });
});

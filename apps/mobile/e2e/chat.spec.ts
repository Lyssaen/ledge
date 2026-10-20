// « Demander à Ledge » end to end: a question, its steps and its answer; the instruction card sent to Nova; the launch
// card confirmed with the device (Chromium's virtual authenticator, as confirm.spec.ts); a question whose channel drops
// while it is answered. The PC is the harness's scripted fake: the real daemon's chat is tested in packages/ledge.
import { devices, expect, test, type ConsoleMessage } from '@playwright/test';
import type { PhoneClientMessage } from '@ledge/protocol';
import { copy } from '../src/copy';
import { createDeviceCheck } from '../test/fakePc';
import { startHarness, type Harness } from './harness';

const { defaultBrowserType: _chromium, ...pixel } = devices['Pixel 7'];
test.use(pixel);
test.skip(({ browserName }) => browserName !== 'chromium', 'The virtual authenticator is a Chromium DevTools feature');

let h: Harness;
test.beforeAll(async () => {
  h = await startHarness();
  h.daemon.device = createDeviceCheck(h.url);
  h.daemon.chat = true;
});
test.afterAll(async () => { await h?.close(); });

const sent = () => h.pc.received.map((t) => JSON.parse(t) as PhoneClientMessage);

test('the phone chat: a question, its steps and answer, the instruction sent, the session launched with the device, and an answer that outlives a lost connection', async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  let signedIn = false;
  let dropping = false;
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const before = !signedIn && (text.startsWith('WebSocket connection to ') || (text.startsWith('Failed to load resource: ') && m.location().url.endsWith('/auth/me')));
    // The relay going down on purpose (step 4) is logged by the browser itself.
    const dropped = dropping && text.startsWith('WebSocket connection to ') || text.startsWith('Failed to load resource: ');
    if (!before && !dropped) problems.push(`console: ${text} (${m.location().url})`);
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true }
  });

  await test.step('pair and protect the accepts: the launch needs a passkey', async () => {
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
    await page.getByRole('link', { name: copy.compare.seePending }).click();
  });

  await test.step('a suggestion asked: the steps, then the answer', async () => {
    await page.getByRole('link', { name: copy.nav.chat }).click();
    await expect(page.getByText(copy.chat.empty)).toBeVisible();
    await page.getByRole('button', { name: copy.chat.suggestions.waiting }).click();
    await page.getByRole('button', { name: copy.chat.send }).click();
    await expect(page.getByText('Otto attend votre accord.').first()).toBeVisible();
    await expect(page.getByText(copy.chat.steps.pane('Otto'))).toBeVisible();
    await expect(page.getByText(/^Lit les \d+ sessions…$/)).toBeVisible();
    await expect(page.getByRole('button', { name: copy.chat.stop })).toHaveCount(0);
    expect(sent().filter((m) => m.type === 'chat.ask')).toHaveLength(1);
  });

  await test.step('« Envoyer » on the instruction card: sent to Nova', async () => {
    const card = page.getByRole('region', { name: copy.chat.relayLabel });
    await expect(card.getByText('Relance les tests.')).toBeVisible();
    await card.getByRole('button', { name: copy.chat.relayGo }).click();
    await expect(card.getByRole('status')).toHaveText(`${copy.chat.sentTo('Nova')}${copy.chat.seeThread}`);
    expect(sent().filter((m) => m.type === 'chat.relay')).toHaveLength(1);
  });

  await test.step('the proposed session is launched after the device confirms', async () => {
    const card = page.getByRole('region', { name: copy.chat.launchLabel });
    await expect(card.getByText('Corriger le badge')).toBeVisible();
    await card.getByRole('button', { name: copy.confirm.go }).click();
    await expect(card.getByRole('status')).toHaveText(`${copy.chat.launchedTo}${copy.chat.seeThread}`);
    const [launch] = sent().filter((m): m is Extract<PhoneClientMessage, { type: 'chat.launch' }> => m.type === 'chat.launch');
    expect(launch).toMatchObject({ rows: [0], assertion: { id: expect.any(String) } });
    expect(h.daemon.launched).toEqual([launch!.qid]);
  });

  await test.step('the connection drops while Ledge answers: back, the finished answer is shown and no bubble is left running', async () => {
    h.daemon.hold = true;
    await page.getByLabel(copy.chat.field).fill('Et maintenant ?');
    await page.getByRole('button', { name: copy.chat.send }).click();
    await expect(page.getByRole('button', { name: copy.chat.stop })).toBeVisible();
    // The PC has the question and is answering it (held) when the link goes.
    await expect.poll(() => h.daemon.turns.length).toBe(2);
    dropping = true;
    await h.stopRelay();
    h.daemon.finishChat();
    h.daemon.hold = false;
    await h.startRelay();
    await expect(page.getByRole('button', { name: copy.chat.stop })).toHaveCount(0);
    // The history of the PC now has the answer and its cards for both questions.
    await expect(page.getByRole('region', { name: copy.chat.relayLabel })).toHaveCount(2);
    await expect(page.getByText('Et maintenant ?')).toBeVisible();
    dropping = false;
  });

  await test.step('no error in the browser console', async () => {
    expect(problems).toEqual([]);
  });
});

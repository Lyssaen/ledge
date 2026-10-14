import { expect, test } from '@playwright/test';

const TOKEN = 't'.repeat(43);
const HOST = 'localhost';

/** The daemon's pre-auth entry, simulated: right code 481203, then a real WebAuthn challenge; any later socket is an authenticated one. */
async function fakePairingDaemon(page: import('@playwright/test').Page) {
  const received: Record<string, unknown>[] = [];
  await page.routeWebSocket(/.*/, ws => {
    ws.onMessage(raw => {
      const m = JSON.parse(String(raw)) as Record<string, unknown>;
      received.push(m);
      if (m.type === 'auth') {
        ws.send(JSON.stringify({ type: 'auth.ok', deviceId: 'dev-1', deviceName: 'Navigateur', pcName: 'PC-Joffrey' }));
        ws.send(JSON.stringify({ type: 'snapshot', sessions: [] }));
      } else if (m.type === 'pair.options') {
        if (m.code !== '481203') return ws.send(JSON.stringify({ type: 'pair.error', reason: 'invalid_code' }));
        ws.send(JSON.stringify({
          type: 'pair.challenge', expiresAt: new Date(Date.now() + 120_000).toISOString(),
          options: {
            challenge: 'Y2hhbGxlbmdl', rp: { name: 'Ledge', id: HOST }, user: { id: 'ZGV2', name: 'phone', displayName: 'phone' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60000, attestation: 'none',
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }
          }
        }));
      } else if (m.type === 'pair.complete') {
        ws.send(JSON.stringify({ type: 'pair.done', token: TOKEN, deviceId: 'dev-1' }));
        ws.close({ code: 1000 });
      }
    });
  });
  return received;
}

for (const width of [320, 390, 430]) {
  test(`pairing ends on the app with a stored token (${width} px)`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 800 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }
    });
    const received = await fakePairingDaemon(page);
    await page.goto(`http://${HOST}:5299/m/`);

    await expect(page.getByRole('heading', { level: 1, name: 'Votre PC, à portée de main' })).toBeVisible();
    await page.getByRole('button', { name: 'Tailscale est connecté' }).click();
    await page.getByRole('button', { name: 'Ledge est installé' }).click();

    const input = page.getByLabel('Code à six chiffres');
    const send = page.getByRole('button', { name: 'Appairer mon téléphone' });
    await input.fill('12345');
    await expect(send).toBeDisabled();
    await input.fill('000000');
    await send.click();
    await expect(page.getByRole('alert')).toContainText('Code non reconnu');
    await expect(input).toHaveValue('000000');

    await input.fill('481203');
    await send.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vous êtes connecté' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ledge.mobile.token'))).toBe(TOKEN);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ledge sur le téléphone' })).toBeVisible();
    await expect.poll(() => received.some(m => m.type === 'auth' && m.token === TOKEN)).toBe(true);
    expect(received.find(m => m.type === 'pair.complete')).toMatchObject({ deviceName: 'Navigateur', webauthn: { type: 'public-key' } });
  });
}

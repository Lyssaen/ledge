import { expect, test, type Page } from '@playwright/test';
import { session } from './daemon';

const TOKEN = 't'.repeat(43);
const HOST = 'localhost';
const KEY = 'BAQAB-_w';

/** The daemon's pairing entry, then an authenticated socket that advertises its push key. */
async function fakeDaemon(page: Page, opts: { gate?: Promise<void>; sessions?: unknown[] } = {}) {
  const received: Record<string, unknown>[] = [];
  await page.routeWebSocket(/.*/, ws => {
    ws.onMessage(raw => {
      const m = JSON.parse(String(raw)) as Record<string, unknown>;
      received.push(m);
      if (m.type === 'auth') {
        ws.send(JSON.stringify({ type: 'auth.ok', deviceId: 'dev-1', deviceName: 'iPhone', pcName: 'PC-Joffrey', vapidPublicKey: KEY }));
        void (opts.gate ?? Promise.resolve()).then(() => ws.send(JSON.stringify({ type: 'snapshot', sessions: opts.sessions ?? [] })));
      } else if (m.type === 'pair.options') {
        ws.send(JSON.stringify({
          type: 'pair.challenge', expiresAt: new Date(Date.now() + 120_000).toISOString(),
          options: { challenge: 'Y2hhbGxlbmdl', rp: { name: 'Ledge', id: HOST }, user: { id: 'ZGV2', name: 'phone', displayName: 'phone' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60000, attestation: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' } }
        }));
      } else if (m.type === 'pair.complete') {
        ws.send(JSON.stringify({ type: 'pair.done', token: TOKEN, deviceId: 'dev-1' }));
        ws.close({ code: 1000 });
      }
    });
  });
  return received;
}

/** Notification and push stubs; the permission prompt records whether it ran inside a user activation. */
async function stubPush(page: Page, permission: 'granted' | 'denied') {
  await page.addInitScript(p => {
    const w = window as unknown as Record<string, unknown>;
    w.__activeAtPrompt = null;
    w.Notification = { permission: 'default', requestPermission: async () => { w.__activeAtPrompt = navigator.userActivation.isActive; return p; } };
    w.PushManager = class {};
    const sub = { toJSON: () => ({ endpoint: 'https://push.example/abc', expirationTime: null, keys: { p256dh: 'pk', auth: 'ak' } }) };
    Object.defineProperty(navigator.serviceWorker, 'ready', { value: Promise.resolve({ pushManager: { subscribe: async (o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => { w.__subscribed = { v: o.userVisibleOnly, key: [...o.applicationServerKey] }; return sub; } } }) });
  }, permission);
}

const noOverflow = async (page: Page) => {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
};

for (const width of [320, 390, 430]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height: 800 }); });

    test('step 4 asks permission from the tap and sends push.subscribe', async ({ page, context }) => {
      const cdp = await context.newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      await stubPush(page, 'granted');
      const received = await fakeDaemon(page);
      await page.goto(`http://${HOST}:5299/m/`);
      await page.getByRole('button', { name: 'Tailscale est connecté' }).click();
      await page.getByRole('button', { name: 'Ledge est installé' }).click();
      await page.getByLabel('Code à six chiffres').fill('481203');
      await page.getByRole('button', { name: 'Vérifier avec cet appareil' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Être prévenu quand un agent attend' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Plus tard' })).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/notifications-step4-${width}.png` });
      const enable = page.getByRole('button', { name: 'Activer les notifications' });
      await expect(enable).toBeEnabled();
      await enable.click();
      await expect.poll(() => received.find(m => m.type === 'push.subscribe')).toMatchObject({ subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'pk', auth: 'ak' } } });
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__activeAtPrompt)).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { __subscribed: unknown }).__subscribed)).toEqual({ v: true, key: [4, 4, 0, 7, 239, 240] });
      await expect(page.getByRole('heading', { level: 1, name: 'À traiter' })).toBeVisible();
    });

    test('a refused permission keeps the step, says so, and "Plus tard" moves on', async ({ page, context }) => {
      const cdp = await context.newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      await stubPush(page, 'denied');
      const received = await fakeDaemon(page);
      await page.goto(`http://${HOST}:5299/m/`);
      await page.getByRole('button', { name: 'Tailscale est connecté' }).click();
      await page.getByRole('button', { name: 'Ledge est installé' }).click();
      await page.getByLabel('Code à six chiffres').fill('481203');
      await page.getByRole('button', { name: 'Vérifier avec cet appareil' }).click();
      await page.getByRole('button', { name: 'Activer les notifications' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Notifications refusées' })).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/notifications-denied-${width}.png` });
      expect(received.some(m => m.type === 'push.subscribe')).toBe(false);
      await page.getByRole('button', { name: 'Plus tard' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'À traiter' })).toBeVisible();
    });

    test('a deep link to a handled request shows Déjà traitée sur le PC, and only loading until the snapshot', async ({ page }) => {
      // The last known state still lists a pending request on another session: the link must not be judged against it.
      const lastState = { sessions: [session('other')], previews: {}, syncedAt: new Date().toISOString(), pcName: 'PC-Joffrey' };
      await page.addInitScript(([k, v]) => { localStorage.setItem('ledge.mobile.token', 't'.repeat(43)); if (!localStorage.getItem(k!)) localStorage.setItem(k!, v!); }, ['ledge.mobile.lastState', JSON.stringify(lastState)]);
      let release!: () => void;
      const gate = new Promise<void>(r => { release = r; });
      await fakeDaemon(page, { gate, sessions: [session('a', { name: 'Otto' })] });
      await page.goto('/m/#/request/a/p-a');
      await expect(page.getByRole('status')).toHaveText('Chargement de la demande…');
      await page.waitForTimeout(400); // auth.ok has arrived by now, the snapshot has not
      await expect(page.getByRole('status')).toHaveText('Chargement de la demande…');
      await expect(page.getByText('Déjà traitée sur le PC')).toHaveCount(0);
      release();
      await expect(page.getByText('Déjà traitée sur le PC')).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/notifications-handled-${width}.png` });
    });

    test('a message from the service worker opens the request', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('ledge.mobile.token', 't'.repeat(43)));
      await fakeDaemon(page, { sessions: [session('a')] });
      await page.goto('/m/');
      await expect(page.getByRole('heading', { level: 1, name: 'À traiter' })).toBeVisible();
      await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: '/m/#/thread/a' } })));
      await expect(page).toHaveURL(/#\/thread\/a$/);
      await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: 'https://evil.example/' } })));
      await expect(page).toHaveURL(/#\/thread\/a$/);
    });
  });
}

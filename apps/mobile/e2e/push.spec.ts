// Web Push end to end in Chromium: the phone turns notifications on at the end of the pairing, the service worker shows
// what a push carries (or the fallback when it is unreadable), and no screen breaks the stricter CSP (no 'unsafe-inline').
// Chromium without a network has no push service, so `pushManager.subscribe` is replaced by an init script that hands
// back a made-up subscription; the pushes themselves come in through DevTools (`ServiceWorker.deliverPushMessage`).
// The headless shell also has no notification service, so the worker's showNotification calls are recorded.
import { devices, expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import type { PhoneClientMessage } from '@ledge/protocol';
import { copy } from '../src/copy';
import { startHarness, waiting, type Harness } from './harness';

const { defaultBrowserType: _chromium, ...pixel } = devices['Pixel 7'];
test.use(pixel);
test.skip(({ browserName }) => browserName !== 'chromium', 'Pushes are delivered through the Chromium DevTools protocol');

let h: Harness;
test.beforeAll(async () => { h = await startHarness(); h.daemon.push = 'off'; });
test.afterAll(async () => { await h?.close(); });

const sent = () => h.pc.received.map((t) => JSON.parse(t) as PhoneClientMessage);
const subscribes = () => sent().filter((m): m is Extract<PhoneClientMessage, { type: 'push.subscribe' }> => m.type === 'push.subscribe');

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-subscription';
// 65 bytes (an uncompressed point's size) and 16 bytes, base64url: 87 and 22 characters, as the protocol wants.
const P256DH = 'B'.padEnd(87, 'A');
const AUTH = 'a'.repeat(22);

/** Replaces the subscription the browser cannot make without a push service. */
const fakePushService = () => {
  let current: { options: { applicationServerKey: ArrayBuffer | null }; toJSON(): unknown; unsubscribe(): Promise<boolean> } | null = null;
  const proto = PushManager.prototype;
  proto.getSubscription = async () => current as unknown as PushSubscription | null;
  proto.subscribe = async (o?: PushSubscriptionOptionsInit) => {
    const key = o?.applicationServerKey;
    const bytes = typeof key === 'string' ? null : key ? new Uint8Array(key as ArrayBuffer).slice().buffer : null;
    current = {
      options: { applicationServerKey: bytes },
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-subscription', keys: { p256dh: 'B'.padEnd(87, 'A'), auth: 'a'.repeat(22) } }),
      unsubscribe: async () => { current = null; return true; }
    };
    return current as unknown as PushSubscription;
  };
};

/** Every violation of the page's CSP, as the browser reports it to the page itself. */
const watchCsp = () => {
  const w = window as unknown as { __csp: string[] };
  w.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    w.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
  });
};
const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test('notifications: turned on while pairing, a push shows a notification, an unreadable one the fallback, and the CSP holds on every screen', async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(['notifications'], { origin: h.url });
  await page.addInitScript(fakePushService);
  await page.addInitScript(watchCsp);

  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  let signedIn = false;
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Before the sign-in the browser itself logs the refused socket and /auth/me; nothing else is expected.
    const before = !signedIn && (text.startsWith('WebSocket connection to ') || (text.startsWith('Failed to load resource: ') && m.location().url.endsWith('/auth/me')));
    if (!before) problems.push(`console: ${text} (${m.location().url})`);
  });

  // The page's own CDP session sees its service worker: its registration id is what a push is delivered to.
  const cdp = await page.context().newCDPSession(page);
  let registrationId: string | null = null;
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
    const r = e.registrations.find((x) => x.scopeURL.startsWith(h.url));
    if (r) registrationId = r.registrationId;
  });
  await cdp.send('ServiceWorker.enable');

  await test.step('pair, then turn the notifications on: the PC receives the subscription', async () => {
    await page.goto(h.url);
    await page.getByRole('link', { name: copy.login.github }).click();
    const code = await h.pc.code();
    await expect(page.getByLabel(copy.compare.codeLabel(code))).toBeVisible();
    signedIn = true;
    await page.getByRole('button', { name: copy.compare.same }).click();
    h.pc.ok();
    await expect(page.getByRole('heading', { name: copy.compare.doneTitle(copy.yourPc) })).toBeVisible();
    // Nothing to protect here (the PC says the device is covered): the step after the pairing is the notifications.
    // The step is offered once the PC's snapshot has said so: wait for the phone to have asked, and for the answer.
    await expect.poll(() => sent().some((m) => m.type === 'snapshot.request')).toBe(true);
    await page.waitForTimeout(500);
    await page.getByRole('link', { name: copy.compare.seePending }).click();
    await expect(page.getByRole('heading', { name: copy.notifications.title })).toBeVisible();
    await page.getByRole('button', { name: copy.notifications.enable }).click();
    await expect.poll(() => subscribes().length).toBe(1);
    expect(subscribes()[0]).toMatchObject({ subscription: { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } }, key: expect.any(String) });
    expect(h.daemon.push).toBe('on');
    // Applied: the phone goes on to the inbox.
    await expect(page.getByRole('link', { name: /pnpm test/ })).toBeVisible();
  });

  // Chromium's headless shell has no notification service: the worker's `showNotification` is refused there, and
  // `getNotifications()` stays empty. So the worker's own call is recorded instead, which is what its push handler decides.
  const worker = async () => {
    await expect.poll(() => context.serviceWorkers().some((w) => w.url().startsWith(h.url))).toBe(true);
    return context.serviceWorkers().find((w) => w.url().startsWith(h.url))!;
  };
  await (await worker()).evaluate(() => {
    const g = self as unknown as { __shown: unknown[] };
    g.__shown = [];
    ServiceWorkerRegistration.prototype.showNotification = async function (title, o) {
      g.__shown.push({ title, body: o?.body, tag: o?.tag, data: o?.data ?? null });
    };
  });
  const shown = async () => (await worker()).evaluate(() => (self as unknown as { __shown: unknown[] }).__shown);
  const deliver = async (data: string) => {
    await expect.poll(() => registrationId).not.toBeNull();
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: h.url, registrationId: registrationId!, data });
  };

  await test.step('a valid push shows its notification', async () => {
    await deliver(JSON.stringify({
      v: 1, kind: 'request', title: 'Otto attend votre accord', body: 'pnpm test', url: '/#/request/s1/p1', badge: 1, tag: 'req-s1'
    }));
    await expect.poll(shown).toEqual([{ title: 'Otto attend votre accord', body: 'pnpm test', tag: 'req-s1', data: { url: '/#/request/s1/p1' } }]);
  });

  await test.step('an unreadable push shows the fallback', async () => {
    await deliver('this is not json');
    await expect.poll(shown).toContainEqual({ title: 'Ledge', body: 'Une demande attend', tag: 'ledge', data: null });
  });

  await test.step('every screen loads without a CSP violation or an error', async () => {
    await h.daemon.update(waiting());
    for (const hash of ['#/', '#/agents', '#/request/s1/p1', '#/thread/s1', '#/terminal/s1', '#/connection']) {
      await page.evaluate((x) => { location.hash = x; }, hash);
      await page.waitForTimeout(300);
      expect(await violations(page), hash).toEqual([]);
    }
    expect(problems).toEqual([]);
  });
});

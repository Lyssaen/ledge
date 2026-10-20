// The phone end to end: the built PWA on an iPhone 13 viewport, the real relay in accounts mode, a sealed fake PC.
// One story, in order: each step starts where the one before left the phone.
import { devices, expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { PAD_TIERS, RELAY_CLOSE_SIGNED_OUT, type PhoneClientMessage } from '@ledge/protocol';
import { generateIdentity } from '@ledge/seal';
import { copy } from '../src/copy';
import { PC_NAME, startHarness, waiting, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _webkit, ...iPhone13 } = devices['iPhone 13'];
test.use(iPhone13);
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');

let h: Harness;
test.beforeAll(async () => { h = await startHarness(); });
test.afterAll(async () => { await h?.close(); });

const sent = () => h.pc.received.map((t) => JSON.parse(t) as PhoneClientMessage);
const decides = () => sent().filter((m): m is Extract<PhoneClientMessage, { type: 'session.decide' }> => m.type === 'session.decide');
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** The inbox, from wherever the phone is: it lists the fake PC's request. */
async function toRequest(page: Page) {
  await page.getByRole('link', { name: /pnpm test/ }).click();
  await expect(page.getByRole('button', { name: copy.decide.allow })).toBeEnabled();
}

test('a phone signs in, pairs, decides, survives a relay restart and a session rotation, and stops at a changed key', async ({ page, context }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // The browser's own network lines (a 401 before sign-in, the relay down) are not the app's errors.
  const network = /^(Failed to load resource|WebSocket connection to )/;
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error' && !network.test(m.text())) problems.push(`console: ${m.text()}`); });
  // Counts every time the login screen appears, from a page's start on.
  await page.addInitScript((title) => {
    const w = window as unknown as { loginShown: number };
    w.loginShown = 0;
    let shown = false;
    new MutationObserver(() => {
      const now = document.body?.textContent?.includes(title) ?? false;
      if (now && !shown) w.loginShown++;
      shown = now;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, copy.login.title);
  const loginShown = () => page.evaluate(() => (window as unknown as { loginShown: number }).loginShown);

  await test.step('sign in with GitHub and pair: compare the code, confirm on the phone, approve on the PC', async () => {
    await page.goto(h.url);
    await page.getByRole('link', { name: copy.login.github }).click();
    const code = await h.pc.code();
    await expect(page.getByLabel(copy.compare.codeLabel(code))).toBeVisible();
    await page.getByRole('button', { name: copy.compare.same }).click();
    await expect(page.getByText(copy.compare.waitTitle)).toBeVisible();
    h.pc.ok();
    await expect(page.getByRole('heading', { name: copy.compare.doneTitle(copy.yourPc) })).toBeVisible();
    await page.getByRole('link', { name: copy.compare.seePending }).click();
  });

  await test.step('accept the low-risk request: the PC gets session.decide with its expect, padded to a tier', async () => {
    await toRequest(page);
    await page.getByRole('button', { name: copy.decide.allow }).click();
    await expect(page.getByText(copy.result.allowed)).toBeVisible();
    const [d] = decides();
    expect(d).toMatchObject({ id: 's1', decision: 'accept', expect: { key: 'p1', kind: 'permission', text: 'pnpm test' } });
    const plain = h.pc.plains.find((p) => p.trimEnd() === JSON.stringify(d));
    expect(PAD_TIERS).toContain(bytes(plain!));
    await expect.poll(() => h.daemon.typed).toEqual([d!.op]);
  });

  await test.step('the relay goes down right after a decision: the same op goes again, the PC answers the same applied', async () => {
    await h.daemon.update({ ...waiting(), pending: { ...waiting().pending!, key: 'p2', text: 'pnpm test --run' } });
    h.daemon.answer = false;
    await page.getByText(copy.result.back).click();
    await page.getByRole('link', { name: /pnpm test --run/ }).click();
    await page.getByRole('button', { name: copy.decide.allow }).click();
    await expect.poll(() => decides().length).toBe(2);
    await expect.poll(() => h.daemon.typed.length).toBe(2);

    await h.stopRelay();
    await expect(page.getByText(copy.decide.uncertain)).toBeVisible();
    h.daemon.answer = true;
    await h.startRelay();
    await expect(page.getByText(copy.result.allowed)).toBeVisible({ timeout: 20_000 });
    const [, first, again] = decides();
    expect(again).toEqual(first);
    expect(h.daemon.typed).toEqual([decides()[0]!.op, first!.op]);
  });

  await test.step('a sign-in from another page rotates the session (4001): /auth/me answers 200, the phone reconnects and says hello again', async () => {
    const hellos = () => h.pc.frames.filter((f) => f.k === 'hello').length;
    const before = hellos();
    const logins = await loginShown();
    const other = await context.newPage();
    // The other page stops at the callback's redirect: loading the app there would take the socket over (4000).
    await other.route('**/auth/github/callback**', async (route) => {
      const res = await route.fetch({ maxRedirects: 0 });
      await route.fulfill({ response: res, status: 200, headers: { ...res.headers(), location: '' }, body: '' });
    });
    await other.goto(`${h.url}/auth/github/start`);
    await other.close();
    await expect.poll(() => h.events.some((e) => e.ev === 'disconnect' && e.peer !== 'pc' && e.code === RELAY_CLOSE_SIGNED_OUT)).toBe(true);
    await expect.poll(hellos).toBeGreaterThan(before);
    await expect(page.getByText(copy.result.allowed)).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/auth/me')).status)).toBe(200);
    expect(await loginShown()).toBe(logins);
  });

  await test.step('the PC answers with another key: « La clé a changé », nothing more is sent', async () => {
    h.pc.answerAs(await generateIdentity());
    await h.pc.disconnect();
    await h.pc.reconnect();
    await expect(page.getByRole('heading', { name: copy.keyChanged.title(PC_NAME) })).toBeVisible();
    const count = h.pc.frames.filter((f) => f.k === 'msg').length;
    await page.waitForTimeout(500);
    expect(h.pc.frames.filter((f) => f.k === 'msg')).toHaveLength(count);
    h.pc.answerAs(h.pc.identity);
  });

  await test.step('a reload: still paired (IndexedDB), the inbox comes back', async () => {
    h.daemon.sessions = [waiting()];
    await page.goto(h.url);
    await expect(page.getByRole('heading', { name: copy.inbox.title })).toBeVisible();
    await expect(page.getByRole('link', { name: /pnpm test/ })).toBeVisible();
  });

  await test.step('no error in the browser console', async () => {
    expect(problems).toEqual([]);
  });
});

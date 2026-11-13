// The Atelier on iPad (docs/mockups/ledge-ipad-atelier.html, choice A): its tab after Agents on a wide screen with a PC that
// offers it, the rooms fitted readable, a tap opening the session in a panel over it, « Plein écran », a room's sheet with
// « Écrire au groupe », an OMP seat, « Sans projet », the PC offline; never on a phone nor with an older PC.
// SHOTS=<dir> saves a capture of each step there (light and dark, landscape 1180 × 820 and portrait 820 × 1180).
import { devices, expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';
import { ompSeats, projects, threads, unfiled, usual } from './atelier.fixtures';

const { defaultBrowserType: _webkit, ...iPad } = devices['iPad Pro 11 landscape'];
const LAND = { width: 1180, height: 820 }, PORT = { width: 820, height: 1180 };
test.use({ ...iPad, viewport: LAND });
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

let h: Harness;
test.beforeEach(async () => {
  h = await startHarness();
  Object.assign(h.daemon, { sessions: [...usual, ...ompSeats, ...unfiled], projects, broadcast: true, sessionClose: true, chat: true, threads });
});
test.afterEach(async () => { await h?.close(); });

async function shot(page: Page, name: string, browser: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/${browser}-atelier-${name}.png` });
}

async function pair(page: Page, theme: 'dark' | 'light' = 'dark') {
  await page.addInitScript(t => { try { localStorage.setItem('ledge.theme', t); } catch { /* ignore */ } }, theme);
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  // The app without a key opens on the choice (passkey-reinstall.html, 1 a): the code.
  await page.getByRole('button', { name: copy.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: copy.compare.seePending }).click();
}

const nav = (page: Page) => page.getByRole('navigation', { name: copy.nav.label });
const atelierTab = (page: Page) => nav(page).getByRole('link', { name: copy.nav.atelier });
const seat = (page: Page, id: string) => page.locator(`.overview-scroll.atelier [data-agent="${id}"]`);
const panel = (page: Page) => page.locator('.atelier-panel');

for (const theme of ['dark', 'light'] as const) {
  test(`the Atelier's flow, ${theme}: tab, session panel, full screen, room sheet`, async ({ page, browserName }) => {
    await pair(page, theme);
    // a · The tab, after Agents; the rooms at a readable zoom (a whole room in the screen's height).
    await atelierTab(page).click();
    await expect(page).toHaveURL(/#\/atelier$/);
    await expect(atelierTab(page)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: copy.atelier.title })).toBeVisible();
    await expect(page.getByText(copy.atelier.subtitle(10, 2, 4))).toBeVisible();
    await expect(page.locator('.atelier-room')).toHaveCount(3);
    await expect(page.locator('.rig-room .plaque-where')).toHaveText('rig · ledge · projet Ledge');
    await expect(page.locator('.helper-seat')).toHaveCount(1);
    await expect(page.locator('.unassigned-zone')).toContainText(copy.atelier.unassignedHint);
    const level = page.locator('.zoom-level');
    const zoom = Number.parseInt((await level.textContent())!, 10);
    expect(zoom).toBeGreaterThanOrEqual(92);
    expect(zoom).toBeLessThanOrEqual(100);
    const room = (await page.locator('.atelier-room').first().boundingBox())!;
    expect(room.y + room.height).toBeLessThanOrEqual(LAND.height + 1);
    // Touch targets: the zoom bar's buttons and every seat at least 44 pt.
    for (const b of await page.locator('.zoom-controls button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await seat(page, 'otto').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, `a-tab-land-${theme}`, browserName);

    // b · A tap on an agent: its session in a panel on the right, the Atelier still there; another agent changes the panel.
    await seat(page, 'otto').click();
    await expect(page).toHaveURL(/#\/atelier\/otto$/);
    await expect(panel(page).locator('header').getByText('Otto', { exact: true })).toBeVisible();
    await expect(panel(page).getByText('Lance les tests avant de préparer la release.')).toBeVisible();
    await expect(panel(page).getByRole('link', { name: copy.thread.examine })).toBeVisible();
    await expect(panel(page).getByRole('link', { name: copy.nav.backTo.sessions! })).toHaveCount(0);
    const box = (await panel(page).boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(LAND.width - 20);
    expect(box.width).toBeLessThan(460);
    await shot(page, `b-session-land-${theme}`, browserName);
    // The request opens in the panel (pilot-lead 12:14Z, design-ux 12:17Z): « Retour au fil » comes back, a decision applied too.
    await expect(panel(page).getByText(copy.atelier.awaiting, { exact: true })).toBeVisible();
    await panel(page).getByRole('link', { name: copy.thread.examine }).click();
    await expect(page).toHaveURL(/#\/atelier\/otto\/request\/p1$/);
    await expect(panel(page).getByRole('button', { name: copy.decide.allow })).toBeVisible();
    await shot(page, `b-request-land-${theme}`, browserName);
    await panel(page).getByRole('button', { name: copy.nav.backTo.thread! }).click();
    await expect(page).toHaveURL(/#\/atelier\/otto$/);
    await panel(page).getByRole('link', { name: copy.thread.examine }).click();
    await panel(page).getByRole('button', { name: copy.decide.allow }).click();
    await expect(page).toHaveURL(/#\/atelier\/otto$/);
    await expect(panel(page).getByRole('link', { name: copy.thread.examine })).toHaveCount(0);
    expect(h.daemon.typed).toHaveLength(1);
    await seat(page, 'nova').click();
    await expect(panel(page).locator('header').getByText('Nova', { exact: true })).toBeVisible();
    await expect(panel(page).getByText('La reconnexion SSH boucle quand le Wi-Fi revient.')).toBeVisible();
    // A sub-agent opens its parent's session.
    await page.locator('.helper-seat').click();
    await expect(page).toHaveURL(/#\/atelier\/nova$/);
    await panel(page).getByRole('button', { name: copy.atelier.closePanel }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/atelier$/);

    // c · « Plein écran »: the usual thread under Agents; back by the tab, at the zoom left.
    await page.getByRole('button', { name: copy.atelier.zoom.in, exact: true }).click();
    const zoomed = await level.textContent();
    await seat(page, 'otto').click();
    await panel(page).getByRole('link', { name: copy.atelier.fullScreen }).click();
    await expect(page).toHaveURL(/#\/thread\/otto$/);
    await expect(page.locator('.split-detail header')).toBeVisible();
    await shot(page, `c-full-land-${theme}`, browserName);
    await atelierTab(page).click();
    await expect(level).toHaveText(zoomed!);
    await page.getByRole('button', { name: copy.atelier.zoom.fit, exact: true }).click();
    await expect(page.getByRole('button', { name: copy.atelier.zoom.fit, exact: true })).toHaveAttribute('aria-pressed', 'true');

    // d · A room's name: its sheet, its agents, « Écrire au groupe ».
    await page.locator('.atelier-room[data-room="website"] .plaque-name').click();
    await expect(panel(page).getByRole('heading', { name: 'Website' })).toBeVisible();
    await expect(panel(page).getByText(copy.atelier.roomAgents(3))).toBeVisible();
    await panel(page).getByRole('button', { name: copy.agents.writeGroup }).click();
    await shot(page, `d-room-land-${theme}`, browserName);
    await panel(page).getByRole('textbox').fill('Faites le point avant midi.');
    await panel(page).getByRole('button', { name: copy.agents.send }).click();
    await expect(panel(page).getByText(copy.agents.sentTo(['Luna', 'Milo', 'Rio']))).toBeVisible();
    expect(h.daemon.broadcasts).toEqual([{ sessions: ['luna', 'milo', 'rio'], text: 'Faites le point avant midi.' }]);
    // A tap on an agent of the sheet opens its session.
    await panel(page).getByRole('button', { name: /Luna/ }).click();
    await expect(page).toHaveURL(/#\/atelier\/luna$/);

    // Portrait: the rooms in a column, the panel from the bottom.
    await page.setViewportSize(PORT);
    await expect(panel(page).locator('header').getByText('Luna', { exact: true })).toBeVisible();
    const low = (await panel(page).boundingBox())!;
    expect(low.y).toBeGreaterThan(PORT.height * 0.3);
    expect(low.y + low.height).toBeGreaterThanOrEqual(PORT.height - 1);
    await shot(page, `b-session-port-${theme}`, browserName);
    await panel(page).getByRole('button', { name: copy.atelier.closePanel }).click();
    await page.getByRole('button', { name: copy.atelier.zoom.fit, exact: true }).click();
    const first = (await page.locator('.atelier-room').first().boundingBox())!;
    expect(first.width).toBeLessThanOrEqual(PORT.width);
    await shot(page, `a-tab-port-${theme}`, browserName);
  });
}

test('« Sans projet » alone starts under Ledge\'s desk, never on « Ton assistant », the panel open or not', async ({ page }) => {
  const loose = ['kit', 'ana', 'rox'].map((id, k) => ({ ...unfiled[0]!, id, name: id[0]!.toUpperCase() + id.slice(1), topic: `Essai ${k + 1}` }));
  Object.assign(h.daemon, { sessions: loose, projects: [] });
  const clear = () => page.evaluate(() => {
    const desk = document.querySelector('.ledge-desk')!.getBoundingClientRect(), zone = document.querySelector('.unassigned-zone')!.getBoundingClientRect();
    return Math.round(zone.top - desk.bottom);
  });
  await pair(page);
  for (const size of [{ width: 1600, height: 1000 }, LAND, PORT]) {
    await page.setViewportSize(size);
    await atelierTab(page).click();
    await expect(page.locator('.unassigned-zone')).toBeVisible();
    await expect.poll(clear, `${size.width} × ${size.height}`).toBeGreaterThanOrEqual(8);
    await page.locator('.unassigned-zone [data-agent="kit"]').click();
    await expect(panel(page)).toBeVisible();
    await expect.poll(clear, `${size.width} × ${size.height}, the panel open`).toBeGreaterThanOrEqual(8);
    await panel(page).getByRole('button', { name: copy.atelier.closePanel }).click();
  }
});

test('the cases: an OMP seat, « Sans projet », a double tap, the PC offline', async ({ page, browserName }) => {
  await pair(page);
  await atelierTab(page).click();
  // An OMP seat: no thread, its terminal.
  await seat(page, 'mia').click();
  await expect(panel(page).getByRole('heading', { name: copy.atelier.ompNoThread })).toBeVisible();
  await expect(panel(page).getByRole('link', { name: copy.atelier.ompTerminal })).toHaveAttribute('href', '#/terminal/mia');
  await shot(page, 'case-omp-land', browserName);
  await panel(page).getByRole('button', { name: copy.atelier.closePanel }).click();

  // « Sans projet »: its card opens the session.
  await page.locator('.unassigned-zone [data-agent="kit"]').click();
  await expect(panel(page).locator('header').getByText('Kit', { exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: copy.atelier.closePanel }).click();

  // A double tap on a room's floor frames it; « Ajuster » comes back.
  await page.getByRole('button', { name: copy.atelier.zoom.fit, exact: true }).click();
  const level = page.locator('.zoom-level');
  const before = await level.textContent();
  // The room's floor, left of its rug: no seat, no label.
  const floor = (await page.locator('.atelier-room[data-room="ledge"]').boundingBox())!;
  await page.touchscreen.tap(floor.x + 40, floor.y + floor.height / 2);
  await page.touchscreen.tap(floor.x + 40, floor.y + floor.height / 2);
  await expect(level).not.toHaveText(before!);
  await page.getByRole('button', { name: copy.atelier.zoom.fit, exact: true }).click();
  await expect(level).toHaveText(before!);

  // The PC offline: the last known state, the bots frozen, the panel read-only.
  await seat(page, 'luna').click();
  await expect(panel(page).locator('header').getByText('Luna', { exact: true })).toBeVisible();
  await h.stopRelay();
  // The shell's banner (shell/Shell.tsx, LinkStrip), over the floor.
  await expect(page.locator('[data-strip]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.atelier-frozen')).toHaveCount(1);
  await expect(page.getByText(new RegExp(`^${copy.agents.offline} · `))).toBeVisible();
  await expect(panel(page).getByRole('textbox')).toBeDisabled();
  await shot(page, 'case-offline-land', browserName);
});

test('no Atelier tab with an older PC, and `#/atelier` leads to the sessions', async ({ page }) => {
  h.daemon.projects = null;
  await pair(page);
  await expect(nav(page).getByRole('link', { name: copy.nav.sessions })).toBeVisible();
  await expect(atelierTab(page)).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/atelier'; });
  await expect(page).toHaveURL(/#\/sessions$/);
});

// The Ledge pane over the Atelier (m3-chat.html §7, review-qa e0065182): on its side the session panel moves beside the pane;
// upright the pane goes over it.
test('the Ledge pane stays in sight with a session panel open', async ({ page, browserName }) => {
  await pair(page);
  await atelierTab(page).click();
  await seat(page, 'otto').click();
  await expect(panel(page)).toBeVisible();
  await nav(page).getByRole('button', { name: copy.nav.chat }).click();
  const pane = page.getByRole('complementary', { name: copy.chat.title });
  await expect(pane.getByLabel(copy.chat.field)).toBeVisible();
  const p = (await pane.boundingBox())!;
  expect.soft(p.x + p.width).toBe(LAND.width);
  const s = (await panel(page).boundingBox())!;
  expect.soft(s.x + s.width).toBeLessThanOrEqual(p.x);
  await shot(page, 'ledge-pane-land', browserName);
  await page.setViewportSize(PORT);
  const q = (await pane.boundingBox())!;
  // The topmost element at the pane's foot, where the session panel also is: the pane's.
  const top = await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.lpane'), [q.x + q.width / 2, q.y + q.height - 120]);
  expect(top).toBe(true);
  await shot(page, 'ledge-pane-port', browserName);
});

test.describe('on a phone', () => {
  const { defaultBrowserType: _w, ...iPhone } = devices['iPhone 13'];
  test.use(iPhone);
  test('no Atelier tab, even with a PC that offers it', async ({ page }) => {
    await pair(page);
    await expect(nav(page).getByRole('link', { name: copy.nav.sessions })).toBeVisible();
    await expect(atelierTab(page)).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/atelier'; });
    await expect(page).toHaveURL(/#\/sessions$/);
  });
});

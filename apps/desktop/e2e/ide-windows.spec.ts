import type { Locator, Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { fleet } from './thread';

// Lot 9: several windows (docs/ide-workspace.md, « Fenêtres détachées », v27). A detached window is a popout of the same
// document (`window.open`), holding one group: in Chromium it is a page of the same context.
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);

const sessions: Session[] = [
  fleet.find(s => s.id === 'otto')!,
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', model: 'claude-opus-5-5' })
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
  await seedAtelier(page);
});

const tabs = (root: Page) => root.locator('.dv-tab');
const tabOf = (root: Page, name: string) => tabs(root).filter({ has: root.locator('.tab-name', { hasText: new RegExp(`^${name}`) }) });
const box = async (l: Locator) => (await l.boundingBox())!;
/** The workspace as the store saved it: windows, and each group's window and tabs. */
const model = (page: Page) => page.evaluate(() => {
  const w = JSON.parse(JSON.parse(localStorage.getItem('ledge.ide.workspace')!)) as { windows: string[]; groups: { window: string; tabs: { kind: string; ref: string }[]; link: string | null }[] };
  return { windows: w.windows, groups: w.groups.map(g => ({ window: g.window, tabs: g.tabs.map(t => `${t.kind}:${t.ref}`), link: g.link })) };
});

async function boot(page: Page, theme: 'light' | 'dark' = 'dark') {
  await page.addInitScript(t => {
    try { localStorage.setItem('desktop.lang', 'en'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ }
    (window as unknown as { __ledgeShells: unknown }).__ledgeShells = { wsl: 'Ubuntu', powershell: false, cmd: false, gitBash: false };
  }, theme);
  await fakeDaemon(page, sessions, { projects: twoProjects });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
}
async function open(page: Page, name: string): Promise<void> {
  const button = page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: 'Projects', exact: true });
  if (!(await button.getAttribute('class'))?.includes('on')) await button.click();
  await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(tabOf(page, name)).toHaveClass(/dv-active-tab/);
}

/** A real mouse drag of `from`, let go outside the page (left of it): the browser ends it with nowhere to drop. */
async function tearOut(page: Page, from: Locator): Promise<void> {
  const f = await box(from);
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2 + 20, f.y + f.height / 2 + 40, { steps: 5 });
  await page.mouse.move(-40, 300, { steps: 10 });
  await page.mouse.up();
}

test('a tab torn out of the window opens alone in a new window, which takes the theme; brought back, the window goes', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  const popped = page.context().waitForEvent('page');
  await tearOut(page, tabOf(page, 'Nova'));
  const pop = await popped;
  await expect(tabOf(pop, 'Nova')).toBeVisible();
  await expect(tabOf(page, 'Nova')).toHaveCount(0);
  await expect(tabOf(page, 'Otto')).toBeVisible();
  expect(await pop.evaluate(() => document.documentElement.dataset.theme)).toBe(await page.evaluate(() => document.documentElement.dataset.theme));
  const m = await model(page);
  expect(m.windows).toHaveLength(2);
  expect(m.groups.find(g => g.tabs.includes('session:local:nova'))!.window).toBe(m.windows[1]);
  await pop.screenshot({ path: shot('lot9-popout.png') });
});

/** A tab of a detached window dragged onto the main window's group `into` (its centre). The mouse cannot cross pages here:
 *  the drag is the browser's events, dispatched where each would fire (dockview reads the panel from its own transfer). */
async function bringBack(pop: Page, page: Page, name: string, into: Locator): Promise<void> {
  const tab = tabOf(pop, name);
  const t = await box(tab);
  await tab.dispatchEvent('dragstart', { clientX: t.x + 5, clientY: t.y + 5, dataTransfer: await pop.evaluateHandle(() => new DataTransfer()) });
  const r = await box(into);
  const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await into.dispatchEvent('dragenter', { ...at, dataTransfer: dt });
  await into.dispatchEvent('dragover', { ...at, dataTransfer: dt });
  // The window closes once the tab has left it: its dragend never comes, as when a webview drops it.
  await into.dispatchEvent('drop', { ...at, dataTransfer: dt });
}

test('dropped on a group of the main window, the tab comes back and its window, emptied, closes', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  const popped = page.context().waitForEvent('page');
  await tearOut(page, tabOf(page, 'Nova'));
  const pop = await popped;
  await expect(tabOf(pop, 'Nova')).toBeVisible();
  const closed = pop.waitForEvent('close');
  await bringBack(pop, page, 'Nova', page.locator('.ide-dockview .dv-content-container').first());
  await closed;
  await expect(tabOf(page, 'Nova')).toBeVisible();
  const m = await model(page);
  expect(m.windows).toEqual(['main']);
  expect(m.groups.map(g => g.tabs)).toEqual([['atelier:main', 'session:local:otto', 'session:local:nova']]);
});

test('a detached window closed by the user: its tabs come back to the main window in a group on the right', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  const popped = page.context().waitForEvent('page');
  await tearOut(page, tabOf(page, 'Nova'));
  const pop = await popped;
  await expect(tabOf(pop, 'Nova')).toBeVisible();
  await pop.close();
  await expect(tabOf(page, 'Nova')).toBeVisible();
  const m = await model(page);
  expect(m.windows).toEqual(['main']);
  expect(m.groups.map(g => g.tabs)).toEqual([['atelier:main', 'session:local:otto'], ['session:local:nova']]);
  await expect(page.locator('.ide-dockview .dv-groupview')).toHaveCount(2);
});

/** Where a capture goes: LEDGE_SHOTS when set (Playwright empties its own output folder at each run), else this test's output. */
const shot = (name: string) => (process.env.LEDGE_SHOTS ? `${process.env.LEDGE_SHOTS}/${name}` : test.info().outputPath(name));
const said = (page: Page) => page.evaluate(() => [...((window as unknown as { __ledgeToasts?: string[] }).__ledgeToasts ?? [])]);

for (const theme of ['dark', 'light'] as const) {
  test(`v27 (${theme}): a detached window's bar names its tab, offers no split; its ✕ gives the tab back and says so`, async ({ page }) => {
    await boot(page, theme);
    await open(page, 'Otto');
    await open(page, 'Nova');
    const popped = page.context().waitForEvent('page');
    await tearOut(page, tabOf(page, 'Nova'));
    const pop = await popped;
    const bar = pop.locator('.ide-popout-bar');
    await expect(bar.locator('.ide-wtitle')).toHaveText(/^Nova · /);
    await expect(bar.locator('.ide-brand')).toHaveText('Ledge');
    await expect.poll(() => pop.title()).toMatch(/^Nova · .* — Ledge$/);
    await expect(pop.getByRole('button', { name: 'Split right (Ctrl+\\)' })).toHaveCount(0);
    await expect(pop.getByRole('button', { name: 'New session' })).toHaveCount(1);
    // The bar is 34 px, as the main window's, the group right under it, the whole window filled.
    const b = await box(bar);
    expect(b.y).toBe(0);
    expect(b.height).toBe(34);
    const strip = await box(pop.locator('.dv-tabs-and-actions-container').first());
    expect(strip.y).toBe(34);
    const page0 = pop.viewportSize()!;
    const content = await box(pop.locator('.dv-groupview').first());
    expect(Math.round(content.y + content.height)).toBe(page0.height);
    // Its tabs wear the main window's skin (jde under Windows: the titles were 14 px there, 12 px here).
    const look = (l: Locator) => l.evaluate(el => {
      const s = getComputedStyle(el);
      return { size: getComputedStyle(el.querySelector('.tab-name')!).fontSize, height: s.height, background: s.backgroundColor, color: s.color };
    });
    await tabOf(page, 'Otto').click();
    await tabOf(pop, 'Nova').click();
    expect(await look(tabOf(pop, 'Nova'))).toEqual(await look(tabOf(page, 'Otto')));
    expect((await look(tabOf(pop, 'Nova'))).size).toBe('12px');
    // Its group has the focus: its tab in front is underlined in Ledge's coral, nothing on top (ledge-ide-tab-front.html).
    const coral = theme === 'dark' ? 'rgb(234, 106, 88)' : 'rgb(204, 82, 65)';
    await expect.poll(() => tabOf(pop, 'Nova').evaluate(el => getComputedStyle(el).boxShadow)).toBe(`${coral} 0px -2px 0px 0px inset`);
    expect(await tabOf(pop, 'Nova').evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
    await pop.screenshot({ path: shot(`lot9-window-${theme}.png`) });
    await bar.screenshot({ path: shot(`lot9-window-bar-${theme}.png`) });
    await page.locator('.dv-tabs-and-actions-container').first().screenshot({ path: shot(`lot9-strip-main-${theme}.png`), scale: 'device' });
    await pop.locator('.dv-tabs-and-actions-container').first().screenshot({ path: shot(`lot9-strip-popout-${theme}.png`), scale: 'device' });
    const closed = pop.waitForEvent('close');
    await bar.getByRole('button', { name: 'Close' }).click();
    await closed;
    await expect(tabOf(page, 'Nova')).toBeVisible();
    expect(await said(page)).toContain('Window closed: its tab is back in the main window.');
  });
}

test('a detached window moves by its bar and maximises on a double press, asked from the main page for that window (jde, Windows)', async ({ page }) => {
  // A detached window knows its Tauri label (popoutLabel); the main page stays outside Tauri, where the bridge records the calls.
  await page.context().addInitScript(() => {
    if (window.opener) (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'ide-e2e' } } };
  });
  await boot(page);
  await page.evaluate(() => {
    const w = window as unknown as { __ledgeWindowCall: (op: string, label?: string) => void; __calls: string[] };
    w.__calls = [];
    w.__ledgeWindowCall = (op, label) => { w.__calls.push(`${op} ${label}`); };
  });
  await open(page, 'Otto');
  await open(page, 'Nova');
  const popped = page.context().waitForEvent('page');
  await tearOut(page, tabOf(page, 'Nova'));
  const pop = await popped;
  const bar = pop.locator('.ide-popout-bar');
  await expect(bar.locator('.ide-wtitle')).toHaveText(/^Nova · /);
  const calls = () => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
  await bar.locator('.ide-wtitle').click();
  await expect.poll(calls).toEqual(['drag ide-e2e']);
  const label = 'ide-e2e';
  await bar.locator('.ide-brand').dblclick();
  await expect.poll(calls).toEqual([`drag ${label}`, `drag ${label}`, `maximize ${label}`]);
  // Its window buttons keep their own job: none moves the window.
  await bar.getByRole('button', { name: 'Minimize' }).click();
  expect((await calls()).filter(c => c.startsWith('drag'))).toHaveLength(2);
  expect(await bar.evaluate(el => el.querySelectorAll('[data-tauri-drag-region]').length + (el.hasAttribute('data-tauri-drag-region') ? 1 : 0))).toBe(0);
});

test('while a tab is dragged, a banner at the bottom of its window; let go outside, a new window', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  const from = await box(tabOf(page, 'Nova'));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 300, { steps: 8 });
  const banner = page.locator('.ide-tear-banner');
  await expect(banner).toHaveText('Drop the tab outside the window to open it in a new window');
  const r = await box(banner);
  // Centred at the bottom of the window, 18 px above its edge.
  expect(Math.abs(r.x + r.width / 2 - 960)).toBeLessThanOrEqual(1);
  expect(Math.round(1080 - (r.y + r.height))).toBe(18);
  await page.screenshot({ path: shot('lot9-banner.png'), clip: { x: r.x - 40, y: r.y - 30, width: r.width + 80, height: r.height + 48 } });
  const popped = page.context().waitForEvent('page');
  await page.mouse.move(-40, 300, { steps: 10 });
  await page.mouse.up();
  await popped;
  await expect(banner).toHaveCount(0);
});

test('a bottom-panel terminal let go outside the window opens alone in a new window', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+j');
  const tile = page.locator('.ide-btile-tab').first();
  await expect(tile).toBeVisible();
  const f = await box(tile);
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2 + 20, f.y + f.height / 2 - 200, { steps: 8 });
  await expect(page.locator('.ide-tear-banner')).toHaveText('Drop the terminal outside the window to open it in a new window');
  const popped = page.context().waitForEvent('page');
  await page.mouse.move(-40, 300, { steps: 10 });
  await page.mouse.up();
  const pop = await popped;
  await expect(pop.locator('.dv-tab').filter({ hasText: /WSL/ })).toBeVisible();
  // The terminal is made again in that window, with what it had printed.
  await expect.poll(() => pop.locator('[data-terminal]').first().evaluate(el => (el as unknown as { __ledgeTermText?: string }).__ledgeTermText ?? '')).toContain('$');
  const m = await model(page);
  expect(m.groups.find(g => g.window !== 'main')!.tabs[0]).toMatch(/^terminal:shell:/);
});

test('the atelier: « Detach » sends its tab alone to a new window, « Bring back » gives it back to the main window', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await tabs(page).filter({ hasText: 'Atelier' }).click();
  const popped = page.context().waitForEvent('page');
  await page.locator('.ide-abar').getByRole('button', { name: 'Detach' }).click();
  const pop = await popped;
  await expect(pop.locator('.ide-popout-bar .ide-wtitle')).toHaveText('Atelier');
  const closed = pop.waitForEvent('close');
  await pop.locator('.ide-abar').getByRole('button', { name: 'Bring back' }).click();
  await closed;
  const m = await model(page);
  expect(m.windows).toEqual(['main']);
  expect(m.groups[0]!.tabs).toContain('atelier:main');
});

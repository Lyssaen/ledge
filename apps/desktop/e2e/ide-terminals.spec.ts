import type { Locator, Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import type { OpenRigState } from '@ledge/protocol';
import { fakeDaemon, session, twoProjects } from './daemon';
import { fleet } from './thread';

// The IDE's bottom panel (lot 5, docs/mockups/ledge-ide-interactive.html `bottomPanel()`): its shells as tiles side by side,
// the « + ▾ » menu, a terminal dragged to a group and back, the last one closed, the Output; then its zoomed shots, light and dark.
test.use({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const STATE: OpenRigState = {
  installed: true, version: '0.6.14', daemon: { state: 'running', pid: 1, port: 7433 }, kernel: { state: 'ready' }, at: new Date().toISOString(),
  rigs: [{ id: '1', name: 'starter', status: 'running', lifecycleState: 'running', seats: 0, running: 0, attention: 0, uptime: '2h', snapshot: null, nodes: [] }]
};
/** A real OpenRig action from the page (Stop, confirmed): the fake daemon ends it with a command, and the log notes it. */
async function stopStarter(page: Page) {
  await page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: 'OpenRig rigs' }).click();
  await page.locator('.ide-rigs-row').filter({ hasText: 'starter' }).getByRole('button', { name: /^Stop/ }).click();
  await page.getByRole('group', { name: /^Stop the rig/ }).getByRole('button', { name: 'Confirm the stop' }).click();
}
const sessions = [fleet.find(s => s.id === 'otto')!, session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working' })];
const panel = (page: Page) => page.getByRole('region', { name: 'Bottom panel' });
const tiles = (page: Page) => panel(page).locator('.ide-btile');
const tilesTitles = (page: Page) => panel(page).locator('.ide-btile-tab');
const tileText = (names: string[]) => names.map(n => new RegExp(`^>_\\s*${n}$`));
const groups = (page: Page) => page.locator('.ide-dockview .dv-groupview');
const dockTab = (page: Page, title: string) => page.locator('.ide-dockview .dv-tab').filter({ hasText: title });
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyWrites: string[] }).__ledgePtyWrites.join(''));
const termText = (page: Page, nth: number) => tiles(page).nth(nth).locator('[data-terminal]').evaluate(el => (el as unknown as { __ledgeTermText?: string }).__ledgeTermText ?? '');
const shownText = (page: Page) => tiles(page).locator('.ide-btile-screen:not([hidden]) [data-terminal]').evaluate(el => (el as unknown as { __ledgeTermText?: string }).__ledgeTermText ?? '');
const ptyOpens = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyOpens: unknown[] }).__ledgePtyOpens.length);
const emit = (page: Page, text: string) => page.evaluate(t => (window as unknown as { __ledgePtyEmit: (s: string) => void }).__ledgePtyEmit(t), text);
const box = async (l: Locator) => (await l.boundingBox())!;

async function boot(page: Page, theme: 'light' | 'dark' = 'light') {
  await seedAtelier(page);
  await page.addInitScript(t => {
    try { localStorage.setItem('ledge.ide.enabled', 'true'); localStorage.setItem('desktop.lang', 'en'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ }
    (window as unknown as { __ledgeShells: unknown }).__ledgeShells = { wsl: 'Ubuntu', powershell: true, cmd: false, gitBash: false };
  }, theme);
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, openrig: STATE, rigCommands: ['rig down starter --snapshot'] });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible();
  return daemon;
}
const openMenu = async (page: Page) => { await panel(page).getByRole('button', { name: 'New terminal' }).click(); await expect(page.getByRole('menu')).toBeVisible(); };

/** A real mouse drag (dockview's and the panel's HTML5 drag): picked up, carried a little so the drag starts, then over `to`. */
async function drag(page: Page, from: Locator, to: () => Promise<{ x: number; y: number }>): Promise<void> {
  const f = await box(from);
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2 + 20, f.y + f.height / 2 - 40, { steps: 5 });
  const t = await to();
  await page.mouse.move(t.x, t.y, { steps: 10 });
  await page.mouse.move(t.x + 1, t.y + 1);
  await page.mouse.up();
}

test('the bottom panel: shells side by side, a terminal to a group and back, the last closed, the Output', async ({ page }) => {
  await boot(page);
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press('Control+j');
  await expect(panel(page)).toBeVisible();
  await expect(tilesTitles(page)).toHaveText(tileText(['WSL · Ubuntu 1']));
  await expect(panel(page).getByRole('tab', { name: 'Terminals' }).locator('.ide-bp-count')).toHaveText('1');
  expect((await box(panel(page))).height).toBe(240);

  // « + ▾ »: PowerShell stacks as a tab of the existing group and takes the focus; « default » now sits on PowerShell.
  await openMenu(page);
  await expect(page.getByRole('menuitem', { name: /WSL/ })).toContainText('default');
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  await expect(tilesTitles(page)).toHaveText(tileText(['WSL · Ubuntu 1', 'PowerShell 2']));
  await expect(tilesTitles(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByRole('tab', { name: 'Terminals' }).locator('.ide-bp-count')).toHaveText('2');
  await openMenu(page);
  await expect(page.getByRole('menuitem', { name: /PowerShell/ })).toContainText('default');
  await expect(page.getByRole('menuitem', { name: /WSL/ })).not.toContainText('default');
  await page.keyboard.press('Escape');

  // Typing in the focused tab reaches its PTY (PowerShell opened natively).
  await tiles(page).locator('.ide-btile-screen:not([hidden]) .xterm').click();
  await page.keyboard.type('echo hi');
  await expect.poll(() => writes(page)).toContain('echo hi');
  const opens = await page.evaluate(() => (window as unknown as { __ledgePtyOpens: { argv: string[]; native?: string }[] }).__ledgePtyOpens);
  expect(opens.map(o => o.native ?? 'wsl')).toEqual(['wsl', expect.stringMatching(/powershell/i)]);
  // The screen is a canvas: the buffer (not a pixel clip that can match blank-to-blank) says the line is « $ echo hi ».
  await expect.poll(() => shownText(page)).toContain('$ echo hi');

  // Ctrl+J while that terminal has the keyboard hides the panel; again shows the same two shells, none new.
  const opensBefore = await ptyOpens(page);
  await page.keyboard.press('Control+j');
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press('Control+j');
  await expect(tilesTitles(page)).toHaveText(tileText(['WSL · Ubuntu 1', 'PowerShell 2']));
  expect(await ptyOpens(page)).toBe(opensBefore);
  await expect.poll(() => shownText(page)).toContain('$ echo hi');

  // The 2nd tile dragged onto the editing group: a tab « >_ PowerShell 2 » with « shell »; the panel keeps one tile.
  const group = groups(page).first();
  await drag(page, tilesTitles(page).nth(1), async () => { const r = await box(group.locator('.dv-content-container')); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await expect(dockTab(page, '>_ PowerShell 2')).toHaveCount(1);
  await expect(tilesTitles(page)).toHaveText(tileText(['WSL · Ubuntu 1']));
  await expect(page.getByRole('tabpanel', { name: /^>_ PowerShell 2/ }).locator('.chip-k')).toHaveText('shell');
  await expect(panel(page).getByRole('tab', { name: 'Terminals' }).locator('.ide-bp-count')).toHaveText('1');

  // And back: the tab dragged onto the panel: two tiles again, the typed text still shown.
  await drag(page, dockTab(page, '>_ PowerShell 2'), async () => { const r = await box(panel(page).locator('.ide-bp-body')); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await expect(tilesTitles(page)).toHaveText(tileText(['WSL · Ubuntu 1', 'PowerShell 2']));
  await expect(dockTab(page, '>_ PowerShell 2')).toHaveCount(0);
  await expect.poll(() => termText(page, 1), { message: 'the tile shows what was typed, as before' }).toContain('$ echo hi');
  expect(await ptyOpens(page)).toBe(2);

  // The Output: an OpenRig action's end, an entry with « ✓ ».
  await stopStarter(page);
  await panel(page).getByRole('tab', { name: 'Output' }).click();
  await expect(panel(page).getByRole('log', { name: 'Output' })).toContainText('rig down starter --snapshot');
  await expect(panel(page).locator('.ide-output-ok')).toHaveText('✓');
  await expect(panel(page).getByRole('tab', { name: 'Output' }).locator('.ide-bp-count')).toHaveText('1');
  await panel(page).getByRole('tab', { name: 'Terminals' }).click();

  // Both closed: the panel hides and says so; Ctrl+J opens it again with the default shell, PowerShell.
  await tiles(page).nth(1).getByRole('button', { name: 'Close' }).click();
  await tiles(page).nth(0).getByRole('button', { name: 'Close' }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __ledgeToasts: string[] }).__ledgeToasts)).toContain('Last terminal closed: the bottom panel hides. Ctrl+J opens it again with a shell.');
  await page.keyboard.press('Control+j');
  await expect(tilesTitles(page)).toHaveText(tileText(['PowerShell 3']));
});

for (const theme of ['light', 'dark'] as const) {
  test(`the bottom panel, zoomed (${theme})`, async ({ page }, info) => {
    await boot(page, theme);
    await page.keyboard.press('Control+j');
    await openMenu(page);
    await page.getByRole('menuitem', { name: /PowerShell/ }).click();
    await expect(tiles(page)).toHaveCount(1);
    await expect(tilesTitles(page)).toHaveCount(2);
    await emit(page, 'Get-ChildItem\r\n');
    const settle = () => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const zoom = async (n: string) => { await settle(); await panel(page).screenshot({ path: info.outputPath(`ide-panel-${n}-${theme}.png`) }); };
    await zoom('terminals');
    // The menu opens upward: the shot is the menu's own box.
    await openMenu(page);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const mb = await box(menu);
    expect(mb.width).toBeGreaterThan(8);
    expect(mb.height).toBeGreaterThan(8);
    await page.screenshot({ path: info.outputPath(`ide-panel-menu-${theme}.png`), clip: { x: mb.x, y: mb.y, width: mb.width, height: mb.height } });
    await page.keyboard.press('Escape');
    // Metrics against the mockup.
    const m = await page.evaluate(() => {
      const css = (sel: string, props: string[]) => { const el = document.querySelector(sel); if (!el) return null; const c = getComputedStyle(el); return Object.fromEntries(props.map(p => [p, c.getPropertyValue(p)])); };
      const h = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().height;
      return { panelH: h('.ide-bottom'), tabsH: h('.ide-bp-tabs'), tileBarH: h('.ide-btile-bar'), tab: css('.ide-bp-tabs [role=tab]', ['font-size', 'text-transform', 'letter-spacing']), chip: css('.ide-btile-tools .chip-k', ['font-size', 'font-family']), gap: css('.ide-bterms', ['gap']) };
    });
    expect(m.panelH).toBe(240); expect(m.tabsH).toBe(30); expect(m.tileBarH).toBe(30);
    expect(m.gap).toMatchObject({ gap: '1px' });
    expect(m.tab).toMatchObject({ 'font-size': '11.5px', 'text-transform': 'uppercase' });
    expect(m.chip).toMatchObject({ 'font-size': '10.5px' });
    await panel(page).getByRole('tab', { name: 'Output' }).click();
    await zoom('output-empty');
    await panel(page).getByRole('tab', { name: 'Terminals' }).click();
    await stopStarter(page);
    await panel(page).getByRole('tab', { name: 'Output' }).click();
    await expect(panel(page).locator('.ide-output-entry')).toHaveCount(1);
    await zoom('output');
  });
}

import type { Locator, Page } from '@playwright/test';
import type { Session, ThreadItem } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { at, fleet, tool } from './thread';

// The IDE's groups (lot 3) at the mockup's size (docs/mockups/ledge-ide-interactive.html): a tab dragged to another group
// or to a new one keeps its page (its draft, its scroll), the group it leaves goes when emptied; split and the empty group,
// agent screens side by side, the link square, four groups in a narrow window, where a session opens, the Ledge mark.
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

/** A long thread (forty turns), long enough to scroll. */
const longThread: ThreadItem[] = Array.from({ length: 40 }, (_, i) => [
  { kind: 'prompt', id: `p${i}`, at: at(-900 + i * 20), turn: i + 1, text: `Étape ${i + 1} : écris le module ${i + 1}` } as ThreadItem,
  tool(`w${i}`, -895 + i * 20, 'Write', `/w/ledge/src/mod${i}.ts`, { turn: i + 1, durationMs: 200 }),
  { kind: 'reply', id: `r${i}`, at: at(-890 + i * 20), turn: i + 1, text: `Module ${i + 1} écrit. Les tests passent.` } as ThreadItem
]).flat();

/** Nova's thread writes files, so its bar has « +N −N » (the Changes beside). */
const novaThread: ThreadItem[] = longThread.map(i => (i.kind === 'tool' ? { ...i, files: [{ path: i.label, change: 'edit', diff: '- old\n+ new' }] } as ThreadItem : i));
/** A daemon that streams the agents' panes (`term.watch`, answered by the fake daemon), so each screen's connection can be counted. */
const STREAM = { version: '0.13.0', install: 'npm' as const, systemd: true, terminalStream: true };

const sessions: Session[] = [
  fleet.find(s => s.id === 'otto')!,
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', model: 'claude-opus-5-5' }),
  session('mia', { name: 'Mia', project: 'website', cwd: '/w/website', state: 'idle' })
];

const groups = (page: Page) => page.locator('.ide-dockview .dv-groupview');
const tabs = (page: Page) => page.locator('.ide-dockview .dv-tab');
const tabOf = (page: Page, name: string) => tabs(page).filter({ has: page.locator('.tab-name', { hasText: new RegExp(`^${name}`) }) });
const pane = (page: Page, name: string) => page.getByRole('tabpanel', { name: new RegExp(`^${name}`) });
const thread = (page: Page, name: string) => pane(page, name).locator('.session-thread');
const draft = (page: Page, name: string) => pane(page, name).locator('.session-reply textarea');
const scrollOf = (l: Locator) => l.evaluate(el => el.scrollTop);
const box = async (l: Locator) => (await l.boundingBox())!;

async function boot(page: Page, stream = false) {
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, threads: { otto: longThread, nova: novaThread }, ...(stream ? { daemon: STREAM } : {}) });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible();
  return daemon;
}
/** A tab whose label is its title alone (not a session's). */
const plainTab = (page: Page, title: string) => tabs(page).filter({ hasText: title });
const tabsIn = (page: Page, i: number) => groups(page).nth(i).locator('.dv-tab');
const split = (page: Page, i: number) => groups(page).nth(i).getByRole('button', { name: 'Split right (Ctrl+\\)' }).click();
const square = (page: Page, i: number) => groups(page).nth(i).locator('.ide-lk');
/** The workspace model as the store saved it (`ledge.ide.workspace`): each group's tab keys, in order. */
const model = (page: Page) => page.evaluate(() => {
  const w = JSON.parse(JSON.parse(localStorage.getItem('ledge.ide.workspace')!)) as { groups: { tabs: { kind: string; ref: string }[]; link: string | null }[] };
  return w.groups.map(g => ({ tabs: g.tabs.map(t => `${t.kind}:${t.ref}`), link: g.link }));
});
/** The thread's keyboard focus, then Ctrl+` : the session's tab shows its agent's screen. */
async function toTerminal(page: Page, name: string): Promise<void> {
  await thread(page, name).focus();
  await page.keyboard.press('Control+Backquote');
  await expect(pane(page, name).locator('.agent-view .terminal-screen')).toBeVisible();
}
const watches = (received: { type: string }[], id: string) => received.filter(m => m.type === 'term.watch' && (m as { id?: string }).id === id).length;
const unwatches = (received: { type: string }[]) => received.filter(m => m.type === 'term.unwatch').length;
async function open(page: Page, name: string): Promise<void> {
  const button = page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: 'Projects', exact: true });
  if (!(await button.getAttribute('class'))?.includes('on')) await button.click();
  await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(tabOf(page, name)).toHaveClass(/dv-active-tab/);
  await expect(pane(page, name).locator('.session-page')).toBeVisible({ timeout: 20_000 });
}
/** Scrolls a thread to the middle of its height and gives back where it stopped. */
async function toMiddle(l: Locator): Promise<number> {
  await expect.poll(() => l.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(1000);
  const top = await l.evaluate(el => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); el.dispatchEvent(new Event('scroll')); return el.scrollTop; });
  await l.page().waitForTimeout(150);
  return top;
}
/** A real mouse drag (dockview's HTML5 drag): picked up, carried a little so the drag starts, then over `to` and let go.
 *  `during` runs while the tab is held over the editing area. */
async function drag(page: Page, from: Locator, to: () => Promise<{ x: number; y: number }>, during?: () => Promise<void>): Promise<void> {
  const f = await box(from);
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2 + 20, f.y + f.height / 2 + 40, { steps: 5 });
  await during?.();
  const t = await to();
  await page.mouse.move(t.x, t.y, { steps: 10 });
  await page.mouse.move(t.x + 1, t.y + 1);
  await page.mouse.up();
}

test('Review Focus 2: Otto\'s tab dragged from A to B keeps its draft and its scroll; A, emptied, goes', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  // A holds Otto alone (the Atelier, open at start, closed).
  await tabs(page).filter({ hasText: 'Atelier' }).locator('.dv-default-tab-action').click();
  await expect(tabs(page)).toHaveCount(1);
  // B: split right, then Nova opened there.
  await page.getByRole('button', { name: 'Split right (Ctrl+\\)' }).first().click();
  await expect(groups(page)).toHaveCount(2);
  await open(page, 'Nova');
  await expect(groups(page).nth(1).locator('.dv-tab')).toHaveCount(1);
  await expect(groups(page).nth(0).locator('.dv-tab')).toHaveCount(1);

  // Otto's page: a draft, a scroll, and a mark on its DOM that a remount would lose.
  await draft(page, 'Otto').fill('brouillon gardé');
  const mid = await toMiddle(thread(page, 'Otto'));
  expect(mid).toBeGreaterThan(500);
  await thread(page, 'Otto').evaluate(el => { (el as HTMLElement & { ledgeMark?: number }).ledgeMark = 42; });

  const b = groups(page).nth(1).locator('.dv-content-container');
  await drag(page, tabOf(page, 'Otto'), async () => { const r = await box(b); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

  await expect(groups(page)).toHaveCount(1);
  await expect(groups(page).first().locator('.dv-tab')).toHaveCount(2);
  await expect(tabOf(page, 'Otto')).toHaveClass(/dv-active-tab/);
  await expect(thread(page, 'Otto')).toBeVisible();
  expect(await thread(page, 'Otto').evaluate(el => (el as HTMLElement & { ledgeMark?: number }).ledgeMark)).toBe(42);
  await expect(draft(page, 'Otto')).toHaveValue('brouillon gardé');
  await expect.poll(() => scrollOf(thread(page, 'Otto'))).toBeGreaterThanOrEqual(mid - 2);
  expect(Math.abs(await scrollOf(thread(page, 'Otto')) - mid)).toBeLessThanOrEqual(2);
});

test('« Déposer ici : nouveau groupe » shows while a tab is dragged; dropped there, the tab opens a group on the right', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  await expect(groups(page)).toHaveCount(1);
  const zone = page.locator('.ide-dropnew');
  await expect(zone).toBeHidden();
  await thread(page, 'Nova').evaluate(el => { (el as HTMLElement & { ledgeMark?: number }).ledgeMark = 7; });

  await drag(page, tabOf(page, 'Nova'), async () => { const r = await box(zone); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, async () => {
    await expect(zone).toBeVisible();
    await expect(zone).toHaveText('Drop here:new group');
    const z = await box(zone), area = await box(page.locator('.ide-dock-area'));
    // 140 px at the right end of the editing area.
    expect(z.width).toBe(140);
    expect(Math.abs(z.x + z.width - (area.x + area.width))).toBeLessThanOrEqual(1);
    await page.locator('.ide-editor').screenshot({ path: 'e2e/.results/ide-groups-dropnew.png' });
  });

  await expect(groups(page)).toHaveCount(2);
  await expect(zone).toBeHidden();
  // The Atelier (open at start) and Otto stay on the left.
  await expect(groups(page).nth(0).locator('.dv-tab')).toHaveCount(2);
  await expect(groups(page).nth(1).locator('.dv-tab')).toHaveCount(1);
  expect((await box(tabOf(page, 'Nova'))).x).toBeGreaterThan((await box(tabOf(page, 'Otto'))).x);
  await expect(tabOf(page, 'Nova')).toHaveClass(/dv-active-tab/);
  expect(await thread(page, 'Nova').evaluate(el => (el as HTMLElement & { ledgeMark?: number }).ledgeMark)).toBe(7);
});

test('a tab dropped on a group\'s left edge goes nowhere: no group stacked, nothing moved', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  const g = groups(page).first().locator('.dv-content-container');
  await drag(page, tabOf(page, 'Nova'), async () => { const r = await box(g); return { x: r.x + 8, y: r.y + r.height / 2 }; });
  await expect(groups(page)).toHaveCount(1);
  await expect(groups(page).first().locator('.dv-tab')).toHaveCount(3);   // the Atelier, Otto, Nova
  await expect(tabOf(page, 'Nova')).toHaveClass(/dv-active-tab/);
});

test('a tab dragged before another in its own strip changes the model\'s order, without being remounted', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  await expect(tabsIn(page, 0)).toHaveCount(3);   // the Atelier, Otto, Nova
  expect((await model(page))[0]!.tabs).toEqual(['atelier:main', 'session:local:otto', 'session:local:nova']);
  await thread(page, 'Nova').evaluate(el => { (el as HTMLElement & { ledgeMark?: number }).ledgeMark = 9; });
  await draft(page, 'Nova').fill('pas perdu');
  // Onto the Atelier's tab, left of its middle: Nova goes first.
  const atelier = plainTab(page, 'Atelier');
  await drag(page, tabOf(page, 'Nova'), async () => { const r = await box(atelier); return { x: r.x + r.width / 4, y: r.y + r.height / 2 }; });
  await expect.poll(async () => (await model(page))[0]!.tabs).toEqual(['session:local:nova', 'atelier:main', 'session:local:otto']);
  await expect(groups(page)).toHaveCount(1);
  const names = await tabsIn(page, 0).evaluateAll(ts => ts.map(t => t.textContent ?? ''));
  expect(names[0]).toMatch(/^Nova/);
  expect(names[1]).toContain('Atelier');
  expect(names[2]).toMatch(/^Otto/);
  await expect(tabOf(page, 'Nova')).toHaveClass(/dv-active-tab/);
  expect(await thread(page, 'Nova').evaluate(el => (el as HTMLElement & { ledgeMark?: number }).ledgeMark)).toBe(9);
  await expect(draft(page, 'Nova')).toHaveValue('pas perdu');
});

test('split from a session: the empty group, « Terminal · Otto » first, then its attached screen; the R2 note when the session\'s tab takes it', async ({ page }) => {
  await boot(page, true);
  await open(page, 'Otto');
  await page.keyboard.press('Control+\\');
  await expect(groups(page)).toHaveCount(2);
  const empty = groups(page).nth(1).locator('.ide-empty');
  await expect(empty).toBeVisible();
  await expect(tabsIn(page, 1)).toHaveCount(0);
  await expect(groups(page).nth(1)).toHaveClass(/dv-active-group/);
  await expect(empty.getByRole('heading', { name: 'Empty group' })).toBeVisible();
  await expect(empty).toContainText('Drag a tab here, open a session from the explorer, or:');
  expect(await empty.getByRole('button').allTextContents()).toEqual(['Terminal · Otto', 'New session', 'OpenRig', 'Settings', 'Atelier']);
  await expect(empty).toContainText('Tip: link this group');
  await groups(page).nth(1).screenshot({ path: 'e2e/.results/ide-empty-group.png' });
  await page.screenshot({ path: 'e2e/.results/ide-empty-group-full.png' });

  await empty.getByRole('button', { name: 'Terminal · Otto' }).click();
  const term = plainTab(page, '>_ Otto · tmux');
  await expect(term).toHaveClass(/dv-active-tab/);
  await expect(tabsIn(page, 1)).toHaveCount(1);
  const tp = pane(page, '>_ Otto');
  await expect(tp.locator('.chip-k')).toHaveText('attached');
  await expect(tp.locator('.terminal-screen .xterm')).toBeVisible();
  await expect(tp.locator('.terminal-footer')).toContainText('Attached');

  // Otto's own tab goes to its terminal view: the screen is the session's one (R2), the Terminal tab says where it went.
  await toTerminal(page, 'Otto');
  await expect(tp.locator('.term-banner')).toContainText('Terminal shown in the other group');
  await tp.getByRole('button', { name: 'Show here' }).click();
  await expect(tp.locator('.terminal-screen .xterm')).toBeVisible();
  await expect(pane(page, 'Otto').locator('.term-banner')).toContainText('Terminal shown in the other group');
});

test('Review Focus 3: split from the Atelier, the empty group offers no « Terminal · … »', async ({ page }) => {
  await boot(page);
  await expect(tabs(page)).toHaveCount(1);   // the Atelier
  await split(page, 0);
  const empty = groups(page).nth(1).locator('.ide-empty');
  await expect(empty).toBeVisible();
  expect(await empty.getByRole('button').allTextContents()).toEqual(['New session', 'OpenRig', 'Settings', 'Atelier']);
  await expect(empty).not.toContainText('Tip:');
  // « Settings » opens in the empty group.
  await empty.getByRole('button', { name: 'Settings' }).click();
  await expect(tabsIn(page, 1)).toHaveCount(1);
  await expect(tabsIn(page, 1).first()).toContainText('Settings');
});

test('Review Focus 1: two sessions on their screens side by side stay attached while the focus goes from one to the other and the daemon updates', async ({ page }) => {
  const daemon = await boot(page, true);
  await open(page, 'Otto');
  await toTerminal(page, 'Otto');
  await split(page, 0);
  await expect(groups(page).nth(1)).toHaveClass(/dv-active-group/);
  await open(page, 'Nova');
  await expect(tabsIn(page, 1)).toHaveCount(1);
  await toTerminal(page, 'Nova');
  const screens = page.locator('.ide-dockview .agent-view .terminal-screen .xterm');
  await expect(screens).toHaveCount(2);
  for (const n of ['Otto', 'Nova']) {
    await expect(pane(page, n).locator('.terminal-footer')).toContainText('Attached');
    await pane(page, n).locator('.terminal-screen .xterm').evaluate((el, m) => { (el as HTMLElement & { ledgeMark?: string }).ledgeMark = m; }, n);
  }
  await expect.poll(() => watches(daemon.received, 'otto')).toBe(1);
  await expect.poll(() => watches(daemon.received, 'nova')).toBe(1);

  // A click in a group's content focuses it; back and forth, then the daemon updates both sessions.
  for (const i of [0, 1, 0, 1]) {
    await groups(page).nth(i).locator('.terminal-footer').click();
    await expect(groups(page).nth(i)).toHaveClass(/dv-active-group/);
    await expect(groups(page).nth(1 - i)).not.toHaveClass(/dv-active-group/);
  }
  daemon.upsert({ ...sessions[1]!, lastActivityAt: new Date().toISOString(), state: 'idle' });
  daemon.upsert({ ...sessions[0]!, lastActivityAt: new Date().toISOString() });
  await page.waitForTimeout(500);
  for (const n of ['Otto', 'Nova']) {
    await expect(pane(page, n).locator('.terminal-footer')).toContainText('Attached');
    expect(await pane(page, n).locator('.terminal-screen .xterm').evaluate(el => (el as HTMLElement & { ledgeMark?: string }).ledgeMark)).toBe(n);
  }
  expect(watches(daemon.received, 'otto')).toBe(1);
  expect(watches(daemon.received, 'nova')).toBe(1);
  expect(unwatches(daemon.received)).toBe(0);
});

test('Review Focus 4: a group linked with Changes in front follows the session chosen in its peer; unlinked, it stops', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  // « +N −N »: Nova's Changes beside, in a group of the same colour.
  await pane(page, 'Nova').locator('.ide-bar .dchip').click();
  await expect(groups(page)).toHaveCount(2);
  await expect(plainTab(page, 'Changes · Nova')).toBeVisible();
  await expect(square(page, 0)).toHaveClass(/\bviolet\b/);
  await expect(square(page, 1)).toHaveClass(/\bviolet\b/);
  await expect(groups(page).nth(0).locator('.ide-lkbtn')).toHaveAttribute('title', 'Link this group (violet, teal, none)');

  await tabOf(page, 'Otto').click();
  await expect(tabsIn(page, 1)).toHaveCount(1);
  await expect(tabsIn(page, 1).first()).toContainText('Changes · Otto');
  await page.screenshot({ path: 'e2e/.results/ide-groups-linked.png' });

  // Violet → teal → none: no longer linked to the session's group.
  await groups(page).nth(1).locator('.ide-lkbtn').click();
  await expect(square(page, 1)).toHaveClass(/\bteal\b/);
  await groups(page).nth(1).locator('.ide-lkbtn').click();
  await expect(square(page, 1)).toHaveClass(/\bnone\b/);
  expect((await model(page))[1]!.link).toBeNull();
  await tabOf(page, 'Nova').click();
  await expect(tabOf(page, 'Nova')).toHaveClass(/dv-active-tab/);
  await page.waitForTimeout(300);
  await expect(tabsIn(page, 1)).toHaveCount(1);
  await expect(tabsIn(page, 1).first()).toContainText('Changes · Otto');
});

test('the mockup\'s groups: a session, its linked Changes, an empty group; screenshot', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  await pane(page, 'Nova').locator('.ide-bar .dchip').click();
  await expect(plainTab(page, 'Changes · Nova')).toBeVisible();
  await split(page, 1);
  await expect(groups(page)).toHaveCount(3);
  await expect(groups(page).nth(2).locator('.ide-empty')).toBeVisible();
  await groups(page).nth(0).locator('.session-thread').click({ position: { x: 20, y: 20 } });
  await expect(groups(page).nth(0)).toHaveClass(/dv-active-group/);
  // The new Ledge mark in the title bar, 16 px.
  const mark = page.locator('.ide-titlebar .ide-brand svg[data-ledge-mark]');
  await expect(mark).toBeVisible();
  expect((await box(mark)).width).toBe(16);
  await page.screenshot({ path: 'e2e/.results/ide-groups.png' });
  await page.screenshot({ path: test.info().outputPath('ide-groups.png') });
});

test('Review Focus 5: four groups in a 1280 px window keep 300 px each, the editing area scrolls, every tab can be reached', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1080 });
  await boot(page);
  await open(page, 'Otto');
  await split(page, 0);
  await open(page, 'Nova');
  await expect(tabsIn(page, 1)).toHaveCount(1);
  await split(page, 1);
  await split(page, 2);
  await expect(groups(page)).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const w = (await box(groups(page).nth(i))).width;
    expect(w, `group ${i}`).toBeGreaterThanOrEqual(299);
  }
  const scroller = page.locator('.ide-dock-scroll');
  const sizes = await scroller.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(sizes.sw).toBeGreaterThan(sizes.cw);
  // Each tab, scrolled to, lies inside the visible area and takes a click.
  const area = await box(scroller);
  for (const t of await tabs(page).all()) {
    await t.scrollIntoViewIfNeeded();
    const b = await box(t);
    expect(b.x).toBeGreaterThanOrEqual(area.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width + 1);
    await t.click();
    await expect(t).toHaveClass(/dv-active-tab/);
  }
  // The last group's empty page, at the far right, too.
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  const last = await box(groups(page).nth(3).locator('.ide-empty'));
  expect(last.x + last.width).toBeLessThanOrEqual(area.x + area.width + 1);
  await page.screenshot({ path: 'e2e/.results/ide-groups-narrow.png' });
  await groups(page).nth(1).screenshot({ path: 'e2e/.results/ide-groups-narrow-nova.png' });
});

test('Ctrl+click in the explorer opens to the right; the setting « To the right » makes a plain click do it', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await expect(groups(page)).toHaveCount(1);
  await page.getByRole('tree').getByRole('button', { name: /^Nova/ }).first().click({ modifiers: ['Control'] });
  await expect(groups(page)).toHaveCount(2);
  await expect(tabsIn(page, 1)).toHaveCount(1);
  await expect(tabsIn(page, 1).first()).toContainText('Nova');
  await expect(groups(page).nth(1)).toHaveClass(/dv-active-group/);

  // Settings › Workspace › « Open a session »: to the right.
  await page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: 'Settings (tab)' }).click();
  await page.locator('.settings-nav').getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('radio', { name: 'To the right' }).check();
  expect(await page.evaluate(() => localStorage.getItem('ledge.ide.openSession'))).toContain('right');
  const before = await groups(page).count();
  await page.getByRole('tree').getByRole('button', { name: /^Mia/ }).first().click();
  await expect(groups(page)).toHaveCount(before + 1);
  await expect(tabOf(page, 'Mia')).toHaveClass(/dv-active-tab/);
  // An open session is only brought forward, never duplicated or moved.
  await page.getByRole('tree').getByRole('button', { name: /^Otto/ }).first().click();
  await expect(groups(page)).toHaveCount(before + 1);
  await expect(tabOf(page, 'Otto')).toHaveClass(/dv-active-tab/);
});

// BUG (Task 4): the link square is dockview's `leftHeaderActionsComponent`, which dockview draws AFTER the tabs (`.dv-left-actions-container`
// follows `.dv-scrollable`); the mockup's `.lkbtn` and the empty group's tip (« the square left of the tabs ») put it before them.
// dockview's `prefixHeaderActionsComponent` (`.dv-pre-actions-container`) is the slot left of the tabs.
test.fixme('the link square sits left of the tabs, as the mockup\'s .lkbtn', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  const sq = await box(groups(page).nth(0).locator('.ide-lkbtn'));
  const first = await box(tabsIn(page, 0).first());
  const strip = await box(groups(page).nth(0).locator('.dv-tabs-and-actions-container'));
  expect(Math.abs(sq.x - strip.x)).toBeLessThanOrEqual(1);
  expect(sq.x + sq.width).toBeLessThanOrEqual(first.x + 1);
});

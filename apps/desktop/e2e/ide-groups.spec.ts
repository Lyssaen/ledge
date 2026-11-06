import type { Locator, Page } from '@playwright/test';
import type { ThreadItem } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { at, fleet, tool } from './thread';

// The IDE's groups (lot 3) at the mockup's size (docs/mockups/ledge-ide-interactive.html): a tab dragged to another group
// or to a new one keeps its page (its draft, its scroll), the group it leaves goes when emptied.
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

const sessions = [
  fleet.find(s => s.id === 'otto')!,
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', model: 'claude-opus-5-5' })
];

const groups = (page: Page) => page.locator('.ide-dockview .dv-groupview');
const tabs = (page: Page) => page.locator('.ide-dockview .dv-tab');
const tabOf = (page: Page, name: string) => tabs(page).filter({ has: page.locator('.tab-name', { hasText: new RegExp(`^${name}`) }) });
const pane = (page: Page, name: string) => page.getByRole('tabpanel', { name: new RegExp(`^${name}`) });
const thread = (page: Page, name: string) => pane(page, name).locator('.session-thread');
const draft = (page: Page, name: string) => pane(page, name).locator('.session-reply textarea');
const scrollOf = (l: Locator) => l.evaluate(el => el.scrollTop);
const box = async (l: Locator) => (await l.boundingBox())!;

async function boot(page: Page): Promise<void> {
  await fakeDaemon(page, sessions, { projects: twoProjects, threads: { otto: longThread, nova: longThread } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible();
}
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

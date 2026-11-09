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

async function boot(page: Page) {
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
  await pop.screenshot({ path: 'e2e/.results/lot9-popout.png' });
});

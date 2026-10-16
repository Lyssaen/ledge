import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, session, twoProjects } from './daemon';

const kit = session('kit', { name: 'Kit', cwd: '/tmp/scratch', project: 'scratch' });
const fleet = [...eight.map(s => s.id === 'otto' ? { ...s, pending: { kind: 'permission' as const, text: 'npm test', source: 'hook' as const } } : s), kit];
const crowd30 = Array.from({ length: 30 }, (_, i) => { const n = String(i + 1).padStart(2, '0'); return session(`p${n}`, { name: `P${n}`, cwd: '/w/ledge', project: 'ledge' }); });

const list = (page: Page) => page.locator('.overview-scroll.list');
const row = (page: Page, name: string) => page.getByRole('listitem', { name: new RegExp(`^${name},`) });

test('the List groups by project, what waits first, Sans projet last; activity reads in minutes', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await expect(page.locator('.lgroup')).toHaveCount(3);
  expect(await page.locator('.lgroup').evaluateAll(gs => gs.map(g => g.getAttribute('aria-label')))).toEqual(['Ledge', 'Website', 'No project']);
  await expect(page.getByRole('region', { name: 'Ledge' }).getByRole('listitem').first()).toHaveAccessibleName(/^Otto,/);
  await expect(row(page, 'Otto').locator('.r-when')).toHaveText('for 5 min');
  await expect(row(page, 'Nova').locator('.r-when')).toHaveText('5 min ago');
});
test('F filters, J walks, Enter opens; Escape comes back to the List', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await page.keyboard.press('f');
  await page.keyboard.type('web');
  await expect(page.locator('.lgroup')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Luna')).toBeFocused();
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('banner').getByText('Milo')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
});
test('Allow from a row: the daemon gets one decision, the row follows the agent', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await row(page, 'Otto').hover();
  await row(page, 'Otto').getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept' }]);
  daemon.upsert({ ...fleet[0]!, state: 'working', pending: undefined });
  await expect(row(page, 'Otto').getByText('Running')).toBeVisible();
});
test('drag Kit from Sans projet onto the Ledge group: the daemon gets the rule, Kit joins it', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await row(page, 'Kit').dragTo(page.getByRole('region', { name: 'Ledge' }));
  await expect(page.getByRole('region', { name: 'Ledge' }).getByRole('listitem', { name: /^Kit,/ })).toBeVisible();
  expect(daemon.received).toContainEqual(expect.objectContaining({ type: 'projects.set', projects: expect.objectContaining({ rules: [{ machine: 'local', path: '/tmp/scratch', project: 'ledge' }] }) }));
});
test('under 780 px machine and activity go under the task, nothing scrolls sideways; group headers stay under the toolbar', async ({ page }) => {
  await fakeDaemon(page, crowd30, { projects: twoProjects });
  await page.setViewportSize({ width: 760, height: 700 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  const first = row(page, 'P01');
  const title = (await first.locator('.r-title').boundingBox())!, ctx = (await first.locator('.r-ctx').boundingBox())!;
  expect(ctx.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
  expect(await list(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await list(page).evaluate(el => { el.scrollTop = 900; });
  const bar = (await page.locator('.list-toolbar').boundingBox())!, head = (await page.locator('.lgroup[aria-label="Ledge"] .lgroup-head').boundingBox())!;
  expect(Math.abs(head.y - (bar.y + bar.height))).toBeLessThan(2);
});
test('grouping and density survive a reload', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await page.getByRole('radio', { name: 'Machine' }).click();
  await page.getByRole('button', { name: 'Compact rows' }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Machine' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.list-view')).toHaveClass(/density-tight/);
});

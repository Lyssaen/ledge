import type { Page } from '@playwright/test';
import type { Projects } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, session } from './daemon';

const twoProjects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'website', name: 'Website', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/website' }] }
  ],
  rules: []
};
const kit = session('kit', { name: 'Kit', cwd: '/tmp/scratch', project: 'scratch' });
const helper = (id: string) => ({ id, kind: 'Explore', task: `Task ${id}`, state: 'working' as const });
const crowd = [
  ...eight.map(s => s.id === 'otto' ? { ...s, helpers: ['o1', 'o2', 'o3'].map(helper) } : s.id === 'nova' ? { ...s, helpers: ['n1', 'n2'].map(helper) } : s),
  ...['ada', 'zed', 'zia'].map(id => session(id, { name: id[0]!.toUpperCase() + id.slice(1), cwd: '/w/ledge', project: 'ledge' }))
];

const scroller = (page: Page) => page.locator('.overview-scroll.atelier');
const noScroll = (page: Page) => scroller(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1);
const level = (page: Page) => page.getByRole('toolbar', { name: 'Atelier zoom' }).getByRole('button', { name: 'Back to 100 %' });
const pct = async (page: Page) => Number.parseInt((await level(page).textContent())!, 10);
const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('at fit nothing scrolls; Ctrl + wheel zooms under the pointer; + - 0', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/');
  const ledge = page.getByRole('region', { name: 'Ledge table' });
  await expect(ledge).toBeVisible();
  expect(await noScroll(page)).toBe(true);
  const fitted = await level(page).textContent();
  const fit = await pct(page);
  expect(fit).toBeGreaterThanOrEqual(40);
  expect(fit).toBeLessThanOrEqual(180);
  // Ctrl + wheel with the pointer on a seat: the seat stays under it.
  const seat = ledge.locator('.agent-seat:not(.helper-seat)').first();
  const b0 = center((await seat.boundingBox())!);
  await page.mouse.move(b0.x, b0.y);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
  await expect(level(page)).not.toHaveText(fitted!);
  const zoomed = await pct(page);
  expect(zoomed).toBeGreaterThan(fit);
  const b1 = center((await seat.boundingBox())!);
  expect(Math.hypot(b1.x - b0.x, b1.y - b0.y), 'the seat stays near the pointer').toBeLessThan(60);
  // 0 refits, + and - step.
  await page.keyboard.press('0');
  await expect(level(page)).toHaveText(fitted!);
  expect(await noScroll(page)).toBe(true);
  await page.keyboard.press('+');
  await expect.poll(() => pct(page)).toBeGreaterThan(fit);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect.poll(() => pct(page)).toBeLessThan(fit);
  await page.keyboard.press('0');
  await expect(level(page)).toHaveText(fitted!);
});

test('double-click frames a table, the floor fits again; legend and zoom bar stay put; dragging the floor pans', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/');
  const legend = page.locator('.workspace-legend');
  await expect(legend).toBeVisible();
  const before = await legend.boundingBox();
  const bar = page.getByRole('toolbar', { name: 'Atelier zoom' });
  const barBefore = await bar.boundingBox();
  const fit = await pct(page);
  const table = page.getByRole('region', { name: 'Website table' });
  await table.locator('.office-rug').dblclick({ position: { x: 20, y: 60 } });
  await expect(page.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'false');
  expect(await pct(page)).toBeGreaterThan(fit);
  const t = (await table.boundingBox())!, v = (await scroller(page).boundingBox())!;
  expect(Math.abs(t.x + t.width / 2 - (v.x + v.width / 2))).toBeLessThan(v.width * 0.1);
  expect(Math.abs(t.y + t.height / 2 - (v.y + v.height / 2))).toBeLessThan(v.height * 0.1);
  expect(t.width).toBeGreaterThan(v.width * 0.5);
  expect(await legend.boundingBox()).toEqual(before);
  expect(await bar.boundingBox()).toEqual(barBefore);
  // Panning: drag the empty floor, the scroll moves.
  await page.keyboard.press('-');
  await page.keyboard.press('+');   // zoomed, so there is something to pan (the framed level overflows)
  const s0 = await scroller(page).evaluate(el => ({ l: el.scrollLeft, t: el.scrollTop, overflow: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight }));
  expect(s0.overflow).toBe(true);
  const x = v.x + 12, y = v.y + v.height - 12;   // the floor margin, outside any seat or label
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y - 50, { steps: 5 }); await page.mouse.up();
  const s1 = await scroller(page).evaluate(el => ({ l: el.scrollLeft, t: el.scrollTop }));
  expect(s1.l !== s0.l || s1.t !== s0.t, 'the scroll moved').toBe(true);
  await page.locator('.office-shell').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await noScroll(page)).toBe(true);
});

test('a resize and full screen refit without scrollbars', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(() => noScroll(page)).toBe(true);
  const narrow = await pct(page);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('aside.sidebar')).toBeHidden();
  await expect.poll(() => pct(page)).toBeGreaterThanOrEqual(narrow);
  expect(await noScroll(page)).toBe(true);
});

test('drag Kit from Sans projet onto a table: the daemon gets the rule, Kit sits there', async ({ page }) => {
  const daemon = await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/');
  await page.locator('.unassigned-card', { hasText: 'Kit' }).dragTo(page.getByRole('region', { name: 'Ledge table' }));
  await expect(page.getByRole('region', { name: 'Ledge table' }).getByRole('button', { name: /^Kit,/ })).toBeVisible();
  expect(daemon.received).toContainEqual(expect.objectContaining({ type: 'projects.set', projects: expect.objectContaining({ rules: [{ machine: 'local', path: '/tmp/scratch', project: 'ledge' }] }) }));
  await expect(page.locator('.toast')).toHaveText('Kit joins the Ledge table. Ledge will remember this folder.');
});

test('a crowded table: six seats, four at the ends, +N opens the List on the project', async ({ page }) => {
  await fakeDaemon(page, crowd, { projects: twoProjects });
  await page.goto('/');
  const table = page.getByRole('region', { name: 'Ledge table' });
  await expect(table.locator('.agent-seat:not(.helper-seat)')).toHaveCount(6);
  await expect(table.locator('.helper-seat')).toHaveCount(4);
  await table.getByRole('button', { name: /\+3 at this table/ }).click();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('banner').getByText('Ledge')).toBeVisible();
});

test('a long project name on the rug is cut with an ellipsis and stays inside the rug', async ({ page }) => {
  const long = { projects: [{ ...twoProjects.projects[0]!, name: 'Payment Service Platform Migration Europe' }, twoProjects.projects[1]!], rules: [] };
  await fakeDaemon(page, eight, { projects: long });
  await page.goto('/');
  const table = page.getByRole('region', { name: 'Payment Service Platform Migration Europe table' });
  const name = table.getByRole('button', { name: /^Conversations of project/ });
  await expect(name).toHaveAttribute('title', 'Payment Service Platform Migration Europe');
  expect(await name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const label = (await table.locator('.room-heading').boundingBox())!, rug = (await table.locator('.office-rug').boundingBox())!;
  expect(label.x + label.width).toBeLessThanOrEqual(rug.x + rug.width);
});

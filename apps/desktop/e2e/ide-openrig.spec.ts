import type { Page } from '@playwright/test';
import type { OpenRigState, RigSpec } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { RIG_7A } from './openrig-fixtures';

// The IDE's launch modal and OpenRig page (lot 7d): « + Launch » in the Rigs view, the daemon row and « Manage machines… » opening the
// page's sections, the page in a narrow group, and a restored OpenRig tab.
test.use({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });

const seat = (logicalId: string, runtime: string) => ({ logicalId, session: `${logicalId.replace('.', '-')}@ledge-survey`, runtime, model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
const rig = (id: string, name: string) => ({ id, name, status: 'running' as const, lifecycleState: 'running', seats: 2, running: 2, attention: 0, uptime: '2h', snapshot: null, nodes: [seat('dev.build', 'claude-code'), seat('dev.review', 'codex')] });
const state = {
  installed: true, version: '0.7.10', daemon: { state: 'running' as const, pid: 1, port: 7433 }, kernel: { state: 'ready' as const }, at: new Date().toISOString(),
  rigs: [rig('1', 'ledge-survey'), { ...rig('k', 'kernel'), nodes: [], seats: 1, running: 1 }]
};
const starter: RigSpec = { name: 'starter', source: 'builtin', path: '/specs/starter.yaml', edges: 0, pods: [{ id: 'dev', members: [{ id: 'builder', runtime: 'claude-code', agent: 'x' }, { id: 'reviewer', runtime: 'codex', agent: 'x' }] }] };
const sessions = [session('otto')];
const rigsButton = (page: Page) => page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: 'OpenRig rigs' });
const view = (page: Page) => page.getByRole('complementary', { name: 'Rigs' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Launch a rig' });
const orp = (page: Page) => page.locator('.ide-orp');
const orpTab = (page: Page) => page.locator('.dv-tab').filter({ hasText: 'OpenRig · WSL' });

async function boot(page: Page) {
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, sessions, {
    projects: twoProjects, openrig: state as unknown as OpenRigState, rigSpecs: [starter], machines: [{ id: 'local', label: 'WSL' }], ...RIG_7A,
    daemon: { version: '0.53.0', install: 'npm', systemd: true, openrigRig: true, openrigPolicy: true, openrigFresh: true, ping: true }
  });
  await page.goto('/');
  await rigsButton(page).click();
  await expect(view(page)).toBeVisible();
  return daemon;
}

test('« + Launch » opens the modal: starter, a folder, Ctrl+Enter launches and opens « Rig · starter »', async ({ page }) => {
  const daemon = await boot(page);
  await view(page).getByRole('button', { name: /Launch/ }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: /starter/ }).click();
  await dialog(page).getByLabel('Folder').fill('/w/ledge');
  await page.keyboard.press('Control+Enter');
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => daemon.received.filter(m => m.type === 'openrig.launch' && !(m.launch as { plan?: boolean }).plan)).toEqual([
    expect.objectContaining({ launch: expect.objectContaining({ name: 'starter', cwd: '/w/ledge' }) })
  ]);
  await expect(page.locator('.dv-tab').filter({ hasText: 'Rig · starter' })).toBeVisible();
});

test('Escape closes the modal and launches nothing', async ({ page }) => {
  const daemon = await boot(page);
  await view(page).getByRole('button', { name: /Launch/ }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(daemon.received.filter(m => m.type === 'openrig.launch')).toEqual([]);
});

test('the daemon row opens « OpenRig · WSL » on the Overview; « Manage machines… » opens the Machines section', async ({ page }) => {
  await boot(page);
  await view(page).getByRole('button', { name: 'Daemon', exact: true }).click();
  await expect(orpTab(page)).toBeVisible();
  await expect(orp(page).getByRole('heading', { name: 'Overview' })).toBeVisible();
  // The tab remembers a section; the row still brings the Overview back.
  await orp(page).getByRole('navigation').getByRole('button', { name: /^Machines/ }).click();
  await expect(orp(page).getByRole('heading', { name: 'Machines' })).toBeVisible();
  await view(page).getByRole('button', { name: 'Daemon', exact: true }).click();
  await expect(orp(page).getByRole('heading', { name: 'Overview' })).toBeVisible();

  await view(page).getByRole('button', { name: /WSL/ }).first().click();
  await page.getByRole('menuitem', { name: 'Manage machines…' }).click();
  await expect(orp(page).getByRole('heading', { name: 'Machines' })).toBeVisible();
});

test('in a narrow group (two groups side by side) the page is a row of tabs with no horizontal scroll', async ({ page }) => {
  await boot(page);
  await view(page).getByRole('button', { name: 'Daemon', exact: true }).click();
  await expect(orp(page)).toBeVisible();
  await page.keyboard.press('Control+b');
  await page.getByRole('button', { name: 'Split right (Ctrl+\\)' }).first().click();
  await expect(page.locator('.dv-groupview')).toHaveCount(2);
  // Narrow the group below the 640 px breakpoint: a third and a fourth group.
  await page.getByRole('button', { name: 'Split right (Ctrl+\\)' }).first().click();
  await page.getByRole('button', { name: 'Split right (Ctrl+\\)' }).first().click();
  await expect(page.locator('.dv-groupview')).toHaveCount(4);
  const group = page.locator('.dv-groupview').filter({ has: orp(page) });
  await expect.poll(async () => (await group.boundingBox())!.width).toBeLessThan(640);
  // The rail is a row above the body (not a column beside it), its tabs side by side.
  const rail = (await orp(page).locator('.ide-orp-rail').boundingBox())!, body = (await orp(page).locator('.ide-orp-main').boundingBox())!;
  expect(rail.y + rail.height).toBeLessThanOrEqual(body.y + 1);
  expect(rail.width).toBeGreaterThan(body.width - 2);
  const nav = orp(page).getByRole('navigation').getByRole('button');
  const ys = await Promise.all((await nav.all()).map(async b => Math.round((await b.boundingBox())!.y)));
  expect(ys.filter(y => y === ys[0]).length).toBeGreaterThan(1);
  expect(await orp(page).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await group.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test('an OpenRig tab restored after a reload reads the daemon again, then shows the Overview (the section is not saved)', async ({ page }) => {
  await boot(page);
  await view(page).getByRole('button', { name: 'Daemon', exact: true }).click();
  await orp(page).getByRole('navigation').getByRole('button', { name: /^Daemon/ }).click();
  await expect(orp(page).getByRole('heading', { name: 'Daemon' })).toBeVisible();
  await page.reload();
  await expect(orpTab(page)).toBeVisible();
  await expect(orp(page).getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(orp(page).getByRole('region', { name: 'Overview' })).toContainText('0.7.10');
});

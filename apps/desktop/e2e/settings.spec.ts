import type { Page } from '@playwright/test';
import type { ClientMessage, Projects } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, fakeRemote, session, twoProjects } from './daemon';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' });
/** A section's tab: its name, then its alert when it has one. */
const tab = (page: Page, name: string) => nav(page).getByRole('button', { name: new RegExp(`^${name}( |$)`) });
const heading = (page: Page) => page.locator('.settings-head h1');
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });
const pageNoSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

/** The app is up (its keys bound), then Ctrl , opens the settings on General. */
async function openSettings(page: Page) {
  await expect(page.locator('aside.sidebar').getByText(/\d+ agents?/).first()).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await expect(heading(page)).toHaveText('General');
}

test('Ctrl , then Appearance › Light: the page takes the light theme, « Setting saved » says it once, Escape goes back to the atelier', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  await openSettings(page);
  await expect(tab(page, 'General')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();
  await tab(page, 'Appearance').click();
  await expect(heading(page)).toHaveText('Appearance');
  const themes = page.getByRole('radiogroup', { name: 'Theme' });
  await expect(themes.getByRole('radio', { name: /Dark/ })).toBeChecked();
  await themes.getByText('Light', { exact: true }).click();
  await expect(themes.getByRole('radio', { name: /Light/ })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(toast(page, 'Setting saved · Light theme · Pebble')).toHaveCount(1);
  // The light tokens reach the page itself, not only the attribute.
  await expect.poll(background).not.toBe(dark);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await expect(nav(page)).toHaveCount(0);
  // Kept: a reload stays light.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('Machines › Add a machine: an SSH server shows once the daemon broadcasts the list, offline, and the Machines tab lights its alert; Remove takes it away', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects });
  const remote = await fakeRemote(page, 'gpu-box', []);
  remote.close();   // the server never answers: it is saved offline
  await page.goto('/');
  await openSettings(page);
  await tab(page, 'Machines').click();
  await expect(heading(page)).toHaveText('Machines');
  const alert = tab(page, 'Machines').getByRole('img', { name: 'A machine is offline' });
  await expect(page.getByRole('article', { name: 'Local' })).toContainText('Connected');
  await expect(alert).toHaveCount(0);

  await page.getByRole('button', { name: 'Add a machine' }).click();
  const form = page.getByRole('form', { name: 'Add a machine' });
  await form.getByRole('textbox', { name: 'Machine name' }).fill('GPU box');
  await form.getByRole('textbox', { name: 'SSH alias' }).fill('gpu-box');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  const sets = daemon.received.filter((m): m is Extract<ClientMessage, { type: 'machines.set' }> => m.type === 'machines.set');
  expect(sets).toHaveLength(1);
  expect(sets[0]!.machines).toEqual([{ id: 'local', label: 'Local' }, expect.objectContaining({ label: 'GPU box', ssh: 'gpu-box' })]);
  const gpu = page.getByRole('article', { name: 'GPU box' });
  await expect(gpu).toContainText('SSH · gpu-box');
  await expect(toast(page, 'Setting saved · GPU box added')).toHaveCount(1);
  await expect(gpu).toContainText('Offline');
  await expect(alert).toBeVisible();
  // The app's sidebar lists it too, offline.
  await expect(page.locator('aside.sidebar .side-machine', { hasText: 'GPU box' })).toContainText('offline');

  await gpu.getByRole('button', { name: 'Remove' }).click();
  await expect(gpu.getByRole('alert')).toContainText('Remove GPU box?');
  await gpu.getByRole('alert').getByRole('button', { name: 'Remove' }).click();
  await expect(gpu).toHaveCount(0);
  await expect(toast(page, 'Setting saved · GPU box removed')).toHaveCount(1);
  await expect(alert).toHaveCount(0);
  await expect(page.locator('aside.sidebar .side-machine', { hasText: 'GPU box' })).toHaveCount(0);
  const last = daemon.received.filter(m => m.type === 'machines.set').at(-1) as Extract<ClientMessage, { type: 'machines.set' }>;
  expect(last.machines).toEqual([{ id: 'local', label: 'Local' }]);
});

test('Projects › a remembered folder re-pointed to Website: its filed agent leaves the Ledge table for the Website table once the daemon broadcasts', async ({ page }) => {
  // Kit works in /tmp/scratch, a folder Ledge remembers: it sits at the Ledge table.
  const kit = session('kit', { name: 'Kit', cwd: '/tmp/scratch', project: 'scratch' });
  const projects: Projects = { ...twoProjects, rules: [{ machine: 'local', path: '/tmp/scratch', project: 'ledge' }] };
  const daemon = await fakeDaemon(page, [...eight, kit], { projects });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Ledge table' }).getByRole('button', { name: /^Kit,/ })).toBeVisible();
  await openSettings(page);
  await tab(page, 'Projects').click();
  await expect(heading(page)).toHaveText('Projects');
  const ledge = page.getByRole('article', { name: 'Ledge' });
  const website = page.getByRole('article', { name: 'Website' });
  await expect(ledge).toContainText('6 agents');
  await expect(website).toContainText('3 agents');
  const rule = page.getByRole('article', { name: '/tmp/scratch on Local' });
  const target = rule.getByRole('combobox', { name: 'Project for /tmp/scratch' });
  await expect(target).toHaveValue('ledge');
  await target.selectOption('website');
  await expect(toast(page, 'Setting saved · /tmp/scratch → Website')).toHaveCount(1);
  await expect(target).toHaveValue('website');
  const sent = daemon.received.filter((m): m is Extract<ClientMessage, { type: 'projects.set' }> => m.type === 'projects.set');
  expect(sent).toHaveLength(1);
  expect(sent[0]!.projects.rules).toEqual([{ machine: 'local', path: '/tmp/scratch', project: 'website' }]);
  await expect(ledge).toContainText('5 agents');
  await expect(website).toContainText('4 agents');
  // Back in the atelier, Kit sits at the Website table.
  await page.getByRole('button', { name: /Back to the atelier/ }).click();
  await expect(page.getByRole('region', { name: 'Website table' }).getByRole('button', { name: /^Kit,/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ledge table' }).getByRole('button', { name: /^Kit,/ })).toHaveCount(0);
});

test('a 900 px window: the settings fit without a side scroll, their section bar folds into a row above the content as in the mockup CSS', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  const projects: Projects = { ...twoProjects, rules: [{ machine: 'local', path: '/home/me/a/rather/long/folder/path/for/the/narrow/layout/scratch', project: 'ledge' }] };
  await fakeDaemon(page, eight, { projects, machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'A build server with a long name', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', []);
  remote.close();
  await page.goto('/');
  await openSettings(page);
  const bar = nav(page);
  const content = page.locator('.settings-content');
  // The section bar is a row above the content: as wide as the page beside the app's sidebar, one tab high, its tabs side by side.
  await expect(page.locator('.settings-page')).toHaveCSS('flex-direction', 'column');
  await expect(bar).toHaveCSS('flex-direction', 'row');
  const nb = (await bar.boundingBox())!;
  const cb = (await content.boundingBox())!;
  expect(nb.y + nb.height).toBeLessThanOrEqual(cb.y + 1);
  expect(nb.height).toBeLessThan(60);
  const general = (await tab(page, 'General').boundingBox())!;
  const appearance = (await tab(page, 'Appearance').boundingBox())!;
  expect(appearance.y).toBeCloseTo(general.y, 0);
  expect(appearance.x).toBeGreaterThan(general.x);
  // The bar scrolls sideways itself; the page never does.
  for (const name of ['General', 'Appearance', 'Machines', 'Projects', 'Keyboard shortcuts', 'About']) {
    await tab(page, name).click();
    await expect(heading(page)).toHaveText(name);
    expect(await pageNoSideScroll(page), `${name}: no side scroll`).toBe(true);
    const box = (await content.boundingBox())!;
    expect(box.x + box.width, `${name}: the content fits`).toBeLessThanOrEqual(900);
  }
  // Machines: the offline server keeps the bar's alert in the folded row.
  await expect(tab(page, 'Machines').getByRole('img', { name: 'A machine is offline' })).toBeVisible();
});

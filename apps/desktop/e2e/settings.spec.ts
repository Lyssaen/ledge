import type { Page } from '@playwright/test';
import type { ClientMessage, Projects } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, fakeRemote, session, twoProjects } from './daemon';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' });
/** A section's tab: its name, then its alert when it has one. */
const tab = (page: Page, name: string) => nav(page).getByRole('button', { name: new RegExp(`^${name}( |$)`) });
const heading = (page: Page) => page.locator('.settings-head h1');
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });
/** The notices said since the page loaded, from the app's recorder (main.tsx, e2e build only): a notice replaces the previous
 *  one on screen, so only this history can tell « once » from « twice ». */
const said = (page: Page) => page.evaluate(() => [...((window as unknown as { __ledgeToasts?: string[] }).__ledgeToasts ?? [])]);
const timesSaid = async (page: Page, text: string) => (await said(page)).filter(t => t === text).length;
/** The notice is on screen and the app said it exactly once; a moment later it still has not said it again. */
async function savedOnce(page: Page, text: string) {
  await expect(toast(page, text)).toBeVisible();
  await expect.poll(() => timesSaid(page, text)).toBe(1);
  await page.waitForTimeout(300);
  expect(await timesSaid(page, text), `« ${text} » said once`).toBe(1);
}
const pageNoSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
/** The settings' own scroller (`.settings-scroll`, overflow auto) does not scroll sideways: the page never would, it is this one that could. */
const scrollerNoSideScroll = (page: Page) => page.locator('.settings-scroll').evaluate(e => e.scrollWidth <= e.clientWidth + 1);
/** How far the card holding `entry` (and anything drawn inside it) reaches past the scroller's right edge, in px (≤ 0 when it fits). */
const pastRightEdge = (page: Page, entry: string) => page.locator(entry).evaluate(el => {
  const card = el.closest('.set-card')!;
  const right = document.querySelector('.settings-scroll')!.getBoundingClientRect().right;
  const edges = [card, ...card.querySelectorAll('*')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0).map(r => r.right);
  return Math.max(...edges) - right;
});

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
  await savedOnce(page, 'Setting saved · Light theme · Pebble');
  // The light tokens reach the page itself, not only the attribute.
  await expect.poll(background).not.toBe(dark);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await expect(nav(page)).toHaveCount(0);
  // Nothing else was saved on the way: opening the settings, changing section and leaving say nothing.
  expect((await said(page)).filter(t => t.startsWith('Setting saved'))).toEqual(['Setting saved · Light theme · Pebble']);
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
  await savedOnce(page, 'Setting saved · GPU box added');
  await expect(gpu).toContainText('Offline');
  await expect(alert).toBeVisible();
  // The app's sidebar lists it too, offline.
  await expect(page.locator('aside.sidebar .side-machine', { hasText: 'GPU box' })).toContainText('offline');

  await gpu.getByRole('button', { name: 'Remove' }).click();
  await expect(gpu.getByRole('alert')).toContainText('Remove GPU box?');
  await gpu.getByRole('alert').getByRole('button', { name: 'Remove' }).click();
  await expect(gpu).toHaveCount(0);
  await savedOnce(page, 'Setting saved · GPU box removed');
  await expect(alert).toHaveCount(0);
  await expect(page.locator('aside.sidebar .side-machine', { hasText: 'GPU box' })).toHaveCount(0);
  const last = daemon.received.filter(m => m.type === 'machines.set').at(-1) as Extract<ClientMessage, { type: 'machines.set' }>;
  expect(last.machines).toEqual([{ id: 'local', label: 'Local' }]);
  expect((await said(page)).filter(t => t.startsWith('Setting saved'))).toEqual(['Setting saved · GPU box added', 'Setting saved · GPU box removed']);
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
  await savedOnce(page, 'Setting saved · /tmp/scratch → Website');
  await expect(target).toHaveValue('website');
  const sent = daemon.received.filter((m): m is Extract<ClientMessage, { type: 'projects.set' }> => m.type === 'projects.set');
  expect(sent).toHaveLength(1);
  expect(sent[0]!.projects.rules).toEqual([{ machine: 'local', path: '/tmp/scratch', project: 'website' }]);
  await expect(ledge).toContainText('5 agents');
  await expect(website).toContainText('4 agents');
  expect((await said(page)).filter(t => t.startsWith('Setting saved'))).toEqual(['Setting saved · /tmp/scratch → Website']);
  // Back in the atelier, Kit sits at the Website table.
  await page.getByRole('button', { name: /Back to the atelier/ }).click();
  await expect(page.getByRole('region', { name: 'Website table' }).getByRole('button', { name: /^Kit,/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ledge table' }).getByRole('button', { name: /^Kit,/ })).toHaveCount(0);
});

test('a 900 px window: the settings fit without a side scroll, their section bar folds into a row above the content as in the mockup CSS', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  const projects: Projects = { ...twoProjects, rules: [{ machine: 'local', path: '/home/me/workspaces/clients/a-rather-long-client-name/projects/a-very-long-repository-name-for-the-narrow-layout/packages/scratch', project: 'ledge' }] };
  await fakeDaemon(page, eight, { projects, machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'A build server in the basement with a rather long name for the narrow layout', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', []);
  remote.close();
  await page.goto('/');
  await openSettings(page);
  const bar = nav(page);
  const content = page.locator('.settings-content');
  // Long enough that, without its ellipsis or its wrapping, either one would reach past the scroller (about 690 px wide here).
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
  // The bar scrolls sideways itself; neither the page nor the settings' scroller does, in any section.
  for (const name of ['General', 'Appearance', 'Notifications', 'Sounds', 'Machines', 'Projects', 'Keyboard shortcuts', 'About']) {
    await tab(page, name).click();
    await expect(heading(page)).toHaveText(name);
    expect(await pageNoSideScroll(page), `${name}: the page does not scroll sideways`).toBe(true);
    expect(await scrollerNoSideScroll(page), `${name}: the settings do not scroll sideways`).toBe(true);
    const box = (await content.boundingBox())!;
    expect(box.x + box.width, `${name}: the content fits`).toBeLessThanOrEqual(900);
    // The cards with the long machine name and the long folder path keep everything inside the scroller.
    if (name === 'Machines') {
      await expect(page.getByRole('article', { name: /A build server/ })).toContainText('Offline');
      expect(await pastRightEdge(page, '.machine-entry[aria-label^="A build server"]'), 'the long machine name stays inside').toBeLessThanOrEqual(1);
    }
    if (name === 'Projects') expect(await pastRightEdge(page, '.rule-entry'), 'the long folder path stays inside').toBeLessThanOrEqual(1);
  }
  // Machines: the offline server keeps the bar's alert in the folded row.
  await expect(tab(page, 'Machines').getByRole('img', { name: 'A machine is offline' })).toBeVisible();
});

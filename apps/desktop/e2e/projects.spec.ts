import type { Locator, Page } from '@playwright/test';
import type { ClientMessage, Projects } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, session, twoProjects, type Folder } from './daemon';

type ProjectsSet = Extract<ClientMessage, { type: 'projects.set' }>;
const sets = (received: ClientMessage[]) => received.filter((m): m is ProjectsSet => m.type === 'projects.set');
const noSideScroll = (el: Locator) => el.evaluate(e => e.scrollWidth <= e.clientWidth + 1);
const pageNoSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const sidebarProjects = (page: Page) => page.getByRole('navigation', { name: 'Projects' });

/** The home on Local: a Workspace with one Git repository on `main` and a plain folder. */
const folders: Record<string, Folder> = {
  '/home/me': { parent: '/home', entries: ['Documents', 'Workspace'] },
  '/home/me/Workspace': { parent: '/home/me', entries: ['drafts', 'paper-fonts'], repos: [{ name: 'paper-fonts', branch: 'main' }] }
};
/** Kit works in a folder no project knows: « No project ». */
const kit = session('kit', { name: 'Kit', cwd: '/tmp/scratch', project: 'scratch' });

test('+ Projects, a name, Workspace › paper-fonts on main from the folder browser, Create: the project is in the sidebar with its colour', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects, folders });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).click();
  const editor = page.getByRole('dialog', { name: 'New project' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Name', { exact: true }).fill('Paper Rendering');
  // The first colour no project uses: Ledge is blue, Website green.
  await expect(editor.getByRole('radio', { name: 'Amber' })).toBeChecked();
  // A new project without repository opens on the folder browser, at Local's home.
  await expect(editor.getByRole('radiogroup', { name: 'Machine to browse' }).getByRole('radio', { name: /Local/ })).toBeChecked();
  const home = editor.getByRole('list', { name: 'Contents of /home/me on Local' });
  await home.getByRole('button', { name: 'Workspace', exact: true }).click();
  const workspace = editor.getByRole('list', { name: 'Contents of /home/me/Workspace on Local' });
  const row = workspace.getByRole('listitem').filter({ hasText: 'paper-fonts' });
  await expect(row).toContainText('⎇ main');
  await expect(workspace.getByRole('listitem').filter({ hasText: 'drafts' })).toContainText('no Git');
  await expect(editor.getByRole('navigation', { name: 'Current folder' }).getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-current', 'location');
  await row.getByRole('button', { name: 'Add paper-fonts (Local)' }).click();
  await expect(editor.getByText('Working repositories · 1')).toBeVisible();
  await expect(row.getByRole('button', { name: 'paper-fonts already added' })).toBeDisabled();
  const repos = editor.locator('.pe-repo-list');
  await expect(repos.getByRole('listitem')).toHaveCount(1);
  await expect(repos).toContainText('/home/me/Workspace/paper-fonts');
  await expect(repos).toContainText('⎇ main');
  await editor.getByRole('button', { name: /Create the project/ }).click();
  await expect(editor).toBeHidden();
  const sent = sets(daemon.received);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.projects.projects).toContainEqual({ id: 'paper-rendering', name: 'Paper Rendering', color: 'amber', description: '', repos: [{ machine: 'local', path: '/home/me/Workspace/paper-fonts' }] });
  const entry = sidebarProjects(page).getByRole('button', { name: /^Paper Rendering/ });
  await expect(entry).toBeVisible();
  await expect(entry.locator('.side-swatch')).toHaveCSS('background-color', 'rgb(245, 158, 11)');
  await expect(page.locator('.toast')).toHaveText('Project Paper Rendering created. It appears in the sidebar; its table opens with the first session.');
});

test('Move to… › New project… on an agent with no project: the project is created with its folder, the agent leaves « No project » for the new table', async ({ page }) => {
  const daemon = await fakeDaemon(page, [...eight, kit], { projects: twoProjects, folders });
  await page.goto('/');
  const card = page.locator('.unassigned-card', { hasText: 'Kit' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Move to…' }).click();
  await page.getByRole('menu', { name: 'Move to…' }).getByRole('menuitem', { name: /New project…/ }).click();
  const editor = page.getByRole('dialog', { name: 'New project' });
  await expect(editor).toBeVisible();
  // Its folder is already the project's repository (inspected on Local), and Kit is checked to be filed too.
  const repos = editor.locator('.pe-repo-list');
  await expect(repos).toContainText('/tmp/scratch');
  await expect(repos).toContainText('⎇ main');
  await expect(editor.getByText('Working repositories · 1')).toBeVisible();
  await expect(editor.getByRole('checkbox', { name: 'Kit' })).toBeChecked();
  await editor.getByLabel('Name', { exact: true }).fill('Scratch');
  await editor.getByLabel('Name', { exact: true }).press('Control+Enter');
  await expect(editor).toBeHidden();
  const sent = sets(daemon.received);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.projects.projects).toContainEqual(expect.objectContaining({ id: 'scratch', name: 'Scratch', repos: [{ machine: 'local', path: '/tmp/scratch' }] }));
  expect(sent[0]!.projects.rules).toContainEqual({ machine: 'local', path: '/tmp/scratch', project: 'scratch' });
  await expect(page.getByRole('region', { name: 'Scratch table' }).getByRole('button', { name: /^Kit,/ })).toBeVisible();
  await expect(page.locator('.unassigned-card')).toHaveCount(0);
  await expect(page.locator('.side-unassigned')).toHaveCount(0);
  await expect(sidebarProjects(page).getByRole('button', { name: /^Scratch/ })).toBeVisible();
  await expect(page.locator('.toast')).toHaveText('Project Scratch created. Kit joins its table.');
});

test('Edit project › Delete the project › Move to… Website: its agents join the Website table and the filter goes back to All', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  // The filter on Ledge: only its table is shown.
  await sidebarProjects(page).getByRole('button', { name: /^Ledge/ }).click();
  const ledge = page.getByRole('region', { name: 'Ledge table' });
  await expect(ledge).toBeVisible();
  await expect(page.getByRole('region', { name: 'Website table' })).toHaveCount(0);
  await ledge.getByRole('button', { name: 'Actions of project Ledge' }).click();
  await page.getByRole('menu', { name: 'Actions of project Ledge' }).getByRole('menuitem', { name: 'Edit project' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit Ledge' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Edit Ledge' }).getByRole('button', { name: 'Delete the project' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete Ledge' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('radio', { name: 'No project' })).toBeChecked();
  // Four of the five names, then an ellipsis.
  await expect(confirm).toContainText(/5 agents \((\w+, ){3}\w+…\) will move to « No project »\./);
  await confirm.getByText('Move to…').click();
  await expect(confirm.getByRole('radio', { name: 'Move to…' })).toBeChecked();
  await expect(confirm.getByRole('combobox', { name: 'Target project' })).toHaveValue('website');
  await expect(confirm).toContainText(/5 agents \((\w+, ){3}\w+…\) will join Website\./);
  await expect(confirm).toContainText('0 remembered folders will point to that project.');
  await confirm.getByRole('button', { name: 'Move and delete' }).click();
  await expect(confirm).toBeHidden();
  const sent = sets(daemon.received);
  expect(sent).toHaveLength(1);
  const state: Projects = sent[0]!.projects;
  expect(state.projects.map(p => p.id)).toEqual(['website']);
  expect(state.projects[0]!.repos).toEqual(expect.arrayContaining([{ machine: 'local', path: '/w/website' }, { machine: 'local', path: '/w/ledge' }]));
  await expect(page.locator('.toast')).toHaveText('Ledge deleted. 5 agents join Website.');
  // Back to All: the Atelier row is the active one, Ledge is gone from the sidebar and the floor.
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Atelier/ })).toHaveClass(/active/);
  await expect(sidebarProjects(page).getByRole('button', { name: /^Ledge/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toHaveCount(0);
  // Eight agents at Website now: six seats and +2.
  const website = page.getByRole('region', { name: 'Website table' });
  await expect(website.locator('.agent-seat:not(.helper-seat)')).toHaveCount(6);
  await expect(website.getByRole('button', { name: /\+2 at this table/ })).toBeVisible();
  await expect(page.locator('.unassigned-card')).toHaveCount(0);
});

test('a 900 px window: the editor and the folder browser fit without a side scroll, the body scrolls, the footer stays visible', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  const many = Array.from({ length: 14 }, (_, i) => `project-with-a-rather-long-folder-name-${String(i + 1).padStart(2, '0')}`);
  await fakeDaemon(page, eight, {
    projects: twoProjects,
    folders: { '/home/me': { parent: '/home', entries: many, repos: many.filter((_, i) => i % 2 === 0).map(name => ({ name, branch: 'feature/a-very-long-branch-name-for-the-layout' })) } }
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).click();
  const editor = page.getByRole('dialog', { name: 'New project' });
  const list = editor.getByRole('list', { name: 'Contents of /home/me on Local' });
  await expect(list.getByRole('listitem')).toHaveCount(many.length + 1);   // the parent folder, then the entries
  await editor.getByLabel('Name', { exact: true }).fill('A project with a long enough name to test the footer layout');
  const box = (await editor.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(900);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  expect(await noSideScroll(editor)).toBe(true);
  expect(await noSideScroll(editor.locator('.pe-body'))).toBe(true);
  expect(await noSideScroll(list)).toBe(true);
  expect(await pageNoSideScroll(page)).toBe(true);
  // Each row keeps its Add button inside the list.
  const lb = (await list.boundingBox())!;
  const add = (await list.getByRole('button', { name: `Add ${many[0]} (Local)` }).boundingBox())!;
  expect(add.x + add.width).toBeLessThanOrEqual(lb.x + lb.width);
  // The body scrolls vertically; the footer stays in view, before and after.
  const body = editor.locator('.pe-body');
  expect(await body.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
  const footer = editor.locator('footer.composer-footer');
  const create = editor.getByRole('button', { name: /Create the project/ });
  await expect(create).toBeInViewport();
  await body.evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect(editor.getByRole('textbox', { name: 'Path on Local' })).toBeInViewport();
  await expect(create).toBeInViewport();
  const fb = (await footer.boundingBox())!;
  expect(fb.y + fb.height).toBeLessThanOrEqual(600);
  expect(await noSideScroll(editor)).toBe(true);
});

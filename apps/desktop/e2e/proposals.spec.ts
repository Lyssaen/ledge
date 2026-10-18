import type { Page } from '@playwright/test';
import type { ClientMessage, FoundRepo } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, twoProjects, type ChatReply } from './daemon';

type ProjectsSet = Extract<ClientMessage, { type: 'projects.set' }>;
const sets = (received: ClientMessage[]) => received.filter((m): m is ProjectsSet => m.type === 'projects.set');
const sidebarProjects = (page: Page) => page.getByRole('navigation', { name: 'Projects' });
const pageNoSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const REMOTE = 'github.com/acme/ledge';

/** What Local holds: Ledge's and Website's repositories (already in a project), three « paper-* » ones nobody has, and one that shares Ledge's remote. */
const disk: FoundRepo[] = [
  { path: '/w/ledge', branch: 'main', remote: REMOTE },
  { path: '/w/website', branch: 'main' },
  { path: '/w/paper-fonts', branch: 'main' },
  { path: '/w/paper-render', branch: 'dev' },
  { path: '/w/paper-assets', branch: 'main' },
  { path: '/w/ledge-cli', branch: 'main', remote: REMOTE }
];
/** Without the repository that overlaps Ledge: the editor then proposes the new project. */
const paperDisk = disk.filter(r => r.path !== '/w/ledge-cli');
const projects = { ...twoProjects, projects: twoProjects.projects.map(p => p.id === 'ledge' ? { ...p, repos: [{ machine: 'local', path: '/w/ledge' }] } : p) };

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
}
async function openProjectsSettings(page: Page) {
  await expect(page.locator('aside.sidebar').getByText(/\d+ agents?/).first()).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation').getByRole('button', { name: /^Projects( |$)/ }).click();
  await expect(page.locator('.settings-head h1')).toHaveText('Projects');
}

test('New project › Let Ledge do it: the steps, then the proposal; uncheck one repository, Create: only the kept ones are in the new project', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects, found: { local: { repos: paperDisk } }, scanDelayMs: 600 });
  await boot(page);
  await page.getByRole('button', { name: 'New project' }).click();
  const editor = page.getByRole('dialog', { name: 'New project' });
  await editor.getByRole('button', { name: 'Let Ledge do it' }).click();
  const scan = page.getByRole('dialog', { name: 'Ledge is preparing a project' });
  await expect(scan).toBeVisible();
  await expect(scan.getByText('Ledge is scanning Local…')).toBeVisible();
  await expect(scan.getByText('Local · 5 repositories found')).toBeVisible();
  await expect(scan.getByText('Remotes and sessions compared')).toBeVisible();
  const proposal = page.getByRole('dialog', { name: 'Ledge proposal' });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByLabel('Name', { exact: true })).toHaveValue('Paper');
  for (const n of ['paper-fonts', 'paper-render', 'paper-assets']) await expect(proposal.getByRole('checkbox', { name: `Keep ${n} (Local)` })).toBeChecked();
  await expect(proposal.locator('.pe-why').first()).toContainText('Ledge · ');
  await proposal.getByRole('checkbox', { name: 'Keep paper-assets (Local)' }).uncheck();
  expect(sets(daemon.received)).toHaveLength(0);
  await proposal.getByRole('button', { name: /Create the project/ }).click();
  await expect(proposal).toBeHidden();
  const sent = sets(daemon.received);
  expect(sent).toHaveLength(1);
  const made = sent[0]!.projects.projects.find(p => p.name === 'Paper')!;
  expect(made.repos).toEqual([{ machine: 'local', path: '/w/paper-fonts' }, { machine: 'local', path: '/w/paper-render' }]);
  await expect(sidebarProjects(page).getByRole('button', { name: /^Paper/ })).toBeVisible();
});

test('Settings › Projects › Ledge, suggest projects: the cards; Review and add… on the overlap with Ledge, Add to Ledge: its repositories join Ledge', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects, found: { local: { repos: disk } } });
  await boot(page);
  await openProjectsSettings(page);
  await page.getByRole('button', { name: 'Ledge, suggest projects' }).click();
  const complete = page.getByRole('article', { name: 'Proposal Ledge' });
  const fresh = page.getByRole('article', { name: 'Proposal Paper' });
  await expect(complete).toBeVisible();
  await expect(fresh).toContainText('paper-fonts · Local');
  await expect(complete).toContainText('ledge-cli · Local');
  await expect(complete.getByRole('button', { name: 'Review and add…' })).toBeVisible();
  await expect(fresh.getByRole('button', { name: 'Review and create…' })).toBeVisible();
  await expect(fresh.getByRole('button', { name: 'Ignore' })).toBeVisible();
  await complete.getByRole('button', { name: 'Review and add…' }).click();
  const editor = page.getByRole('dialog', { name: 'Ledge proposal for Ledge' });
  await expect(editor).toBeVisible();
  expect(sets(daemon.received)).toHaveLength(0);
  await editor.getByRole('button', { name: /Add to Ledge/ }).click();
  await expect(editor).toBeHidden();
  const sent = sets(daemon.received);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.projects.projects.find(p => p.id === 'ledge')!.repos).toEqual([{ machine: 'local', path: '/w/ledge' }, { machine: 'local', path: '/w/ledge-cli' }]);
  // The card drops out once the daemon broadcasts the project.
  await expect(complete).toBeHidden();
  await expect(fresh).toBeVisible();
});

test('The chat proposes a project: Review the proposal opens the editor prefilled, Cancel: nothing changed', async ({ page }) => {
  const chat: ChatReply = {
    text: 'These three belong together.',
    projectProposal: { name: 'Paper', description: 'The paper pipeline', repos: [{ path: '/w/paper-fonts', why: 'same prefix' }, { path: '/w/paper-render', why: 'renders the fonts' }] }
  };
  const daemon = await fakeDaemon(page, eight, { projects, chat });
  await boot(page);
  await page.keyboard.press('/');
  const panel = page.getByRole('complementary', { name: 'Chat Ledge' });
  await expect(panel.getByPlaceholder('Ask Ledge…')).toBeFocused();
  await page.keyboard.type('Group my paper repositories');
  await page.keyboard.press('Enter');
  const card = panel.getByRole('region', { name: 'Project proposal' });
  await expect(card).toContainText('Project proposal · Paper');
  await expect(card).toContainText('2 repositories');
  await card.getByRole('button', { name: 'Review the proposal' }).click();
  const editor = page.getByRole('dialog', { name: 'Ledge proposal' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Paper');
  await expect(editor.getByRole('checkbox', { name: 'Keep paper-fonts (Local)' })).toBeChecked();
  await expect(editor.locator('.pe-why').first()).toContainText('same prefix');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toBeHidden();
  expect(sets(daemon.received)).toHaveLength(0);
  await expect(sidebarProjects(page).getByRole('button', { name: /^Paper/ })).toHaveCount(0);
});

test('At 900 px the scan view and the Settings cards fit with no side scroll', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  const long: FoundRepo[] = [...paperDisk, { path: '/home/me/workspaces/clients/a-rather-long-client-name/projects/paper-a-very-long-repository-name-for-the-narrow-layout', branch: 'feature/a-quite-long-branch-name' }];
  await fakeDaemon(page, eight, { projects, found: { local: { repos: long } }, scanDelayMs: 1500 });
  await boot(page);
  await page.getByRole('button', { name: 'New project' }).click();
  const editor = page.getByRole('dialog', { name: 'New project' });
  await editor.getByRole('button', { name: 'Let Ledge do it' }).click();
  const scan = page.getByRole('dialog', { name: 'Ledge is preparing a project' });
  await expect(scan.getByText('Ledge is scanning Local…')).toBeVisible();
  expect(await pageNoSideScroll(page)).toBe(true);
  expect(await scan.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Ledge proposal' })).toBeVisible();
  expect(await pageNoSideScroll(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await openProjectsSettings(page);
  await page.getByRole('button', { name: 'Ledge, suggest projects' }).click();
  await expect(page.locator('article.suggest-card').first()).toBeVisible();
  expect(await pageNoSideScroll(page)).toBe(true);
  expect(await page.locator('.settings-scroll').evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
});

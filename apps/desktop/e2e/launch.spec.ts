import type { Locator, Page } from '@playwright/test';
import type { ClientMessage, Projects } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, fakeRemote, session } from './daemon';
import { ideReady, tabOf } from './ide';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

/** Ledge with two repositories on this machine, Website with one. */
const projects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }, { machine: 'local', path: '/w/ledge-docs' }] },
    { id: 'website', name: 'Website', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/website' }] }
  ],
  rules: []
};
/** Three agents: two at the Ledge table, one at Website, so the new one has a free seat. */
const fleet = eight.filter(s => ['otto', 'nova', 'luna'].includes(s.id));

type Launch = Extract<ClientMessage, { type: 'session.launch' }>;
const launchesOf = (received: ClientMessage[]) => received.filter((m): m is Launch => m.type === 'session.launch');
// The IDE's « New session » modal (lot 4, ide-launch.spec for its look): a project row (one folder on one machine, R3), the agent's
// tiles, its model, the first message. The old form's instruction, repository chips and machine chips are this modal's rows.
const dialog = (page: Page) => page.getByRole('dialog', { name: 'New session' });
const noSideScroll = (el: Locator) => el.evaluate(e => e.scrollWidth <= e.clientWidth + 1);
const pageNoSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const agent = (form: Locator, name: string) => form.getByRole('group', { name: 'Agent' }).getByRole('button', { name: new RegExp(`^${name}`) });
const message = (form: Locator) => form.getByRole('textbox', { name: 'First message' });
/** The Project menu's row, by its label (« Ledge · /w/ledge-docs · Local »). */
async function row(page: Page, label: RegExp) {
  await dialog(page).locator('.launch-modal-inp').click();
  return page.getByRole('menu', { name: 'Project' }).getByRole('menuitem', { name: label });
}

async function open(page: Page) {
  await page.goto('/'); await ideReady(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await page.keyboard.press('n');
  await expect(dialog(page)).toBeVisible();
}

test('N, a message, Claude Code, the second folder, Ctrl Enter twice: one launch, the modal closes, its tab in front, Starting then Running at the table', async ({ page }) => {
  // The test answers the launch and says when the agent is at work: Starting holds as long as it needs, whatever the load.
  const daemon = await fakeDaemon(page, fleet, { projects, launches: 'manual' });
  await open(page);
  const form = dialog(page);
  await (await row(page, /^Ledge · \/w\/ledge-docs · Local/)).click();
  await expect(form.locator('.launch-modal-inp')).toContainText('/w/ledge-docs');
  await agent(form, 'Claude Code').click();
  await expect(agent(form, 'Claude Code')).toHaveAttribute('aria-pressed', 'true');
  await message(form).fill('Fix the failing tests');
  // A second Ctrl Enter right after: still one launch (two in the same frame are the unit suite's).
  await message(form).press('Control+Enter');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  const launch = launchesOf(daemon.received)[0]!;
  expect(launch).toMatchObject({ tool: 'claude', cwd: '/w/ledge-docs', prompt: 'Fix the failing tests' });
  expect(launch).not.toHaveProperty('dirs');
  expect(launch).not.toHaveProperty('machineId');
  const name = launch.name!;
  expect(name).toBeTruthy();
  const started = session('launched-1', { name, tool: 'claude', cwd: '/w/ledge-docs', project: 'ledge', title: `${name} · ledge`, state: 'starting' });
  daemon.launched(started);
  await expect(form).toBeHidden();
  await expect(tabOf(page, name)).toHaveClass(/dv-active-tab/);
  // The atelier's table seats it: Starting, then Running once at work.
  await page.locator('.ide-dockview .dv-tab').filter({ hasText: 'Atelier' }).click();
  const seat = page.getByRole('region', { name: 'Ledge table' }).getByRole('button', { name: new RegExp(`^${name},`) });
  await expect(seat.locator('[data-badge]')).toHaveText('Starting');
  daemon.upsert({ ...started, state: 'working' });
  await expect(seat.locator('[data-badge]')).toHaveText('Running');
  expect(launchesOf(daemon.received)).toHaveLength(1);
});

test('a 900 px window: the modal fits without a side scroll; Escape closes it', async ({ page }) => {
  // Under 1280 px the IDE's own states are still to be drawn (plan 4.1 point 5): the old form's 540 px stacking is not checked here.
  await page.setViewportSize({ width: 900, height: 760 });
  await fakeDaemon(page, fleet, { projects });
  await open(page);
  const form = dialog(page);
  await message(form).fill('Update the documentation');
  await agent(form, 'Codex').click();
  await expect(agent(form, 'Codex')).toHaveAttribute('aria-pressed', 'true');
  expect(await noSideScroll(form)).toBe(true);
  expect(await pageNoSideScroll(page)).toBe(true);
  const box = (await form.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(900);
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
});

test('an offline machine: its row is disabled, the modal launches on Local', async ({ page }) => {
  const both: Projects = { ...projects, projects: projects.projects.map(p => (p.id === 'ledge' ? { ...p, repos: [...p.repos, { machine: 'devbox', path: '/w/ledge' }] } : p)) };
  const daemon = await fakeDaemon(page, fleet, { projects: both, machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', []);
  remote.close();   // refuses every connection from the start
  await open(page);
  const form = dialog(page);
  await expect(form.locator('.launch-modal-inp')).toContainText('Local');
  const devbox = await row(page, /Devbox/);
  await expect(devbox).toBeDisabled();
  await expect(devbox).toContainText('offline');
  await page.keyboard.press('Escape');
  await expect(form).toBeVisible();
  await message(form).fill('Review the latest pull request');
  await agent(form, 'Codex').click();
  await form.getByRole('button', { name: /^Launch/ }).click();
  await expect(form).toBeHidden();
  const sent = launchesOf(daemon.received);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ tool: 'codex', cwd: '/w/ledge', prompt: 'Review the latest pull request' });
  expect(sent[0]).not.toHaveProperty('dirs');
  expect(sent[0]).not.toHaveProperty('machineId');
});

test('the model (#58): Sonnet and High chosen in the agent\'s model block, sent with the launch', async ({ page }) => {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  const daemon = await fakeDaemon(page, fleet, { projects, models: { claude: [
    { id: 'fable', label: 'Fable', efforts }, { id: 'opus', label: 'Opus', efforts, isDefault: true }, { id: 'sonnet', label: 'Sonnet', efforts }, { id: 'haiku', label: 'Haiku', efforts }
  ] } });
  await open(page);
  const form = dialog(page);
  await agent(form, 'Claude Code').click();
  const models = form.getByRole('group', { name: 'Claude Code model' });
  await expect(models).toBeVisible();
  await models.getByRole('button', { name: /^Claude Code model : / }).click();
  const menu = page.getByRole('dialog', { name: 'Claude Code model' });
  await menu.getByRole('option', { name: /Sonnet/ }).click();
  await expect(menu).toBeHidden();
  for (let i = 0; i < 3; i++) await models.getByRole('button', { name: 'More effort' }).click();
  await expect(models.getByRole('group', { name: 'Effort' }).getByRole('status')).toHaveText('High');
  expect(await noSideScroll(form)).toBe(true);
  await form.screenshot({ path: test.info().outputPath('model-picker.png') });
  await message(form).fill('Fix the failing tests');
  await message(form).press('Control+Enter');
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  expect(launchesOf(daemon.received)[0]).toMatchObject({ tool: 'claude', model: 'sonnet', effort: 'high' });
});

test('the model (#58 v2): Codex\'s long names and six efforts stay inside the form, its eleven models in one searchable list', async ({ page }) => {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const codex = [
    ['gpt-6.1-sol', 'GPT-6.1-Sol', 'Latest workhorse model for coding and everyday work.'], ['gpt-6-astra', 'GPT-6-Astra', 'Frontier intelligence for the most demanding work.'],
    ['gpt-6-sol', 'GPT-6-Sol', 'Previous generation workhorse model.'], ['gpt-6-luna', 'GPT-6-Luna', 'Fast and affordable model for easier tasks.'],
    ['gpt-5.6-sol', 'GPT-5.6-Sol', 'Older generation workhorse model.'], ['gpt-5.6-terra', 'GPT-5.6-Terra', 'Older balanced model for straightforward work.'],
    ['gpt-5.6-luna', 'GPT-5.6-Luna', 'Older fast and efficient model.'], ['gpt-daybreak-blue-latest', 'Daybreak Blue', 'Latest frontier agentic coding model for broad defensive cybersecurity work.'],
    ['gpt-daybreak-red-latest', 'Daybreak Red', 'Cyber-permissive variant of our latest frontier agentic coding model for advanced, authorized work.'],
    ['gpt-5.5', 'GPT-5.5', 'Legacy coding model.'], ['codex-auto-review', 'Codex Auto Review', 'Automatic approval review model for Codex.']
  ].map(([id, label, description], i) => ({ id: id!, label: label!, description, efforts, defaultEffort: 'medium', ...(i === 0 ? { isDefault: true } : {}) }));
  await fakeDaemon(page, fleet, { projects, models: { codex } });
  await open(page);
  const form = dialog(page);
  await form.getByRole('group', { name: 'Agent' }).getByRole('button', { name: /^Codex/ }).click();
  const models = form.getByRole('group', { name: 'Codex model' });
  for (let i = 0; i < 4; i++) await models.getByRole('button', { name: 'More effort' }).click();
  await expect(models.getByRole('group', { name: 'Effort' }).getByRole('status')).toHaveText('Ultra');
  // Nothing in the block is wider than the block.
  expect(await models.evaluate(el => [...el.querySelectorAll('*')].every(c => c.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5))).toBe(true);
  expect(await noSideScroll(form)).toBe(true);
  await models.getByRole('button', { name: /^Codex model : / }).click();
  const menu = page.getByRole('dialog', { name: 'Codex model' });
  await expect(menu.getByRole('option')).toHaveCount(11);
  await page.screenshot({ path: test.info().outputPath('model-picker-codex.png') });
  await page.keyboard.type('daybreak');
  await expect(menu.getByRole('option', { name: /Daybreak/ })).toHaveCount(2);
  await expect(menu.getByRole('option').last()).toHaveText(/Use as is/);
});

import type { Locator, Page } from '@playwright/test';
import type { ClientMessage, Projects } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, fakeRemote, session } from './daemon';

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
const dialog = (page: Page) => page.getByRole('dialog', { name: 'New session' });
const noSideScroll = (el: Locator) => el.evaluate(e => e.scrollWidth <= e.clientWidth + 1);
const pageNoSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const tiles = (page: Page) => dialog(page).locator('.tool-tile');
/** The way a person picks: a click on the tile or the chip (its input is hidden under it, as in the mockup). */
const tile = (form: Locator, name: string) => form.locator('label.tool-tile', { hasText: name });
/** The default agent is preselected; another is picked behind « Change », whose list stays open once shown. */
async function pick(form: Locator, name: string) {
  if (!(await tile(form, name).count())) await form.locator('.harness-current').click();
  await tile(form, name).click();
}
const chip = (form: Locator, name: string) => form.locator('label.chip').filter({ hasText: new RegExp(`^${name}`) });

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await page.keyboard.press('n');
  await expect(dialog(page)).toBeVisible();
}

test('N, an instruction, Claude Code, two repositories, Ctrl Enter: one launch, the form closes, the new agent sits at Ledge, Starting then Running', async ({ page }) => {
  // The test answers the launch and says when the agent is at work: Starting holds as long as it needs, whatever the load.
  const daemon = await fakeDaemon(page, fleet, { projects, launches: 'manual' });
  await open(page);
  const form = dialog(page);
  await form.getByLabel('Instruction').fill('Fix the failing tests');
  await pick(form, 'Claude Code');
  await expect(form.getByRole('radio', { name: /Claude Code/ })).toBeChecked();
  await expect(form.getByRole('radio', { name: 'Ledge' })).toBeChecked();
  await expect(form.getByRole('checkbox', { name: 'ledge', exact: true })).toBeChecked();
  await chip(form, 'ledge-docs').click();
  await expect(form.getByRole('checkbox', { name: 'ledge-docs' })).toBeChecked();
  await expect(form.getByText('⎇ main')).toBeVisible();
  // A second Ctrl Enter right after: still one launch (two in the same frame are the unit suite's, task 5).
  await form.getByLabel('Instruction').press('Control+Enter');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  await expect(form.getByRole('button', { name: /Launching…/ })).toBeVisible();
  const launch = launchesOf(daemon.received)[0]!;
  expect(launch).toMatchObject({ tool: 'claude', cwd: '/w/ledge', dirs: ['/w/ledge-docs'], prompt: 'Fix the failing tests' });
  expect(launch).not.toHaveProperty('machineId');
  const name = launch.name!;
  expect(name).toBeTruthy();
  const started = session('launched-1', { name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`, state: 'starting' });
  daemon.launched(started);
  await expect(form).toBeHidden();
  const seat = page.getByRole('region', { name: 'Ledge table' }).getByRole('button', { name: new RegExp(`^${name},`) });
  await expect(seat).toHaveClass(/just-seated/);
  await expect(seat.locator('[data-badge]')).toHaveText('Starting');
  await expect(page.locator('.toast')).toHaveText(`${name} is starting at the Ledge table.`);
  daemon.upsert({ ...started, state: 'working' });
  await expect(seat.locator('[data-badge]')).toHaveText('Running');
  await expect(seat).not.toHaveClass(/just-seated/);
  expect(launchesOf(daemon.received)).toHaveLength(1);
});

test('a 900 px window: the form fits without a side scroll; under 540 px the agents stack; Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await fakeDaemon(page, fleet, { projects });
  await open(page);
  const form = dialog(page);
  await form.getByLabel('Instruction').fill('Update the documentation');
  await pick(form, 'Codex');
  await expect(form.getByRole('radio', { name: /Codex/ })).toBeChecked();
  expect(await noSideScroll(form)).toBe(true);
  expect(await pageNoSideScroll(page)).toBe(true);
  const box = (await form.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(900);
  // Four tiles, two per row at 900 px.
  const row = await Promise.all((await tiles(page).all()).map(async t => (await t.boundingBox())!));
  expect(row).toHaveLength(4);
  expect(new Set(row.map(b => Math.round(b.y))).size).toBe(2);
  // Under 540 px they stack in one column, still without a side scroll.
  await page.setViewportSize({ width: 520, height: 760 });
  await expect.poll(async () => {
    const bs = await Promise.all((await tiles(page).all()).map(async t => (await t.boundingBox())!));
    return new Set(bs.map(b => Math.round(b.x))).size === 1 && bs[0]!.y < bs[1]!.y && bs[1]!.y < bs[2]!.y;
  }).toBe(true);
  expect(await noSideScroll(form)).toBe(true);
  expect(await pageNoSideScroll(page)).toBe(true);
  // Escape closes the list first (the focus is in it), then the form.
  await page.keyboard.press('Escape');
  await expect(tiles(page)).toHaveCount(0);
  await expect(form.locator('.harness-current')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
});

test('an offline machine: its chip is disabled, the form launches on Local', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects, machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', []);
  remote.close();   // refuses every connection from the start
  await open(page);
  const form = dialog(page);
  const devbox = form.getByRole('radio', { name: /Devbox/ });
  await expect(devbox).toBeDisabled();
  await expect(chip(form, 'Devbox')).toHaveClass(/disabled/);
  await expect(chip(form, 'Devbox')).toContainText('offline');
  await expect(form.getByRole('radio', { name: 'Local' })).toBeChecked();
  await form.getByLabel('Instruction').fill('Review the latest pull request');
  await pick(form, 'Codex');
  await expect(form.getByRole('radio', { name: /Codex/ })).toBeChecked();
  // One repository at a time for Codex.
  await expect(form.getByRole('radio', { name: 'ledge', exact: true })).toBeChecked();
  await form.getByRole('button', { name: /Launch/ }).click();
  await expect(form).toBeHidden();
  const sent = launchesOf(daemon.received);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ tool: 'codex', cwd: '/w/ledge', prompt: 'Review the latest pull request' });
  expect(sent[0]).not.toHaveProperty('dirs');
  const seat = page.getByRole('region', { name: 'Ledge table' }).getByRole('button', { name: new RegExp(`^${sent[0]!.name},`) });
  await expect(seat.locator('[data-badge]')).toHaveText('Running');
});

test('the model (#58): the block under the agents, Sonnet and High chosen, sent with the launch and summed up in the preview', async ({ page }) => {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  const daemon = await fakeDaemon(page, fleet, { projects, models: { claude: [
    { id: 'fable', label: 'Fable', efforts }, { id: 'opus', label: 'Opus', efforts, isDefault: true }, { id: 'sonnet', label: 'Sonnet', efforts }, { id: 'haiku', label: 'Haiku', efforts }
  ] } });
  await open(page);
  const form = dialog(page);
  await form.getByLabel('Instruction').fill('Fix the failing tests');
  await pick(form, 'Claude Code');
  const models = form.getByRole('group', { name: 'Claude Code model' });
  await expect(models).toBeVisible();
  await models.getByRole('button', { name: /^Claude Code model : / }).click();
  const menu = page.getByRole('dialog', { name: 'Claude Code model' });
  await menu.getByRole('option', { name: /Sonnet/ }).click();
  await expect(menu).toBeHidden();
  for (let i = 0; i < 3; i++) await models.getByRole('button', { name: 'More effort' }).click();
  await expect(form.locator('.preview-model')).toHaveText('Sonnet · high');
  expect(await noSideScroll(form)).toBe(true);
  await form.screenshot({ path: test.info().outputPath('model-picker.png') });
  await page.keyboard.press('Control+Enter');
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
  await pick(form, 'Codex');
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

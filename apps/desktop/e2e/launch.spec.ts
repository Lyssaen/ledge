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
  await tile(form, 'Claude Code').click();
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

test('a 900 px window: the form fits without a side scroll; under 700 px the agents stack; Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await fakeDaemon(page, fleet, { projects });
  await open(page);
  const form = dialog(page);
  await form.getByLabel('Instruction').fill('Update the documentation');
  await tile(form, 'Codex').click();
  await expect(form.getByRole('radio', { name: /Codex/ })).toBeChecked();
  expect(await noSideScroll(form)).toBe(true);
  expect(await pageNoSideScroll(page)).toBe(true);
  const box = (await form.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(900);
  // Three tiles on one row at 900 px.
  const row = await Promise.all((await tiles(page).all()).map(async t => (await t.boundingBox())!));
  expect(row).toHaveLength(3);
  expect(new Set(row.map(b => Math.round(b.y))).size).toBe(1);
  // Under 700 px they stack in one column, still without a side scroll.
  await page.setViewportSize({ width: 680, height: 760 });
  await expect.poll(async () => {
    const bs = await Promise.all((await tiles(page).all()).map(async t => (await t.boundingBox())!));
    return new Set(bs.map(b => Math.round(b.x))).size === 1 && bs[0]!.y < bs[1]!.y && bs[1]!.y < bs[2]!.y;
  }).toBe(true);
  expect(await noSideScroll(form)).toBe(true);
  expect(await pageNoSideScroll(page)).toBe(true);
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
  await tile(form, 'Codex').click();
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

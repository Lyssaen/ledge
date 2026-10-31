import type { OpenRigStatus, RigSpecInfo } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';

const specSeat = (address: string, runtime = 'claude-code', model = 'opus') => ({ address, member: address.slice(1), pod: 'dev', runtime, model, profile: 'demande' });
const STARTER: RigSpecInfo = { id: 'starter', name: 'starter', summary: 'a bounded change', source: 'builtin', seats: [specSeat('@build'), specSeat('@review-a', 'codex', 'gpt-5.5')] };
const FACTORY: RigSpecInfo = { id: 'factory', name: 'factory', summary: 'a product over time', source: 'builtin',
  seats: [specSeat('@lead'), specSeat('@advisor'), specSeat('@build'), specSeat('@qa', 'claude-code', 'sonnet'), specSeat('@review-a', 'codex', 'gpt-5.5')] };
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };

test('launch a rig in three steps, then see it starting', async ({ page }) => {
  const daemon = await fakeDaemon(page, [], { projects: twoProjects, specs: [STARTER, FACTORY], openrig: RUNNING, rigs: [] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Launch a rig', exact: true }).first().click();
  await page.getByLabel('Goal given to the lead').fill('Resume rigs after a WSL reboot');
  await page.locator('label.chip', { hasText: /^Ledge$/ }).click(); // opened from the sidebar, the window starts outside any project
  await page.getByRole('button', { name: 'Change' }).click(); await page.getByRole('button', { name: /^factory/ }).click();
  await page.getByRole('button', { name: 'Work in a copy' }).click(); // unchecked: the plan is imposed
  await expect(page.getByRole('button', { name: /^Launch the rig/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'See the plan' }).click();
  await expect(page.getByRole('heading', { name: 'factory rig plan' })).toBeVisible();
  await expect(page.getByText('What starts · 5 seats')).toBeVisible();
  expect(daemon.received.find(m => m.type === 'rig.prepare')).toMatchObject({ machine: 'local', spec: 'factory',
    where: { kind: 'project', projectId: 'ledge', repo: '/w/ledge', branch: 'feat/factory', copy: false } });
  await page.getByRole('button', { name: /^Launch the rig/ }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'rig.launch')).toHaveLength(1);
  await expect(page.getByRole('tab', { name: /^Running/, selected: true })).toBeVisible(); // Rigs › Live, « Running » in English
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('off-project launch: workspace named after the goal', async ({ page }) => {
  const daemon = await fakeDaemon(page, [], { projects: twoProjects, specs: [STARTER, FACTORY], openrig: RUNNING, rigs: [] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Launch a rig', exact: true }).first().click();
  await page.getByLabel('Goal given to the lead').fill('Prototype the rigs resume after a WSL reboot');
  await expect(page.getByLabel('Workspace')).toHaveValue('wsl-reboot');
  await expect(page.getByText('Recommended by Ledge')).toBeVisible();
  await page.getByRole('button', { name: /^Launch the rig/ }).click();
  await expect.poll(() => daemon.received.find(m => m.type === 'rig.prepare')).toMatchObject({ spec: 'starter', where: { kind: 'off-project', name: 'wsl-reboot' } });
  await expect.poll(() => daemon.received.filter(m => m.type === 'rig.launch')).toHaveLength(1);
  await expect(page.getByRole('tab', { name: /^Running/, selected: true })).toBeVisible(); // Rigs › Live, « Running » in English
  await expect(page.locator('.rig-card', { hasText: 'starter' })).toBeVisible();
});

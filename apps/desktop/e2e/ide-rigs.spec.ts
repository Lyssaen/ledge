import type { Page } from '@playwright/test';
import type { OpenRigState } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { ideReady } from './ide';

// The IDE's Rigs view (lot 7b, docs/mockups/ledge-ide-rigs.html): the activity bar's Rigs button (no « ! » since 2026-11-09), the actions and their confirmation.
test.use({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });

const LONG = 'a-rig-with-a-really-long-name-that-cannot-fit';
const rig = (id: string, name: string, status: 'running' | 'stopped') => ({ id, name, status, lifecycleState: status === 'running' ? 'running' : 'recoverable', seats: 0, running: 0, attention: 0, uptime: status === 'running' ? '2h' : null, snapshot: null, nodes: [] });
const state = (daemon: 'running' | 'stopped'): OpenRigState => ({
  installed: true, version: '0.6.14', daemon: daemon === 'running' ? { state: 'running', pid: 1, port: 7433 } : { state: 'stopped' }, kernel: { state: 'ready' }, at: new Date().toISOString(),
  rigs: [rig('1', 'starter', 'running'), rig('2', LONG, 'running'), { ...rig('k', 'kernel', 'running') }]
});
const sessions = [session('otto'), session('pim', { name: 'Pim', rig: { seat: 'dev@starter', name: 'starter' } })];
const rigsButton = (page: Page) => page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: 'OpenRig rigs' });
const view = (page: Page) => page.getByRole('complementary', { name: 'Rigs' });

async function boot(page: Page, openrig: OpenRigState, opts: { width?: number } = {}) {
  await seedAtelier(page);
  await page.addInitScript(({ width }) => {
    try {
      if (width) localStorage.setItem('ledge.ide.layout', JSON.stringify({ sideOpen: true, sideWidth: width, sideView: 'rigs', bottom: false, bottomHeight: 240, right: false }));
    } catch { /* ignore */ }
  }, { width: opts.width ?? 0 });
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, openrig, rigCommands: ['rig down starter --snapshot'] });
  await page.goto('/');
  // A Vite cold start (the run's first page) keeps the IDE's chunk loading past the default 5 s.
  await ideReady(page);
  return daemon;
}

test('the Rigs button opens the view: kernel, rigs and the Daemon row; a stop asks under the row, then the Output shows the command', async ({ page }) => {
  const daemon = await boot(page, state('running'));
  await rigsButton(page).click();
  await expect(view(page)).toBeVisible();
  await expect(view(page).getByText('Kernel').first()).toBeVisible();
  await expect(view(page).getByText('starter')).toBeVisible();
  await expect(view(page).getByText('Daemon')).toBeVisible();
  await expect(rigsButton(page).locator('.ide-badge')).toHaveCount(0);

  await view(page).locator('.ide-rigs-row').filter({ hasText: 'starter' }).getByRole('button', { name: /^Stop/ }).click();
  const conf = view(page).getByRole('group', { name: /starter/ });
  await expect(conf).toContainText('rig down starter');
  await conf.getByRole('button', { name: /^Confirm/ }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'openrig.act')).toEqual([expect.objectContaining({ action: expect.objectContaining({ kind: 'rig.stop', rig: 'starter' }) })]);

  await page.keyboard.press('Control+j');
  await page.getByRole('region', { name: 'Bottom panel' }).getByRole('tab', { name: 'Output' }).click();
  await expect(page.getByRole('region', { name: 'Bottom panel' })).toContainText('rig down starter --snapshot');
});

test('a stopped daemon puts no « ! » on Rigs (the user, 2026-11-09) and offers « Start OpenRig »', async ({ page }) => {
  await boot(page, state('stopped'));
  await expect(rigsButton(page).locator('.ide-badge')).toHaveCount(0);
  await rigsButton(page).click();
  await expect(view(page).getByRole('button', { name: 'Start OpenRig' })).toBeVisible();
});

test('at 160 px a long rig name keeps the actions column visible', async ({ page }) => {
  await boot(page, state('running'), { width: 160 });
  const row = view(page).locator('.ide-rigs-row').filter({ hasText: LONG });
  await expect(row).toBeVisible();
  const stop = await row.getByRole('button', { name: /^Stop/ }).boundingBox();
  const side = await page.locator('.ide-explorer').boundingBox();
  expect(stop && side && stop.x + stop.width <= side.x + side.width).toBe(true);
  expect(stop!.width).toBeGreaterThan(8);
});

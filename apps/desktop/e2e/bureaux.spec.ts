import { test, expect } from './fixtures';
import { eight, fakeDaemon, twoProjects, openAtelier } from './daemon';

test('Bureaux: rooms, sprites, live seats and session navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await fakeDaemon(page, eight.map(s => s.id === 'otto' ? { ...s, lastReply: { text: 'Je vérifie les tests du projet', at: new Date().toISOString() }, helpers: [{ id: 'helper-1', kind: 'Explore', task: 'Inspecter', state: 'working' as const }] } : s), { projects: twoProjects });
  await page.goto('/');
  await openAtelier(page, true);
  const floor = page.locator('.bureaux-floor');
  await expect(floor).toBeVisible();
  await expect(floor.getByRole('button', { name: 'Ledge', exact: true })).toBeVisible();
  await expect(floor.locator('.bureaux-bubble')).toContainText('Je vérifie les tests');
  await expect(floor.locator('.bureaux-helper')).toHaveCount(1);
  await expect(page.locator('.bureaux-seat, .bureaux-walker')).toHaveCount(eight.filter(s => s.state !== 'exited' && !s.offline).length);
  await expect.poll(() => page.locator('.bureaux-floor img').evaluateAll(images => images.filter(i => !(i as HTMLImageElement).complete || (i as HTMLImageElement).naturalWidth === 0).map(i => (i as HTMLImageElement).src))).toEqual([]);
  await page.screenshot({ path: '/tmp/ledge-bureaux-playwright.png' });
  await page.locator('.bureaux-seat').first().click();
  await expect(page.getByRole('banner')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Bureaux: light sprites, zoom and session menu', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.theme', 'light'); } catch { /* about:blank */ } });
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await openAtelier(page, true);
  const floor = page.locator('.bureaux-floor');
  await expect(floor).toHaveClass(/light/);
  await expect(floor.locator('img[src*="/offices/day/"]').first()).toBeVisible();
  const level = page.getByRole('toolbar', { name: 'Atelier zoom' }).locator('.zoom-level');
  const before = await level.textContent();
  await page.keyboard.press('+');
  await expect(level).not.toHaveText(before!);
  await floor.locator('.bureaux-seat').first().click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
});

test('Bureaux: ephemeral daemon thought appears in one room', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await openAtelier(page, true);
  await expect(page.locator('.bureaux-floor')).toBeVisible();
  daemon.push({ type: 'session.thought', id: 'otto', text: 'Je relis le résultat des tests', at: new Date().toISOString() });
  await expect(page.locator('.bureaux-bubble')).toContainText('Je relis le résultat des tests');
});

test('Bureaux: a new agent message starts a corridor visit', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await openAtelier(page, true);
  await expect(page.locator('.bureaux-floor')).toBeVisible();
  daemon.upsert({ ...eight[1]!, lastMessage: { id: 'visit-1', to: 'Otto', peer: 'otto', summary: 'Je viens te voir', at: new Date().toISOString() } });
  await expect(page.locator('.bureaux-visitor')).toBeVisible();
  await expect(page.locator('.bureaux-bubble')).toContainText('Je viens te voir');
});

test('Bureaux: OpenRig racks and a Ledge invitation', async ({ page }) => {
  const rig = { id: 'factory', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: null, offProject: false, lifecycle: 'running' as const, kernel: false, repos: [], seats: [{ ref: 'build@factory', address: '@build', name: 'build', runtime: 'codex', state: 'working' as const, sessionId: 'build' }] };
  const kernel = { ...rig, id: 'kernel', name: 'kernel', kernel: true, seats: [] };
  const build = { ...eight[1]!, id: 'build', name: 'build', rig: { machine: 'local', rigId: 'factory', rigName: 'factory', seat: 'build@factory', pod: 'dev', member: 'build' } };
  const daemon = await fakeDaemon(page, [build], { projects: twoProjects, rigs: [rig, kernel], openrig: { machine: 'local', state: 'running' } });
  await page.goto('/'); await openAtelier(page, true);
  await expect(page.locator('.bureaux-rack.running')).toHaveCount(1);
  daemon.exchange({ id: 'invite-1', machine: 'local', rigId: 'factory', from: 'ledge', to: '@build', kind: 'ledge', text: 'Passe me voir, build', at: new Date().toISOString() });
  await expect(page.locator('.bureaux-visitor')).toBeVisible();
  await expect(page.locator('.bureaux-ledge-bubble')).toContainText('Passe me voir');
});

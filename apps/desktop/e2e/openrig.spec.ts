import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import type { OpenRigState } from '@ledge/protocol';
import { fakeDaemon, session } from './daemon';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
  await seedAtelier(page);
});

const seat = (logicalId: string, activity: string, work = 0, runtime = 'claude-code', model: string | null = null) => ({ logicalId, session: `${logicalId.replace('.', '-')}@starter`, runtime, model, sessionStatus: 'running', lifecycleState: 'running', activity, stopped: false, work });
const STATE: OpenRigState = {
  installed: true, version: '0.6.14', daemon: { state: 'running', pid: 255259, port: 7433 }, kernel: { state: 'ready' }, at: new Date().toISOString(),
  rigs: [
    { id: '1', name: 'starter', status: 'running', lifecycleState: 'running', seats: 2, running: 2, attention: 1, uptime: '2h 12m', snapshot: '5m ago', nodes: [seat('dev.build', 'running', 2, 'claude-code', 'opus'), seat('dev.review', 'idle', 1, 'codex', 'gpt-6-astra')] },
    { id: '2', name: 'workshop', status: 'partial', lifecycleState: 'starting', seats: 4, running: 2, attention: 0, uptime: '20s', snapshot: null, nodes: [] },
    { id: '3', name: 'openrig-build', status: 'stopped', lifecycleState: 'recoverable', seats: 3, running: 0, attention: 0, uptime: null, snapshot: '1d ago', nodes: [] },
    { id: 'k', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 4, running: 4, attention: 0, uptime: '3d', snapshot: null, nodes: [seat('operator.agent', 'idle')] }
  ]
};

const SPECS = [
  { name: 'starter', source: 'builtin', path: '/o/starter/rig.yaml', summary: 'A builder and a reviewer', edges: 1, pods: [{ id: 'dev', label: 'Project', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }, { id: 'review', runtime: 'codex', model: 'gpt-6-astra', agent: 'qa' }] }] },
  { name: 'factory', source: 'builtin', path: '/o/factory/rig.yaml', edges: 6, pods: [{ id: 'orch', members: [{ id: 'lead', runtime: 'claude-code', agent: 'orchestrator' }] }, { id: 'dev', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }, { id: 'qa', runtime: 'codex', agent: 'qa' }] }] },
  { name: 'ledge-x3', source: 'user', path: '/u/ledge-x3/rig.yaml', edges: 3, pods: [{ id: 'dev', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }] }] }
];

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

// The first test of a run pays Vite's first compile of the IDE chunk: on a loaded machine that is past 20 s.
test.setTimeout(60_000);

const view = (page: Page) => page.getByRole('complementary', { name: 'Rigs' });
const row = (page: Page, name: string) => view(page).locator('.ide-rigs-row').filter({ hasText: name });

/** French, dark, the IDE up, then its Rigs view (the old OpenRig page is the Rigs view and the « OpenRig · Local » tab, lot 7). */
async function boot(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', 'dark'); } catch { /* ignore */ } });
  const daemon = await fakeDaemon(page, [session('otto')], { openrig: STATE, rigSpecs: SPECS });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('navigation', { name: 'Barre d’activité' }).getByRole('button', { name: 'Rigs OpenRig' }).click();
  await expect(view(page)).toBeVisible();
  return daemon;
}

test('the OpenRig page: daemon, kernel, rigs; a stop asks first and runs the command shown', async ({ page }, info) => {
  const daemon = await boot(page);
  // The Rigs view: the kernel, the rigs with starter's seats, the daemon; its row opens « OpenRig · Local » on the overview.
  await expect(row(page, 'Opérations')).toBeVisible();
  await expect(view(page).getByText('dev.build')).toBeVisible();
  await view(page).getByRole('button', { name: 'Daemon', exact: true }).click();
  const overview = page.getByRole('region', { name: 'OpenRig sur Local' });
  await expect(overview).toContainText(/Daemon\s*en marche/);
  await expect(overview).toContainText(/Kernel\s*1 siège/);
  await page.screenshot({ path: info.outputPath('openrig-page.png') });
  // Stop asks under the row, with the command, and runs it.
  await row(page, 'starter').getByRole('button', { name: 'Arrêter starter' }).click();
  const confirm = view(page).getByRole('group', { name: /starter/ });
  await expect(confirm).toContainText('rig down starter --snapshot');
  await page.screenshot({ path: info.outputPath('openrig-confirm.png') });
  await confirm.getByRole('button', { name: 'Confirmer l’arrêt' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'openrig.act')).toEqual([expect.objectContaining({ action: { kind: 'rig.stop', rig: 'starter', snapshot: true } })]);
});

test('launching a rig: 3 builders and 3 reviewers, then launched', async ({ page }, info) => {
  const daemon = await boot(page);
  await view(page).getByRole('button', { name: 'Lancer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Lancer un rig' });
  await expect(dialog).toBeVisible();
  // starter is running, so its card only points at its Rig view: the launch starts from factory.
  await expect(dialog.getByRole('button', { name: /^starter/ })).toContainText('Déjà en marche');
  await dialog.getByRole('button', { name: /^factory/ }).click();
  await dialog.getByLabel('Dossier').fill('~/Workspace/ledge');
  await dialog.getByLabel('Nom', { exact: true }).fill('ledge-scale');
  for (const role of ['dev.build', 'dev.qa']) for (let i = 0; i < 2; i++) await dialog.getByRole('button', { name: `Un siège de plus pour ${role}` }).click();
  // No check step (docs/mockups/ledge-ide-rigs.html, rigLaunchModal()): the modal shows the command, « Lancer » goes straight
  // to the rig's view.
  await expect(dialog.locator('.ide-rl-cmd')).toContainText('ledge-scale');
  await page.screenshot({ path: info.outputPath('openrig-launch.png'), fullPage: true });
  await dialog.getByRole('button', { name: /^Lancer/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.dv-tab').filter({ hasText: 'Rig · ledge-scale' })).toBeVisible();
  await expect.poll(() => daemon.received.filter(m => m.type === 'openrig.launch' && !(m.launch as { plan?: boolean }).plan).map(m => m.type === 'openrig.launch' && m.launch)).toEqual([
    expect.objectContaining({ spec: 'factory', cwd: '~/Workspace/ledge', name: 'ledge-scale', seats: expect.objectContaining({ 'dev.build': 3, 'dev.qa': 3 }) })
  ]);
});

test('a running rig\'s seats: 3 builders and 3 reviewers, added while it runs', async ({ page }, info) => {
  const daemon = await boot(page);
  await row(page, 'starter').getByRole('button', { name: 'starter', exact: true }).click();
  for (const role of ['dev.build', 'dev.review']) for (let i = 0; i < 2; i++) await page.getByRole('button', { name: `Un siège de plus pour ${role}` }).click();
  await expect(page.getByText(/Ajoute build-2, build-3|Ajoute .*build-3/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('openrig-seats.png') });
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'openrig.seats').map(m => m.type === 'openrig.seats' && { rig: m.rig, seats: m.seats })).toEqual([
    { rig: 'starter', seats: { 'dev.build': 3, 'dev.review': 3 } }
  ]);
});

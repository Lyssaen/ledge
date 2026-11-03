import { test, expect } from '@playwright/test';
import type { OpenRigState } from '@ledge/protocol';
import { fakeDaemon, session } from './daemon';

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

test('the OpenRig page: daemon, kernel, rigs; a stop asks first and runs the command shown', async ({ page }, info) => {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', 'dark'); } catch { /* ignore */ } });
  const daemon = await fakeDaemon(page, [session('otto')], { openrig: STATE, rigSpecs: SPECS });
  await page.goto('/');
  await page.getByRole('button', { name: 'OpenRig' }).click();
  await expect(page.getByRole('region', { name: 'Daemon' })).toContainText('Actif');
  await expect(page.getByRole('region', { name: 'Kernel' })).toContainText('Prêt');
  await page.getByRole('button', { name: 'Voir les sièges de starter' }).click();
  await expect(page.getByText('dev.build')).toBeVisible();
  await page.screenshot({ path: info.outputPath('openrig-page.png') });
  await page.getByRole('button', { name: 'Voir les sièges de starter' }).locator('xpath=ancestor::li[1]').getByRole('button', { name: 'Arrêter' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Arrêter le rig « starter » sur Local ?' });
  await expect(dialog).toContainText('rig down starter --snapshot');
  await page.screenshot({ path: info.outputPath('openrig-confirm.png') });
  await dialog.getByRole('button', { name: 'Arrêter le rig « starter »' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'openrig.act')).toEqual([expect.objectContaining({ action: { kind: 'rig.stop', rig: 'starter', snapshot: true } })]);
});

test('launching a rig: 3 builders and 3 reviewers, checked, then launched', async ({ page }, info) => {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', 'dark'); } catch { /* ignore */ } });
  const daemon = await fakeDaemon(page, [session('otto')], { openrig: STATE, rigSpecs: SPECS });
  await page.goto('/');
  await page.getByRole('button', { name: 'OpenRig' }).click();
  await page.locator('.or-head').getByRole('button', { name: 'Lancer un rig…' }).click();
  await page.getByRole('radio', { name: /^starter/ }).click();
  await page.getByLabel('Dossier de travail').fill('~/Workspace/ledge');
  await page.getByLabel('Nom du rig').fill('ledge-scale');
  for (const role of ['dev.build', 'dev.review']) for (let i = 0; i < 2; i++) await page.getByRole('button', { name: `Un siège de plus pour ${role}` }).click();
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page.getByText('Le plan passe : 6 sièges.')).toBeVisible();
  await expect(page.getByText('6 sièges sans politique de permissions')).toBeVisible();
  await page.screenshot({ path: info.outputPath('openrig-launch.png'), fullPage: true });
  await page.getByRole('button', { name: 'Lancer 6 sièges' }).click();
  await expect(page.getByText('Rig « ledge-scale » lancé.')).toBeVisible();
  expect(daemon.received.filter(m => m.type === 'openrig.launch').map(m => m.type === 'openrig.launch' && m.launch)).toEqual([
    { spec: 'starter', cwd: '~/Workspace/ledge', name: 'ledge-scale', seats: { 'dev.build': 3, 'dev.review': 3 }, delegation: 'pairs', plan: true },
    { spec: 'starter', cwd: '~/Workspace/ledge', name: 'ledge-scale', seats: { 'dev.build': 3, 'dev.review': 3 }, delegation: 'pairs' }
  ]);
});

test('a running rig\'s seats: 3 builders and 3 reviewers, added while it runs', async ({ page }, info) => {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', 'dark'); } catch { /* ignore */ } });
  const daemon = await fakeDaemon(page, [session('otto')], { openrig: STATE, rigSpecs: SPECS });
  await page.goto('/');
  await page.getByRole('button', { name: 'OpenRig' }).click();
  await page.getByRole('button', { name: 'Changer les sièges de starter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sièges du rig « starter » · Local' });
  for (const role of ['dev.build', 'dev.review']) for (let i = 0; i < 2; i++) await dialog.getByRole('button', { name: `Un siège de plus pour ${role}` }).click();
  await expect(dialog).toContainText('+ build-3');
  await expect(dialog).toContainText('rig add starter dev review-3.json');
  await page.screenshot({ path: info.outputPath('openrig-seats.png') });
  await dialog.getByRole('button', { name: 'Ajouter 4 sièges' }).click();
  await expect(page.getByText('+4 sièges, 4 liens.')).toBeVisible();
  expect(daemon.received.filter(m => m.type === 'openrig.seats').map(m => m.type === 'openrig.seats' && { rig: m.rig, seats: m.seats, delegation: m.delegation })).toEqual([
    { rig: 'starter', seats: { 'dev.build': 3, 'dev.review': 3 }, delegation: 'pairs' }
  ]);
});

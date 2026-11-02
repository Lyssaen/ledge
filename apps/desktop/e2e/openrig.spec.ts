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

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

test('the OpenRig page: daemon, kernel, rigs; a stop asks first and runs the command shown', async ({ page }, info) => {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', 'dark'); } catch { /* ignore */ } });
  const daemon = await fakeDaemon(page, [session('otto')], { openrig: STATE });
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

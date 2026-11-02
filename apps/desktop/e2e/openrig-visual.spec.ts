import { test, expect, type Page } from '@playwright/test';
import { fakeDaemon, openAtelier, session, twoProjects } from './daemon';

// Visual review of the OpenRig screens (not an assertion suite): full screens in both themes, and zooms on the controls.
// LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/openrig-visual.spec.ts
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the OpenRig screens');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });

const seat = (logicalId: string, activity: string, work = 0, runtime = 'claude-code', model: string | null = null) => ({ logicalId, session: `${logicalId}@starter`, runtime, model, sessionStatus: 'running', lifecycleState: 'running', activity, stopped: false, work });
const STATE = {
  installed: true, version: '0.7.7', daemon: { state: 'running' as const, pid: 255259, port: 7433 }, kernel: { state: 'ready' as const }, at: new Date().toISOString(),
  rigs: [
    { id: '1', name: 'starter', status: 'running', lifecycleState: 'running', seats: 2, running: 2, attention: 1, uptime: '2h 12m', snapshot: '5m ago', nodes: [seat('dev.build', 'running', 2, 'claude-code', 'opus'), seat('dev.review', 'idle', 1, 'codex', 'gpt-6-astra')] },
    { id: 'k', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 4, running: 4, attention: 0, uptime: '3d', snapshot: null, nodes: [] }
  ]
};
const SPECS = [
  { name: 'starter', source: 'builtin', path: '/o/starter/rig.yaml', summary: 'A builder and a reviewer', edges: 1, pods: [{ id: 'dev', label: 'Project', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }, { id: 'review', runtime: 'codex', model: 'gpt-6-astra', agent: 'qa' }] }] },
  { name: 'factory', source: 'builtin', path: '/o/factory/rig.yaml', edges: 6, pods: [{ id: 'orch', members: [{ id: 'lead', runtime: 'claude-code', agent: 'orchestrator' }, { id: 'advisor', runtime: 'claude-code', agent: 'advisor' }] }, { id: 'dev', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }, { id: 'qa', runtime: 'codex', agent: 'qa' }, { id: 'design', runtime: 'claude-code', agent: 'product-designer' }] }, { id: 'review', members: [{ id: 'r1', runtime: 'codex', agent: 'independent-reviewer' }, { id: 'r2', runtime: 'claude-code', agent: 'independent-reviewer' }] }] },
  { name: 'code-review', source: 'builtin', path: '/o/cr/rig.yaml', edges: 2, pods: [{ id: 'orch', members: [{ id: 'lead', runtime: 'claude-code', agent: 'orchestrator' }] }, { id: 'review', members: [{ id: 'r1', runtime: 'codex', agent: 'independent-reviewer' }, { id: 'r2', runtime: 'claude-code', agent: 'independent-reviewer' }] }] },
  { name: 'ledge-x3', source: 'user', path: '/u/ledge-x3/rig.yaml', edges: 3, pods: [{ id: 'dev', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }] }] }
];

async function open(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  await fakeDaemon(page, [session('otto')], { openrig: STATE, rigSpecs: SPECS });
  await page.goto('/');
  await page.getByRole('button', { name: 'OpenRig' }).click();
  await expect(page.getByRole('region', { name: 'Daemon' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of ['dark', 'light'] as const) {
  test(`launch form, ${theme}`, async ({ page }, info) => {
    await open(page, theme);
    await page.getByRole('button', { name: 'Lancer un rig…' }).click();
    await page.getByRole('radio', { name: /^starter/ }).click();
    await page.getByLabel('Dossier de travail').fill('~/Workspace/ledge');
    await page.screenshot({ path: info.outputPath(`launch-empty-${theme}.png`) });
    for (const role of ['dev.build', 'dev.review']) for (let i = 0; i < 2; i++) await page.getByRole('button', { name: `Un siège de plus pour ${role}` }).click();
    await page.getByRole('button', { name: 'Vérifier' }).click();
    await expect(page.getByText('Le plan passe : 6 sièges.')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`launch-checked-${theme}.png`), fullPage: true });
    await page.locator('.or-specs').screenshot({ path: info.outputPath(`zoom-specs-${theme}.png`) });
    await page.locator('.or-roles').screenshot({ path: info.outputPath(`zoom-roles-${theme}.png`) });
    await page.locator('.or-factions').screenshot({ path: info.outputPath(`zoom-actions-${theme}.png`) });
    await page.getByRole('radio', { name: 'Auto' }).click();
    await page.getByLabel('Permissions · dev.review').selectOption('yolo');
    await page.locator('section[aria-label="4 · Permissions"]').screenshot({ path: info.outputPath(`zoom-perms-${theme}.png`) });
    await page.locator('.or-roles').screenshot({ path: info.outputPath(`zoom-roles-perms-${theme}.png`) });
    await page.getByRole('radio', { name: /^factory/ }).click();
    await page.locator('.or-roles').screenshot({ path: info.outputPath(`zoom-roles-factory-${theme}.png`) });
  });
  test(`seats dialog, ${theme}`, async ({ page }, info) => {
    await open(page, theme);
    await page.getByRole('button', { name: 'Changer les sièges de starter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Un siège de plus pour dev.build' }).click();
    await dialog.getByRole('button', { name: 'Un siège de moins pour dev.review' }).click();
    await dialog.screenshot({ path: info.outputPath(`seats-${theme}.png`) });
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`seats as sessions, ${theme}`, async ({ page }, info) => {
    await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
    const T = new Date(Date.now() - 60_000).toISOString();
    await fakeDaemon(page, [
      session('otto', { cwd: '/w/ledge', project: 'ledge', name: 'Otto', state: 'idle' }),
      session('s1', { cwd: '/w/ledge', project: 'ledge', name: 'Bix', state: 'waiting_permission', source: 'hook_only', rig: { seat: 'dev-build@first-factory', name: 'first-factory', role: 'dev.build' },
        pending: { kind: 'permission' as const, text: 'npm test', tool: 'Bash', source: 'hook' as const } }),
      session('s2', { cwd: '/w/ledge', project: 'ledge', name: 'Nova', state: 'working', source: 'hook_only', rig: { seat: 'dev-review@first-factory', name: 'first-factory', role: 'dev.review' } }),
      session('k1', { cwd: '/w/openrigdev', project: 'openrigdev', name: 'Lu', tool: 'codex', state: 'idle', source: 'rig', tmuxSession: 'operator-agent@kernel', rig: { seat: 'operator-agent@kernel', name: 'kernel', role: 'operator.agent' } }),
      session('k2', { cwd: '/w/openrigdev', project: 'openrigdev', name: 'Ada', state: 'working', source: 'rig', tmuxSession: 'advisor-lead@kernel', rig: { seat: 'advisor-lead@kernel', name: 'kernel', role: 'advisor.lead' } }),
      session('k3', { cwd: '/w/openrigdev', project: 'openrigdev', name: 'Sol', tool: 'codex', state: 'idle', source: 'rig', tmuxSession: 'queue-worker@kernel', rig: { seat: 'queue-worker@kernel', name: 'kernel', role: 'queue.worker' } })
    ], { projects: twoProjects });
    await page.goto('/');
    await openAtelier(page);
    await expect(page.locator('.agent-seat').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath(`seats-sessions-${theme}.png`) });
    await page.locator('aside.sidebar').screenshot({ path: info.outputPath(`zoom-sidebar-${theme}.png`) });
    for (const name of ['Bix', 'Nova']) await page.locator('.agent-seat', { hasText: name }).screenshot({ path: info.outputPath(`zoom-seat-${name}-${theme}.png`) });
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`kernel seats and opening a seat, ${theme}`, async ({ page }, info) => {
    await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
    const k = (logicalId: string, runtime: string, activity: string, sessionStatus = 'running') => ({ logicalId, session: `${logicalId.replace('.', '-')}@kernel`, runtime, model: null, sessionStatus, lifecycleState: 'running', activity, stopped: false, work: 0 });
    const state = { ...STATE, rigs: [STATE.rigs[0]!, { id: 'k', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 4, running: 3, attention: 0, uptime: '3d', snapshot: null,
      nodes: [k('operator.agent', 'codex', 'idle'), k('advisor.lead', 'claude-code', 'running'), k('queue.worker', 'codex', 'idle'), k('operator.human', 'terminal', 'running')] }] };
    await fakeDaemon(page, [
      session('op', { cwd: '/w/openrigdev', project: 'openrigdev', name: 'Lu', tool: 'codex', state: 'idle', source: 'rig', tmuxSession: 'operator-agent@kernel', rig: { seat: 'operator-agent@kernel', name: 'kernel', role: 'operator.agent' } }),
      session('b', { cwd: '/w/ledge', project: 'ledge', name: 'Bix', state: 'working', source: 'rig', tmuxSession: 'dev.build@starter', rig: { seat: 'dev.build@starter', name: 'starter', role: 'dev.build' } })
    ], { openrig: state as never, rigSpecs: SPECS });
    await page.goto('/');
    await page.getByRole('button', { name: 'OpenRig' }).click();
    await expect(page.getByRole('list', { name: 'Sièges du kernel' })).toBeVisible();
    await page.getByRole('button', { name: 'Voir les sièges de starter' }).click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath(`kernel-seats-${theme}.png`) });
    await page.getByRole('region', { name: 'Kernel' }).screenshot({ path: info.outputPath(`zoom-kernel-${theme}.png`) });
    await page.getByRole('button', { name: 'Réglages de operator.agent' }).click();
    const dlg = page.getByRole('dialog', { name: 'Réglages du siège operator.agent · kernel' });
    await dlg.getByRole('radio', { name: 'Claude Code' }).click();
    await dlg.getByLabel('Modèle').fill('opus');
    await dlg.getByRole('radio', { name: 'high' }).click();
    await expect(dlg).toContainText('rig seat set-runtime operator-agent@kernel --runtime claude-code --model opus --effort high --reason Ledge');
    await dlg.screenshot({ path: info.outputPath(`seat-settings-${theme}.png`) });
    await dlg.getByRole('button', { name: 'Annuler' }).click();
    await page.getByRole('button', { name: 'Parler à l’opérateur' }).click();
    await expect(page.locator('.crumb-session')).toContainText('Lu');
  });
}

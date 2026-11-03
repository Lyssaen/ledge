import { test, expect, type Page } from '@playwright/test';
import type { OpenRigState, Session } from '@ledge/protocol';
import { fakeDaemon, session, twoProjects } from './daemon';

// Visual review of docs/mockups/ledge-sidebar-tidy.html (not an assertion suite): the sidebar in both themes, its empty states.
// LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/sidebar-tidy-visual.spec.ts
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the sidebar');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });

const seat = (id: string, name: string, rig: string, role: string, extra: Partial<Session> = {}) =>
  session(id, { name, cwd: `/w/${rig === 'kernel' ? 'openrig' : 'ledge'}`, project: rig, title: `${name} · ${rig}`, state: 'idle', rig: { seat: `${role.replace('.', '-')}@${rig}`, name: rig, role }, ...extra });
const KERNEL = [seat('k1', 'Nova', 'kernel', 'advisor.agent'), seat('k2', 'Max', 'kernel', 'operator.agent'), seat('k3', 'Rex', 'kernel', 'queue.worker')];
const RIG = [
  seat('r1', 'Bix', 'ledge-dev', 'pilot.lead', { state: 'working' }), seat('r2', 'Lu', 'ledge-dev', 'design.ux'),
  seat('r3', 'Ida', 'ledge-dev', 'dev.front', { state: 'working' }), seat('r4', 'Pim', 'ledge-dev', 'review.qa', { tool: 'codex' }), seat('r5', 'Pam', 'ledge-dev', 'dev.back')
];
const PROJECT = [session('otto', { name: 'Otto', cwd: '/w/pay', state: 'waiting_permission' }), session('nova', { name: 'Plume', cwd: '/w/pay', state: 'working' })];
const state = (o: Partial<OpenRigState> = {}): OpenRigState => ({ installed: true, version: '0.7.7', daemon: { state: 'running', pid: 1, port: 7433 }, kernel: { state: 'ready' }, rigs: [], at: new Date().toISOString(), ...o });

async function open(page: Page, o: { theme: 'dark' | 'light'; lang?: 'fr' | 'en'; grouping?: 'rigs' | 'projects'; sessions: Session[]; openrig?: OpenRigState }) {
  await page.addInitScript(([t, l, g]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.grouping', g!); } catch { /* ignore */ } }, [o.theme, o.lang ?? 'fr', o.grouping ?? 'rigs']);
  await fakeDaemon(page, o.sessions, { projects: twoProjects, ...(o.openrig ? { openrig: o.openrig } : {}) });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
}
const side = (page: Page) => page.locator('aside.sidebar');

for (const theme of ['dark', 'light'] as const) {
  test(`rigs, ${theme}`, async ({ page }, info) => {
    await open(page, { theme, sessions: [...PROJECT, ...RIG, ...KERNEL], openrig: state() });
    await expect(side(page).getByRole('region', { name: 'Kernel' })).toBeVisible();
    await expect(side(page).locator('.st-kernel-tag')).toHaveText('opérationnel');
    await side(page).screenshot({ path: info.outputPath(`rigs-${theme}.png`) });
    await side(page).getByRole('button', { name: 'Lancer un rig…' }).hover();
    await side(page).locator('.st-label').filter({ hasText: 'Rigs' }).screenshot({ path: info.outputPath(`zoom-rigs-header-${theme}.png`) });
    await side(page).locator('.st-rig').hover();
    await side(page).locator('.st-rig').screenshot({ path: info.outputPath(`zoom-rig-row-hover-${theme}.png`) });
    await side(page).locator('.st-kernel-box').screenshot({ path: info.outputPath(`zoom-kernel-${theme}.png`) });
  });

  test(`kernel starting / stopped, ${theme}`, async ({ page }, info) => {
    await open(page, { theme, sessions: [...RIG, ...KERNEL], openrig: state({ kernel: { state: 'starting' } }) });
    await expect(side(page).locator('.st-kernel-tag')).toHaveText('démarrage');
    await side(page).locator('.st-kernel-box').screenshot({ path: info.outputPath(`zoom-kernel-starting-${theme}.png`) });
  });

  test(`projects, ${theme}`, async ({ page }, info) => {
    await open(page, { theme, grouping: 'projects', sessions: [...PROJECT, ...RIG, ...KERNEL], openrig: state() });
    await expect(side(page).getByRole('radio', { name: 'Projets' })).toHaveAttribute('aria-checked', 'true');
    await side(page).screenshot({ path: info.outputPath(`projects-${theme}.png`) });
  });

  test(`empty states, ${theme}`, async ({ page }, info) => {
    await open(page, { theme, grouping: 'projects', sessions: [], openrig: state({ daemon: { state: 'stopped' }, kernel: { state: 'stopped' } }) });
    await expect(side(page).getByText('Aucune session pour l’instant.')).toBeVisible();
    await side(page).screenshot({ path: info.outputPath(`empty-projects-${theme}.png`) });
    await side(page).getByRole('radio', { name: 'Rigs' }).click();
    await expect(side(page).getByText('OpenRig est arrêté.')).toBeVisible();
    await side(page).screenshot({ path: info.outputPath(`empty-stopped-${theme}.png`) });
  });

  test(`no rig, ${theme}`, async ({ page }, info) => {
    await open(page, { theme, sessions: KERNEL, openrig: state() });
    await expect(side(page).getByText('Aucun rig pour l’instant.')).toBeVisible();
    await side(page).screenshot({ path: info.outputPath(`empty-norig-${theme}.png`) });
  });
}

test('english', async ({ page }, info) => {
  await open(page, { theme: 'dark', lang: 'en', sessions: [...RIG, ...KERNEL], openrig: state() });
  await expect(side(page).locator('.st-kernel-tag')).toHaveText('operational');
  await side(page).screenshot({ path: info.outputPath('rigs-en-dark.png') });
});

test('english empty states', async ({ page }, info) => {
  await open(page, { theme: 'light', lang: 'en', sessions: KERNEL, openrig: state() });
  await expect(side(page).getByText('No rig yet.')).toBeVisible();
  await side(page).screenshot({ path: info.outputPath('norig-en-light.png') });
});

test('a long list scrolls: the kernel box keeps the views’ width', async ({ page }, info) => {
  const many = Array.from({ length: 14 }, (_, i) => seat(`m${i}`, `Bot${i}`, `rig-${i % 3}`, 'dev.build'));
  await open(page, { theme: 'dark', sessions: [...many, ...KERNEL], openrig: state() });
  const box = await side(page).locator('.st-kernel-box').boundingBox();
  const views = await side(page).locator('.st-views').boundingBox();
  const toggle = await side(page).locator('.st-grouping').boundingBox();
  console.log('views', views, 'toggle', toggle, 'kernel', box);
  await side(page).screenshot({ path: info.outputPath('rigs-scroll-dark.png') });
});

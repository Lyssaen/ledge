import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import type { OpenRigState, Session } from '@ledge/protocol';
import { fakeDaemon, session } from './daemon';

// Visual review of docs/mockups/ledge-openrig-omp.html, view 1 (not an assertion suite): OMP seats under their rig, a running seat's
// page on its Terminal view and on « Fil », a stopped one greyed and its page. The browser build has no PTY: the terminal pane shows the seat's preview.
// LEDGE_VISUAL=1 pnpm exec playwright test e2e/omp-seats-visual.spec.ts   (from apps/desktop)
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the OMP seats');
test.use({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });

const seat = (id: string, name: string, rig: string, role: string, tool: Session['tool'], extra: Partial<Session> = {}) =>
  session(id, { name, tool, cwd: `/w/${rig === 'ledge-dev' ? 'ledge' : 'work'}`, project: rig, title: `${name} · ${role}`, state: 'idle', source: 'rig',
    tmuxSession: `${role.replace('.', '-')}@${rig}`, rig: { seat: `${role.replace('.', '-')}@${rig}`, name: rig, role }, ...extra });
const SEATS = [
  seat('rig-kit', 'Kit', 'kernel', 'operator.agent', 'claude'),
  seat('rig-ivo', 'Ivo', 'dev-omp', 'dev.agent', 'omp', { state: 'working' }), seat('rig-pia', 'Pia', 'dev-omp', 'review.reviewer', 'omp'),
  seat('rig-lu', 'Lu', 'ledge-dev', 'pilot.lead', 'claude'), seat('rig-ida', 'Ida', 'ledge-dev', 'dev.back', 'claude', { state: 'working' }),
  seat('rig-ana', 'Ana', 'split-omp', 'analysis.analyst', 'omp'), seat('rig-sol', 'Sol', 'split-omp', 'review.reviewer', 'omp'),
  seat('rig-tom', 'Tom', 'split-omp', 'split.splitter', 'omp', { state: 'exited', exitedAt: new Date(Date.now() - 600_000).toISOString() })
];
const MIRROR = ["you > Story ST7-412 : implémente le refus d'un IBAN vide, en TDD strict.", '', 'Je commence par le test rouge : un IBAN vide doit être refusé avec', 'INVALID_IBAN.', '',
  '  ⚙ read …', '  ⚙ read done', '  ⚙ edit done', '  ⚙ bash …', '  ⚙ bash FAILED', '', 'Le test échoue comme attendu (rouge). Je commite cette étape.'];
const state: OpenRigState = { installed: true, version: '0.7.7', daemon: { state: 'running', pid: 1, port: 7433 }, kernel: { state: 'ready' }, rigs: [], at: new Date().toISOString() };

async function open(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en' = 'fr', sessions: Session[] = SEATS, dense = false) {
  await page.addInitScript(([t, l, c]) => { try {
    localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.grouping', 'rigs');
    if (c === '1') localStorage.setItem('desktop.sidebar', JSON.stringify({ hideDone: true, dense: true }));
  } catch { /* ignore */ } }, [theme, lang, dense ? '1' : '0']);
  const d = await fakeDaemon(page, sessions, { projects: { projects: [], rules: [] }, openrig: state });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  return d;
}
const side = (page: Page) => page.locator('aside.sidebar');

for (const theme of ['dark', 'light'] as const) {
  test(`a running OMP seat, ${theme}`, async ({ page }, info) => {
    const d = await open(page, theme);
    await side(page).getByRole('button', { name: /^Ivo/ }).click();
    d.preview('rig-ivo', MIRROR);
    // A running seat opens on its Terminal view; « Fil » says why there is no thread (design-ux, Fil | Terminal, 12:23Z).
    await expect(page.getByRole('region', { name: 'Terminal' })).toContainText('INVALID_IBAN', { timeout: 30_000 });
    await page.screenshot({ path: info.outputPath(`omp-live-${theme}.png`) });
    await side(page).screenshot({ path: info.outputPath(`omp-sidebar-${theme}.png`) });
    await page.getByRole('tab', { name: /^Fil/ }).click();
    await expect(page.locator('.seat-note')).toContainText('Pas de fil pour ce siège.');
    await page.screenshot({ path: info.outputPath(`omp-live-thread-${theme}.png`) });
    await page.locator('.seat-note').screenshot({ path: info.outputPath(`omp-nothread-${theme}.png`) });
    await side(page).locator('[role="treeitem"]').filter({ hasText: 'Tom' }).screenshot({ path: info.outputPath(`omp-stopped-row-${theme}.png`) });
  });

  test(`a stopped OMP seat's page, ${theme}`, async ({ page }, info) => {
    await open(page, theme);
    await side(page).getByRole('button', { name: /^Tom/ }).click();
    await expect(page.locator('.seat-note')).toContainText('Siège arrêté.', { timeout: 30_000 });
    await expect(page.getByRole('region', { name: 'Terminal' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Terminal/ })).toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: info.outputPath(`omp-stopped-open-${theme}.png`) });
    await page.locator('.seat-note').screenshot({ path: info.outputPath(`omp-stopped-note-${theme}.png`) });
  });
}

// The seats in the compact sidebar (#185's alignment): the stopped one greyed on the same grid.
for (const theme of ['dark', 'light'] as const) test(`OMP seats, compact sidebar, ${theme}`, async ({ page }, info) => {
  await open(page, theme, 'fr', SEATS, true);
  await expect(side(page).locator('[role="treeitem"]').filter({ hasText: 'Tom' })).toBeVisible({ timeout: 30_000 });
  await side(page).screenshot({ path: info.outputPath(`omp-sidebar-compact-${theme}.png`) });
});

test('english', async ({ page }, info) => {
  const d = await open(page, 'dark', 'en');
  await side(page).getByRole('button', { name: /^Ivo/ }).click();
  d.preview('rig-ivo', MIRROR);
  await expect(page.getByRole('region', { name: 'Terminal' })).toContainText('INVALID_IBAN', { timeout: 30_000 });
  await page.getByRole('tab', { name: /^Thread/ }).click();
  await expect(page.locator('.seat-note')).toContainText('No thread for this seat.');
  await page.screenshot({ path: info.outputPath('omp-live-en-dark.png') });
  await side(page).getByRole('button', { name: /^Tom/ }).click();
  await expect(page.locator('.seat-note')).toContainText('Seat stopped.');
  await page.screenshot({ path: info.outputPath('omp-stopped-open-en-dark.png') });
});

// The real OMP seats as the daemon would follow them, read from OpenRig and OMP's journals by a read-only script (LEDGE_OMP_REAL: its JSON).
for (const theme of ['dark', 'light'] as const) test(`real OMP seats, ${theme}`, async ({ page }, info) => {
  test.skip(!process.env.LEDGE_OMP_REAL, 'set LEDGE_OMP_REAL to the read-only script\'s sessions');
  const real = JSON.parse(readFileSync(process.env.LEDGE_OMP_REAL!, 'utf8')) as Session[];
  await open(page, theme, 'fr', [SEATS[0]!, ...real]);
  await expect(side(page).getByRole('button', { name: /^split-omp/ })).toBeVisible();
  await side(page).screenshot({ path: info.outputPath(`real-sidebar-${theme}.png`) });
});

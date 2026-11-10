import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, session, twoProjects } from './daemon';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

// The first tests of a run pay Vite's first compile of the IDE chunk: on a loaded machine that is past 20 s.
test.setTimeout(60_000);
/** The IDE is up on its Atelier tab, the agents seated. */
async function booted(page: Page) {
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.ide-atelier button[data-agent]').first()).toBeVisible({ timeout: 15_000 });
}

// Visual reference of the Desktop Atelier (not an assertion suite): project rooms, a rig's room, sub-agents at a table's
// ends, « Sans projet », dark and light. The iPad lot shares the Atelier's layout and stylesheet (packages/ui/src/atelier): these
// captures, taken before and after, must stay byte for byte the same (Desktop does not change).
// LEDGE_VISUAL=1 pnpm exec playwright test e2e/atelier-visual.spec.ts   (from apps/desktop)
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the Desktop Atelier');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

const sessions = [
  ...eight.map(s => (s.id === 'nova' ? { ...s, helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le relais', state: 'working' as const }, { id: 'h2', kind: 'Plan', task: 'Plan de reprise', state: 'idle' as const }] } : s)),
  session('ivo', { name: 'Ivo', tool: 'omp', cwd: '/w/dev-omp', project: 'dev-omp', state: 'working', source: 'rig', tmuxSession: 'dev-agent@dev-omp', rig: { seat: 'dev-agent@dev-omp', name: 'dev-omp', role: 'dev.agent' } }),
  session('mia', { name: 'Mia', tool: 'omp', cwd: '/w/dev-omp', project: 'dev-omp', state: 'idle', source: 'rig', tmuxSession: 'design-maquettiste@dev-omp', rig: { seat: 'design-maquettiste@dev-omp', name: 'dev-omp', role: 'design.maquettiste' } }),
  session('kit', { name: 'Kit', cwd: '/w/elsewhere', project: 'elsewhere', state: 'idle' })
];

async function open(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(([t]) => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme]);
  await fakeDaemon(page, sessions, { projects: twoProjects, launcher: ['ledge'] });
  await page.goto('/');
  await booted(page);
  await expect(page.locator('.atelier-room').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}

for (const theme of ['dark', 'light'] as const) test(`the Desktop Atelier, ${theme}`, async ({ page }, info) => {
  await open(page, theme);
  await page.locator('.overview-scroll.atelier').screenshot({ path: info.outputPath(`atelier-${theme}.png`), animations: 'disabled' });
});

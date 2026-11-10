import type { Page } from '@playwright/test';
import type { Projects, Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session } from './daemon';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
  await seedAtelier(page);
});

// Visual review of docs/mockups/ledge-projects-eye.html (not an assertion suite): « Projets » with the eye pressed, released,
// and with nobody live, comfortable and compact, dark and light. LEDGE_VISUAL=1 pnpm exec playwright test e2e/projects-eye-visual.spec.ts
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the Projects eye');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });

const PROJECTS: Projects = { projects: [
  { id: 'ledge', name: 'Ledge', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
  { id: 'review', name: 'Review', color: 'slate', description: '', repos: [{ machine: 'local', path: '/w/review' }] },
  { id: 'pay', name: 'Payment Service', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/pay' }] },
  { id: 'paper', name: 'Paper Channel', color: 'amber', description: '', repos: [{ machine: 'local', path: '/w/paper' }] },
  { id: 'factory', name: 'Software Factory', color: 'violet', description: '', repos: [{ machine: 'local', path: '/w/factory' }] },
  { id: 'doccle', name: 'Doccle Channel', color: 'pink', description: '', repos: [{ machine: 'local', path: '/w/doccle' }] }
], rules: [] };
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const s = (id: string, name: string, cwd: string, state: Session['state'], topic: string, min: number, extra: Partial<Session> = {}) =>
  session(id, { name, cwd, project: cwd.split('/').at(-1)!, repo: cwd.split('/').at(-1)!, branch: 'main', state, topic, title: `${name} · ${topic}`, lastActivityAt: ago(min), ...(state === 'exited' ? { exitedAt: ago(min) } : {}), ...extra });
const SESSIONS = [
  s('pim', 'Pim', '/w/ledge', 'working', 'Est-ce que tu peux clarifier le menu ?', 7), s('max', 'Max', '/w/ledge', 'idle', 'Relire la maquette OMP', 12),
  s('rex', 'Rex', '/w/ledge', 'exited', 'Corriger l’alignement compact', 120, { tool: 'codex' }), s('eli', 'Eli', '/w/ledge', 'exited', 'Revue de la PR #181', 180, { tool: 'codex' }),
  s('otto', 'Otto', '/w/review', 'waiting_input', 'Tu sais m’expliquer la règle ?', 21, { pending: { kind: 'question', text: 'La règle ?', source: 'hook' } }),
  s('zoe', 'Zoe', '/w/pay', 'idle', 'Regarder l’umbrella', 60), s('luna', 'Luna', '/w/paper', 'exited', 'Décliner la nouvelle identité', 1440)
];
const QUIET = SESSIONS.map(x => (x.state === 'exited' ? x : { ...x, state: 'exited' as const, exitedAt: ago(1), pending: undefined }));

async function open(page: Page, theme: 'dark' | 'light', dense: boolean, hideDone: boolean, sessions = SESSIONS) {
  await page.addInitScript(([t, d, h]) => { try {
    localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.grouping', 'projects');
    localStorage.setItem('desktop.sidebar', JSON.stringify({ hideDone: h === '1', dense: d === '1' }));
  } catch { /* ignore */ } }, [theme, dense ? '1' : '0', hideDone ? '1' : '0']);
  await fakeDaemon(page, sessions, { projects: PROJECTS });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
}
const projects = (page: Page) => page.locator('aside.sidebar section[aria-label="Projets"]');

for (const theme of ['dark', 'light'] as const) for (const dense of [false, true]) {
  const mode = dense ? 'compact' : 'normal';
  // The IDE's explorer has no « +N projects with no live agent » line (Tree.tsx, `!p.ide`): the eye in its head releases them.
  const eye = (page: Page) => page.locator('aside.sidebar').getByRole('button', { name: 'Seulement les projets avec un agent actif (H)' });
  test(`eye pressed, released, nobody live — ${mode}, ${theme}`, async ({ page }, info) => {
    await open(page, theme, dense, true);
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
    await expect(projects(page).getByRole('button', { name: /^Doccle Channel/ })).toHaveCount(0);
    await projects(page).screenshot({ path: info.outputPath(`eye-pressed-${mode}-${theme}.png`) });
    await eye(page).click();
    await expect(projects(page).getByRole('button', { name: /^Doccle Channel/ })).toBeVisible();
    await projects(page).screenshot({ path: info.outputPath(`eye-released-${mode}-${theme}.png`) });
  });
  test(`projects but no session — ${mode}, ${theme}`, async ({ page }, info) => {
    await open(page, theme, dense, true, []);
    await expect(projects(page).getByRole('button', { name: 'Créer une session' })).toBeVisible({ timeout: 30_000 });
    await projects(page).screenshot({ path: info.outputPath(`eye-nosession-${mode}-${theme}.png`) });
  });
  test(`nobody live — ${mode}, ${theme}`, async ({ page }, info) => {
    await open(page, theme, dense, true, QUIET);
    await expect(projects(page).getByText('Aucun agent actif.')).toBeVisible({ timeout: 30_000 });
    await projects(page).screenshot({ path: info.outputPath(`eye-quiet-${mode}-${theme}.png`) });
  });
}

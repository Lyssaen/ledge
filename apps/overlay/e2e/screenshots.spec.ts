import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { expect, layer, expectMode, ready, surface } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { overview, team, perm, openList, restInside } from './scenarios';

/*
 * Product captures for docs/tour.md, not a test: skipped unless LEDGE_SCREENSHOTS is set.
 *   LEDGE_SCREENSHOTS=1 pnpm --filter overlay exec playwright test e2e/screenshots.spec.ts
 * Set LEDGE_CHROMIUM to a Chromium binary when the pinned Playwright build is not installed.
 * Every screen runs the real app against the fake daemon, in French (the default), with the real web fonts (needs
 * network), on a 1600 x 1000 screen with a plain desktop behind the transparent window. The base Playwright `test` is
 * used on purpose: the shared fixture fails on any console error, and the full Chromium logs a 404 for the favicon.
 * Files land in docs/screens/<name>.png at the repository root.
 */
test.skip(!process.env.LEDGE_SCREENSHOTS, 'set LEDGE_SCREENSHOTS=1 to refresh the product captures');
test.use({ viewport: { width: 1600, height: 1000 }, launchOptions: process.env.LEDGE_CHROMIUM ? { executablePath: process.env.LEDGE_CHROMIUM } : {} });
test.describe.configure({ mode: 'serial' });

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'screens');
mkdirSync(OUT, { recursive: true });

/** Something behind the window: a quiet desktop, dark or light to match the theme. */
async function desktop(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(t => { try { localStorage.setItem('ledge.theme', t); } catch { /* ignore */ } }, theme);
  await page.addStyleTag({ content: theme === 'dark'
    ? 'html { background: radial-gradient(120% 90% at 70% 10%, #1d2430 0%, #0f141b 55%, #090c11 100%) !important; }'
    : 'html { background: radial-gradient(120% 90% at 70% 10%, #e9edf3 0%, #d9dee6 55%, #c9d0da 100%) !important; }' });
}

/** The surface and whatever floats beside it (tooltip, coachmark), with a margin. */
async function shoot(page: Page, name: string, extra: string[] = [], minWidth = 120) {
  await page.waitForTimeout(700); // let the motion settle
  const boxes = [await surface(page).boundingBox()];
  for (const sel of extra) { const l = page.locator(sel); if (await l.count() && await l.first().isVisible()) boxes.push(await l.first().boundingBox()); }
  const bs = boxes.filter((b): b is NonNullable<typeof b> => !!b);
  const m = 28;
  const x0 = Math.max(0, Math.min(...bs.map(b => b.x)) - m), y0 = Math.max(0, Math.min(...bs.map(b => b.y)) - m);
  const x1 = Math.min(1600, Math.max(...bs.map(b => b.x + b.width)) + m), y1 = Math.min(1000, Math.max(...bs.map(b => b.y + b.height)) + m);
  await page.screenshot({ path: join(OUT, `${name}.png`), clip: { x: x0, y: y0, width: Math.max(x1 - x0, minWidth), height: y1 - y0 } });
}

const conversation = [
  '❯ Lance les tests du overlay et corrige ce qui casse.',
  '',
  '● Bash(pnpm --filter overlay test)',
  '  ⎿  Test Files  19 passed (19)',
  '        Tests  229 passed (229)',
  '',
  '● Les tests passent. Je relis SessionView pour vérifier que l’aperçu suit bien la dernière ligne quand le daemon envoie une mise à jour.',
  '',
  '● Read(src/surface/SessionView.tsx)',
  '  ⎿  Read 180 lines',
  '',
  '● Rien à corriger : le défilement se fait dans un effet après chaque aperçu reçu. Je lance les e2e pour confirmer.',
  '',
  '● Bash(pnpm --filter overlay test:e2e)',
  '  ⎿  Running 31 tests using 4 workers',
  '',
  '✻ Brewed for 42s · done 1:12 PM'
];

const openSession = async (page: Page, row: string) => {
  await openList(page);
  await layer(page, 'list').getByRole('button', { name: row }).click();
  await expectMode(page, 'session');
  await restInside(page);
};

for (const theme of ['dark', 'light'] as const) {
  test.describe(theme, () => {
    test('handle and tooltip', async ({ page }) => {
      await desktop(page, theme);
      await fakeDaemon(page, overview());
      await ready(page, 4);
      await page.mouse.move(600, 500);
      // Two asks are waiting: the bubble unfolds on its own, then folds back after its 4 s; the handle is captured after that.
      await expectMode(page, 'bubble');
      await expect(surface(page)).toHaveAttribute('data-mode', 'handle', { timeout: 10_000 });
      await shoot(page, `handle-${theme}`, [], 240);
      const bot = layer(page, 'handle').getByRole('button').first();
      await bot.hover();
      await page.waitForTimeout(400);
      await shoot(page, `handle-tooltip-${theme}`, ['[role="tooltip"]']);
    });

    test('bubble', async ({ page }) => {
      await desktop(page, theme);
      const d = await fakeDaemon(page, [session('pim', { name: 'Pim', tool: 'cursor', project: 'landing-page' }), session('bix', { name: 'Bix', project: 'documentation', state: 'idle' })]);
      await ready(page, 2);
      d.upsert(session('otto', { name: 'Otto', ...perm }));
      await expectMode(page, 'bubble');
      await expect(layer(page, 'bubble').getByText('Otto attend votre accord')).toBeVisible();
      await shoot(page, `bubble-${theme}`);
    });

    test('list', async ({ page }) => {
      await desktop(page, theme);
      await fakeDaemon(page, overview());
      await ready(page, 4);
      await openList(page);
      await shoot(page, `list-${theme}`);
    });

    test('session: permission', async ({ page }) => {
      await desktop(page, theme);
      const d = await fakeDaemon(page, overview());
      await ready(page, 4);
      d.preview('otto', conversation);
      await openSession(page, 'harness-assistant, Otto, ouvrir');
      await expect(layer(page, 'session').getByText('pnpm test --filter overlay')).toBeVisible();
      await shoot(page, `session-permission-${theme}`);
    });

    if (theme === 'dark') {
      test('session: question', async ({ page }) => {
        await desktop(page, theme);
        await fakeDaemon(page, overview());
        await ready(page, 4);
        await openSession(page, 'design-system, Nova, ouvrir');
        await expect(layer(page, 'session').locator('label.ledge-opt')).toHaveCount(3);
        await shoot(page, `session-question-${theme}`);
      });

      test('session: working, with the terminal preview', async ({ page }) => {
        await desktop(page, theme);
        const d = await fakeDaemon(page, overview());
        await ready(page, 4);
        d.preview('pim', conversation);
        await openSession(page, 'landing-page, Pim, ouvrir');
        const pre = layer(page, 'session').locator('pre[data-terminal]');
        await expect(pre).toBeVisible();
        await expect(pre).toContainText('Brewed for 42s');
        await shoot(page, `session-preview-${theme}`);
      });

      test('session: helpers, the main thread at rest while two subagents work', async ({ page }) => {
        await desktop(page, theme);
        const helpers = [
          { id: 'h0', kind: 'Explore', task: 'find the reducer consumers', state: 'exited' as const },
          { id: 'h1', kind: 'general-purpose', task: 'Review task 1 (spec + quality)', state: 'working' as const },
          { id: 'h2', kind: 'Explore', task: 'list the i18n keys without a French string', state: 'working' as const }
        ];
        const d = await fakeDaemon(page, overview().map(s => (s.id === 'pim' ? { ...s, state: 'idle' as const, helpers } : s)));
        await ready(page, 4);
        d.preview('pim', conversation);
        await openSession(page, 'landing-page, Pim, ouvrir');
        await expect(layer(page, 'session').getByRole('list', { name: 'Sous-agents' }).locator('[data-helper]')).toHaveCount(2);
        await shoot(page, `session-helpers-${theme}`);
      });

      test('session: your turn, the last reply read like a plan', async ({ page }) => {
        await desktop(page, theme);
        const d = await fakeDaemon(page, overview());
        await ready(page, 4);
        d.preview('bix', conversation);
        await openSession(page, 'documentation, Bix, ouvrir');
        await expect(layer(page, 'session').getByRole('group', { name: 'Question 1' })).toBeVisible();
        await shoot(page, `session-reply-${theme}`);
      });

      test('session: read only', async ({ page }) => {
        await desktop(page, theme);
        await fakeDaemon(page, [session('otto', { source: 'hook_only', tmuxSession: null })]);
        await ready(page, 1);
        await openSession(page, 'harness-assistant, Otto, ouvrir');
        await expect(layer(page, 'session').getByRole('heading', { name: 'Visible, en lecture seule.' })).toBeVisible();
        await shoot(page, `session-readonly-${theme}`);
      });

      test('keyboard: numbered list and coachmark', async ({ page }) => {
        await desktop(page, theme);
        await fakeDaemon(page, overview());
        await ready(page, 4);
        await page.keyboard.press('Control+Alt+L');
        await expectMode(page, 'list');
        await expect(page.locator('[data-coachmark]')).toBeVisible();
        await shoot(page, `keyboard-${theme}`, ['[data-coachmark]']);
      });

      test('settings and help', async ({ page }) => {
        await desktop(page, theme);
        await fakeDaemon(page, overview());
        await ready(page, 4);
        await openList(page);
        await layer(page, 'list').getByRole('button', { name: 'Réglages' }).click();
        await expectMode(page, 'settings');
        await restInside(page);
        await shoot(page, `settings-${theme}`);
        await page.keyboard.press('Escape');
        await expectMode(page, 'list');
        await layer(page, 'list').getByRole('button', { name: 'Raccourcis clavier' }).click();
        await expectMode(page, 'help');
        await restInside(page);
        await shoot(page, `help-${theme}`);
      });

      test('new session, and the empty list', async ({ page }) => {
        await desktop(page, theme);
        const recents = [
          { cwd: '/home/joffrey/Workspace/api-gateway', project: 'api-gateway', lastAt: new Date(Date.now() - 86_400_000).toISOString() },
          { cwd: '/home/joffrey/Workspace/harness-assistant', project: 'harness-assistant', lastAt: new Date(Date.now() - 18 * 60_000).toISOString() },
          { cwd: '/home/joffrey/Workspace/speos-portal', project: 'speos-portal', lastAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }
        ];
        await fakeDaemon(page, overview().map(s => (s.id === 'otto' ? { ...s, cwd: '/home/joffrey/Workspace/harness-assistant' } : s)), { recents });
        await ready(page, 4);
        await openList(page);
        await layer(page, 'list').getByRole('button', { name: 'Nouvelle session' }).click();
        await expectMode(page, 'launch');
        await restInside(page);
        await layer(page, 'launch').getByLabel('Compagnon', { exact: true }).fill('Juno');
        await shoot(page, `launch-${theme}`);
      });

      test('empty list', async ({ page }) => {
        await desktop(page, theme);
        await fakeDaemon(page, []);
        await ready(page, 0);
        await openList(page);
        await expect(layer(page, 'list').getByText('Personne au travail.')).toBeVisible();
        await shoot(page, `launch-empty-${theme}`);
      });

      test('twelve sessions', async ({ page }) => {
        await desktop(page, theme);
        await fakeDaemon(page, team());
        await ready(page, 12);
        await openList(page);
        await expect(layer(page, 'list').getByText('12 sessions · 3 demandes pour vous')).toBeVisible();
        await shoot(page, `team-${theme}`);
      });
    }
  });
}

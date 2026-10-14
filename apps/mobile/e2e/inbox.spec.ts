import { expect, test, type Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { fakeDaemon, session, T0 } from './daemon';

const TOKEN_KEY = 'ledge.mobile.token';
const LAST_KEY = 'ledge.mobile.lastState';

const withPending = (id: string, kind: 'permission' | 'question' | 'plan' | 'diff', text: string, ageMin: number, extra: Partial<Session> = {}): Session => {
  const since = new Date(Date.now() - ageMin * 60_000).toISOString();
  return session(id, {
    state: kind === 'question' ? 'waiting_input' : 'waiting_permission', name: ['Otto', 'Nova', 'Kai', 'Bix', 'Pim'][id.length % 5]!, topic: `Tâche de la session ${id}`,
    repo: 'harness-assistant', branch: 'session-search', lastActivityAt: since,
    pending: { id: `p-${id}`, version: 1, since, kind, text, source: 'hook', ...(kind === 'question' ? { options: ['Sombre · Signal', 'Clair · Galet'] } : { reason: 'Vérifier le badge après la modification de la liste.' }) },
    ...extra
  });
};

const ten = () => Array.from({ length: 10 }, (_, i) => withPending(`s${i}`, i === 3 ? 'question' : 'permission', i === 3 ? 'Quel thème utiliser par défaut ?' : 'pnpm --filter overlay test', i + 1, i === 5 ? { tool: 'codex', worktree: true } : {}));

async function paired(page: Page) {
  await page.addInitScript(k => localStorage.setItem(k, 't'.repeat(43)), TOKEN_KEY);
}
const noOverflow = async (page: Page) => {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
};

for (const width of [320, 390, 430]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height: 800 }); await paired(page); });

    test('ten requests: no horizontal overflow, every target at least 44 px, filters keep the global count', async ({ page }) => {
      await fakeDaemon(page, ten());
      await page.goto('/m/');
      await expect(page.getByRole('heading', { level: 1, name: 'À traiter' })).toBeVisible();
      await expect(page.getByText('10 demandes. Choisissez par où commencer.')).toBeVisible();
      await expect(page.locator('main a[href^="#/request/"]')).toHaveCount(10);
      await noOverflow(page);
      const small = await page.evaluate(() => [...document.querySelectorAll('a, button, summary')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && (r.width < 44 || r.height < 44)).length);
      expect(small).toBe(0);
      await page.getByRole('button', { name: 'Questions' }).click();
      await expect(page.locator('main a[href^="#/request/"]')).toHaveCount(1);
      await expect(page.getByText('10 demandes. Choisissez par où commencer.')).toBeVisible();
      await expect(page.getByRole('navigation').getByText('10', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Autorisations' }).click();
      await expect(page.locator('main a[href^="#/request/"]')).toHaveCount(9);
      await page.screenshot({ path: `e2e/shots/inbox-${width}.png` });
    });

    test('a long command wraps in the detail without widening the page', async ({ page }) => {
      const cmd = 'pnpm --filter overlay exec vitest run src/surface/__tests__/SessionList.waiting-duration.test.tsx --reporter=verbose --testNamePattern="affiche la durée d’attente après reconnexion" /home/paradow/Workspace/harness-assistant/apps/overlay/src/surface/averyveryverylongunbrokenpathname_without_spaces_at_all_1234567890';
      const s = withPending('long', 'permission', cmd, 3);
      await fakeDaemon(page, [s]);
      await page.goto('/m/');
      await page.getByRole('link', { name: /Tâche de la session long/ }).click();
      await expect(page).toHaveURL(/#\/request\/long\/p-long$/);
      const pre = page.locator('pre').first();
      await expect(pre).toContainText('affiche la durée');
      await noOverflow(page);
      expect(await pre.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Refuser' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Autoriser une fois' })).toBeDisabled();
      await expect(page.getByText('Décisions depuis le téléphone : pas encore disponibles. Répondez sur le PC.')).toBeVisible();
      await expect(page.getByText('Dossier')).toBeVisible();
      await expect(page.getByText('/w/harness-assistant')).toBeVisible();
      await page.screenshot({ path: `e2e/shots/request-${width}.png` });
    });

    test('the terminal context unfolds when a preview exists', async ({ page }) => {
      const d = await fakeDaemon(page, [withPending('ctx', 'permission', 'pnpm test', 1)]);
      await page.goto('/m/#/request/ctx/p-ctx');
      await expect(page.getByRole('button', { name: 'Refuser' })).toBeVisible();
      d.send({ type: 'session.preview', id: 'ctx', lines: ['● Lancement des tests', '  18 réussis'] });
      await page.getByText('Contexte du terminal').click();
      await expect(page.getByText('18 réussis')).toBeVisible();
    });

    test('offline: last state readable, decision buttons disabled, banner offers reconnect', async ({ page }) => {
      const syncedAt = new Date().toISOString();
      await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [LAST_KEY, JSON.stringify({ sessions: [withPending('off', 'permission', 'git push --force origin main', 2)], previews: {}, syncedAt, pcName: 'PC-Joffrey' })]);
      await page.routeWebSocket(/.*/, ws => { void ws.close({ code: 1001 }); });
      await page.goto('/m/');
      await expect(page.getByText('Connexion au PC perdue')).toBeVisible();
      await expect(page.getByText(/^Dernier état connu · \d\d:\d\d$/)).toBeVisible();
      await expect(page.getByText('PC-Joffrey · déconnecté')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reconnecter et actualiser' })).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/offline-${width}.png` });
      await page.getByRole('link', { name: /Tâche de la session off/ }).click();
      await expect(page.getByText('git push --force origin main').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Refuser' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Autoriser une fois' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Reconnecter et actualiser' })).toBeVisible();
      await page.screenshot({ path: `e2e/shots/request-offline-${width}.png` });
    });

    test('a link to a request that is no longer pending shows Gone', async ({ page }) => {
      const d = await fakeDaemon(page, [withPending('g', 'permission', 'pnpm test', 1)]);
      await page.goto('/m/#/request/g/p-g');
      await expect(page.getByRole('button', { name: 'Refuser' })).toBeVisible();
      d.upsert(session('g', { state: 'working', lastActivityAt: T0 }));
      await expect(page.getByText('Cette demande n’attend plus de décision.')).toBeVisible();
      await page.getByRole('link', { name: 'Retour aux demandes' }).last().click();
      await expect(page.getByText('Vous êtes à jour')).toBeVisible();
      await page.goto('/m/#/request/nope/nope');
      await expect(page.getByText('Cette demande n’attend plus de décision.')).toBeVisible();
      await page.screenshot({ path: `e2e/shots/gone-${width}.png` });
    });

    test('the settings icon opens the Connexion panel; pairing needs a confirmation', async ({ page }) => {
      await fakeDaemon(page, [withPending('c', 'permission', 'pnpm test', 1)]);
      await page.goto('/m/');
      await page.getByRole('link', { name: 'Connexion du téléphone' }).click();
      await expect(page.getByText('PC-Joffrey', { exact: true })).toBeVisible();
      await expect(page.getByText('iPhone', { exact: true })).toBeVisible();
      await expect(page.getByText('Code à six chiffres')).toHaveCount(0);
      await page.goto('/m/#/pair');
      await expect(page.getByRole('button', { name: 'Réappairer' })).toBeVisible();
      await page.getByRole('button', { name: 'Réappairer' }).click();
      await page.getByRole('button', { name: 'Oui, réappairer' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Votre PC, à portée de main' })).toBeVisible();
      await page.getByRole('button', { name: 'Annuler' }).click();
      await expect(page.getByRole('button', { name: 'Réappairer' })).toBeVisible();
    });
  });
}

import { expect, test, type Page } from '@playwright/test';
import { fakeDaemon, session } from './daemon';

const since = () => new Date(Date.now() - 2 * 60_000).toISOString();
const sessions = () => [
  session('otto', { name: 'Otto', topic: 'Badge d’attente', repo: 'harness-assistant', repoPath: '/r/harness-assistant', branch: 'wait-badge', state: 'waiting_permission', pending: { id: 'p-otto', version: 1, since: since(), kind: 'permission', text: 'pnpm test --filter overlay', source: 'hook', risk: 'low' } }),
  session('bix', { name: 'Bix', topic: 'Recherche de sessions', repo: 'harness-assistant', repoPath: '/r/harness-assistant', branch: 'session-search', state: 'idle', unread: true, lastReply: { text: 'La recherche est prête. Voir le résultat.', at: since() } }),
  session('pim', { name: 'Pim', tool: 'cursor', topic: 'Lecture des réponses avec un titre particulièrement long pour vérifier le retour à la ligne', repo: 'harness-assistant', repoPath: '/r/harness-assistant', branch: 'markdown-reader-with-a-very-long-branch-name-without-any-break', worktree: true, state: 'working' }),
  session('nova', { name: 'Nova', tool: 'codex', topic: 'Thème au premier lancement', repo: 'design-system', repoPath: '/r/design-system', branch: 'theme-default', state: 'waiting_input', pending: { id: 'p-nova', version: 1, since: since(), kind: 'question', text: 'Quel thème utiliser par défaut ?', source: 'hook', options: ['A', 'B'] } }),
  session('kai', { name: 'Kai', tool: 'codex', topic: 'Publication du site', repo: 'ledge-site', repoPath: '/r/ledge-site', branch: 'main', state: 'exited' })
];

const paired = (page: Page) => page.addInitScript(() => localStorage.setItem('ledge.mobile.token', 't'.repeat(43)));

for (const width of [320, 390, 430]) {
  test(`agents list fits the width; unread dot shows; a row opens its thread (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await paired(page);
    await fakeDaemon(page, sessions());
    await page.goto('/m/#/agents');
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
    await expect(page.getByText('5 sessions · 3 projets sur ce PC')).toBeVisible();
    await expect(page.getByText('harness-assistant', { exact: true })).toBeVisible();
    await expect(page.getByText('● Non lu')).toHaveCount(1);
    for (const label of ['Autorisation', 'Question', 'Disponible', 'Au travail', 'Terminée']) await expect(page.locator('main').getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText('Travaille sur les dernières modifications.')).toBeVisible();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    const small = await page.evaluate(() => [...document.querySelectorAll('a, button')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && (r.width < 44 || r.height < 44)).length);
    expect(small).toBe(0);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: `e2e/shots/agents-${width}.png` });
    await page.getByRole('link', { name: /Recherche de sessions/ }).click();
    await expect(page).toHaveURL(/#\/thread\/bix$/);
  });
}

test('offline: the list keeps the last known state and says so', async ({ page }) => {
  await paired(page);
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), ['ledge.mobile.lastState', JSON.stringify({ sessions: sessions(), previews: {}, syncedAt: new Date().toISOString(), pcName: 'PC-Joffrey' })]);
  await page.routeWebSocket(/.*/, ws => { void ws.close({ code: 1001 }); });
  await page.goto('/m/#/agents');
  await expect(page.getByText('Dernier état connu · connexion perdue')).toBeVisible();
  await expect(page.getByText('Thème au premier lancement')).toBeVisible();
});

test('the empty inbox points to the agents', async ({ page }) => {
  await paired(page);
  await fakeDaemon(page, [session('a', { state: 'idle' })]);
  await page.goto('/m/');
  await page.getByRole('link', { name: 'Voir les agents' }).click();
  await expect(page).toHaveURL(/#\/agents$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
});

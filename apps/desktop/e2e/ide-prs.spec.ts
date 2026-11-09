import type { Page } from '@playwright/test';
import type { PrDetail, PullRequest, Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// Lot 8b: the MR and PR view (docs/mockups/ledge-ide-interactive.html v27: explorer `prs`, prPage, pipeGraph, statusbar),
// on the lot 8a contract, with the mockup's requests. Nothing reaches a real forge: the fake daemon answers.
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);

const AT = '2026-11-09T10:05:00.000Z';
const sessions: Session[] = [
  session('tom', { name: 'Tom', project: 'synapse', cwd: '/w/synapse', branch: 'fix/s3-timeout', state: 'idle' }),
  session('front', { name: 'dev-front', project: 'ledge', cwd: '/w/ledge', branch: 'feat/seat-term', state: 'idle' })
];
const pr = (p: Partial<PullRequest> & Pick<PullRequest, 'id' | 'forge' | 'number' | 'ref' | 'title' | 'repo' | 'branch'>): PullRequest => ({
  host: p.forge === 'github' ? 'github.com' : 'gitlab.speos.lan', url: `https://example.invalid/${p.number}`, state: 'open', target: 'main', headSha: 'a41c9e2',
  pipeline: 'ok', approvals: { given: 1, required: 1 }, mergeable: true, openThreads: 0, updatedAt: AT, sessions: [], ...p
});
const PRS: PullRequest[] = [
  pr({ id: 'gitlab.speos.lan/synapse#41', forge: 'gitlab', number: 41, ref: '!41', title: 'Worker : relance sur délai S3', repo: 'synapse', branch: 'fix/s3-timeout', pipeline: 'fail', openThreads: 1, sessions: ['tom'], updatedAt: '2026-11-09T10:06:00.000Z' }),
  pr({ id: 'github.com/ledge#222', forge: 'github', number: 222, ref: '#222', title: 'Terminal de siège : capture et copie', repo: 'ledge', branch: 'feat/seat-term', state: 'review', approvals: { given: 0, required: 1 }, mergeable: false, openThreads: 1, sessions: ['front'] }),
  pr({ id: 'github.com/ledge#219', forge: 'github', number: 219, ref: '#219', title: 'Fil : rendu des sous-agents', repo: 'ledge', branch: 'feat/subagents', state: 'merged', updatedAt: '2026-11-08T16:00:00.000Z' })
];
const DETAIL_41: Omit<PrDetail, 'pr'> = {
  description: 'Relance les appels S3 sur délai, avec un backoff exponentiel.\n\n- MAX_RETRIES = 3.\n- Closes #38.', author: 'tom',
  reviewers: [{ name: 'Joffrey', state: 'approved' }], labels: ['worker', 'bug'], issues: ['#38'],
  jobs: [
    { id: 'j1', name: 'build', column: 0, columnName: 'build', status: 'ok', durationS: 122 },
    { id: 'j2', name: 'test', column: 1, columnName: 'test', status: 'fail', durationS: 91 },
    { id: 'j3', name: 'deploy:staging', column: 2, columnName: 'deploy', status: 'skip' }
  ],
  threads: [{ id: 't1', resolvable: true, resolved: false, file: 'worker/retry.ts', line: 31, code: '+    if (attempt >= MAX_RETRIES) throw err;',
    comments: [{ id: 'c1', author: 'Tom', at: '2026-11-09T08:50:00.000Z', body: 'Le test « relance après 3 délais » attend encore 2 tentatives.' }] }],
  files: [
    { path: 'worker/retry.ts', added: 18, removed: 6, patch: '@@ retry.ts  −28,7 +28,9 @@\n export async function withRetry(fn, attempt = 0) {\n   try { return await fn(); } catch (err) {\n-    if (attempt >= 2) throw err;\n+    if (attempt >= MAX_RETRIES) throw err;\n+    await sleep(backoff(attempt));\n     return withRetry(fn, attempt + 1);\n   }' },
    { path: 'worker/retry.test.ts', added: 24, removed: 2 }
  ],
  commits: [{ sha: '91fe2c0aa', title: 'retry : backoff exponentiel', author: 'Tom', at: '2026-11-09T08:44:00.000Z' }],
  mergeCommand: 'glab mr merge 41 --squash', mergeBlockers: ['pipeline']
};
const DAEMON = { version: '0.54.1', install: 'npm' as const, systemd: true, forge: true };

type ForgeExtras = NonNullable<Parameters<typeof fakeDaemon>[2]>['forge'];
async function boot(page: Page, theme: 'dark' | 'light' = 'dark', forge?: ForgeExtras) {
  await page.addInitScript(t => { try { localStorage.setItem('ledge.ide.enabled', 'true'); localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, daemon: DAEMON as never,
    forge: forge ?? { prs: PRS, details: { [PRS[0]!.id]: DETAIL_41 }, logs: { j2: 'FAIL worker/retry.test.ts › relance après 3 délais\n  attendu : 3 tentatives\n  reçu :    2 tentatives' }, commands: { rerun: 'glab ci retry -b fix/s3-timeout' } } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  return daemon;
}
const activity = (page: Page) => page.getByRole('navigation', { name: 'Barre d’activité' }).or(page.getByRole('navigation', { name: 'Activity bar' }));

for (const theme of ['dark', 'light'] as const) {
  test(`MR et PR (${theme}): the view, the badge, a failed MR's overview, its discussion and changes`, async ({ page }) => {
    const daemon = await boot(page, theme);
    const button = activity(page).getByRole('button', { name: 'MR et PR', exact: true });
    // The badge: one open request whose pipeline failed.
    await expect(button.locator('.ide-badge')).toHaveText('1');
    await expect(page.locator('.ide-status-prs')).toContainText('2 MR/PR');
    await expect(page.locator('.ide-status-prs')).toContainText('1 pipeline échoué');
    await button.click();
    const view = page.getByRole('region', { name: 'MR et PR' });
    await expect(view.locator('.fg-row')).toHaveCount(3);
    await expect(view.locator('.fg-row').first()).toContainText('!41');
    await expect(view.locator('.fg-row').first()).toContainText('GitLab · synapse · ouverte · Tom · pipeline échoué · 1 comm.');
    await view.locator('.fg-row').first().click();
    const tab = page.getByRole('tabpanel', { name: /^!41/ });
    await expect(tab.locator('.fg-graph .fg-node')).toHaveCount(3);
    await expect(tab.locator('.fg-log')).toContainText('reçu :    2 tentatives');
    await page.screenshot({ path: `e2e/.results/lot8b-overview-${theme}.png` });

    // « Relancer »: the daemon's command comes back in a toast. « Fusionner »: off, the conditions say why (state 6).
    await tab.getByRole('button', { name: 'Relancer' }).click();
    await expect(tab.getByRole('button', { name: 'Fusionner' })).toBeDisabled();
    await expect(tab.locator('.fg-check [role=listitem]')).toHaveText(['✕Le pipeline a échoué.', '✓Approuvée (1/1)', '✓Aucun changement demandé']);
    await expect.poll(() => daemon.received.filter(m => m.type === 'forge.act').map(m => (m as { action: { kind: string } }).action.kind)).toEqual(['rerun']);

    await tab.getByRole('tab', { name: /^Discussion/ }).click();
    await expect(tab.locator('.fg-th')).toHaveCount(1);
    await page.screenshot({ path: `e2e/.results/lot8b-discussion-${theme}.png` });
    await tab.getByRole('tab', { name: /^Modifications/ }).click();
    await expect(tab.locator('.fg-code .a').first()).toContainText('MAX_RETRIES');
    await page.screenshot({ path: `e2e/.results/lot8b-changes-${theme}.png` });
  });
}

test('« Demander à Tom de corriger »: the message goes to Tom, whose tab opens on the right; his bar carries the MR chip', async ({ page }) => {
  const daemon = await boot(page);
  await activity(page).getByRole('button', { name: 'MR et PR', exact: true }).click();
  await page.getByRole('region', { name: 'MR et PR' }).locator('.fg-row').first().click();
  const tab = page.getByRole('tabpanel', { name: /^!41/ });
  await tab.getByRole('button', { name: 'Demander à Tom de corriger' }).click();
  await expect.poll(() => JSON.stringify(daemon.received.filter(m => m.type !== 'forge.detail' && JSON.stringify(m).includes('échoue sur')))).toContain('Le pipeline de !41 échoue sur « test ». Lis le job, corrige et pousse.');
  const tom = page.getByRole('tabpanel', { name: /^Tom/ });
  await expect(tom.locator('.ide-bar .fg-chip')).toContainText('!41');
  await page.screenshot({ path: 'e2e/.results/lot8b-askfix.png' });
});

// The states (docs/mockups/ledge-ide-prs-states.html, validated by jde on 2026-11-09).
const said = (page: Page) => page.evaluate(() => [...((window as unknown as { __ledgeToasts?: string[] }).__ledgeToasts ?? [])]);
const PR225 = pr({ id: 'github.com/ledge#225', forge: 'github', number: 225, ref: '#225', title: 'layout.ts : sérialiser les dispositions', repo: 'ledge', branch: 'feat/layout-225', headSha: '3f9c2ab', sessions: ['front'] });
const DETAIL_225: Omit<PrDetail, 'pr'> = {
  description: 'Sérialise les dispositions en JSON versionné.', author: 'dev-back', reviewers: [{ name: 'lead', state: 'approved' }], labels: ['fleet'], issues: ['#218'],
  jobs: [{ id: 'l', name: 'lint', column: 0, columnName: 'lint', status: 'ok', durationS: 40 }, { id: 't', name: 'test', column: 1, columnName: 'test', status: 'ok', durationS: 167 }],
  threads: [{ id: 't9', resolvable: true, resolved: false, comments: [{ id: 'c9', author: 'reviewer', at: AT, body: 'Le WebglAddon n’est pas libéré quand l’onglet se ferme (ligne 88).' }] }],
  files: [], commits: [], mergeCommand: 'gh pr merge 225 --squash --match-head-commit 3f9c2ab', mergeBlockers: []
};
async function open225(page: Page, actFails?: NonNullable<ForgeExtras>['actFails'], theme: 'dark' | 'light' = 'dark') {
  const daemon = await boot(page, theme, { prs: [PR225], details: { [PR225.id]: DETAIL_225 }, ...(actFails ? { actFails } : {}) });
  await activity(page).getByRole('button', { name: 'MR et PR', exact: true }).click();
  await page.getByRole('region', { name: 'MR et PR' }).locator('.fg-row').first().click();
  const tab = page.getByRole('tabpanel', { name: /^#225/ });
  await expect(tab.locator('.fg-check')).toBeVisible();
  return { daemon, tab };
}

for (const theme of ['dark', 'light'] as const) {
  test(`state 7 (${theme}): every condition met, « Fusionner » asks on the spot with the exact command, then merges`, async ({ page }) => {
    const { daemon, tab } = await open225(page, undefined, theme);
    await expect(tab.locator('.fg-check [role=listitem]')).toHaveText(['✓Pipeline réussi', '✓Approuvée (1/1)', '✓Aucun changement demandé']);
    await tab.getByRole('button', { name: 'Fusionner' }).click();
    const confirm = tab.getByRole('group', { name: 'Fusionner #225 dans main ?' });
    await expect(confirm.locator('code')).toHaveText('gh pr merge 225 --squash --match-head-commit 3f9c2ab');
    await expect(confirm).toContainText('Ledge lance, sur Local :');
    await page.screenshot({ path: `e2e/.results/lot8b-merge-confirm-${theme}.png` });
    await confirm.getByRole('button', { name: 'Fusionner' }).click();
    await expect.poll(() => daemon.received.filter(m => m.type === 'forge.act').map(m => (m as { action: unknown }).action)).toEqual([{ kind: 'merge', headSha: '3f9c2ab' }]);
    await expect.poll(() => said(page)).toContain('#225 fusionnée');
  });
}

test('state 8: the head moved, « Relire »; state 9: a comment not posted keeps its text, « Réessayer »', async ({ page }) => {
  const { tab } = await open225(page, { merge: { code: 'stale', message: 'head moved' }, comment: { message: 'GraphQL: Resource not accessible by integration' } });
  await tab.getByRole('button', { name: 'Fusionner' }).click();
  const confirm = tab.getByRole('group', { name: 'Fusionner #225 dans main ?' });
  await confirm.getByRole('button', { name: 'Fusionner' }).click();
  await expect(confirm).toContainText('La branche a bougé depuis votre lecture (nouveau commit 3f9c2ab). Relisez avant de fusionner.');
  await expect(confirm.getByRole('button', { name: 'Relire' })).toBeVisible();
  await page.screenshot({ path: 'e2e/.results/lot8b-merge-stale.png' });
  await tab.getByRole('tab', { name: /^Discussion/ }).click();
  const field = tab.getByRole('textbox', { name: 'Ajouter un commentaire…  (Entrée)' });
  await field.fill('Corrigé dans le dernier commit.');
  await field.press('Enter');
  await expect(tab.getByRole('alert')).toHaveText(/Non publié : GraphQL: Resource not accessible by integration\. Votre texte est gardé\.Réessayer/);
  await expect(field).toHaveValue('Corrigé dans le dernier commit.');
  await page.screenshot({ path: 'e2e/.results/lot8b-comment-failed.png' });
});

test('state 1: glab not signed in, the exact command with « Copier »; state 10: no open MR or PR, no count', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page, 'dark', { prs: [], forges: [{ forge: 'gitlab', host: 'gitlab.corp.lan', status: 'unauthenticated', at: AT }, { forge: 'github', host: 'github.com', status: 'ok', at: AT }] });
  await activity(page).getByRole('button', { name: 'MR et PR', exact: true }).click();
  const view = page.getByRole('region', { name: 'MR et PR' });
  await expect(view.locator('.fg-line')).toContainText('glab n’est pas connecté à gitlab.corp.lan sur Local. Dans un terminal de Local :');
  await expect(view.locator('.fg-line code')).toHaveText('glab auth login --hostname gitlab.corp.lan');
  await view.getByRole('button', { name: 'Copier' }).click();
  await expect.poll(() => said(page)).toContain('Commande copiée');
  await expect(view.locator('.fg-empty')).toContainText('Aucune MR ni PR ouverte');
  await expect(view).not.toContainText('Fusionnées');
  await expect(page.locator('.ide-status-prs')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/.results/lot8b-unauth-empty.png' });
});

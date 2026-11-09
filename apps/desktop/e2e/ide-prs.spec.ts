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

async function boot(page: Page, theme: 'dark' | 'light' = 'dark') {
  await page.addInitScript(t => { try { localStorage.setItem('ledge.ide.enabled', 'true'); localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, daemon: DAEMON as never,
    forge: { prs: PRS, details: { [PRS[0]!.id]: DETAIL_41 }, logs: { j2: 'FAIL worker/retry.test.ts › relance après 3 délais\n  attendu : 3 tentatives\n  reçu :    2 tentatives' }, commands: { rerun: 'glab ci retry -b fix/s3-timeout' } } });
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

    // « Relancer »: the daemon's command comes back in a toast; « Fusionner » sends nothing (inert until its confirmation).
    await tab.getByRole('button', { name: 'Relancer' }).click();
    await tab.getByRole('button', { name: 'Fusionner' }).click();
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

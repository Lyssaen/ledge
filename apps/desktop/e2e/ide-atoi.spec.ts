import type { Page } from '@playwright/test';
import type { PrDetail, PullRequest, Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// The page « À toi » (D3, docs/ide-workspace-plan.md 4.1 point 3; docs/mockups/ledge-ide-interactive.html v27 atoiPage), opened
// from the « À toi » view's « Page », in a tab (the IDE has no windows of its own on main yet). Nothing reaches a real forge.
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const sessions: Session[] = [
  session('pim', { name: 'Pim', project: 'ledge', cwd: '/w/ledge', branch: 'feat/ide-shell', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm --filter desktop exec playwright test e2e/workspace.spec.ts', tool: 'Bash', source: 'hook' } }),
  session('tom', { name: 'Tom', project: 'synapse', cwd: '/w/synapse', branch: 'fix/s3-timeout', state: 'idle', lastReply: { text: 'Le retry passe à 3 tentatives, les tests sont verts.', at: iso(60_000) } }),
  session('ida', { name: 'Ida', project: 'ledge', cwd: '/w/ledge', branch: 'feat/subagents', state: 'working' })
];
const pr = (p: Partial<PullRequest> & Pick<PullRequest, 'id' | 'number' | 'ref' | 'title'>): PullRequest => ({
  forge: 'github', host: 'github.com', repo: 'ledge', url: `https://example.invalid/${p.number}`, state: 'open', branch: 'b', target: 'main', headSha: '3f9c2ab',
  pipeline: 'ok', approvals: { given: 1, required: 1 }, mergeable: true, openThreads: 0, updatedAt: iso(0), sessions: [], ...p
});
const PRS = [
  pr({ id: 'github.com/ledge#225', number: 225, ref: '#225', title: 'layout.ts : sérialiser les dispositions' }),
  pr({ id: 'gitlab.corp.lan/synapse#41', forge: 'gitlab', host: 'gitlab.corp.lan', repo: 'synapse', number: 41, ref: '!41', title: 'Worker : relance sur délai S3', pipeline: 'fail', sessions: ['tom'] }),
  pr({ id: 'github.com/ledge#226', number: 226, ref: '#226', title: 'Coque IDE', pipeline: 'run', mergeable: false })
];
const detail = (cmd: string, jobs: PrDetail['jobs'] = []): Omit<PrDetail, 'pr'> => ({ description: '', author: '', reviewers: [], labels: [], issues: [], jobs, threads: [], files: [], commits: [], mergeCommand: cmd, mergeBlockers: [] });
const said = (page: Page) => page.evaluate(() => [...((window as unknown as { __ledgeToasts?: string[] }).__ledgeToasts ?? [])]);

async function boot(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(([t, seen]) => { try { localStorage.setItem('ledge.ide.enabled', 'true'); localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t!); localStorage.setItem('ledge.ide.atoi.seen', seen!); } catch { /* ignore */ } }, [theme, String(NOW - 3_600_000)]);
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, daemon: { version: '0.54.1', install: 'npm', systemd: true, forge: true } as never,
    forge: { prs: PRS, details: { [PRS[0]!.id]: detail('gh pr merge 225 --squash --match-head-commit 3f9c2ab'), [PRS[1]!.id]: detail('glab mr merge 41', [{ id: 'j', name: 'test', column: 0, columnName: 'test', status: 'fail' }]) } } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  return daemon;
}

for (const theme of ['dark', 'light'] as const) {
  test(`« Page » (${theme}): the requests, the MRs and PRs waiting, the sessions finished; decided and merged in place`, async ({ page }) => {
    const daemon = await boot(page, theme);
    const nav = page.getByRole('navigation', { name: /activité/ });
    await nav.getByRole('button', { name: 'À toi', exact: true }).click();
    await page.getByRole('button', { name: 'Page', exact: true }).click();
    const tab = page.getByRole('tabpanel', { name: /^À toi/ });
    // « À toi 1 » (mockup v27): the requests waiting.
    await expect(page.locator('.dv-tab').filter({ hasText: 'À toi' }).locator('.atoi-tab-n')).toHaveText('1');
    await expect(tab.locator('.atoi-row')).toHaveCount(1);
    await expect(tab.locator('.atoi-row code')).toHaveText('pnpm --filter desktop exec playwright test e2e/workspace.spec.ts');
    // MRs and PRs: the failed one and the ready one; the running one does not wait for you.
    await expect(tab.locator('.atoi-pr')).toHaveCount(2);
    await expect(tab.locator('.atoi-pr').filter({ hasText: '!41' })).toContainText('pipeline échoué');
    await expect(tab.locator('.atoi-pr').filter({ hasText: '#225' })).toContainText('pipeline réussi, approuvée');
    // Finished since the last visit (an hour ago): Tom, with his last reply.
    await expect(tab.locator('.fg-blk').nth(2).locator('.atoi-line')).toHaveCount(1);
    await expect(tab.locator('.fg-blk').nth(2)).toContainText('Le retry passe à 3 tentatives');
    await page.screenshot({ path: `e2e/.results/lot8b-atoi-${theme}.png` });

    await tab.locator('.atoi-pr').filter({ hasText: '#225' }).getByRole('button', { name: 'Fusionner' }).click();
    const confirm = tab.getByRole('group', { name: 'Fusionner #225 dans main ?' });
    await expect(confirm.locator('code')).toHaveText('gh pr merge 225 --squash --match-head-commit 3f9c2ab');
    await page.screenshot({ path: `e2e/.results/lot8b-atoi-merge-${theme}.png` });
    await confirm.getByRole('button', { name: 'Fusionner' }).click();
    await expect.poll(() => said(page)).toContain('#225 fusionnée');

    await tab.locator('.atoi-row').getByRole('button', { name: 'Autoriser' }).click();
    await expect.poll(() => daemon.received.some(m => m.type === 'session.decide' && JSON.stringify(m).includes('accept'))).toBe(true);
  });
}

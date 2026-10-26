import type { Page } from '@playwright/test';
import type { Role, Team, TeamTemplate } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, T0, twoProjects } from './daemon';

// The catalog of « Teams » (#97, docs/mockups/ledge-teams-roles.html): the roles, templates and skipped files a folder reads,
// and the live teams linking to them. LEDGE_CATALOG_SHOTS=<dir> also captures each view, dark and light, to compare with the mockup.
const SHOTS = process.env.LEDGE_CATALOG_SHOTS;

const role = (id: string, label: string, extra: Partial<Role>): Role => ({ id, label, prompt: `Tu es ${label}.`, source: 'repo', path: `/w/ledge/.ledge/roles/${id}.md`, ...extra });
const review = role('review', 'Relecteur', {
  tool: 'codex', model: 'gpt-5.5', effort: 'high', autonomy: 'ask', shadows: '/home/me/.ledge/roles/review.md',
  prompt: 'Tu relis le travail des autres sessions **sans modifier le code**.\n\n- Lis le diff du candidat (`git diff main...`).\n- Note chaque point avec le fichier et la ligne.\n- Rends un verdict : *OK*, *à corriger*, *à rediscuter*.'
});
const roles: Role[] = [
  role('build', 'Builder', { tool: 'claude', model: 'opus', effort: 'high', autonomy: 'edits' }),
  review,
  role('qa', 'QA', { tool: 'claude', model: 'sonnet', effort: 'medium', autonomy: 'auto' }),
  role('lead', 'Lead', { tool: 'claude', model: 'opus', effort: 'high', autonomy: 'ask', source: 'home', path: '/home/me/.ledge/roles/lead.md' }),
  role('doc', 'Rédacteur', { tool: 'cursor', autonomy: 'ask', source: 'home', path: '/home/me/.ledge/roles/doc.md' })
];
const templates: TeamTemplate[] = [
  { id: 'workshop', name: 'workshop', source: 'repo', path: '/w/ledge/.ledge/teams/workshop.yaml', seats: [{ role: 'lead' }, { role: 'build' }, { role: 'review', model: 'gpt-5.5-mini' }, { role: 'qa' }] },
  { id: 'relecture', name: 'relecture', source: 'home', path: '/home/me/.ledge/teams/relecture.yaml', seats: [{ role: 'review' }, { role: 'doc' }] }
];
const problems = [
  { path: '/w/ledge/.ledge/roles/Design.md', reason: 'nom de fichier invalide (minuscules, chiffres, - et _)' },
  { path: '/w/ledge/.ledge/teams/audit.yaml', reason: 'le même rôle deux fois dans une équipe' }
];
const team: Team = {
  id: 'team-a1b2', name: 'ledge-roles', template: 'workshop', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active',
  seats: [{ role: 'lead', sessionId: 'bix' }, { role: 'build', sessionId: 'otto' }, { role: 'review', sessionId: 'nova' }, { role: 'qa', sessionId: 'mila' }],
  createdAt: T0, updatedAt: T0
};
const seated = (id: string, name: string, role: string) => session(id, { name, title: `${name} · ledge`, project: 'ledge', cwd: '/w/ledge', team: team.id, role });
const sessions = [seated('bix', 'Bix', 'lead'), seated('otto', 'Otto', 'build'), seated('nova', 'Nova', 'review'), seated('mila', 'Mila', 'qa')];

async function openTeams(page: Page, theme?: 'dark' | 'light') {
  if (theme) await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  await fakeDaemon(page, sessions, { projects: twoProjects, teams: [team], roles: { '/w/ledge': { roles, templates, problems } } });
  await page.goto('/');
  const home = page.locator('section.ledge-home');
  await home.getByRole('tab', { name: /^(Teams|Équipes)/ }).click();
  return home;
}
const detail = (page: Page) => page.locator('section.ledge-home .cat-detail');

test('the roles view shows a role’s defaults, its file and its prompt', async ({ page }) => {
  const home = await openTeams(page);
  await home.getByRole('tab', { name: /^Roles/ }).click();
  await home.locator('.cat-row[data-role="review"]').click();
  const d = detail(page);
  await expect(d.getByRole('heading', { name: /Relecteur/ })).toBeVisible();
  await expect(d).toContainText('gpt-5.5');
  await expect(d).toContainText('/w/ledge/.ledge/roles/review.md');
  await expect(d).toContainText('/home/me/.ledge/roles/review.md');
  await expect(d.getByText('sans modifier le code')).toBeVisible();
});

test('the templates view shows the seats and warns of an auto seat', async ({ page }) => {
  const home = await openTeams(page);
  await home.getByRole('tab', { name: /^Templates/ }).click();
  await home.locator('.cat-list').getByRole('button', { name: /workshop/ }).click();
  await expect(detail(page)).toContainText('gpt-5.5-mini');
  await expect(detail(page).locator('.cat-warn')).toContainText('@qa');
});

test('the skipped files are listed with their reason', async ({ page }) => {
  const home = await openTeams(page);
  await home.getByRole('tab', { name: /^Roles/ }).click();
  await home.locator('.cat-list').getByRole('button', { name: /⚠/ }).click();
  await expect(detail(page)).toContainText('le même rôle deux fois dans une équipe');
});

test('a live team links to its template and its roles', async ({ page }) => {
  const home = await openTeams(page);
  await home.getByRole('button', { name: 'workshop' }).click();
  await expect(detail(page)).toContainText('gpt-5.5-mini');
  await home.getByRole('tab', { name: /^Live/ }).click();
  await home.getByRole('button', { name: '@review' }).click();
  await expect(detail(page).getByRole('heading', { name: /Relecteur/ })).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`captures, ${theme}`, async ({ page }) => {
    test.skip(!SHOTS, 'set LEDGE_CATALOG_SHOTS=<dir> to capture');
    await page.setViewportSize({ width: 1440, height: 900 });
    const home = await openTeams(page, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${SHOTS}/live-${theme}.png` });
    await home.getByRole('tab', { name: /^Rôles/ }).click();
    await home.locator('.cat-row[data-role="review"]').click();
    await page.screenshot({ path: `${SHOTS}/roles-${theme}.png` });
    await home.locator('.cat-list').getByRole('button', { name: /⚠/ }).click();
    await page.screenshot({ path: `${SHOTS}/problems-${theme}.png` });
    await home.getByRole('tab', { name: /^Modèles/ }).click();
    await home.locator('.cat-list').getByRole('button', { name: /workshop/ }).click();
    await page.screenshot({ path: `${SHOTS}/templates-${theme}.png` });
  });
}

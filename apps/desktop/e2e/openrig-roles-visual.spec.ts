import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import type { OpenRigState, RoleDetail, RoleSummary } from '@ledge/protocol';
import { fakeDaemon, session, type FakeRoles } from './daemon';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

// Visual review of OpenRig › Rôles (docs/mockups/ledge-openrig-roles.html), not an assertion suite: the screens in both
// themes, and zooms on the provenance, against the daemon's real answers on a machine (a dump of openrig.roles /
// openrig.role / the files it serves, kept out of the repository: it holds that machine's paths and role files).
// LEDGE_VISUAL=1 LEDGE_ROLES_DUMP=<dir> pnpm --filter desktop exec playwright test e2e/openrig-roles-visual.spec.ts
const DUMP = process.env.LEDGE_ROLES_DUMP;
test.skip(!process.env.LEDGE_VISUAL || !DUMP, 'set LEDGE_VISUAL=1 and LEDGE_ROLES_DUMP to capture the Roles screens');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });

function load(): FakeRoles {
  const json = (f: string) => JSON.parse(readFileSync(join(DUMP!, f), 'utf8'));
  const list = json('roleList.json') as { roles: RoleSummary[]; openrigVersion?: string };
  const details: Record<string, RoleDetail> = {};
  for (const f of readdirSync(DUMP!).filter(f => f.startsWith('roleDetail-'))) { const d = json(f); const role = (d.role ?? d) as RoleDetail; details[role.summary.id] = role; }
  return { list: list.roles, details, files: json('files.json'), ...(list.openrigVersion ? { openrigVersion: list.openrigVersion } : {}) };
}
const idOf = (roles: FakeRoles, name: string, source: 'user' | 'builtin' = 'user') => roles.list.find(r => r.name === name && r.source === source)!.id;

/** The Rigs page's state, from the seats the roles name. */
function stateOf(roles: FakeRoles): OpenRigState {
  const seats = roles.list.flatMap(r => r.seatRefs.map(s => ({ ...s, role: r })));
  const rigs = [...new Set(seats.map(s => s.rig))];
  return {
    installed: true, version: roles.openrigVersion ?? '0.7.7', daemon: { state: 'running', pid: 255259, port: 7433 }, kernel: { state: 'ready' }, at: new Date().toISOString(),
    rigs: rigs.map((name, i) => {
      const nodes = seats.filter(s => s.rig === name).map(s => ({ logicalId: s.logicalId, session: s.session ?? `${s.logicalId}@${name}`, runtime: s.role.runtime ?? 'claude-code', model: s.role.runtime === 'codex' ? 'gpt-6.1-terra' : 'claude-opus-5-5', sessionStatus: 'running', lifecycleState: 'running', activity: s.logicalId === 'dev.back' ? 'idle' : 'running', stopped: false, work: 0 }));
      return { id: String(i), name, status: 'running', lifecycleState: 'running', seats: nodes.length, running: nodes.length, attention: 0, uptime: '32m', snapshot: null, nodes };
    })
  };
}

async function open(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en' = 'fr', roles = load()) {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await fakeDaemon(page, [session('otto')], { openrig: stateOf(roles), roles });
  await page.goto('/');
  await page.getByRole('button', { name: 'OpenRig' }).click();
  await page.getByRole('button', { name: lang === 'fr' ? /^Rôles/ : /^Roles/ }).click();
  await page.evaluate(() => document.fonts.ready);
  return roles;
}
const pick = async (page: Page, name: RegExp) => { await page.getByRole('option', { name }).first().click(); };

for (const theme of ['dark', 'light'] as const) {
  test(`roles, ${theme}`, async ({ page }, info) => {
    const shot = (n: string) => page.screenshot({ path: info.outputPath(`roles-${n}-${theme}.png`) });
    await open(page, theme);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await shot('role');
    await page.locator('.orr-rfile').first().screenshot({ path: info.outputPath(`zoom-rolefile-${theme}.png`) });
    await page.locator('.or-head').screenshot({ path: info.outputPath(`zoom-head-${theme}.png`) });
    await page.locator('.orr-list').screenshot({ path: info.outputPath(`zoom-list-${theme}.png`) });
    await page.getByRole('tab', { name: 'Paramètres' }).click();
    await shot('params');
    await page.locator('.orr-legend').screenshot({ path: info.outputPath(`zoom-legend-${theme}.png`) });
    await page.locator('.orr-psec').nth(1).screenshot({ path: info.outputPath(`zoom-exec-${theme}.png`) });
    await page.locator('.orr-psec').nth(3).screenshot({ path: info.outputPath(`zoom-uses-${theme}.png`) });
    await page.locator('.orr-detail').evaluate(e => e.scrollTo(0, e.scrollHeight));
    await shot('params-end');
    // Seen from a seat.
    await page.getByRole('button', { name: 'depuis dev.front' }).click();
    await page.locator('.orr-detail').evaluate(e => e.scrollTo(0, 0));
    await shot('seat-params');
    await page.locator('.orr-psec').nth(1).screenshot({ path: info.outputPath(`zoom-seat-exec-${theme}.png`) });
    await page.getByRole('tab', { name: /^Rôle/ }).click();
    await shot('seat-role');
    await page.getByRole('tab', { name: /Contexte de démarrage/ }).click();
    await shot('context');
    await page.locator('.orr-pieces').screenshot({ path: info.outputPath(`zoom-pieces-${theme}.png`) });
    await page.getByRole('option', { name: /Skills du siège/ }).click();
    await page.locator('.orr-reader').screenshot({ path: info.outputPath(`zoom-missing-${theme}.png`) });
    await page.getByRole('option', { name: /Prompt de base/ }).click();
    await page.locator('.orr-reader').screenshot({ path: info.outputPath(`zoom-harness-${theme}.png`) });
    await page.getByRole('button', { name: 'Tout à la suite' }).click();
    await shot('context-all');
    await page.getByRole('tab', { name: 'YAML source' }).click();
    await shot('yaml');
    // A role shipped with OpenRig, two profiles; then several files; then an import-only spec.
    await page.getByRole('button', { name: /Livrés avec OpenRig/ }).click();
    await pick(page, /^pm/);
    await page.getByRole('tab', { name: 'Paramètres' }).click();
    await shot('builtin');
    await pick(page, /^conveyor-lead/);
    await shot('multi');
    await pick(page, /^shared.*importée/);
    await shot('shared');
    // Search with no result.
    await page.getByLabel('Chercher un rôle').fill('terraform');
    await shot('noresult');
  });

  test(`rigs link, ${theme}`, async ({ page }, info) => {
    await open(page, theme);
    await page.getByRole('button', { name: 'Rigs', exact: true }).click();
    await page.getByRole('button', { name: 'Voir les sièges de ledge-dev' }).click();
    const link = page.getByRole('button', { name: 'Voir le rôle ledge-developer depuis dev.front' });
    await link.hover();
    await page.screenshot({ path: info.outputPath(`roles-rigs-link-${theme}.png`) });
    await page.locator('.or-seats').screenshot({ path: info.outputPath(`zoom-rigs-link-${theme}.png`) });
    await link.click();
    await expect(page.getByRole('button', { name: 'depuis dev.front' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('tab', { name: /^Rôle/ })).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: info.outputPath(`roles-from-rigs-${theme}.png`) });
  });
}

test('english, light', async ({ page }, info) => {
  await open(page, 'light', 'en');
  await page.getByRole('button', { name: 'from dev.front' }).click();
  await page.screenshot({ path: info.outputPath('roles-seat-role-light-en.png') });
  await page.getByRole('tab', { name: 'Parameters' }).click();
  await page.screenshot({ path: info.outputPath('roles-seat-params-light-en.png') });
});

test('narrow, 900 px', async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await open(page, 'dark');
  await page.screenshot({ path: info.outputPath('roles-narrow-dark.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Paramètres' }).click();
  await page.screenshot({ path: info.outputPath('roles-narrow-params-dark.png'), fullPage: true });
});

test('states: daemon stopped, invalid spec', async ({ page }, info) => {
  const roles = load();
  const dev = idOf(roles, 'ledge-developer');
  roles.details[dev] = { ...roles.details[dev]!, error: { kind: 'invalid', message: 'unexpected indentation', line: 6, col: 3 } };
  await open(page, 'dark', 'fr', roles);
  await page.screenshot({ path: info.outputPath('roles-invalid-dark.png') });
  await page.getByRole('tab', { name: 'YAML source' }).click();
  await page.screenshot({ path: info.outputPath('roles-invalid-yaml-dark.png') });
});

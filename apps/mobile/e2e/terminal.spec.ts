import { expect, test, type Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { fakeDaemon, session } from './daemon';

const since = () => new Date(Date.now() - 2 * 60_000).toISOString();
const working = (extra: Partial<Session> = {}): Session => session('bix', { name: 'Bix', topic: 'Recherche de sessions', repo: 'harness-assistant', repoPath: '/r/h', branch: 'session-search', state: 'working', ...extra });
const LINES = [
  '> Ajoute une recherche dans la liste des sessions.',
  '',
  '● Lecture des dernières modifications…',
  '  apps/overlay/src/surface/SessionList.tsx  packages/ledge/src/daemon/state.ts  packages/ledge/src/daemon/remote/project.ts  apps/mobile/src/screens/Terminal.tsx',
  '',
  '● Vérification de la recherche de sessions',
  '  18 tests réussis',
  '',
  '✻ Working… (14s · esc to interrupt)'
];
const interrupts = (received: unknown[]) => received.filter((m): m is Record<string, unknown> => (m as { type?: string }).type === 'session.interrupt');

async function open(page: Page, s: Session = working(), lines: string[] = LINES) {
  await page.addInitScript(() => localStorage.setItem('ledge.mobile.token', 't'.repeat(43)));
  const d = await fakeDaemon(page, [s]);
  await page.goto('/m/#/terminal/bix');
  await expect(page.getByRole('heading', { name: 'Terminal de Bix' }).or(page.getByText('Terminal de Bix'))).toBeVisible();
  await expect(page.getByText('Lecture seule · en direct').or(page.getByText('Lecture seule · en attente'))).toBeVisible();
  d.send({ type: 'session.preview', id: 'bix', lines });
  if (lines.length) await expect(page.locator('pre')).toContainText(lines[0]!);
  return d;
}

for (const width of [320, 390, 430]) {
  test(`long lines scroll inside the terminal, never the page (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    const out = page.getByLabel('Sortie du terminal, défilement horizontal');
    await expect(out).toHaveAttribute('tabindex', '0');
    const m = await out.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(m.sw).toBeGreaterThan(m.cw);
    const page_ = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(page_.sw).toBeLessThanOrEqual(page_.iw);
    await expect(page.locator('pre')).toContainText('● Vérification de la recherche de sessions\n  18 tests réussis');
    await expect(page.getByText('Interrompre n’annule pas les actions déjà effectuées.')).toBeVisible();
    const small = await page.evaluate(() => [...document.querySelectorAll('a, button')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && (r.width < 44 || r.height < 44)).length);
    expect(small).toBe(0);
    await page.screenshot({ path: `e2e/shots/terminal-${width}.png` });
  });
}

test('text size changes between 11 and 20 px and is remembered', async ({ page }) => {
  await open(page);
  const size = () => page.locator('pre').evaluate(el => getComputedStyle(el).fontSize);
  expect(await size()).toBe('12px');
  await page.getByRole('button', { name: 'Réduire le texte' }).click();
  expect(await size()).toBe('11px');
  await expect(page.getByRole('button', { name: 'Réduire le texte' })).toBeDisabled();
  for (let i = 0; i < 12; i++) if (await page.getByRole('button', { name: 'Agrandir le texte' }).isEnabled()) await page.getByRole('button', { name: 'Agrandir le texte' }).click();
  expect(await size()).toBe('20px');
  await expect(page.getByRole('button', { name: 'Agrandir le texte' })).toBeDisabled();
  await page.getByRole('button', { name: 'Réduire le texte' }).click();
  expect(await size()).toBe('19px');
  expect(await page.evaluate(() => localStorage.getItem('ledge.mobile.terminalSize'))).toBe('19');
  await page.reload();
  await expect(page.locator('pre')).toBeVisible();
  expect(await size()).toBe('19px');
});

test('one tap sends one interrupt and shows it was transmitted', async ({ page }) => {
  const d = await open(page);
  d.onMessage(m => { if (m.type === 'session.interrupt') { d.send({ type: 'operation.received', operationId: m.operationId }); setTimeout(() => d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' }), 300); } });
  const btn = page.getByRole('button', { name: 'Interrompre Bix' });
  await expect(btn).toBeEnabled();
  await btn.dblclick();
  await expect(page.getByRole('button', { name: 'Interruption transmise' })).toBeDisabled();
  await page.waitForTimeout(500);
  expect(interrupts(d.received)).toEqual([expect.objectContaining({ id: 'bix' })]);
  expect(interrupts(d.received)[0]!.operationId).toEqual(expect.any(String));
});

test('interrupt is disabled while waiting, idle or offline', async ({ page }) => {
  const pending = { id: 'p-bix', version: 1, since: since(), kind: 'permission' as const, text: 'pnpm test', source: 'hook' as const, risk: 'low' as const };
  const d = await open(page, working({ state: 'waiting_permission', pending }));
  await expect(page.getByText('Lecture seule · en attente')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Interrompre Bix' })).toBeDisabled();
  d.upsert(working({ state: 'idle' }));
  await expect(page.getByText('Lecture seule · en direct')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Interrompre Bix' })).toBeDisabled();
  d.upsert(working());
  await expect(page.getByRole('button', { name: 'Interrompre Bix' })).toBeEnabled();
  d.drop();
  await expect(page.getByText('Lecture seule · dernier état connu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Interrompre Bix' })).toBeDisabled();
  await page.waitForTimeout(300);
  expect(interrupts(d.received)).toHaveLength(0);
  await page.screenshot({ path: 'e2e/shots/terminal-offline-390.png' });
});

test('the back link returns to the same session thread', async ({ page }) => {
  await open(page);
  await page.getByRole('link', { name: 'Retour au fil' }).click();
  await expect(page).toHaveURL(/#\/thread\/bix$/);
  await page.getByRole('link', { name: 'Ouvrir le terminal de Bix' }).click();
  await expect(page).toHaveURL(/#\/terminal\/bix$/);
});

import type { Page } from '@playwright/test';
import type { ChatAction } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';
import { ideReady } from './ide';

/* Captures of the chat's generic card with OpenRig rows (rig.act, rig.seats), to hold against M3 Q34's words.
   Not a check: it runs only with RIG_ACTION_SHOTS=<folder>. */
const out = process.env.RIG_ACTION_SHOTS;
test.skip(!out, 'captures only: RIG_ACTION_SHOTS=<folder>');
test.setTimeout(90_000);
test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

const fleet = eight.filter(s => ['otto', 'nova', 'luna'].includes(s.id));
const panel = (page: Page) => page.getByRole('complementary', { name: 'Chat Ledge' });

const row = (action: 'rig.act' | 'rig.seats', vars: Record<string, string>, risk: ChatAction['risk'], extra: Partial<ChatAction> = {}): ChatAction =>
  ({ action, args: action === 'rig.seats' ? { ...vars, count: Number(vars.count) } : vars, summary: `${action} ${Object.values(vars).join(' ')}`, vars, risk, ...extra });

/** A plan not applied yet: two destructive rows (their own button) and two reversible ones (the card's Apply). */
const proposed: ChatAction[] = [
  row('rig.act', { kind: 'rig.restart', rig: 'ledge-dev' }, 'destructive'),
  row('rig.act', { kind: 'rig.snapshot', rig: 'ledge-dev' }, 'reversible'),
  row('rig.seats', { rig: 'ledge-dev', role: 'dev.back', count: '2', from: '1' }, 'reversible'),
  row('rig.seats', { rig: 'ledge-dev', role: 'dev.front', count: '0', from: '2' }, 'destructive', { cuts: ['dev-front@ledge-dev', 'dev-front-2@ledge-dev'] })
];
const at = new Date().toISOString();
/** The same kinds once the PC answered: one done, the refusals with each cause the daemon names. */
const answered: ChatAction[] = [
  row('rig.act', { kind: 'kernel.start', rig: 'kernel' }, 'reversible', { state: 'done', doneAt: at }),
  row('rig.act', { kind: 'rig.stop', rig: 'ledge-dev' }, 'destructive', { state: 'refused', code: 'not_running', error: 'not running' }),
  row('rig.seats', { rig: 'ledge-dev', role: 'dev.back', count: '2', from: '1' }, 'reversible', { state: 'refused', code: 'unchanged', error: 'unchanged' }),
  row('rig.seats', { rig: 'ledge-dev', role: 'qa.review', count: '1', from: '0', missing: 'role' }, 'reversible', { state: 'refused', code: 'unknown', error: 'no such role' }),
  row('rig.act', { kind: 'rig.start', rig: 'old-rig', missing: 'rig' }, 'reversible', { state: 'refused', code: 'unknown', error: 'no such rig' })
];

async function shoot(page: Page, lang: 'fr' | 'en', theme: 'dark' | 'light', actions: ChatAction[], name: string) {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.addInitScript(([l, t]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [lang, theme]);
  await fakeDaemon(page, fleet, { projects: twoProjects, chat: { steps: [{ kind: 'sessions' }], text: lang === 'fr' ? 'Voici le plan.' : 'Here is the plan.', actions } });
  await page.goto('/'); await ideReady(page);
  await expect(panel(page)).toBeVisible();
  const field = panel(page).getByPlaceholder(/^(Ask Ledge|Demander à Ledge)…$/);
  await field.click(); await field.fill('rig'); await field.press('Enter');
  const card = panel(page).locator('[data-action-card]');
  await expect(card).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: `${out}/${name}-${lang}-${theme}.png` });
  return card;
}

for (const lang of ['fr', 'en'] as const) for (const theme of ['dark', 'light'] as const) {
  test(`OpenRig rows proposed, ${lang} ${theme}`, async ({ page }) => {
    const card = await shoot(page, lang, theme, proposed, 'rig-card');
    // A destructive row's own button opens the confirm sheet, which says the same verb.
    await card.getByRole('button', { name: lang === 'fr' ? /^Redémarrer/ : /^Restart/ }).first().click();
    await expect(card).toHaveAttribute('data-confirming', 'true');
    await card.screenshot({ path: `${out}/rig-card-confirm-${lang}-${theme}.png` });
  });
  test(`OpenRig rows answered, ${lang} ${theme}`, async ({ page }) => {
    await shoot(page, lang, theme, answered, 'rig-card-answered');
  });
}

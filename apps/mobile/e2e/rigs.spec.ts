// The Rigs tab (docs/mockups/ledge-mobile-refonte/m4-rigs.html) on a PC that sends its rigs: the list, a rig and its sheets, a
// stopped rig, the kernel and its daemon, Max and a goal as a thread; on a phone and on an iPad, dark and light, French and English.
// SHOTS=<dir> saves a capture of each screen there; compare with captures/ledge-mobile-refonte-m4-*.png.
import { devices, expect, test, type Page } from '@playwright/test';
import { copy, copyFor, type Lang } from '../src/copy';
import { goal, kernelGraph, ledgeGraph, openrig, routing } from '../test/model/openrig-fixtures';
import { startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _phone, ...iPhone13 } = devices['iPhone 13'];
const { defaultBrowserType: _tablet, ...iPad } = devices['iPad Pro 11 landscape'];
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

let h: Harness;
test.beforeEach(async () => {
  h = await startHarness();
  h.daemon.openrig = {
    state: openrig(),
    graphs: { 'ledge-dev': ledgeGraph(), kernel: kernelGraph() },
    queues: {
      'ledge-dev': {
        rows: [
          { id: 'qitem-20261111084549-0e470a9b31291e54', state: 'in-progress', summary: 'M4 Rigs (écrans) sur le téléphone', from: 'pilot-lead@ledge-dev', to: 'dev-front2@ledge-dev', createdAt: '2026-11-11 08:45:49', claimedAt: '2026-11-11 08:45:58', updatedAt: '2026-11-11 09:40:00', at: '2026-11-11T10:00:00.000Z' },
          { id: 'qitem-20261111104745-a24c6c604ba41ec6', state: 'pending', summary: 'M4 Rigs : textes proposés', from: 'dev-front2@ledge-dev', to: 'design-ux@ledge-dev', createdAt: '2026-11-11 10:47:45', updatedAt: '2026-11-11 10:47:45', at: '2026-11-11T10:50:00.000Z' }
        ],
        closed: [{ id: 'qitem-20261110190000-0000000000000001', state: 'done', summary: 'Maquettes M4', from: 'pilot-lead@ledge-dev', to: 'design-ux@ledge-dev', createdAt: '2026-11-10 19:00:00', updatedAt: '2026-11-10 21:00:00', at: '2026-11-11T10:00:00.000Z' }]
      }
    },
    permissions: { 'ledge-dev': openrig().rigs[1]!.nodes.map(n => ({ logicalId: n.logicalId, session: n.session, policySource: 'member_policy', policy: 'builtin:auto' })) },
    snapshots: { 'ledge-dev': [{ id: '01JC0000000000000000000001', kind: 'manual', status: 'complete', createdAt: '2026-11-11 10:42:00' }, { id: '01JC0000000000000000000002', kind: 'auto-pre-down', status: 'complete', createdAt: '2026-11-10 18:00:00' }] },
    routing: routing().entries,
    goals: [goal(), goal({ goalId: 'goal-0002-abcd', text: 'Documenter le multi-machine.', state: 'running', proposal: null, current: { qitemId: 'q', seat: 'docs-pass@docs', state: 'in-progress' } })]
  };
});
test.afterEach(async () => { await h?.close(); });

async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/rigs-${name}.png` });
}
async function pair(page: Page, theme: 'dark' | 'light', lang: Lang) {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('ledge.theme', t!); localStorage.setItem('mobile.lang', l!); } catch { /* ignore */ } }, [theme, lang]);
  await page.goto(h.url);
  const c = copyFor(lang);
  await page.getByRole('link', { name: c.login.github }).click();
  await page.getByRole('button', { name: c.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: c.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: c.compare.seePending }).click();
}
const go = async (page: Page, hash: string) => { await page.evaluate(x => { location.hash = x; }, hash); };

for (const lang of ['fr', 'en'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    const C = copyFor(lang).rigs;
    test.describe(`on a phone, ${theme}, ${lang}`, () => {
      test.use(iPhone13);
      test('the list, a rig and its sheets, the kernel, Max', async ({ page }) => {
        const tag = `phone-${theme}-${lang}`;
        await pair(page, theme, lang);
        await go(page, '#/rigs');
        await expect(page.getByRole('region', { name: C.title }).getByRole('link')).toHaveCount(2);
        await shot(page, `list-${tag}`);

        await go(page, '#/rigs/ledge-dev');
        await expect(page.getByRole('button', { name: C.seatLabel('dev-front', C.seatState.work) })).toBeVisible();
        await shot(page, `rig-${tag}`);
        await page.getByRole('button', { name: C.seatLabel('dev-front', C.seatState.work) }).click();
        await shot(page, `seat-${tag}`);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: C.actions.stop, exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await shot(page, `stop-${tag}`);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: C.actions.seats, exact: true }).click();
        await page.getByRole('button', { name: C.reseat.more('dev.front') }).click();
        await shot(page, `reseat-${tag}`);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: C.tiles.permissions }).click();
        await shot(page, `permissions-${tag}`);
        await page.keyboard.press('Escape');

        await go(page, '#/rigs/synapse-review');
        await expect(page.getByRole('button', { name: C.actions.start, exact: true })).toBeVisible();
        await shot(page, `stopped-${tag}`);

        await go(page, '#/kernel');
        await expect(page.getByText(C.kernelView.actor('pilot-lead'))).toBeVisible();
        await shot(page, `kernel-${tag}`);
        await page.getByRole('heading', { name: C.daemon }).scrollIntoViewIfNeeded();
        await shot(page, `kernel-daemon-${tag}`);

        await go(page, '#/max');
        await expect(page.getByText(goal().text)).toBeVisible();
        await shot(page, `max-${tag}`);
        await go(page, '#/max/goal-0001-abcd');
        await expect(page.getByText(C.max.proposal)).toBeVisible();
        await shot(page, `goal-${tag}`);
      });
    });

    test.describe(`on an iPad, ${theme}, ${lang}`, () => {
      test.use(iPad);
      test('the list beside a rig, the kernel with Max’s goal as a thread', async ({ page }) => {
        const tag = `tablet-${theme}-${lang}`;
        await pair(page, theme, lang);
        await go(page, '#/rigs/ledge-dev');
        await expect(page.getByText(C.seatsByRole)).toBeVisible();
        await shot(page, `rig-${tag}`);
        await go(page, '#/kernel');
        await expect(page.getByText(`${C.kernelView.max} · ${goal().text}`)).toBeVisible();
        await shot(page, `kernel-${tag}`);
      });
    });
  }
}

test.describe('offline', () => {
  test.use(iPhone13);
  test('the last state stays, greyed, and nothing can be sent', async ({ page }) => {
    await pair(page, 'dark', 'fr');
    await go(page, '#/rigs/ledge-dev');
    await expect(page.getByRole('button', { name: copy.rigs.actions.stop, exact: true })).toBeEnabled();
    await h.stopRelay();
    await expect(page.locator('[data-strip="relay"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: copy.rigs.actions.stop, exact: true })).toBeDisabled();
    await shot(page, 'offline-phone-dark-fr');
  });
});

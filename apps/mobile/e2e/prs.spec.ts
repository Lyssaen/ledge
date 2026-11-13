// The MR/PR tab (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html) on a PC that sends its pull and merge requests: the list, a failed
// merge request (its pipeline, the failed job's log, its discussion, changes and commits), a ready pull request, « À toi » › MR et PR;
// on a phone, dark and light, French and English. Then, on Chromium with its virtual authenticator for Face ID, a merge and a reply
// checked by the PC with the daemon's own verification. SHOTS=<dir> saves a capture of each screen there.
import { devices, expect, test, type Page } from '@playwright/test';
import type { PrDetail } from '@ledge/protocol';
import { copyFor, type Lang } from '../src/copy';
import { detail, forgeState, mr, pr } from '../test/model/forge-fixtures';
import { createDeviceCheck } from '../test/fakePc';
import { startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _phone, ...iPhone13 } = devices['iPhone 13'];
const { defaultBrowserType: _pixel, ...pixel } = devices['Pixel 7'];
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

const T = '2026-11-11T10:05:00.000Z';
const front = { id: 's-front', name: 'dev-front', tool: 'claude' as const, project: 'ledge', repo: 'ledge', title: 'dev-front · ledge', state: 'working' as const, helpers: [], startedAt: T, lastActivityAt: T, unread: false };
const tom = { ...front, id: 's-tom', name: 'Tom', tool: 'omp' as const, project: 'synapse', repo: 'synapse', title: 'Tom · synapse' };
const merged = pr({ id: 'github.com/acme/ledge#222', number: 222, ref: '#222', title: 'Terminal de siège : capture et copie', state: 'merged', branch: 'feat/seat-term', url: 'https://github.com/acme/ledge/pull/222' });

/** The failed merge request with the mockup's discussion: a review thread with its line, a comment on the request, one resolved. */
const threads: PrDetail['threads'] = [
  { id: 't1', resolvable: true, resolved: false, file: 'worker/retry.ts', line: 88, code: '+ await sleep(backoff(attempt));', comments: [
    { id: 'c1', author: 'reviewer', at: T, body: 'Le délai n\'est pas plafonné : au 8e essai on attend 4 minutes.' },
    { id: 'c2', author: 'Tom', at: '2026-11-11T10:21:00.000Z', body: 'Exact, je le plafonne à 30 s.' }
  ] },
  { id: 't2', resolvable: false, resolved: false, comments: [{ id: 'c3', author: 'lead', at: '2026-11-11T10:09:00.000Z', body: 'Ajoute un test du plafond avant la fusion.' }] },
  { id: 't3', resolvable: true, resolved: true, file: 'worker/s3.ts', line: 12, comments: [{ id: 'c4', author: 'reviewer', at: T, body: 'ok' }] }
];
const LOG = ['$ pnpm test worker', ' FAIL  worker/retry.test.ts > retries a timed-out upload', '   AssertionError: expected 4 to be 3', '     at worker/retry.test.ts:42:18', '', ' Test Files  1 failed | 11 passed (12)'].join('\n');

let h: Harness;
test.beforeEach(async () => {
  h = await startHarness();
  h.daemon.sessions = [...h.daemon.sessions, front, tom];
  h.daemon.forge = {
    state: forgeState({ prs: [mr(), pr(), merged] }),
    details: {
      [mr().id]: detail(mr(), { mergeBlockers: ['approvals', 'pipeline'], threads }),
      [pr().id]: detail(pr(), { threads: [] }),
      [merged.id]: detail(merged)
    },
    logs: { j2: LOG }
  };
});
test.afterEach(async () => { await h?.close(); });

async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/prs-${name}.png` });
}
async function pair(page: Page, theme: 'dark' | 'light', lang: Lang, enroll = false) {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('ledge.theme', t!); localStorage.setItem('mobile.lang', l!); } catch { /* ignore */ } }, [theme, lang]);
  await page.goto(h.url);
  const c = copyFor(lang);
  await page.getByRole('link', { name: c.login.github }).click();
  await page.getByRole('button', { name: c.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: c.compare.same }).click();
  h.pc.ok();
  if (enroll) {
    await page.getByRole('button', { name: c.enroll.go }).click();
    await expect(page.getByText(c.enroll.done)).toBeVisible();
  }
  await page.getByRole('link', { name: c.compare.seePending }).click();
}
const go = async (page: Page, hash: string) => { await page.evaluate(x => { location.hash = x; }, hash); };
const at = (id: string) => `#/prs/${encodeURIComponent(id)}`;

for (const lang of ['fr', 'en'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    const C = copyFor(lang).prs;
    test.describe(`on a phone, ${theme}, ${lang}`, () => {
      test.use(iPhone13);
      test('the list, a failed MR and its four views, a ready PR, a merged one, À toi', async ({ page }) => {
        const tag = `phone-${theme}-${lang}`;
        await pair(page, theme, lang);
        await go(page, '#/prs');
        // The open two; the merged one is folded under « Fusionnées et fermées (1) ».
        await expect(page.locator('[data-pr]')).toHaveCount(2);
        await expect(page.getByText(C.closedGroup(1))).toBeVisible();
        await shot(page, `list-${tag}`);

        await go(page, at(mr().id));
        await expect(page.getByText('AssertionError: expected 4 to be 3', { exact: false })).toBeVisible();
        await expect(page.getByRole('button', { name: C.askFix('Tom') })).toBeVisible();
        await shot(page, `overview-failed-${tag}`);
        await page.getByRole('region', { name: C.toMerge }).scrollIntoViewIfNeeded();
        await shot(page, `overview-tomerge-${tag}`);

        await page.getByRole('button', { name: new RegExp(`^${C.tabs.discussion}`) }).click();
        await expect(page.getByText(C.discSub(2, 1))).toBeVisible();
        await shot(page, `discussion-${tag}`);
        await page.locator('[data-thread="t1"]').getByRole('button', { name: C.reply, exact: true }).click();
        await page.getByPlaceholder(C.replyPh).fill(lang === 'fr' ? 'Bien, fusionne quand le test est là.' : 'Good, merge once the test is in.');
        await shot(page, `reply-${tag}`);

        await page.getByRole('button', { name: new RegExp(`^${C.tabs.changes}`) }).click();
        await shot(page, `changes-${tag}`);
        await page.getByRole('button', { name: new RegExp(`^${C.tabs.commits}`) }).click();
        await shot(page, `commits-${tag}`);

        await go(page, at(pr().id));
        await expect(page.getByRole('button', { name: C.merge, exact: true })).toBeEnabled();
        await shot(page, `overview-ready-${tag}`);
        await go(page, at(merged.id));
        await expect(page.locator('[data-foot="done"]')).toBeVisible();
        await shot(page, `merged-${tag}`);

        await go(page, '#/');
        await expect(page.getByRole('region', { name: C.atoi.title })).toBeVisible();
        await shot(page, `atoi-${tag}`);
      });
    });
  }
}

// A tablet (m5-mr-pr.html, §10): on its side, the request beside the list with its Discussion in a column; upright, the phone's views.
for (const theme of ['dark', 'light'] as const) {
  test.describe(`on a tablet, ${theme}`, () => {
    test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false });
    test('a failed MR on its side, its Discussion in a column; upright, the four views', async ({ page }) => {
      const C = copyFor('fr').prs;
      await pair(page, theme, 'fr');
      await go(page, at(mr().id));
      const column = page.getByRole('complementary', { name: C.tabs.discussion });
      await expect(column.getByText(C.discSub(2, 1))).toBeVisible();
      await expect(page.locator('[data-pipeline="side"]')).toBeVisible();
      await expect(page.locator('footer').getByRole('button', { name: C.sendAll('Tom') })).toBeVisible();
      await expect(page.getByRole('navigation', { name: C.title }).getByRole('button')).toHaveCount(3);
      // The Discussion column sits on the right of the overview, the list on its left.
      const box = (await column.boundingBox())!;
      expect.soft(Math.round(box.width)).toBe(320);
      expect.soft(Math.round(box.x + box.width)).toBe(1180);
      expect.soft(Math.round((await page.locator('.split-list').boundingBox())!.width)).toBe(320);
      await shot(page, `tablet-landscape-${theme}`);

      await page.setViewportSize({ width: 820, height: 1180 });
      await expect(column).toBeHidden();
      await expect(page.getByRole('navigation', { name: C.title }).getByRole('button')).toHaveCount(4);
      expect.soft(Math.round((await page.locator('.split-list').boundingBox())!.width)).toBe(290);
      await shot(page, `tablet-portrait-${theme}`);
    });
  });
}

test.describe('with Face ID', () => {
  test.use(pixel);
  test.skip(({ browserName }) => browserName !== 'chromium', 'The virtual authenticator is a Chromium DevTools feature');

  test('merges a ready PR and replies in a thread, each checked by the PC over that very action', async ({ page }) => {
    test.setTimeout(90_000);
    const C = copyFor('fr').prs;
    h.daemon.device = createDeviceCheck(h.url);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
    await pair(page, 'dark', 'fr', true);

    await go(page, at(pr().id));
    await page.getByRole('button', { name: C.merge, exact: true }).click();
    const sheet = page.getByRole('dialog', { name: C.confirm('#231', 'main') });
    await expect(sheet.getByText(detail(pr()).mergeCommand)).toBeVisible();
    await sheet.getByRole('button', { name: new RegExp(`^${C.merge} avec`) }).click();
    await expect(page.getByText(C.merged('#231'))).toBeVisible();
    expect(h.daemon.forgeActs.map(a => a.action)).toEqual([{ kind: 'merge', headSha: pr().headSha }]);

    await go(page, at(mr().id));
    await page.getByRole('button', { name: new RegExp(`^${C.tabs.discussion}`) }).click();
    await page.locator('[data-thread="t1"]').getByRole('button', { name: C.reply, exact: true }).click();
    await page.getByPlaceholder(C.replyPh).fill('Bien, fusionne quand le test est là.');
    await page.getByRole('button', { name: new RegExp(`^${C.reply} avec`) }).click();
    await expect(page.getByText(C.replyPosted('GitLab'))).toBeVisible();
    expect(h.daemon.forgeActs.at(-1)?.action).toEqual({ kind: 'reply', threadId: 't1', body: 'Bien, fusionne quand le test est là.' });
  });
});

import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import type { Session } from '@ledge/protocol';
import { fakeDaemon, session, twoProjects } from './daemon';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

// The sidebar's rows line up in compact and normal mode: an archive or « Sans projet » without a project's colour keeps its place.
// With LEDGE_VISUAL=1 it also captures them: LEDGE_VISUAL=1 pnpm exec playwright test e2e/sidebar-align.spec.ts
const shoot = !!process.env.LEDGE_VISUAL;
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const archived = (id: string, name: string, cwd: string, topic: string, min: number): Session =>
  session(id, { name, cwd, project: cwd.split('/').at(-1)!, topic, title: `${name} · ${topic}`, state: 'exited', exitedAt: ago(min), lastActivityAt: ago(min), archivedAt: ago(min) });
const ARCHIVES = [
  archived('a1', 'Bix', '/w/ledge', 'Ok j’aimerais que tu lèves le doute', 3), archived('a2', 'Zoe', '/w/website', 'J’aimerais que tu regardes la page', 4),
  archived('a3', 'Otto', '/w/ledge', 'Pour le moment on déplace le bouton', 32), archived('a4', 'Dee', '/home/gch', 'Dee · gch', 52),
  archived('a5', 'Pim', '/w/other', 'Est-ce que tu peux relancer les tests', 52), archived('a6', 'Maximilien', '/w/ledge', 'Fait un pull du remote main', 52),
  archived('a7', 'Nova', '/w/other', 'Lance chrome pour accéder au site', 53)
];
const LIVE = [session('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }), session('nova', { name: 'Plume', cwd: '/w/website', state: 'idle' }), session('free', { name: 'Kai', cwd: '/w/other', state: 'idle' })];

async function open(page: Page, theme: 'dark' | 'light', dense: boolean) {
  await page.addInitScript(([t, d]) => { try {
    localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.grouping', 'projects');
    localStorage.setItem('desktop.sidebar', JSON.stringify({ hideDone: true, dense: d === 'dense' }));
  } catch { /* ignore */ } }, [theme, dense ? 'dense' : 'normal']);
  await fakeDaemon(page, [...LIVE, ...ARCHIVES], { projects: twoProjects });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
}
const side = (page: Page) => page.locator('aside.sidebar');

for (const theme of ['dark', 'light'] as const) for (const dense of [true, false]) {
  const mode = dense ? 'compact' : 'normal';
  test(`archives, ${mode}, ${theme}`, async ({ page }, info) => {
    await open(page, theme, dense);
    await side(page).getByRole('button', { name: /^Archives/ }).click();
    const archives = side(page).locator('.st-archives');
    await expect(archives.getByRole('listitem')).toHaveCount(ARCHIVES.length, { timeout: 30_000 });
    if (shoot) {
      await archives.screenshot({ path: info.outputPath(`archives-${mode}-${theme}.png`) });
      await side(page).screenshot({ path: info.outputPath(`sidebar-${mode}-${theme}.png`) });
    }
    // Where each archive's name starts: one column, with or without a project's colour.
    const starts = await archives.locator('.st-arch .st-main strong').evaluateAll(els => els.map(e => {
      const r = document.createRange(); const text = [...e.childNodes].find(n => n.nodeType === Node.TEXT_NODE)!; r.selectNodeContents(text); return Math.round(r.getBoundingClientRect().left);
    }));
    expect(new Set(starts).size, `the names start at ${starts.join(', ')}`).toBe(1);
    // The projects' heads, « Sans projet » included: one column too.
    const heads = await side(page).locator('.st-tree .st-project .st-main strong').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(heads).size, `the projects start at ${heads.join(', ')}`).toBe(1);
  });
}

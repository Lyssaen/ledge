import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { expect, layer, expectMode, received, ready, surface } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { restInside } from './scenarios';

/*
 * 60 s presentation (docs/2026-10-11-video-presentation-ledge-design.md).
 *   LEDGE_VIDEO=1 pnpm --filter overlay exec playwright test e2e/presentation-video.spec.ts
 * Writes docs/video/ledge-presentation.webm and cover.png. Needs network for Geist.
 */
test.skip(!process.env.LEDGE_VIDEO, 'set LEDGE_VIDEO=1 to record the presentation');
test.use({
  viewport: { width: 1920, height: 1080 },
  locale: 'fr-FR',
  video: { mode: 'on', size: { width: 1920, height: 1080 } },
  launchOptions: process.env.LEDGE_CHROMIUM ? { executablePath: process.env.LEDGE_CHROMIUM } : {}
});
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'video');
mkdirSync(OUT, { recursive: true });

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const perm = { state: 'waiting_permission' as const, pending: { kind: 'permission' as const, text: 'pnpm test --filter overlay', source: 'hook' as const } };
const replyText = `## Tests overlay : 229 verts

Les tests du overlay passent. Rien à corriger sur le défilement de l’aperçu.

### Ce que j’ai fait

- Relancé \`pnpm test --filter overlay\`
- Vérifié que l’aperçu suit la dernière ligne

### Vérifié

- \`pnpm test --filter overlay\` : 229 passed, 4.1s
`;

const otto = (extra: Partial<ReturnType<typeof session>> = {}) => session('otto', {
  name: 'Otto', tool: 'claude', project: 'harness-assistant', repo: 'harness-assistant',
  cwd: '/home/demo/Workspace/harness-assistant', repoPath: '/home/demo/Workspace/harness-assistant',
  branch: 'main', topic: 'Tests overlay', topicSource: 'prompt',
  title: 'Otto · Tests overlay', startedAt: ago(18), ...extra
});
const pim = session('pim', {
  name: 'Pim', tool: 'cursor', project: 'landing-page', repo: 'landing-page',
  cwd: '/home/demo/Workspace/landing-page', repoPath: '/home/demo/Workspace/landing-page',
  branch: 'main', topic: 'Page d’accueil', topicSource: 'prompt',
  title: 'Pim · Page d’accueil', startedAt: ago(8), state: 'working'
});
const bix = session('bix', {
  name: 'Bix', tool: 'codex', project: 'documentation', repo: 'documentation',
  cwd: '/home/demo/Workspace/documentation', repoPath: '/home/demo/Workspace/documentation',
  branch: 'main', topic: 'Tour de Ledge', topicSource: 'prompt',
  title: 'Bix · Tour de Ledge', startedAt: ago(2), state: 'idle'
});

const conversation = [
  '❯ Lance les tests du overlay et corrige ce qui casse.',
  '',
  '● Bash(pnpm test --filter overlay)',
  '  ⎿  Test Files  19 passed (19)',
  '        Tests  229 passed (229)',
  '',
  '● Les tests passent. Je relis SessionView.',
  '',
  '✻ Brewed for 42s · done'
];

async function stage(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.theme', 'dark'); } catch { /* ignore */ } });
  await page.addStyleTag({ content: `
    html, body, #root { background: #0f141b !important; }
    [data-surface] { z-index: 5 !important; }
    #ledge-bg {
      position: fixed; inset: 0; z-index: 0; pointer-events: none;
      background: radial-gradient(120% 90% at 70% 10%, #1d2430 0%, #0f141b 55%, #090c11 100%);
    }
    #ledge-desk, #ledge-caption, #ledge-end, #ledge-pointer { pointer-events: none; }
    #ledge-desk {
      position: fixed; inset: 0; z-index: 1;
      font-family: 'Ubuntu Mono', ui-monospace, monospace;
      color: #d7dde6;
    }
    #ledge-desk .term {
      position: absolute; background: #10141b; border: 1px solid #3a4452;
      border-radius: 8px; overflow: hidden; box-shadow: 0 18px 48px #00000080;
    }
    #ledge-desk .bar {
      height: 28px; display: flex; align-items: center; gap: 6px;
      padding: 0 10px; background: #1a212c; color: #9aa3b0; font-size: 12px;
      border-bottom: 1px solid #2a3340;
    }
    #ledge-desk .dot { width: 8px; height: 8px; border-radius: 50%; background: #3d4654; }
    #ledge-desk pre {
      margin: 0; padding: 12px 14px 16px; font: 13px/18px 'Ubuntu Mono', ui-monospace, monospace;
      color: #c9d2de; white-space: pre-wrap;
    }
    #ledge-desk .ask { color: #f3b23e; }
    #ledge-caption {
      position: fixed; left: 520px; right: 80px; bottom: 56px; z-index: 41;
      color: #f4f6f8; font: 600 28px/36px Geist, Ubuntu, system-ui, sans-serif;
      text-shadow: 0 1px 0 #090c11, 0 8px 24px #090c11;
      letter-spacing: -0.02em; max-width: 980px;
    }
    #ledge-end {
      position: fixed; left: 480px; right: 80px; top: 42%; z-index: 41;
      color: #f4f6f8; display: none;
      font-family: Geist, Ubuntu, system-ui, sans-serif;
    }
    #ledge-end.show { display: block; }
    #ledge-end strong { display: block; font-size: 64px; line-height: 1; letter-spacing: -0.04em; font-weight: 650; }
    #ledge-end span { display: block; margin-top: 16px; font-size: 24px; line-height: 32px; color: #c5ccd6; font-weight: 500; }
    #ledge-pointer {
      position: fixed; left: 900px; top: 500px; z-index: 42; opacity: 0;
      width: 20px; height: 20px; filter: drop-shadow(0 1px 1px rgba(0,0,0,.55));
      transition: left 80ms linear, top 80ms linear;
    }
  ` });
}

async function mountDesk(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById('ledge-desk')) return;
    const bg = document.createElement('div');
    bg.id = 'ledge-bg';
    const desk = document.createElement('div');
    desk.id = 'ledge-desk';
    desk.innerHTML = `
      <div class="term" style="left: 420px; top: 88px; width: 720px; height: 420px;">
        <div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i> Pim · landing-page</div>
        <pre>cursor-agent  landing-page
● Edit src/Hero.tsx
  ⎿  Le hero utilise les jetons Signal.

● Bash(pnpm test)
  ⎿  Test Files  8 passed (8)

Pim écrit encore.</pre>
      </div>
      <div class="term" style="left: 980px; top: 360px; width: 640px; height: 380px;">
        <div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i> Otto · harness-assistant</div>
        <pre id="ledge-otto-term">claude  harness-assistant
❯ Lance les tests du overlay et corrige ce qui casse.

● Bash(pnpm test --filter overlay)
  ⎿  waiting for approval</pre>
      </div>
      <div class="term" style="left: 560px; top: 620px; width: 520px; height: 220px;">
        <div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i> Bix · documentation</div>
        <pre>codex  documentation
Tour de Ledge — terminé.
Bix attend la prochaine instruction.</pre>
      </div>`;
    const cap = document.createElement('div');
    cap.id = 'ledge-caption';
    const end = document.createElement('div');
    end.id = 'ledge-end';
    end.innerHTML = '<strong>Ledge</strong><span>Vos agents travaillent. Vous savez quand intervenir.</span>';
    const pointer = document.createElement('div');
    pointer.id = 'ledge-pointer';
    pointer.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 2.2 16.4 11.1l-6.1.4 2.6 6.3-2.3 1L8 12.2 3 16.6Z" fill="#f4f6f8" stroke="#11161d" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    const root = document.getElementById('root');
    document.documentElement.style.background = '#0f141b';
    document.body.style.background = '#0f141b';
    if (root) {
      root.style.background = '#0f141b';
      root.prepend(desk);
      root.prepend(bg);
      root.append(cap, end, pointer);
    }
  });
}

async function caption(page: Page, text: string) {
  await page.locator('#ledge-caption').evaluate((el, t) => { el.textContent = t; }, text);
}

async function move(page: Page, x: number, y: number, steps = 14) {
  await page.mouse.move(x, y, { steps });
  await page.locator('#ledge-pointer').evaluate((el, p) => {
    (el as HTMLElement).style.left = `${p.x}px`;
    (el as HTMLElement).style.top = `${p.y}px`;
    (el as HTMLElement).style.opacity = '1';
  }, { x, y });
}

async function clickAt(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await move(page, x, y);
  await page.mouse.click(x, y);
}

test('presentation: where did my agent go', async ({ page }, info) => {
  await stage(page);
  const d = await fakeDaemon(page, [otto(), pim, bix]);
  await ready(page, 3);
  await mountDesk(page);
  await expectMode(page, 'handle');
  await caption(page, 'Plusieurs agents travaillent. Lequel attend votre réponse ?');
  await move(page, 1100, 420);
  await page.waitForTimeout(7000);

  d.upsert(otto(perm));
  d.preview('otto', ['❯ Lance les tests du overlay et corrige ce qui casse.', '', '● Bash(pnpm test --filter overlay)', '  ⎿  waiting for approval']);
  await page.evaluate(() => {
    const el = document.getElementById('ledge-otto-term');
    if (el) el.innerHTML = `claude  harness-assistant
❯ Lance les tests du overlay et corrige ce qui casse.

● Bash(pnpm test --filter overlay)
<span class="ask">  Do you want to run this command?</span>
  ⎿  waiting for your approval`;
  });
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble').getByText('Otto attend votre accord')).toBeVisible();
  await caption(page, 'Ledge vous le montre, là où vous travaillez.');
  await page.screenshot({ path: join(OUT, 'cover.png') });
  await page.waitForTimeout(8000);

  const ottoBot = layer(page, 'handle').getByRole('button', { name: /Otto attend votre accord/ });
  await clickAt(page, (await ottoBot.boundingBox())!);
  await expectMode(page, 'session');
  await expect(layer(page, 'session').getByText('pnpm test --filter overlay', { exact: true })).toBeVisible();
  await caption(page, 'Voyez la demande. Décidez depuis le bord de l’écran.');
  await restInside(page);
  const rest = (await surface(page).boundingBox())!;
  await move(page, rest.x + rest.width - 4, rest.y + rest.height / 2);
  await page.waitForTimeout(3500);

  const allow = layer(page, 'session').getByRole('button', { name: 'Autoriser' });
  await clickAt(page, (await allow.boundingBox())!);
  expect(await received(d.received, 'session.decide', m => m.id === 'otto')).toEqual({ type: 'session.decide', id: 'otto', decision: 'accept' });
  await page.waitForTimeout(700);
  d.upsert(otto({ state: 'working' }));
  d.preview('otto', conversation);
  await expect(layer(page, 'session').getByText('En cours')).toBeVisible();
  await page.waitForTimeout(3500);

  await caption(page, 'Et gardez une vue sur tous vos agents.');
  const back = layer(page, 'session').getByRole('button', { name: 'Retour aux sessions' });
  await clickAt(page, (await back.boundingBox())!);
  await expectMode(page, 'list');
  const listBox = (await surface(page).boundingBox())!;
  await move(page, listBox.x + listBox.width - 8, listBox.y + listBox.height / 2);
  await expect(layer(page, 'list').getByText('Tests overlay')).toBeVisible();
  await page.waitForTimeout(10000);

  const fold = layer(page, 'list').getByRole('button', { name: 'Replier' });
  await clickAt(page, (await fold.boundingBox())!);
  await expectMode(page, 'handle');
  d.upsert(otto({ state: 'idle', lastReply: { text: replyText, at: new Date().toISOString() } }));
  await expectMode(page, 'bubble');
  await expect(layer(page, 'bubble').getByText('Otto a terminé')).toBeVisible();
  await caption(page, 'Quand le travail est fini, le résultat est à portée de main.');
  await page.waitForTimeout(2800);
  const open = layer(page, 'bubble').getByRole('button', { name: 'Ouvrir' });
  await clickAt(page, (await open.boundingBox())!);
  await expectMode(page, 'session');
  await expect(layer(page, 'session').getByRole('heading', { level: 2 })).toContainText('Tests overlay');
  await page.waitForTimeout(5500);

  const close = layer(page, 'session').getByRole('button', { name: 'Fermer' });
  await clickAt(page, (await close.boundingBox())!);
  await expectMode(page, 'handle');
  await caption(page, '');
  await page.locator('#ledge-desk').evaluate(el => { (el as HTMLElement).style.opacity = '0.18'; });
  await page.locator('#ledge-end').evaluate(el => el.classList.add('show'));
  await move(page, 640, 540);
  await page.waitForTimeout(8000);

  const video = page.video();
  if (video) {
    const src = await video.path();
    const dest = join(OUT, 'ledge-presentation.webm');
    await info.attach('presentation', { path: src, contentType: 'video/webm' });
    copyFileSync(src, dest);
  }
});

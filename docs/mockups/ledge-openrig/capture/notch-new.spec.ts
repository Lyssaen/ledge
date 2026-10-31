import { test, type Page } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/overlay/node_modules/@playwright/test/index.js';
import { fakeDaemon, session } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/overlay/e2e/daemon';
const C = '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/capture';
const bg = 'html,body{background:linear-gradient(180deg,#1c1f24,#101215)!important} [data-surface]{transition:none!important}';

const closed: Record<string, string> = {
  calm: `<span style="font-size:12px;color:var(--muted-foreground)">9 au travail · 2 rigs</span>`,
  exchange: `<span style="font-size:12px;color:var(--muted-foreground)">factory</span><span style="font-size:12px;font-weight:500">build → review-a</span><span style="font-size:12px;color:var(--muted-foreground)">Candidat prêt, tests verts</span>`,
  decided: `<span style="font-size:12px">J’ai tranché pour build : merge, pas de rebase</span><span style="width:1px;height:14px;background:var(--sidebar-border)"></span><span style="font-size:12px;color:var(--muted-foreground)">Revenir dessus</span>`,
  foryou: `<span style="font-size:11px;font-weight:600;color:var(--warning);background:var(--status-warning-soft);padding:1px 6px;border-radius:6px">Architecture</span><span style="font-size:12px">orch-lead : JSON ou SQLite ?</span><span style="font-size:11px;font-weight:600;color:var(--danger-text);background:var(--status-danger-soft);padding:1px 6px;border-radius:6px">1</span>`
};

async function closedState(page: Page, kind: string, original: string) {
  await page.evaluate(([html, orig]) => {
    const layer = document.querySelector('[data-layer="handle"]') as HTMLElement;
    layer.innerHTML = orig;
    [...layer.children].forEach((c, i) => { if (i > 0) c.remove(); });
    const box = document.createElement('span');
    box.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:10px;white-space:nowrap';
    box.innerHTML = html;
    layer.appendChild(box);
    const surface = document.querySelector('[data-surface]') as HTMLElement;
    const w = layer.scrollWidth;
    surface.style.width = w + 'px';
    surface.style.left = Math.round((window.innerWidth - w) / 2) + 'px';
  }, [closed[kind], original]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/nn-closed-${kind}.png`, clip: { x: 420, y: 0, width: 600, height: 90 } });
}

const feed = `
<div style="display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid color-mix(in oklab, var(--warning) 45%, transparent);border-radius:var(--radius-lg);background:var(--well)">
  <div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;font-weight:600;color:var(--warning);background:var(--status-warning-soft);padding:1px 6px;border-radius:6px">Architecture</span><span class="mono" style="font-size:11px;color:var(--muted-foreground)">orch-lead@factory · 4 min</span></div>
  <span style="font-size:13px;line-height:18px;font-weight:600">Sessions : passer du fichier JSON à SQLite ?</span>
  <span style="font-size:12px;line-height:17px;color:var(--muted-foreground)">Mon avis : SQLite. Tu as écarté deux fois les fichiers plats pour l’état partagé. Je te la passe : c’est de l’architecture.</span>
  <div style="display:flex;gap:6px"><button class="ledge-btn" data-variant="primary" style="height:28px;padding:0 12px;border-radius:var(--radius-md);font-size:12px;font-weight:500">SQLite</button><button class="ledge-btn" data-variant="outline" style="height:28px;padding:0 12px;border-radius:var(--radius-md);font-size:12px;font-weight:500">Garder le JSON</button><span style="flex:1"></span><button class="ledge-btn" data-variant="ghost" style="height:28px;padding:0 10px;border-radius:var(--radius-md);font-size:12px;color:var(--muted-foreground)">En parler</button></div>
</div>
${[
  ['16:31', 'starter', 'dev-review', 'dev-build', 'message', 'Deux remarques mineures, rien de bloquant.', 0],
  ['16:36', 'factory', 'orch-lead', 'qa', 'tâche confiée', 'Vérifier la reprise après reboot sur deux rigs.', 0],
  ['16:38', '', 'Ledge', 'build', 'décision', 'Merge, pas de rebase : le force-push est interdit ici.', 1],
  ['16:42', 'factory', 'build', 'review-a', 'message', 'Candidat prêt sur feat/rigs (3f2a1c0), tests ciblés verts.', 0],
  ['16:44', '', 'Toi', 'Ledge', '', 'Pourquoi review-b a été relancé ?', 2],
  ['16:44', '', 'Ledge', 'toi', '', 'Il approchait 82 % de contexte. L’operator l’a relevé, la relève a repris sa revue.', 1]
].map(([t, rig, from, to, kind, text, who]) => `
<div style="display:flex;gap:10px;padding:6px 8px;border-radius:var(--radius-md);${who === 1 ? 'background:color-mix(in oklab, var(--sidebar-primary) 12%, transparent);' : who === 2 ? 'background:var(--sidebar-accent);' : ''}">
  <span class="mono" style="font-size:11px;line-height:18px;color:var(--muted-foreground);flex-shrink:0">${t}</span>
  <div style="display:flex;flex-direction:column;gap:1px;min-width:0">
    <span style="font-size:11.5px;line-height:16px;color:var(--muted-foreground)"><b style="font-weight:500;color:${who === 1 ? 'var(--danger-text)' : 'var(--sidebar-foreground)'}">${from}</b> → <b style="font-weight:500;color:var(--sidebar-foreground)">${to}</b>${rig ? ' · ' + rig : ''}${kind ? ' · ' + kind : ''}</span>
    <span style="font-size:12.5px;line-height:18px">${text}</span>
  </div>
</div>`).join('')}`;

test('notch new', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', 'dark'); });
  await fakeDaemon(page, ['Otto','Nova','Pim','Bix','Lu','Milo','Ada','Sol','Tao'].map((n, i) => session('s' + i, { name: n, tool: (['claude','codex','cursor'] as const)[i % 3], project: 'harness-assistant', state: 'working' })));
  await page.goto('/');
  await page.addStyleTag({ content: bg });
  await page.waitForTimeout(1500);
  const h = (await page.locator('[data-surface]').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2, { steps: 2 });
  await page.waitForTimeout(900);
  await page.locator('[data-resident]').first().click();
  await page.waitForTimeout(1200);
  await page.evaluate(html => {
    const chat = document.querySelector('[data-layer="chat"]') as HTMLElement;
    const sub = chat.querySelector('[data-brand]')!.nextElementSibling as HTMLElement;
    sub.textContent = 'Orchestre 2 rigs · 8 agents · tranche dans son mandat';
    const content = chat.querySelector('[data-chat-content]') as HTMLElement;
    content.style.gap = '4px';
    content.innerHTML = html;
    const input = chat.querySelector('[data-chat-input]') as HTMLInputElement;
    input.placeholder = 'Écrire à Ledge… (@build pour un agent)';
    const surface = document.querySelector('[data-surface]') as HTMLElement;
    surface.style.height = '640px';
  }, feed);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/nn-open.png`, clip: { x: 420, y: 0, width: 600, height: 680 } });
  await page.reload();
  await page.addStyleTag({ content: bg });
  await page.waitForTimeout(1500);
  const h2 = (await page.locator('[data-surface]').boundingBox())!;
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2, { steps: 2 });
  await page.waitForTimeout(900);
  const original = await page.locator('[data-layer="handle"]').evaluate(e => e.innerHTML);
  for (const k of Object.keys(closed)) await closedState(page, k, original);
});

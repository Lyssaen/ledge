import { test, type Page } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/desktop/node_modules/@playwright/test/index.js';
import { writeFileSync } from 'node:fs';
import { fakeDaemon, T0 } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/desktop/e2e/daemon';
import { projects, fleet, sidebar, atelier } from './helpers';
import { fakeDaemon as fd, session as ses } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/desktop/e2e/daemon';
import { eight, twoProjects } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/desktop/e2e/daemon';
const S = '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/capture';

const role = (id: string, label: string, extra: Record<string, unknown>) => ({ id, label, prompt: `Tu es ${label}.`, source: 'repo', path: `/home/me/.openrig/specs/agents/${id}/agent.yaml`, ...extra });
export const roles = [
  role('lead', 'Lead', { tool: 'claude', model: 'opus', effort: 'high', autonomy: 'ask' }),
  role('build', 'Builder', { tool: 'claude', model: 'opus', effort: 'high', autonomy: 'edits' }),
  role('review-a', 'Relecteur A', { tool: 'codex', model: 'gpt-5.5', effort: 'high', autonomy: 'ask' }),
  role('review-b', 'Relecteur B', { tool: 'codex', model: 'gpt-5.5-mini', effort: 'medium', autonomy: 'ask' }),
  role('qa', 'QA', { tool: 'claude', model: 'sonnet', effort: 'medium', autonomy: 'edits' }),
  role('design', 'Design', { tool: 'claude', model: 'opus', effort: 'medium', autonomy: 'ask' }),
  role('advisor', 'Advisor', { tool: 'claude', model: 'opus', effort: 'high', autonomy: 'ask' })
];
export const templates = [
  { id: 'starter', name: 'starter', source: 'home', path: '/home/me/.openrig/specs/rigs/starter/rig.yaml', seats: [{ role: 'build' }, { role: 'review-a' }] },
  { id: 'workshop', name: 'workshop', source: 'home', path: '~/rigs/workshop/rig.yaml', seats: [{ role: 'lead' }, { role: 'build' }, { role: 'qa' }, { role: 'review-a' }] },
  { id: 'factory', name: 'factory', source: 'home', path: '/home/me/.openrig/specs/rigs/factory/rig.yaml', seats: [{ role: 'lead' }, { role: 'advisor' }, { role: 'build' }, { role: 'qa' }, { role: 'design' }, { role: 'review-a' }, { role: 'review-b' }] }
];
export const teams = [
  { id: 'team-fa01', name: 'factory', template: 'factory', project: 'factory', machine: 'local', cwd: '/rigs/factory', state: 'active', seats: [{ role: 'lead', sessionId: 'lead' }, { role: 'build', sessionId: 'build' }, { role: 'review-a', sessionId: 'reva' }, { role: 'review-b', sessionId: 'revb' }, { role: 'qa', sessionId: 'qa' }, { role: 'design', sessionId: 'design' }], createdAt: T0, updatedAt: T0 },
  { id: 'team-5701', name: 'starter', template: 'starter', project: 'starter', machine: 'local', cwd: '/rigs/starter', state: 'active', seats: [{ role: 'build', sessionId: 'sbuild' }, { role: 'review-a', sessionId: 'srev' }], createdAt: T0, updatedAt: T0 }
];
const dump = async (page: Page, n: string) => writeFileSync(`${S}/${n}.html`, await page.locator('body').evaluate(e => e.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>')));

const seat: Record<string, [string, string]> = { lead: ['team-fa01', 'lead'], build: ['team-fa01', 'build'], reva: ['team-fa01', 'review-a'], revb: ['team-fa01', 'review-b'], qa: ['team-fa01', 'qa'], design: ['team-fa01', 'design'], sbuild: ['team-5701', 'build'], srev: ['team-5701', 'review-a'] };
const rigFleet = fleet.map(x => seat[x.id] ? { ...x, team: seat[x.id][0], role: seat[x.id][1] } : x);
const readyTopic: Record<string, string> = { lead: 'Prêt, attend le but', build: 'Prêt', reva: 'Prêt' };

async function boot(page: Page, sessions: unknown[], extras: Record<string, unknown>) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', 'dark'); });
  const d = await fakeDaemon(page, sessions as never, extras as never);
  await page.goto('/');
  await page.getByRole('tree').waitFor();
  await page.waitForTimeout(1200);
  return d;
}

/** The sidebar once teams exist: drop the team rows and role pills, then the shared rewrite. */
async function rigSidebar(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('aside .st-row.st-team, aside .st-row.st-common').forEach(r => r.remove());
    document.querySelectorAll('aside .st-tree .role-pill, aside .st-tree [class*="role"]').forEach(p => { if (p.textContent?.startsWith('@')) p.remove(); });
    document.querySelectorAll('aside .st-project *').forEach(s => { if (s.children.length === 0 && /^\d+ tables?$/.test(s.textContent?.trim() ?? '')) s.remove(); });
  });
  await page.getByRole('button', { name: 'Mode compact (D)' }).click().catch(() => {});
  await page.waitForTimeout(200);
  await sidebar(page);
}

/** Ledge's own header and tabs, the proposal: Conversation · Rigs · Décisions · Mandat. */
async function ledgeHead(page: Page, selected: number) {
  await page.evaluate(sel => {
    (document.querySelector('.home-sub') as HTMLElement).textContent = 'Orchestrateur OpenRig · 2 rigs, 8 agents · 4 sessions seules · tranche dans son mandat';
    const tabs = [...document.querySelectorAll('.home-tabs [role="tab"]')] as HTMLElement[];
    ['Conversation', 'Rigs · 2', 'Décisions · 3', 'Mandat'].forEach((t, i) => { tabs[i].textContent = t; tabs[i].classList.toggle('on', i === sel); tabs[i].setAttribute('aria-selected', String(i === sel)); });
  }, selected);
}

const feedHtml = `
<div style="display:flex;flex-direction:column;gap:8px;padding:14px;border:1px solid color-mix(in oklab, var(--warning) 45%, transparent);border-radius:var(--radius-lg);background:var(--well)">
  <div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;font-weight:600;color:var(--warning);background:var(--status-warning-soft);padding:1px 6px;border-radius:6px">Architecture</span><span class="mono" style="font-size:11px;color:var(--muted-foreground)">orch-lead@factory · 4 min</span><span style="flex:1"></span><span style="font-size:11px;color:var(--muted-foreground)">remontée par Ledge</span></div>
  <span style="font-size:14px;line-height:20px;font-weight:600">Sessions : passer du fichier JSON à SQLite ?</span>
  <span style="font-size:13px;line-height:19px;color:var(--muted-foreground)">Le lead propose SQLite pour tenir 200 sessions sans relire tout le fichier. <b style="color:var(--foreground);font-weight:500">Mon avis : SQLite.</b> Tu as écarté deux fois les fichiers plats pour l’état partagé (14/10, 22/10).</span>
  <div style="display:flex;gap:6px"><button class="ledge-btn" data-variant="primary" style="height:30px;padding:0 12px;border-radius:var(--radius-md);font-size:13px">SQLite</button><button class="ledge-btn" data-variant="outline" style="height:30px;padding:0 12px;border-radius:var(--radius-md);font-size:13px">Garder le JSON</button><span style="flex:1"></span><button class="ledge-btn" data-variant="ghost" style="height:30px;padding:0 10px;font-size:13px;color:var(--muted-foreground)">Voir le fil de factory</button></div>
</div>
${[
  ['16:31', 'starter', 'dev-review', 'dev-build', 'message', 'Deux remarques mineures, rien de bloquant.', 0],
  ['16:36', 'factory', 'orch-lead', 'qa', 'tâche confiée', 'Vérifier la reprise après reboot sur deux rigs.', 0],
  ['16:38', 'factory', 'Ledge', 'build', 'décision · mandat Git', 'Merge, pas de rebase : le force-push est interdit ici.', 1],
  ['16:42', 'factory', 'build', 'review-a', 'message', 'Candidat prêt sur feat/rigs (3f2a1c0), tests ciblés verts.', 0],
  ['16:44', '', 'Toi', 'Ledge', '', 'Pourquoi review-b a été relancé ?', 2],
  ['16:44', '', 'Ledge', 'toi', '', 'Il approchait 82 % de contexte. L’operator l’a relevé, la relève a repris sa revue en cours.', 1]
].map(([t, rig, from, to, kind, text, who]) => `
<div style="display:flex;gap:12px;padding:8px 10px;border-radius:var(--radius-md);${who === 1 ? 'background:color-mix(in oklab, var(--sidebar-primary) 10%, transparent);' : who === 2 ? 'background:var(--accent);' : ''}">
  <span class="mono" style="font-size:11px;line-height:20px;color:var(--muted-foreground);flex-shrink:0">${t}</span>
  <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
    <span style="font-size:12px;line-height:16px;color:var(--muted-foreground)"><b style="font-weight:500;color:${who === 1 ? 'var(--danger-text)' : 'var(--foreground)'}">${from}</b> → <b style="font-weight:500;color:var(--foreground)">${to}</b>${rig ? ' · ' + rig : ''}${kind ? ' · ' + kind : ''}</span>
    <span style="font-size:13.5px;line-height:20px">${text}</span>
  </div>
  ${who === 0 ? '<span style="flex:1"></span><button class="ledge-btn" data-variant="ghost" style="height:24px;padding:0 8px;font-size:12px;color:var(--muted-foreground);align-self:center">Demander</button>' : ''}
</div>`).join('')}`;

test('ledge and rigs', async ({ page }) => {
  await boot(page, rigFleet, { projects, teams, roles: { '/w/ledge': { roles, templates, problems: [] } } });
  await rigSidebar(page);

  // S1 · Ledge › Conversation: le point, then the feed as the conversation.
  await ledgeHead(page, 0);
  await page.evaluate(html => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    const cols = $$('.lp-col');
    const tpl = $('.lp-row', cols[0]);
    const mk = (strong: string, text: string, btns: [string, boolean][]) => { const r = tpl.cloneNode(true) as HTMLElement; $('.lp-text', r).innerHTML = `<strong>${strong}</strong> ${text}`; $$('button', r).forEach(b => b.remove()); for (const [l, p] of btns) { const b = document.createElement('button'); b.className = p ? 'st-qa pri' : 'st-qa'; b.textContent = l; r.appendChild(b); } return r; };
    cols[0].insertBefore(mk('orch-lead', 'JSON ou SQLite ?', [['SQLite', true], ['JSON', false]]), $('.lp-row', cols[0]));
    const badge = $('h3 .st-badge', cols[0]); if (badge) badge.textContent = '3';
    $('h3', cols[1]).textContent = 'Rigs';
    $$('.lp-count', cols[1]).forEach((c, i) => c.textContent = ['4/6', '1/2'][i] ?? c.textContent);
    $$('small', cols[1]).forEach(s => { s.textContent = s.textContent!.replace('modèle', 'spec').replace(/factory · 6 sièges/, 'rig · 6').replace(/starter · 2 sièges/, 'rig · 2'); });
    $('h3', cols[2]).textContent = 'Tranché par Ledge';
    const none = $('.lp-none', cols[2]); if (none) none.replaceWith(mk('build', 'merge, pas de rebase', [['Revenir', false]]), mk('dev-review', 'tests ciblés', [['Revenir', false]]), mk('operator', 'starter relancé', [['Voir', false]]));
    const content = $('[data-chat-content]');
    content.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px;padding:4px 0">${html}</div>`;
    const sugg = $$('.home-suggestions button');
    ['Lance un rig…', 'Où en est factory ?', 'Qu’as-tu tranché ?', 'Qui a besoin de moi ?'].forEach((t, i) => sugg[i] && (sugg[i].textContent = t));
    const ta = $('[data-chat-input]') as HTMLTextAreaElement; ta.placeholder = 'Écrire à Ledge… (@build pour un agent d’un rig)';
    $('.home-readonly').textContent = 'tranche dans son mandat · design, architecture et critique te reviennent';
  }, feedHtml);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'p-ledge-conv.png' });

  // S2 · Rigs › En cours.
  const home = page.locator('section.ledge-home');
  await home.getByRole('tab', { name: /^Équipes|^Rigs/ }).click();
  await page.waitForTimeout(500);
  await ledgeHead(page, 1);
  await page.evaluate(() => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    const sub = $$('.cat-toolbar [role="tab"]'); ['En cours · 3', 'Specs · 3', 'Agents · 7'].forEach((t, i) => sub[i].textContent = t);
    const cards = $$('.home-team');
    const info: Record<string, { meta: string; spec: string; count: string; ctx: string[]; tools: string[] }> = {
      factory: { meta: 'rig · 6 sièges · dans Ledge · ⎇ feat/rigs', spec: 'factory', count: '4/6 au travail', ctx: ['41 %', '63 %', '28 %', '12 %', '55 %', '9 %'], tools: ['Claude Code · opus', 'Claude Code · opus', 'Codex · gpt-5.5', 'Codex · gpt-5.5-mini', 'Claude Code · sonnet', 'Claude Code · opus'] },
      starter: { meta: 'rig · 2 sièges · dans Ledge · ⎇ fix/notch', spec: 'starter', count: '1/2 au travail', ctx: ['33 %', '7 %'], tools: ['Claude Code · opus', 'Codex · gpt-5.5'] }
    };
    for (const card of cards) {
      const name = $('.lp-text strong', card).textContent!;
      const it = info[name]; if (!it) continue;
      const smalls = $$('.lp-text small', card); smalls[0].textContent = it.meta; smalls[1].innerHTML = ` · spec <button type="button" class="cat-goto">${it.spec}</button>`;
      $('.lp-count', card).textContent = it.count;
      const prog = $('.lp-progress i', card); if (prog) prog.style.width = it.count.startsWith('4') ? '66%' : '50%';
      const row = $('.lp-row', card);
      const tbl = $('button.st-qa', row);
      for (const label of ['Terminaux', 'Arrêter…']) { const b = tbl.cloneNode(true) as HTMLElement; b.textContent = label; row.appendChild(b); }
      $$('li', card).forEach((li, i) => {
        const s = document.createElement('small'); s.textContent = ` · ${it.tools[i]} · contexte ${it.ctx[i]}`; s.style.opacity = '.75'; li.appendChild(s);
      });
    }
    const kernel = cards[cards.length - 1].cloneNode(true) as HTMLElement;
    $('.lp-text', kernel).innerHTML = '<strong>Noyau OpenRig</strong> <small>la mécanique · operator et queue · toujours allumé</small>';
    $('.lp-count', kernel).textContent = 'au repos';
    const prog = $('.lp-progress', kernel); if (prog) prog.remove();
    $$('button.st-qa', kernel).forEach((b, i) => { if (i > 0) b.remove(); else b.textContent = 'Santé'; });
    const lis = $$('li', kernel);
    [['@operator', 'operator', 'Disponible', ' · Codex · fait tourner OpenRig, reçoit les ordres de Ledge'], ['@queue', 'queue', 'Disponible', ' · Codex · range le flux en tâches']].forEach(([pill, n, st, extra], i) => {
      const li = lis[i]; $('.role-pill', li).textContent = pill; $('.st-name', li).textContent = n; const sm = $$('small', li); sm[0].textContent = st; sm[1].textContent = extra;
    });
    kernel.style.opacity = '.8';
    cards[cards.length - 1].after(kernel);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'p-rigs-live.png' });

  // S3 · Rigs › Specs › factory.
  await home.getByRole('tab', { name: /^Modèles|^Specs/ }).click();
  await home.locator('.cat-list').getByRole('button', { name: /factory/ }).click();
  await page.waitForTimeout(400);
  await ledgeHead(page, 1);
  await page.evaluate(() => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    const sub = $$('.cat-toolbar [role="tab"]'); ['En cours · 3', 'Specs · 3', 'Agents · 7'].forEach((t, i) => sub[i].textContent = t);
    document.querySelectorAll('.home-team').forEach(c => c.remove());
    const path = $('.cat-path'); path.textContent = '~/.openrig/specs/rigs/factory/rig.yaml';
    const scope = $('.cat-scope-btn'); if (scope) scope.innerHTML = 'Bibliothèque <strong>OpenRig</strong> <small>~/.openrig/specs</small> ▾';
    $('.cat-list h4').textContent = 'Bibliothèque · ~/.openrig/specs';
    $$('.cat-row .cat-badge').forEach(b => b.textContent = b.textContent!.replace('postes', 'sièges'));
    const wk = $('.cat-row[data-template="workshop"]'); const h = document.createElement('h4'); h.textContent = 'Registre · openrig.dev/rigs'; wk.before(h);
    $('.cat-head small').innerHTML = 'Spec OpenRig · 7 sièges · <span class="cat-src home">bibliothèque</span>';
    $('.cat-actions .ledge-btn').textContent = 'Lancer ce rig…';
    $('.cat-section h3').textContent = 'Sièges';
    $$('.cat-seats th')[0].textContent = 'Siège'; $$('.cat-seats th')[1].textContent = 'Rôle';
    const ro = $$('.cat-ro'); ro[0].innerHTML = '<span class="over">bleu</span> : ce que la spec change aux défauts de l’agent.';
    ro[1].textContent = '✎ Une spec se modifie dans son dossier. Ledge en adapte une copie à tes fournisseurs (Claude seul, Codex seul) avant de lancer.';
    const dts = $$('.cat-facts dt'); dts[1].textContent = 'Rigs nés';
    const dl = $('.cat-facts');
    const dt = document.createElement('dt'); dt.textContent = 'Fournisseurs';
    const dd = document.createElement('dd'); dd.innerHTML = '<span>Claude Code et Codex connectés · rien à adapter</span>';
    dl.append(dt, dd);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'p-rigs-spec.png' });

  // S4 · Lancer un rig.
  await page.getByRole('button', { name: /^Lancer ce rig|^Lancer cette équipe/ }).click();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    $('.modal-title h2').textContent = 'Nouveau rig · factory';
    const fields = $$('.team-launch .field');
    $('span', fields[0]).textContent = 'Projet et dossier';
    ($('select', fields[0]) as HTMLSelectElement).options[0].textContent = 'Ledge · /w/ledge';
    $('span', fields[1]).textContent = 'Spec OpenRig';
    $('span', fields[2]).textContent = 'Nom du rig';
    const goal = fields[2].cloneNode(true) as HTMLElement;
    $('span', goal).textContent = 'But donné au lead';
    const ta = document.createElement('textarea'); ta.rows = 2; ta.value = 'Reprendre les rigs après un reboot de WSL, sans perdre les sessions en cours.';
    ta.className = ($('input', goal) as HTMLElement).className; ta.style.cssText = 'resize:none;padding:8px 12px;font:inherit;border-radius:var(--radius-md)';
    $('input', goal).replaceWith(ta);
    fields[2].after(goal);
    const prev = $('.team-preview');
    $('p', prev).textContent = 'Le rig factory aura sa propre pièce dans l’atelier : une table, 7 sièges. Il travaille dans /w/ledge, sur la branche feat/rigs.';
    const extra = document.createElement('p'); extra.style.cssText = 'margin-top:10px;color:var(--muted-foreground)';
    extra.textContent = 'OpenRig ajoute CLAUDE.md, .openrig/ et .claude/settings.local.json au dossier. Ledge donne le but au lead dès que les sièges sont prêts, puis tranche dans son mandat.';
    prev.appendChild(extra);
    const btns = $$('.composer-actions .ledge-btn'); btns[1].textContent = 'Lancer le rig';
    const plan = btns[0].cloneNode(true) as HTMLElement; plan.textContent = 'Voir le plan'; btns[0].after(plan);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'p-rig-launch.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // S5 · Ledge › Mandat, built on the catalog's split view.
  await ledgeHead(page, 3);
  await page.evaluate(() => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    document.querySelectorAll('.home-team').forEach(c => c.remove());
    const primary = $('.cat-actions .ledge-btn').getAttribute('style') ?? '';
    const ghost = ($$('.cat-facts .ledge-btn')[0]?.getAttribute('style')) ?? '';
    (window as unknown as { __st: string[] }).__st = [primary, ghost];
    const sub = $$('.cat-toolbar [role="tab"]'); sub[0].remove(); sub[1].textContent = 'Ce que Ledge tranche'; sub[2].textContent = 'Souvenirs · 12';
    const scope = $('.cat-scope'); if (scope) scope.innerHTML = '<span style="font-size:13px;color:var(--muted-foreground)">Mandat lu dans <code class="mono">~/.ledge/mandat.md</code></span>';
    const list = $('.cat-list');
    const row = (n: string, badge: string, pills: string[], on = false) => `<button type="button" class="cat-row${on ? ' on' : ''}"><span class="t"><span class="n">${n}</span></span><span class="cat-badge">${badge}</span><span class="s">${pills.map(p => `<span class="role-pill">${p}</span>`).join('')}</span></button>`;
    list.innerHTML = `<h4>Ledge tranche seul</h4>${row('Git et branches', '6 cette semaine', ['merge', 'branches'], true)}${row('Tests et relectures', '9', ['ciblés', 'relance'])}${row('Contexte et relèves', '3', ['operator'])}${row('Petits choix de code', '14', ['nommage', 'style'])}<h4>Te revient toujours</h4>${row('Design', '—', ['UI', 'copie'])}${row('Architecture', '1 en attente', ['stockage', 'API'])}${row('Critique', '—', ['données', 'sécurité', 'suppression', 'coûts'])}`;
    const body = $('.cat-detail-body');
    body.innerHTML = `<div class="cat-head"><div><h2>Git et branches</h2><small>Ledge tranche seul · 6 décisions cette semaine · <span class="cat-src home">mandat</span></small></div><div class="cat-actions"><button type="button" class="ledge-btn" data-variant="outline">Me le remonter désormais</button></div></div>
    <div class="cat-section"><h3>Règles retenues</h3><table class="cat-seats"><thead><tr><th>Règle</th><th>Depuis</th><th>D’où elle vient</th><th>Appliquée</th></tr></thead><tbody>
    <tr><td>Merge, jamais de rebase sur une branche partagée</td><td>26/10</td><td>force-push refusé</td><td class="auto-ask">4 fois</td></tr>
    <tr><td>Une branche par rig, préfixe feat/ ou fix/</td><td>22/10</td><td>ta réponse à orch-lead</td><td class="auto-ask">2 fois</td></tr>
    <tr><td>Jamais de push direct sur main</td><td>14/10</td><td>ta consigne</td><td class="auto-ask">0</td></tr>
    <tr><td>Fusion sur main seulement après la relecture d’un second agent</td><td>proposée</td><td>tu as tranché deux fois pareil</td><td class="auto-edits">à valider</td></tr>
    </tbody></table><p class="cat-ro"><span class="over">bleu</span> : une règle que Ledge propose ; elle ne s’applique qu’une fois validée.</p></div>
    <div class="cat-section"><h3>Dernières décisions</h3><table class="cat-seats"><tbody>
    <tr><td>16:38</td><td><b>build@factory</b> merge, pas de rebase</td><td>règle du 26/10</td><td><button type="button" class="ledge-btn" data-variant="ghost">Revenir dessus</button></td></tr>
    <tr><td>hier</td><td><b>dev-build@starter</b> branche fix/notch</td><td>règle du 22/10</td><td><button type="button" class="ledge-btn" data-variant="ghost">Revenir dessus</button></td></tr>
    </tbody></table></div>
    <dl class="cat-facts"><dt>Mandat</dt><dd><code class="cat-path">~/.ledge/mandat.md</code><button type="button" class="ledge-btn" data-variant="ghost">Ouvrir</button></dd><dt>Souvenirs</dt><dd><code class="cat-path">~/.ledge/memoire/</code><span style="margin-left:8px;color:var(--muted-foreground)">12 règles, 31 décisions</span></dd></dl>
    <p class="cat-ro">✎ Ledge propose une règle quand tu tranches deux fois pareil. Le design, l’architecture et le critique ne passent jamais dans « Ledge tranche seul ».</p>`;
    const [p, g] = (window as unknown as { __st: string[] }).__st;
    $$('.cat-detail-body .ledge-btn').forEach(b => b.setAttribute('style', b.dataset.variant === 'outline' ? p : g));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'p-ledge-mandat.png' });
});

test('one table', async ({ page }) => {
  // Before: today a project can hold several tables (the shared one and a team's).
  const team = { id: 'team-a1b2', name: 'ledge-dev', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'lead', sessionId: 'pim' }, { role: 'review', sessionId: 'nova' }], createdAt: T0, updatedAt: T0 };
  const before = eight.map(x => x.id === 'pim' ? { ...x, team: 'team-a1b2', role: 'lead' } : x.id === 'nova' ? { ...x, team: 'team-a1b2', role: 'review' } : x);
  await boot(page, before, { projects: twoProjects, teams: [team] });
  await page.locator('aside').first().getByRole('button', { name: /^Atelier/ }).click();
  await page.waitForTimeout(800);
  await page.locator('[data-tree-key="p:ledge"]').click();
  await page.waitForTimeout(1800);
  await page.addStyleTag({ content: '.room-heading .heading-names{min-width:0;overflow:hidden}.room-heading .heading-team-line{display:block;white-space:normal;line-height:1.25}.room-heading .heading-branch{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'p-before-ledge.png' });
});

test('one table after', async ({ page }) => {
  const d = await boot(page, fleet, { projects });
  await page.getByRole('button', { name: 'Mode compact (D)' }).click();
  await sidebar(page);
  await page.locator('aside').first().getByRole('button', { name: /^Atelier/ }).click();
  await page.waitForTimeout(800);
  await page.locator('[data-tree-key="p:ledge"]').click();
  await page.waitForTimeout(1800);
  await atelier(page);
  await page.evaluate(() => {
    const el = document.querySelector('[data-room="ledge"] .plaque-counts'); if (el) el.textContent = 'projet · 2 sessions seules';
  });
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'p-after-ledge.png' });
  await page.locator('[data-tree-key="p:factory"]').click();
  await page.waitForTimeout(1800);
  const build = fleet.find(x => x.id === 'build')!;
  d.push({ type: 'session.updated', session: { ...build, lastMessage: { id: 'm3', to: 'review-a', peer: 'reva', summary: 'Candidat prêt, 3f2a1c0', at: new Date(Date.now() + 2000).toISOString() } } } as never);
  await page.waitForTimeout(1000);
  await atelier(page);
  await page.evaluate(() => {
    const el = document.querySelector('[data-room="factory"] .plaque-counts'); if (el) el.textContent = 'rig · 6 sièges · spec factory · dans Ledge';
    const chip = [...document.querySelectorAll('header *')].find(e => e.children.length <= 3 && /^factory/.test(e.textContent?.trim() ?? '') && (e as HTMLElement).offsetHeight > 20) as HTMLElement | undefined;
    if (chip) {
      const bar = document.createElement('span');
      bar.style.cssText = 'display:inline-flex;gap:8px;margin-left:12px;align-items:center';
      bar.innerHTML = ['Fil du rig', 'Terminaux', 'Relancer un siège…', 'Arrêter le rig…'].map(t => `<button type="button" class="ledge-btn" data-variant="outline" style="height:28px;padding:0 10px;border-radius:var(--radius-md);font-size:12px;font-weight:500">${t}</button>`).join('');
      chip.after(bar);
    }
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'p-after-factory.png' });
});

const flag = '<span class="team-flag" aria-hidden="true" style="font-size:20px;line-height:1;color:var(--sidebar-primary)">⚑</span>';

test('launch rig', async ({ page }) => {
  await boot(page, fleet, { projects, launcher: ['claude', 'codex', 'cursor', 'omp'] });
  await page.getByRole('button', { name: 'Mode compact (D)' }).click();
  await sidebar(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await page.waitForTimeout(1000);
  await page.locator('.harness-current').click();
  await page.waitForTimeout(500);
  // Écran 1 · consigne d'abord, puis la spec, puis où.
  await page.evaluate(f => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    const m = $('.composer-modal');
    $('.modal-title h2', m).textContent = 'Nouveau rig';
    $('.composer-prompt .composer-label', m).textContent = 'But donné au lead';
    const ta = $('.composer-prompt textarea', m) as HTMLTextAreaElement; ta.value = 'Reprendre les rigs après un reboot de WSL, sans perdre les sessions en cours. Vérifier sur deux rigs avant de proposer la fusion.';
    $$('.composer-suggestions button', m).forEach((b, i) => b.textContent = ['Corriger les tests qui échouent', 'Livrer l’issue #63', 'Relire la PR #118'][i]);
    const lab = $('.harness-field-label', m); $$('span', lab)[0].textContent = 'Spec OpenRig'; $$('span', lab)[1].textContent = 'L’équipe qu’OpenRig monte';
    const cur = $('.harness-current', m);
    $('.composer-bot', cur).innerHTML = f;
    $('.harness-current-copy strong', cur).textContent = 'factory';
    $('.harness-current-copy small', cur).textContent = '7 sièges · lead, advisor, build, QA, design, 2 relecteurs';
    $('.harness-choice-tag', cur).textContent = 'Recommandé par Ledge';
    $('.composer-tools legend', m).textContent = 'Choisir pour ce rig';
    const tiles = $$('.tool-tile', m);
    const specs = [['starter', '2 sièges · une modification bornée'], ['workshop', '4 sièges · un dépôt, au long cours'], ['factory', '7 sièges · produit dans la durée'], ['Depuis le registre…', 'openrig.dev/rigs · code-review, research, pm']];
    tiles.forEach((t, i) => { $('.composer-bot', t).innerHTML = i < 3 ? f : '<span style="font-size:20px;line-height:1;color:var(--muted-foreground)">+</span>'; $('strong', t).textContent = specs[i][0]; $('small', t).textContent = specs[i][1]; t.classList.toggle('selected', i === 2); });
    const act = $('.harness-default-action span', m); act.textContent = 'Ledge recommande factory : un travail suivi sur plusieurs jours, avec deux relectures.';
    $('.harness-default-action .ledge-btn', m)?.remove();
    $$('.composer-where .chip', m).forEach(c => { if (/factory|starter|Noyau/.test(c.textContent ?? '')) c.remove(); });
    const st = document.createElement('style'); st.textContent = '.modal-backdrop{z-index:1000!important}'; document.head.appendChild(st);
    $('.composer-models legend', m).textContent = 'Fournisseurs';
    const mt = $('.model-trigger', m); $('strong', mt).textContent = 'Claude Code + Codex'; $('.model-badge', mt).textContent = 'connectés'; $('.model-desc', mt).textContent = '5 sièges Claude Code, 2 sièges Codex · rien à adapter';
    $$('.composer-where .chip-note', m).forEach(n => n.textContent = '⎇ nouvelle branche feat/rigs');
    const prev = $('.composer-preview', m); $('.composer-bot', prev).innerHTML = f;
    $('.preview-line', prev).innerHTML = '<strong>factory</strong> ouvrira sa pièce';
    $('small', prev).textContent = '1 table · 7 sièges · dans Ledge · Local';
    const btns = $$('.composer-footer .ledge-btn', m);
    const plan = btns[0].cloneNode(true) as HTMLElement; plan.textContent = 'Voir le plan'; plan.setAttribute('data-variant', 'outline'); btns[0].after(plan);
    btns[1].removeAttribute('aria-disabled'); btns[1].innerHTML = 'Lancer le rig<kbd class="mono">Ctrl ↵</kbd>';
  }, flag);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'l-1-nouveau.png' });

  // Écran 2 · le plan, ce qui démarre et ce qui change.
  await page.evaluate(f => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    const m = $('.composer-modal');
    $('.modal-title h2', m).textContent = 'Plan du rig factory';
    const seats = [['@lead', 'Claude Code · opus · demande avant d’agir'], ['@advisor', 'Claude Code · opus · demande avant d’agir'], ['@build', 'Claude Code · opus · modifie sans demander'], ['@qa', 'Claude Code · sonnet · modifie sans demander'], ['@design', 'Claude Code · opus · demande avant d’agir'], ['@review-a', 'Codex · gpt-5.5 · demande avant d’agir'], ['@review-b', 'Codex · gpt-5.5-mini · demande avant d’agir']];
    const sec = (title: string, body: string) => `<section style="display:flex;flex-direction:column;gap:8px"><span class="composer-label">${title}</span>${body}</section>`;
    const box = (inner: string) => `<div style="border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--well);padding:12px 14px;display:flex;flex-direction:column;gap:8px">${inner}</div>`;
    $('.composer-body', m).innerHTML = `<div style="display:flex;flex-direction:column;gap:20px">
      ${sec('Ce qui démarre · 7 sièges', box(seats.map(([r, d]) => `<div style="display:flex;align-items:center;gap:10px;font-size:13px"><span class="role-pill">${r}</span><span>${d}</span></div>`).join('')))}
      ${sec('Ce qui change dans /w/ledge', box(`<div style="font-size:13px;line-height:20px">OpenRig ajoute <code class="mono">CLAUDE.md</code>, <code class="mono">.mcp.json</code>, <code class="mono">.openrig/</code> et <code class="mono">.claude/settings.local.json</code>.</div><div style="font-size:12.5px;line-height:18px;color:var(--muted-foreground)">Ton propre Claude Code dans ce dossier démarrerait alors en mode « accepter les modifications ».</div><div style="font-size:12.5px;line-height:18px;color:var(--muted-foreground)">Permissions : politique par défaut de l’équipe, aucun accès large.</div><label class="chip selected" style="align-self:flex-start"><input type="checkbox" checked>Travailler dans une copie : <code class="mono">.worktrees/rig-factory</code></label>`))}
      ${sec('Après le lancement', box(`<div style="display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:20px"><span class="composer-bot" aria-hidden="true">${f}</span><span>Je donne le but à <b>orch-lead</b> dès que les 7 sièges sont prêts. Je tranche Git, tests et relèves ; je te remonte le design, l’architecture et le critique.</span></div>`))}
    </div>`;
    const prev = $('.composer-preview', m);
    $('.preview-line', prev).innerHTML = '<strong>7 sièges</strong> · 2 fournisseurs';
    $('small', prev).textContent = 'rig up factory --cwd .worktrees/rig-factory';
    const btns = $$('.composer-footer .ledge-btn', m);
    btns[0].textContent = 'Retour'; btns[1].remove();
  }, flag);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'l-2-plan.png' });
});

test('launching', async ({ page }) => {
  const starting: Record<string, string> = { revb: 'starting', qa: 'starting', design: 'starting' };
  const f2 = rigFleet.map(x => starting[x.id] ? { ...x, state: 'starting', topic: x.id === 'design' ? 'Attend ta confiance' : 'Démarre' } : readyTopic[x.id] ? { ...x, state: 'idle', topic: readyTopic[x.id] } : x);
  await boot(page, f2, { projects, teams, roles: { '/w/ledge': { roles, templates, problems: [] } } });
  await rigSidebar(page);
  const home = page.locator('section.ledge-home');
  await home.getByRole('tab', { name: /^Équipes/ }).click();
  await page.waitForTimeout(500);
  await ledgeHead(page, 1);
  await page.evaluate(f => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    const sub = $$('.cat-toolbar [role="tab"]'); ['En cours · 2', 'Specs · 3', 'Agents · 7'].forEach((t, i) => sub[i].textContent = t);
    const [fac, sta] = $$('.home-team');
    sta.remove();
    const sm = $$('.lp-text small', fac); sm[0].textContent = 'rig · démarre · dans Ledge · ⎇ feat/rigs'; sm[1].innerHTML = ' · spec <button type="button" class="cat-goto">factory</button>';
    $('.lp-count', fac).textContent = '4/7 prêts'; const pi = $('.lp-progress i', fac); if (pi) { pi.style.width = '57%'; }
    const row = $('.lp-row', fac); const tbl = $('button.st-qa', row); tbl.textContent = 'Table';
    const stop = tbl.cloneNode(true) as HTMLElement; stop.textContent = 'Annuler le lancement'; row.appendChild(stop);
    const ul = $('ul', fac);
    const tpl = $('li', ul);
    const adv = tpl.cloneNode(true) as HTMLElement; $('.role-pill', adv).textContent = '@advisor'; $('.st-name', adv).textContent = 'advisor'; ul.insertBefore(adv, ul.children[1]);
    const st: Record<string, [string, string]> = { lead: ['prêt', 'var(--success)'], advisor: ['prêt', 'var(--success)'], build: ['prêt', 'var(--success)'], 'review-a': ['prêt', 'var(--success)'], 'review-b': ['démarre…', 'var(--info)'], qa: ['démarre…', 'var(--info)'], design: ['attend ta confiance dans le dossier', 'var(--warning)'] };
    $$('li', ul).forEach(li => {
      const n = $('.st-name', li).textContent!.replace('orch-', '');
      const [t, c] = st[n] ?? ['prêt', 'var(--success)'];
      const s = $$('small', li)[0]; s.textContent = t; s.style.color = c;
      if (n === 'design') { const b = document.createElement('button'); b.className = 'st-qa'; b.textContent = 'Ouvrir l’invite'; b.style.marginLeft = '10px'; li.appendChild(b); }
    });
    const note = document.createElement('div');
    note.style.cssText = 'display:flex;gap:10px;align-items:center;margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--well);font-size:13px';
    note.innerHTML = `<span aria-hidden="true">${f}</span><span>Le but attend : je le donne à <b>orch-lead</b> dès que les 7 sièges sont prêts. <span style="color:var(--muted-foreground)">design attend ta confiance dans le dossier, je ne réponds pas à sa place.</span></span>`;
    fac.appendChild(note);
  }, flag);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'l-3-demarrage.png' });
});

test('workspace launch', async ({ page }) => {
  await boot(page, fleet, { projects, launcher: ['claude', 'codex', 'cursor', 'omp'] });
  await page.getByRole('button', { name: 'Mode compact (D)' }).click();
  await sidebar(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await page.waitForTimeout(1000);
  await page.evaluate(f => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    const st = document.createElement('style'); st.textContent = '.modal-backdrop{z-index:1000!important}'; document.head.appendChild(st);
    const m = $('.composer-modal');
    $('.modal-title h2', m).textContent = 'Nouveau rig';
    $('.composer-prompt .composer-label', m).textContent = 'But donné au lead';
    ($('.composer-prompt textarea', m) as HTMLTextAreaElement).value = 'Prototyper la reprise des rigs après un reboot de WSL : cloner ledge et openrig, comparer leurs snapshots, proposer un correctif.';
    $$('.composer-suggestions button', m).forEach((b, i) => b.textContent = ['Explorer un dépôt inconnu', 'Comparer deux dépôts', 'Prototyper une idée'][i]);
    const lab = $('.harness-field-label', m); $$('span', lab)[0].textContent = 'Spec OpenRig'; $$('span', lab)[1].textContent = 'L’équipe qu’OpenRig monte';
    const cur = $('.harness-current', m);
    $('.composer-bot', cur).innerHTML = f;
    $('.harness-current-copy strong', cur).textContent = 'factory';
    $('.harness-current-copy small', cur).textContent = '7 sièges · lead, advisor, build, QA, design, 2 relecteurs';
    $('.harness-choice-tag', cur).textContent = 'Recommandé par Ledge';
    $('.composer-models legend', m).textContent = 'Fournisseurs';
    const mt = $('.model-trigger', m); $('strong', mt).textContent = 'Claude Code + Codex'; $('.model-badge', mt).textContent = 'connectés'; $('.model-desc', mt).textContent = '5 sièges Claude Code, 2 sièges Codex';
    const where = $('.composer-where', m);
    const chipCls = $('.chip', where).className.replace('selected', '').trim();
    const machine = $$('fieldset', where)[1].outerHTML;
    const chip = (label: string, sel: boolean, swatch?: string) => `<label class="${chipCls}${sel ? ' selected' : ''}"><input type="radio" name="where" ${sel ? 'checked' : ''}>${swatch ? `<i class="side-swatch" style="background:${swatch}"></i>` : ''}${label}</label>`;
    where.innerHTML = `
      <fieldset class="chip-group"><legend class="composer-label">Où travaille le rig</legend>${chip('Ledge', false, 'rgb(59,130,246)')}${chip('Website', false, 'rgb(16,185,129)')}${chip('+ Nouvel espace, hors projet', true)}</fieldset>
      <label style="display:flex;flex-direction:column;gap:6px"><span class="composer-label">Espace de travail</span><input class="ledge-field" type="text" value="~/rigs/reprise-wsl" style="height:34px;padding:0 10px;background:var(--well);color:inherit;border:1px solid var(--input);border-radius:var(--radius-md);font:13px var(--font-mono, monospace)"><small style="color:var(--muted-foreground);font-size:12px">Ledge le crée vide, nommé d’après le but. OpenRig y installe le rig.</small></label>
      ${machine}
      <fieldset class="chip-group"><legend class="composer-label">Dépôts</legend><span style="font-size:13px;line-height:19px;color:var(--muted-foreground);flex-basis:100%">Identifiés en route : ceux que le rig clone ou que ses agents ouvrent. Tu pourras ensuite ranger le rig dans un projet.</span><label class="${chipCls}"><input type="checkbox">+ Préparer un dépôt (facultatif)</label></fieldset>`;
    const prev = $('.composer-preview', m); $('.composer-bot', prev).innerHTML = f;
    $('.preview-line', prev).innerHTML = '<strong>factory</strong> ouvrira sa pièce, hors projet';
    $('small', prev).textContent = '1 table · 7 sièges · ~/rigs/reprise-wsl · Local';
    const btns = $$('.composer-footer .ledge-btn', m);
    const plan = btns[0].cloneNode(true) as HTMLElement; plan.textContent = 'Voir le plan'; plan.setAttribute('data-variant', 'outline'); btns[0].after(plan);
    btns[1].removeAttribute('aria-disabled'); btns[1].innerHTML = 'Lancer le rig<kbd class="mono">Ctrl ↵</kbd>';
  }, flag);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'w-1-nouveau.png' });
});

/** The rig runs outside any project: its card lists the repositories it brought in. */
test('workspace live', async ({ page }) => {
  await boot(page, rigFleet, { projects, teams, roles: { '/w/ledge': { roles, templates, problems: [] } } });
  await rigSidebar(page);
  await page.evaluate(() => { const s = document.querySelector('[data-tree-key="p:factory"] span:last-child'); if (s) s.textContent = 'rig · hors projet'; });
  const home = page.locator('section.ledge-home');
  await home.getByRole('tab', { name: /^Équipes/ }).click();
  await page.waitForTimeout(500);
  await ledgeHead(page, 1);
  await page.evaluate(f => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    const sub = $$('.cat-toolbar [role="tab"]'); ['En cours · 2', 'Specs · 3', 'Agents · 7'].forEach((t, i) => sub[i].textContent = t);
    const [fac, sta] = $$('.home-team');
    const sm = $$('.lp-text small', fac); sm[0].textContent = 'rig · hors projet · ~/rigs/reprise-wsl'; sm[1].innerHTML = ' · spec <button type="button" class="cat-goto">factory</button>';
    $('.lp-count', fac).textContent = '4/6 au travail'; const pi = $('.lp-progress i', fac); if (pi) pi.style.width = '66%';
    const row = $('.lp-row', fac); const tbl = $('button.st-qa', row);
    for (const l of ['Terminaux', 'Arrêter…']) { const b = tbl.cloneNode(true) as HTMLElement; b.textContent = l; row.appendChild(b); }
    const repo = (name: string, detail: string) => `<span style="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--border);border-radius:9999px;font-size:12.5px"><b style="font-weight:500">${name}</b><span style="color:var(--muted-foreground)">${detail}</span></span>`;
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--well)';
    box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><strong style="font-size:13px">Dépôts trouvés · 3</strong><span style="font-size:12px;color:var(--muted-foreground)">ce que le rig a cloné ou ouvert</span><span style="flex:1"></span><button type="button" class="st-qa">Ranger dans un projet…</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${repo('ledge', '⎇ fix/reboot-resume · cloné par build · 9 fichiers modifiés')}${repo('openrig', '⎇ main · lu par advisor')}${repo('wsl-notes', 'créé par design · pas encore de dépôt distant')}</div>
      <div style="display:flex;gap:10px;align-items:center;font-size:13px"><span aria-hidden="true">${f}</span><span>Je propose de ranger factory dans <b>Ledge</b> : c’est le seul dépôt modifié. <span style="color:var(--muted-foreground)">Je ne déplace rien sans toi.</span></span><span style="flex:1"></span><button type="button" class="st-qa pri">Ranger dans Ledge</button></div>`;
    fac.appendChild(box);
    sta.remove();
  }, flag);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'w-2-encours.png' });
});

test('workspace room', async ({ page }) => {
  const d = await boot(page, fleet, { projects });
  await page.getByRole('button', { name: 'Mode compact (D)' }).click();
  await sidebar(page);
  await page.evaluate(() => { const s = document.querySelector('[data-tree-key="p:factory"] span:last-child'); if (s) s.textContent = 'rig · hors projet'; });
  await page.locator('aside').first().getByRole('button', { name: /^Atelier/ }).click();
  await page.waitForTimeout(800);
  await page.locator('[data-tree-key="p:factory"]').click();
  await page.waitForTimeout(1800);
  const build = fleet.find(x => x.id === 'build')!;
  d.push({ type: 'session.updated', session: { ...build, lastMessage: { id: 'm4', to: 'advisor', peer: 'lead', summary: 'ledge cloné, je compare les snapshots', at: new Date(Date.now() + 2000).toISOString() } } } as never);
  await page.waitForTimeout(1000);
  await atelier(page);
  await page.evaluate(() => {
    const el = document.querySelector('[data-room="factory"] .plaque-counts'); if (el) el.textContent = 'rig · 6 sièges · hors projet · ~/rigs/reprise-wsl';
    const br = document.querySelector('[data-room="factory"] .heading-branch'); if (br) br.textContent = '3 dépôts · ledge, openrig, wsl-notes';
    const chip = [...document.querySelectorAll('header *')].find(e => e.children.length <= 3 && /^factory/.test(e.textContent?.trim() ?? '') && (e as HTMLElement).offsetHeight > 20) as HTMLElement | undefined;
    if (chip) {
      const bar = document.createElement('span');
      bar.style.cssText = 'display:inline-flex;gap:8px;margin-left:12px;align-items:center';
      bar.innerHTML = ['Fil du rig', 'Dépôts · 3', 'Ranger dans un projet…', 'Arrêter le rig…'].map(t => `<button type="button" class="ledge-btn" data-variant="outline" style="height:28px;padding:0 10px;border-radius:var(--radius-md);font-size:12px;font-weight:500">${t}</button>`).join('');
      chip.after(bar);
    }
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/' + 'w-3-piece.png' });
});

/** Ledge screen proposals: the real home, its body replaced; the real composer is moved into the new layout. */
async function ledgeVariant(page: Page, variant: 'A' | 'B' | 'C') {
  await boot(page, rigFleet, { projects, teams, roles: { '/w/ledge': { roles, templates, problems: [] } } });
  await rigSidebar(page);
  await ledgeHead(page, 0);
  await page.evaluate(v => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const svgOf = (key: string) => (document.querySelector(`[data-tree-key="${key}"]`)?.parentElement?.querySelector('.st-bot svg')?.outerHTML ?? '');
    const claude = svgOf('local:build'), codex = svgOf('local:reva');
    const ledgeSvg = $('.home-head svg').outerHTML;
    const av = (svg: string, size = 28) => `<span style="flex-shrink:0;width:${size}px;height:${size}px;display:grid;place-items:center;overflow:hidden">${svg.replace(/width="[^"]*"/, `width="${size}"`).replace(/height="[^"]*"/, `height="${size}"`)}</span>`;
    const btn = (t: string, pri = false) => `<button type="button" class="${pri ? 'st-qa pri' : 'st-qa'}">${t}</button>`;
    const muted = 'color:var(--muted-foreground)';
    const ledgeMsg = (html: string, time = '') => `<div style="display:flex;gap:10px;align-items:flex-start;max-width:720px">${av(ledgeSvg, 30)}<div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span style="font-size:12px;${muted}"><b style="color:var(--foreground);font-weight:600">Ledge</b> ${time}</span><div style="font-size:14px;line-height:21px;padding:10px 14px;border-radius:4px 14px 14px 14px;background:var(--card);border:1px solid var(--border)">${html}</div></div></div>`;
    const meMsg = (t: string, time: string) => `<div style="display:flex;justify-content:flex-end"><div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;max-width:560px"><span style="font-size:12px;${muted}">Toi ${time}</span><div style="font-size:14px;line-height:21px;padding:10px 14px;border-radius:14px 4px 14px 14px;background:var(--secondary)">${t}</div></div></div>`;
    const decision = `<div style="display:flex;flex-direction:column;gap:8px;padding:12px 14px;margin-top:8px;border:1px solid color-mix(in oklab, var(--warning) 45%, transparent);border-radius:var(--radius-lg);background:var(--well)">
      <div style="display:flex;gap:8px;align-items:center"><span style="font-size:11px;font-weight:600;color:var(--warning);background:var(--status-warning-soft);padding:1px 6px;border-radius:6px">Architecture</span><span class="mono" style="font-size:11px;${muted}">orch-lead@factory · il y a 4 min</span></div>
      <b style="font-weight:600">Sessions : passer du fichier JSON à SQLite ?</b>
      <span style="font-size:13px;line-height:19px;${muted}">Mon avis : SQLite. Tu as écarté deux fois les fichiers plats pour l’état partagé.</span>
      <div style="display:flex;gap:6px">${btn('SQLite', true)}${btn('Garder le JSON')}${btn('En parler')}</div></div>`;
    const ex = (svg: string, from: string, to: string, kind: string, text: string, time: string) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0">${av(svg, 22)}<div style="display:flex;flex-direction:column;gap:1px;min-width:0"><span style="font-size:12px;${muted}"><b style="color:var(--foreground);font-weight:500">${from}</b> → <b style="color:var(--foreground);font-weight:500">${to}</b> · ${kind} · ${time}</span><span style="font-size:13px;line-height:19px">${text}</span></div></div>`;
    const group = (rig: string, n: string, open: boolean, items = '') => `<div style="margin-left:40px;max-width:680px;border-left:2px solid var(--border);padding:2px 0 2px 14px"><div style="display:flex;gap:8px;align-items:center;font-size:12.5px;${muted}"><span class="team-flag" style="color:var(--sidebar-primary)">⚑</span><b style="color:var(--foreground);font-weight:500">${rig}</b> · ${n}<span style="flex:1"></span><span>${open ? 'Replier ▾' : 'Voir ▸'}</span></div>${open ? items : ''}</div>`;
    const card = (title: string, body: string) => `<section style="border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--card);padding:12px 14px;display:flex;flex-direction:column;gap:10px"><h3 style="margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;${muted};font-weight:600">${title}</h3>${body}</section>`;
    const row = (svg: string, strong: string, text: string, btns: string) => `<div style="display:flex;gap:8px;align-items:center;font-size:13px">${av(svg, 20)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="font-weight:600">${strong}</b> ${text}</span>${btns}</div>`;
    const prog = (p: number) => `<span style="width:56px;height:4px;border-radius:2px;background:var(--muted);overflow:hidden"><i style="display:block;height:100%;width:${p}%;background:var(--sidebar-primary)"></i></span>`;
    const flag = '<span class="team-flag" style="color:var(--sidebar-primary);width:20px;text-align:center">⚑</span>';

    const body = $('.home-body');
    const composer = $('[data-chat-composer]');
    composer.querySelectorAll('.home-suggestions button').forEach((b, i) => (b as HTMLElement).textContent = ['Lance un rig…', 'Où en est factory ?', 'Qu’as-tu tranché ?', 'Qui a besoin de moi ?'][i] ?? '');
    ($('[data-chat-input]', composer) as HTMLTextAreaElement).placeholder = 'Écrire à Ledge… (@build pour un agent d’un rig)';
    $('.home-readonly', composer).textContent = 'tranche dans son mandat · design, architecture et critique te reviennent';
    composer.remove();
    const col = $('.home-column'); col.style.maxWidth = 'none'; col.style.width = '100%';
    const scroll = (inner: string) => `<div style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px;padding:20px 24px">${inner}</div>`;
    const sep = (t: string) => `<div style="display:flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;${muted}"><span style="flex:1;height:1px;background:var(--border)"></span>${t}<span style="flex:1;height:1px;background:var(--border)"></span></div>`;

    if (v === 'A') {
      // Messagerie : la conversation prend la place, le point passe en rail à droite, les échanges des rigs se replient.
      const chat = scroll(`${sep('Aujourd’hui')}
        ${ledgeMsg('factory avance sur la reprise après reboot, starter corrige l’encoche. Une décision t’attend, je ne peux pas la prendre seul :' + decision, '· 16:44')}
        ${group('factory', '3 échanges entre agents · 16:36 → 16:42', true, ex(claude, 'orch-lead', 'qa', 'tâche', 'Vérifier la reprise après reboot sur deux rigs.', '16:36') + ex(claude, 'build', 'review-a', 'message', 'Candidat prêt sur feat/rigs (3f2a1c0), tests ciblés verts.', '16:42') + ex(codex, 'review-a', 'build', 'message', 'Je relis, verdict dans 10 min.', '16:42'))}
        ${ledgeMsg('J’ai tranché pour <b>build</b> : merge, pas de rebase. <span style="' + muted + '">Règle du 26/10 · force-push refusé.</span> <button type="button" class="st-qa" style="margin-left:6px">Revenir dessus</button>', '· 16:38')}
        ${group('starter', '1 échange · 16:31', false)}
        ${meMsg('Pourquoi review-b a été relancé ?', '· 16:45')}
        ${ledgeMsg('Il approchait 82 % de contexte. L’operator l’a relevé ; la relève a repris sa revue là où elle en était.', '· 16:45')}`);
      const rail = `<aside style="width:340px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;padding:20px 20px 20px 0;overflow:auto">
        ${card('À toi · 3', row(claude, 'orch-lead', 'JSON ou SQLite ?', btn('Voir')) + row(claude, 'Luna', 'Quel port ?', btn('Répondre')) + row(claude, 'Otto', 'npm test', btn('Oui', true) + btn('Non')))}
        ${card('Rigs · 2', row('', 'factory', '4/6 au travail', prog(66) + btn('Table')).replace('<span style="flex-shrink:0;width:20px;height:20px;display:grid;place-items:center;overflow:hidden"></span>', flag) + row('', 'starter', '1/2 au travail', prog(50) + btn('Table')).replace('<span style="flex-shrink:0;width:20px;height:20px;display:grid;place-items:center;overflow:hidden"></span>', flag))}
        ${card('Tranché aujourd’hui · 3', row(ledgeSvg, 'build', 'merge, pas de rebase', btn('Revenir')) + row(ledgeSvg, 'dev-review', 'tests ciblés', btn('Revenir')) + row(ledgeSvg, 'operator', 'starter relancé', btn('Voir')))}
        <button type="button" class="st-qa" style="align-self:flex-start">Résumer la journée</button></aside>`;
      body.innerHTML = `<div style="display:flex;height:100%;min-height:0;gap:20px"><div id="chatcol" style="flex:1;min-width:0;display:flex;flex-direction:column">${chat}</div>${rail}</div>`;
      $('#chatcol').appendChild(composer);
    }

    if (v === 'B') {
      // Deux colonnes : la conversation avec Ledge à gauche, le fil des rigs à droite. Rien ne se mélange.
      const chat = scroll(`
        <div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;${muted};font-weight:600">Épinglé · pour toi</span>${decision}</div>
        ${sep('Aujourd’hui')}
        ${ledgeMsg('factory et starter tournent. J’ai tranché deux fois ce matin, dans mon mandat. Une question d’architecture t’attend, épinglée en haut.', '· 16:44')}
        ${meMsg('Pourquoi review-b a été relancé ?', '· 16:45')}
        ${ledgeMsg('Il approchait 82 % de contexte. L’operator l’a relevé ; la relève a repris sa revue là où elle en était. <div style="margin-top:8px;padding:8px 10px;border-left:2px solid var(--border);font-size:12.5px;' + muted + '">↳ cité : operator → Ledge · review-b relancé (contexte 82 %)</div>', '· 16:45')}`);
      const chip = (t: string, on = false) => `<button type="button" class="st-qa" style="${on ? 'background:var(--secondary);' : ''}">${t}</button>`;
      const tl = (svg: string, from: string, to: string, kind: string, text: string, time: string, ledge = false) => `<div style="display:flex;gap:10px;padding:10px 12px;border-radius:var(--radius-md);${ledge ? 'background:color-mix(in oklab, var(--sidebar-primary) 10%, transparent);' : ''}">${av(svg, 24)}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:12px;${muted}"><b style="color:${ledge ? 'var(--danger-text)' : 'var(--foreground)'};font-weight:500">${from}</b> → <b style="color:var(--foreground);font-weight:500">${to}</b> · ${kind}</span><span style="font-size:13px;line-height:19px">${text}</span></div><span class="mono" style="font-size:11px;${muted}">${time}</span></div>`;
      const rigHead = (n: string, meta: string) => `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px 4px;font-size:13px">${flag}<b>${n}</b><span style="font-size:12px;${muted}">${meta}</span><span style="flex:1"></span>${btn('Table')}</div>`;
      const feed = `<section style="flex:1;min-width:0;display:flex;flex-direction:column;border-left:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 10px"><b style="font-size:14px">Fil des rigs</b><span style="flex:1"></span>${chip('Tout', true)}${chip('factory')}${chip('starter')}${chip('Noyau')}${chip('Décisions de Ledge')}</div>
        <div style="flex:1;overflow:auto;padding:0 12px 16px">
          ${rigHead('factory', '4/6 au travail · ⎇ feat/rigs')}
          ${tl(claude, 'build', 'review-a', 'message', 'Candidat prêt sur feat/rigs (3f2a1c0), tests ciblés verts.', '16:42')}
          ${tl(ledgeSvg, 'Ledge', 'build', 'décision · mandat Git', 'Merge, pas de rebase : le force-push est interdit ici.', '16:38', true)}
          ${tl(claude, 'orch-lead', 'qa', 'tâche confiée', 'Vérifier la reprise après reboot sur deux rigs.', '16:36')}
          ${tl(claude, 'orch-lead', 'Ledge', 'question · architecture', 'JSON ou SQLite pour les sessions ? → remontée à toi', '16:40')}
          ${rigHead('starter', '1/2 au travail · ⎇ fix/notch')}
          ${tl(codex, 'dev-review', 'dev-build', 'message', 'Deux remarques mineures, rien de bloquant.', '16:31')}
          ${rigHead('Noyau OpenRig', 'au repos')}
          ${tl(codex, 'operator', 'Ledge', 'pour info', 'review-b relancé : contexte à 82 %, relève remise.', '16:20')}
        </div></section>`;
      body.innerHTML = `<div style="display:flex;height:100%;min-height:0"><div id="chatcol" style="flex:1;min-width:0;display:flex;flex-direction:column">${chat}</div>${feed}</div>`;
      $('#chatcol').appendChild(composer);
    }

    if (v === 'C') {
      // Ledge résume : pas de flux brut. Ledge écrit des points, chacun avec ce qui t'attend, ce qu'il a tranché, ce qui avance.
      col.style.maxWidth = '920px'; col.style.margin = '0 auto';
      const sect = (title: string, inner: string) => `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px"><span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;${muted};font-weight:600">${title}</span>${inner}</div>`;
      const line = (t: string, b = '') => `<div style="display:flex;gap:8px;align-items:center;font-size:13.5px;line-height:20px"><span style="flex:1">${t}</span>${b}</div>`;
      const digest = `<b style="font-size:15px">Point de 16:45</b>
        ${sect('Pour toi · 1', decision)}
        ${sect('J’ai tranché · 2', line('<b>build</b> : merge, pas de rebase <span style="' + muted + '">· règle du 26/10</span>', btn('Revenir dessus')) + line('<b>dev-review</b> : tests ciblés seulement <span style="' + muted + '">· ta règle « tests ciblés »</span>', btn('Revenir dessus')))}
        ${sect('Dans les rigs', line(flag + ' <b>factory</b> · le candidat 3f2a1c0 est en relecture chez review-a, qa vérifie la reprise.', btn('Voir les 6 échanges')) + line(flag + ' <b>starter</b> · deux remarques mineures, dev-build corrige.', btn('Voir 1 échange')))}`;
      const chat = scroll(`
        <div style="display:flex;gap:8px;flex-wrap:wrap">${['3 à toi', '2 rigs au travail', '3 tranchées aujourd’hui', 'Noyau au repos'].map((t, i) => `<button type="button" class="st-qa" style="${i === 0 ? 'color:var(--danger-text);' : ''}">${t}</button>`).join('')}</div>
        ${ledgeMsg('<span style="' + muted + '">Point de 15:30 · 2 décisions tranchées, rien pour toi.</span> <button type="button" class="st-qa">Déplier</button>', '· 15:30')}
        ${ledgeMsg(digest, '· 16:45')}
        ${meMsg('Pourquoi review-b a été relancé ?', '· 16:46')}
        ${ledgeMsg('Il approchait 82 % de contexte. L’operator l’a relevé ; la relève a repris sa revue là où elle en était.', '· 16:46')}`);
      body.innerHTML = `<div id="chatcol" style="display:flex;flex-direction:column;height:100%;min-height:0">${chat}</div>`;
      $('#chatcol').appendChild(composer);
    }
  }, variant);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/c-${variant}.png` });
}

test('ledge chat A', async ({ page }) => { await ledgeVariant(page, 'A'); });
test('ledge chat B', async ({ page }) => { await ledgeVariant(page, 'B'); });
test('ledge chat C', async ({ page }) => { await ledgeVariant(page, 'C'); });

/** Sidebar proposals for Ledge's own entry, over the atelier. */
async function sideVariant(page: Page, variant: '1' | '2' | '3') {
  await boot(page, rigFleet, { projects, teams, roles: { '/w/ledge': { roles, templates, problems: [] } } });
  await rigSidebar(page);
  await page.locator('aside').first().getByRole('button', { name: /^Atelier/ }).click();
  await page.waitForTimeout(1500);
  await atelier(page);
  await page.evaluate(v => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
    const aside = $('aside.sidebar');
    const ask = $('.st-ask', aside);
    const mascot = $('.st-mascot', ask).outerHTML;
    const brand = '<span class="st-ledge-brand">Ledge<span class="brand-dot">.</span></span>';
    const muted = 'color:var(--muted-foreground)';
    const badge = (n: string) => `<b class="st-badge">${n}</b>`;
    const attn = $('section.st-attn', aside);
    if (v === '1') {
      // Une conversation épinglée : Ledge comme un fil de messagerie, son dernier mot en aperçu. Le champ part dans l'écran Ledge (/).
      ask.removeAttribute('class');
      ask.style.cssText = 'margin:8px 8px 4px;padding:10px 10px;border-radius:var(--radius-lg);background:var(--sidebar-accent);display:flex;flex-direction:column;gap:8px';
      ask.innerHTML = `<button type="button" style="all:unset;cursor:pointer;display:flex;gap:10px;align-items:center">${mascot}<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="display:flex;align-items:center;gap:6px">${brand}<span style="flex:1"></span><small class="mono" style="font-size:11px;${muted}">16:44</small>${badge('1')}</span><small style="font-size:12.5px;line-height:17px;${muted};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">Une décision d’architecture t’attend. J’ai tranché pour build : merge, pas de rebase.</small></span></button>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${['2 rigs au travail', '3 tranchées', 'Noyau au repos'].map(t => `<span style="font-size:11.5px;padding:2px 8px;border-radius:9999px;border:1px solid var(--sidebar-border);${muted}">${t}</span>`).join('')}</div>`;
    }
    if (v === '2') {
      // Ledge absorbe « À toi » : ce que Ledge te remonte, puis ce que tes sessions seules demandent.
      ask.removeAttribute('class');
      ask.style.cssText = 'margin:8px 8px 4px;padding:10px;border-radius:var(--radius-lg);border:1px solid var(--sidebar-border);display:flex;flex-direction:column;gap:8px';
      const cards = $$('.st-card', attn);
      ask.innerHTML = `<button type="button" style="all:unset;cursor:pointer;display:flex;gap:10px;align-items:center">${mascot}<span style="flex:1;min-width:0;display:flex;flex-direction:column"><span>${brand}</span><small style="font-size:12px;${muted}">orchestre 2 rigs · 3 tranchées</small></span><kbd class="mono">/</kbd></button>
        <div id="viaLedge" style="display:flex;flex-direction:column;gap:2px"><div class="st-label" style="padding:0 2px"><span>Ledge te demande</span>${badge('1')}</div></div>
        <div id="solo" style="display:flex;flex-direction:column;gap:2px"><div class="st-label" style="padding:0 2px"><span>Tes sessions</span>${badge('2')}<span class="st-fill"></span><kbd class="mono">Alt ↓</kbd></div></div>`;
      $('#viaLedge', ask).appendChild(cards[0]);
      cards.slice(1).forEach(c => $('#solo', ask).appendChild(c));
      attn.remove();
    }
    if (v === '3') {
      // Ledge en bas, comme un dock de chat toujours ouvert ; le haut de la barre commence par « À toi ».
      ask.remove();
      const dock = document.createElement('div');
      dock.style.cssText = 'border-top:1px solid var(--sidebar-border);padding:10px 10px 8px;display:flex;flex-direction:column;gap:8px;background:var(--sidebar)';
      dock.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start">${mascot}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="display:flex;align-items:center;gap:6px">${brand}<small style="font-size:11.5px;${muted}">orchestre 2 rigs</small><span style="flex:1"></span>${badge('1')}</span><span style="font-size:12.5px;line-height:17px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">J’ai tranché pour build : merge, pas de rebase. Une question d’architecture t’attend.</span></div></div>
        <div style="display:flex;gap:6px;align-items:center"><input class="ledge-field" placeholder="Écrire à Ledge…" style="flex:1;min-width:0;height:32px;padding:0 10px;background:var(--well);color:inherit;border:1px solid var(--input);border-radius:var(--radius-md);font-size:13px"><kbd class="mono">/</kbd></div>`;
      const foot = $('.st-foot', aside);
      foot.before(dock);
    }
  }, variant);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/s-${variant}.png` });
}
test('side 1', async ({ page }) => { await sideVariant(page, '1'); });
test('side 2', async ({ page }) => { await sideVariant(page, '2'); });
test('side 3', async ({ page }) => { await sideVariant(page, '3'); });

/** Variants of the pinned-conversation Ledge entry. */
async function pinVariant(page: Page, variant: 'a' | 'b' | 'c' | 'd') {
  await boot(page, rigFleet, { projects, teams, roles: { '/w/ledge': { roles, templates, problems: [] } } });
  await rigSidebar(page);
  await page.locator('aside').first().getByRole('button', { name: /^Atelier/ }).click();
  await page.waitForTimeout(1500);
  await atelier(page);
  await page.evaluate(v => {
    const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;
    const aside = $('aside.sidebar');
    const ask = $('.st-ask', aside);
    const mascotSvg = $('.st-mascot svg', ask).outerHTML;
    const mascot = (size: number) => `<span style="flex-shrink:0;width:${size}px;height:${size}px;display:grid;place-items:center">${mascotSvg.replace(/width="[^"]*"/, `width="${size}"`).replace(/height="[^"]*"/, `height="${size}"`)}</span>`;
    const brand = '<span class="st-ledge-brand">Ledge<span class="brand-dot">.</span></span>';
    const muted = 'color:var(--muted-foreground)';
    const badge = (n: string) => `<b class="st-badge">${n}</b>`;
    const time = (t: string) => `<small class="mono" style="font-size:11px;${muted}">${t}</small>`;
    const clamp = (n: number) => `display:-webkit-box;-webkit-line-clamp:${n};-webkit-box-orient:vertical;overflow:hidden`;
    ask.removeAttribute('class');
    if (v === 'a') {
      // Une ligne de messagerie, rien de plus : avatar, nom, aperçu d'une ligne, heure, non-lus.
      ask.style.cssText = 'margin:8px 8px 2px;padding:8px 10px;border-radius:var(--radius-md);background:var(--sidebar-accent)';
      ask.innerHTML = `<button type="button" style="all:unset;cursor:pointer;display:flex;gap:10px;align-items:center;width:100%">${mascot(28)}<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px"><span style="display:flex;align-items:center;gap:6px">${brand}<span style="flex:1"></span>${time('16:44')}</span><span style="display:flex;align-items:center;gap:6px"><small style="flex:1;min-width:0;font-size:12.5px;${muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Une décision t’attend · factory</small>${badge('1')}</span></span></button>`;
    }
    if (v === 'b') {
      // La mascotte parle : son dernier mot dans une bulle, comme au bureau de l'atelier.
      ask.style.cssText = 'margin:10px 8px 4px;padding:4px 4px 8px;display:flex;flex-direction:column;gap:6px';
      ask.innerHTML = `<div style="position:relative;margin-left:44px;padding:9px 12px;border-radius:12px 12px 12px 4px;background:var(--sidebar-accent);font-size:12.5px;line-height:17px"><span style="${clamp(3)}">J’ai tranché pour build : merge, pas de rebase. <b style="font-weight:600">Une question d’architecture t’attend.</b></span><span style="position:absolute;left:-6px;bottom:0;width:12px;height:12px;background:var(--sidebar-accent);clip-path:polygon(100% 0,100% 100%,0 100%)"></span></div>
        <div style="display:flex;align-items:center;gap:8px">${mascot(36)}<span style="display:flex;flex-direction:column">${brand}<small style="font-size:11.5px;${muted}">16:44 · orchestre 2 rigs</small></span><span style="flex:1"></span>${badge('1')}<kbd class="mono">/</kbd></div>`;
    }
    if (v === 'c') {
      // L'aperçu est la question elle-même, avec ses réponses : on tranche sans ouvrir Ledge.
      ask.style.cssText = 'margin:8px 8px 4px;padding:10px;border-radius:var(--radius-lg);background:var(--sidebar-accent);box-shadow:inset 3px 0 0 var(--warning);display:flex;flex-direction:column;gap:8px';
      ask.innerHTML = `<div style="display:flex;gap:10px;align-items:center">${mascot(26)}${brand}<span style="flex:1"></span>${time('16:44')}${badge('1')}</div>
        <div style="font-size:12.5px;line-height:17px"><span style="font-size:11px;font-weight:600;color:var(--warning);background:var(--status-warning-soft);padding:1px 5px;border-radius:5px;margin-right:4px">Architecture</span>orch-lead : JSON ou SQLite pour les sessions ? <span style="${muted}">Mon avis : SQLite.</span></div>
        <div style="display:flex;gap:6px"><button type="button" class="st-qa pri">SQLite</button><button type="button" class="st-qa">JSON</button><span style="flex:1"></span><button type="button" class="st-qa">Ouvrir</button></div>`;
    }
    if (v === 'd') {
      // Un mini-fil : les trois derniers mots de Ledge, du plus récent au plus ancien.
      ask.style.cssText = 'margin:8px 8px 4px;padding:10px;border-radius:var(--radius-lg);background:var(--sidebar-accent);display:flex;flex-direction:column;gap:8px';
      const line = (t: string, txt: string, strong = false) => `<div style="display:flex;gap:8px;font-size:12.5px;line-height:17px">${time(t)}<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${strong ? '' : muted}">${txt}</span></div>`;
      ask.innerHTML = `<div style="display:flex;gap:10px;align-items:center">${mascot(26)}${brand}<small style="font-size:11.5px;${muted}">orchestre 2 rigs</small><span style="flex:1"></span>${badge('1')}</div>
        <div style="display:flex;flex-direction:column;gap:4px;padding-left:2px">${line('16:44', '<b style="font-weight:600">Pour toi</b> · JSON ou SQLite ? (factory)', true)}${line('16:38', 'Tranché : merge, pas de rebase (build)')}${line('16:20', 'operator a relancé review-b')}</div>`;
    }
  }, variant);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/shots/s1${variant}.png`, clip: { x: 0, y: 0, width: 400, height: 760 } });
}
for (const v of ['a', 'b', 'c', 'd'] as const) test(`pin ${v}`, async ({ page }) => { await pinVariant(page, v); });

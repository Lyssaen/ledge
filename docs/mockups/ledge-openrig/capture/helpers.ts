import { type Page } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/desktop/node_modules/@playwright/test/index.js';
import { fakeDaemon, session } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/desktop/e2e/daemon';
const S = '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/capture';

export const projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'website', name: 'Website', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/website' }] },
    { id: 'factory', name: 'factory', color: 'amber', description: '', repos: [{ machine: 'local', path: '/rigs/factory' }] },
    { id: 'starter', name: 'starter', color: 'teal', description: '', repos: [{ machine: 'local', path: '/rigs/starter' }] },
    { id: 'openrig', name: 'Noyau OpenRig', color: 'slate', description: '', repos: [{ machine: 'local', path: '/home/me/.openrig' }] }
  ],
  rules: []
} as never;

const soon = new Date(Date.now() + 120_000).toISOString();
export const f = (id: string, name: string, tool: 'claude' | 'codex', state: string, topic: string, extra = {}) =>
  session(id, { name, tool, project: 'factory', cwd: '/rigs/factory', branch: 'feat/rigs', state: state as never, topic, ...extra });

export const fleet = [
  session('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', state: 'waiting_permission', branch: 'release/LEDGE-42-v0.5.0', topic: 'Préparer la release', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } }),
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'fix/LEDGE-42-ssh-reconnect', topic: 'Reconnexion ssh du fleet' }),
  session('luna', { name: 'Luna', project: 'website', cwd: '/w/website', state: 'waiting_input', branch: 'feat/WEB-18-homepage', topic: 'Nouvelle page d’accueil', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' } }),
  session('milo', { name: 'Milo', project: 'website', cwd: '/w/website', state: 'working', branch: 'fix/WEB-18-mobile-layout', topic: 'Mise en page mobile' }),
  f('lead', 'orch-lead', 'claude', 'working', 'Mener le rig factory'),
  f('build', 'build', 'claude', 'working', 'Reprise après reboot', { lastMessage: { id: 'm1', to: 'review-a', peer: 'reva', summary: 'Candidat prêt, 3f2a1c0', at: soon } }),
  f('reva', 'review-a', 'codex', 'working', 'Relire 3f2a1c0'),
  f('revb', 'review-b', 'codex', 'idle', 'Seconde revue'),
  f('qa', 'qa', 'claude', 'working', 'Vérifier la reprise'),
  f('design', 'design', 'claude', 'idle', 'Maquettes de l’encoche'),
  session('sbuild', { name: 'dev-build', tool: 'claude', project: 'starter', cwd: '/rigs/starter', branch: 'fix/notch', state: 'working', topic: 'Corriger l’encoche' }),
  session('srev', { name: 'dev-review', tool: 'codex', project: 'starter', cwd: '/rigs/starter', branch: 'fix/notch', state: 'idle', topic: 'Relecture' }),
  session('op', { name: 'operator', tool: 'codex', project: 'openrig', cwd: '/home/me/.openrig', state: 'idle', topic: 'Fait tourner OpenRig' }),
  session('queue', { name: 'queue', tool: 'codex', project: 'openrig', cwd: '/home/me/.openrig', state: 'idle', topic: 'Range le flux en tâches' })
];

/** Rewrites the real sidebar: one more request in « À toi » (a rig decision Ledge passed up), and the rigs moved from Projets to a Rigs section. */
export async function sidebar(page: Page) {
  await page.evaluate(() => {
    const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement;
    const $$ = (sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as HTMLElement[];
    $('.st-ledge-line').textContent = '3 à toi · 2 rigs · 3 tranchées par Ledge';
    const attn = $('section.st-attn');
    const luna = $$('.st-card', attn)[0];
    const card = luna.cloneNode(true) as HTMLElement;
    $('.st-name', card).textContent = 'orch-lead';
    const where = $('.st-where', card); ($('i', where)).style.background = 'rgb(245, 158, 11)'; where.lastChild!.textContent = 'factory';
    $('.st-time', card).textContent = '4 min';
    const req = $('.st-req', card); req.textContent = 'Architecture · JSON ou SQLite ?';
    const l2 = $('.st-l2', card); $$('button', l2).forEach(b => b.remove());
    const b1 = document.createElement('button'); b1.className = 'st-qa pri'; b1.textContent = 'SQLite';
    const b2 = document.createElement('button'); b2.className = 'st-qa'; b2.textContent = 'JSON';
    l2.append(b1, b2);
    luna.before(card);
    $('.st-badge', attn).textContent = '3';

    const projSec = $('section[aria-label="Projets"]');
    const rigsSec = projSec.cloneNode(true) as HTMLElement;
    rigsSec.setAttribute('aria-label', 'Rigs');
    $('.st-label span', rigsSec).textContent = 'Rigs';
    const icons = $$('.st-label .st-icon', rigsSec);
    icons.slice(0, -1).forEach(i => i.remove());
    icons.at(-1)!.title = 'Lancer un rig';
    const tree = $('[role="tree"]', rigsSec); tree.innerHTML = '';
    const rows = $$('[role="treeitem"]', projSec);
    const start = rows.findIndex(r => r.querySelector('[data-tree-key="p:factory"]'));
    rows.slice(start).forEach(r => tree.appendChild(r));
    const meta: Record<string, string> = { 'p:factory': 'rig · 6', 'p:starter': 'rig · 2', 'p:openrig': 'noyau' };
    for (const [k, v] of Object.entries(meta)) {
      const main = $(`[data-tree-key="${k}"]`, tree);
      const s = document.createElement('span');
      s.textContent = v; s.style.cssText = 'margin-left:6px;font:500 11px var(--font-mono, monospace);color:var(--muted-foreground)';
      main.appendChild(s);
    }
    projSec.after(rigsSec);
    $$('.st-row.st-more').forEach(r => r.remove());
    const wait = document.querySelector('[aria-label$="ouvrir la première"]');
    if (wait) { const t = [...wait.childNodes].reverse().find(n => n.textContent?.trim() === '2'); if (t) t.textContent = '3'; }
  });
}

export async function atelier(page: Page) {
  await page.evaluate(() => {
    const bubble = document.querySelector('.ledge-bubble')!;
    bubble.firstChild!.textContent = 'J’orchestre 2 rigs · 1 décision pour toi.';
    document.querySelector('.ledge-desk small')!.textContent = 'Orchestrateur OpenRig';
    const counts: Record<string, string> = { factory: 'rig · 6 sièges', starter: 'rig · 2 sièges', openrig: 'noyau OpenRig · 2 sièges' };
    for (const [room, text] of Object.entries(counts)) {
      const el = document.querySelector(`[data-room="${room}"] .plaque-counts`);
      if (el) el.textContent = text;
    }
  });
}

export async function home(page: Page) {
  await page.evaluate(() => {
    const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement;
    const $$ = (sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as HTMLElement[];
    $('.home-sub').textContent = 'Orchestrateur OpenRig · 2 rigs, 8 agents · 4 sessions seules · tranche dans son mandat';
    const tabs = $$('.home-tabs [role="tab"]');
    tabs[1].textContent = 'Rigs · 2'; tabs[2].textContent = 'Tranché · 3';
    const cols = $$('.lp-col');
    const rowTpl = $('.lp-row', cols[0]);
    const mk = (strong: string, text: string, btns: [string, boolean][]) => {
      const r = rowTpl.cloneNode(true) as HTMLElement;
      $('.lp-text', r).innerHTML = `<strong>${strong}</strong> ${text}`;
      $$('button', r).forEach(b => b.remove());
      for (const [label, pri] of btns) { const b = document.createElement('button'); b.className = pri ? 'st-qa pri' : 'st-qa'; b.textContent = label; r.appendChild(b); }
      return r;
    };
    cols[0].insertBefore(mk('orch-lead', 'JSON ou SQLite ?', [['SQLite', true], ['JSON', false]]), $('.lp-row', cols[0]));
    $('h3 .st-badge', cols[0]).textContent = '3';
    $('h3', cols[1]).textContent = 'Rigs';
    $('.lp-none', cols[1]).replaceWith(mk('factory', 'feat/rigs · 4 au travail', [['Table', false]]), mk('starter', 'fix/notch · 1 au travail', [['Table', false]]));
    $('h3', cols[2]).textContent = 'Tranché par Ledge';
    $('.lp-none', cols[2]).replaceWith(mk('build', 'merge, pas de rebase', [['Revenir', false]]), mk('dev-review', 'tests ciblés', [['Revenir', false]]), mk('operator', 'starter relancé', [['Voir', false]]));
    const empty = $('[data-chat-empty]');
    $('strong', empty).textContent = 'Je tiens les rigs.';
    $('strong + span', empty).textContent = 'J’orchestre factory et starter et je tranche dans mon mandat. Le design, l’architecture et le critique te reviennent.';
    const chips = $$('.ledge-recent > span:first-child', empty);
    ['Où en est factory ?', 'Qu’as-tu tranché aujourd’hui ?', 'Lance un rig pour corriger le build Windows'].forEach((t, i) => chips[i].textContent = t);
    const sugg = $$('.home-suggestions button');
    ['Lance un rig…', 'Où en est factory ?', 'Qu’as-tu tranché ?', 'Qui a besoin de moi ?'].forEach((t, i) => sugg[i].textContent = t);
    $('.home-readonly').textContent = 'tranche dans son mandat · design, architecture et critique te reviennent';
  });
}


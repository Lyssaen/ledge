import React, { useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot } from '../../../packages/ui/src/bots/Bot';
import { Icon, ICONS } from '../../../packages/ui/src/ui/icons';
import type { BotState } from '../../../packages/ui/src/bots/poseFor';

/* The « Projets » section of the sidebar (Tree.tsx, sidebar.css), today and with the eye as the projects' filter. */

const EYE_OFF = ['M9.9 9.9a3 3 0 1 0 4.2 4.2', 'M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7', 'M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M2 2l20 20'];
const DENSE = ['M4 4h16', 'M4 8h16', 'M4 12h16', 'M4 16h16', 'M4 20h16'];
const FOLD = ['m7 20 5-5 5 5', 'm7 4 5 5 5-5'];
const COLORS = { green: '#10b981', slate: '#64748b', blue: '#3b82f6', amber: '#f59e0b', violet: '#8b5cf6', pink: '#ec4899' } as const;

type State = 'working' | 'idle' | 'waiting_input' | 'exited';
interface S { name: string; tool: 'claude' | 'codex'; state: State; task: string; when: string }
interface P { id: string; name: string; color: keyof typeof COLORS; sub?: string; sessions: S[] }

const PROJECTS: P[] = [
  { id: 'ledge', name: 'Ledge', color: 'green', sub: 'ledge · main', sessions: [
    { name: 'Pim', tool: 'claude', state: 'working', task: 'Est-ce que tu peux clarifier le menu ?', when: '7 min' },
    { name: 'Max', tool: 'claude', state: 'idle', task: 'Relire la maquette OMP', when: '12 min' },
    { name: 'Rex', tool: 'codex', state: 'exited', task: 'Corriger l’alignement compact', when: '2 h' },
    { name: 'Eli', tool: 'codex', state: 'exited', task: 'Revue de la PR #181', when: '3 h' }
  ] },
  { id: 'review', name: 'Review', color: 'slate', sessions: [{ name: 'Otto', tool: 'claude', state: 'waiting_input', task: 'Tu sais m’expliquer la règle ?', when: '21 min' }] },
  { id: 'pay', name: 'Payment Service', color: 'blue', sub: 'api · checkout', sessions: [{ name: 'Zoe', tool: 'claude', state: 'idle', task: 'Regarder l’umbrella', when: '1 h' }] },
  { id: 'paper', name: 'Paper Channel', color: 'amber', sub: 'portfolio · main', sessions: [{ name: 'Luna', tool: 'claude', state: 'exited', task: 'Décliner la nouvelle identité', when: '1 j' }] },
  { id: 'factory', name: 'Software Factory', color: 'violet', sessions: [] },
  { id: 'doccle', name: 'Doccle Channel', color: 'pink', sessions: [] }
];
/** Nobody at work anywhere: what « actifs » shows when no project qualifies. */
const QUIET: P[] = PROJECTS.map(p => ({ ...p, sessions: p.sessions.filter(s => s.state === 'exited') }));

type Mode = 'today' | 'active' | 'all';
const live = (s: S) => s.state !== 'exited';
/** Today's « terminée » (isFinished): exited, or idle with no subagent at work. */
const finishedToday = (s: S) => s.state === 'exited' || s.state === 'idle';
const theme = (): 'light' | 'dark' => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const pose: Record<State, BotState> = { working: 'working', idle: 'idle', waiting_input: 'question', exited: 'done' };

function SessionRow({ s, done, sel }: { s: S; done: boolean; sel?: boolean }) {
  return (
    <div role="treeitem" aria-level={2} aria-selected={!!sel} className={'st-row st-agent' + (sel ? ' sel' : '') + (done ? ' done' : '')} style={{ '--d': 1 } as CSSProperties}>
      <span className="st-gap" />
      <span className="st-bot"><Bot theme={theme()} tool={s.tool} state={pose[s.state]} size={18} seed={s.name} /></span>
      <button type="button" className="st-main"><strong>{s.name}</strong><span>{s.task}</span></button>
      <span className={'st-time' + (s.state === 'waiting_input' ? ' t-question' : '')}>{s.when}</span>
    </div>
  );
}

function More({ text, depth, mark }: { text: string; depth: number; mark?: boolean }) {
  return (
    <div className={'st-row st-more' + (mark ? ' mk-more-projects' : '')} style={{ '--d': depth } as CSSProperties}>
      <span className="st-gap" />
      <button type="button" aria-expanded={false}>{text}</button>
    </div>
  );
}

function ProjectRow({ p, open, tally }: { p: P; open: boolean | null; tally: Array<[string, number]> }) {
  return (
    <div role="treeitem" aria-level={1} aria-expanded={open ?? undefined} className="st-row st-project" style={{ '--d': 0 } as CSSProperties}>
      {open === null ? <span className="st-gap" /> : <button type="button" className="st-chev"><span className={open ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={12} /></span></button>}
      <i className="side-swatch" style={{ background: COLORS[p.color] }} />
      <button type="button" className="st-main"><strong>{p.name}</strong>{p.sub && <span className="mono">{p.sub}</span>}</button>
      <span className="st-tally">{tally.map(([c, n]) => <span key={c} className={c}><i />{n}</span>)}</span>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function Projects({ mode, dense, projects = PROJECTS }: { mode: Mode; dense: boolean; projects?: P[] }) {
  const pressed = mode !== 'all';
  const shown = projects.filter(p => mode === 'all' ? true : mode === 'today' ? p.sessions.length > 0 : p.sessions.some(live));
  const hidden = projects.length - shown.length;
  const label = mode === 'today' ? 'Masquer les sessions terminées (H)' : 'Seulement les projets avec un agent actif (H)';
  const rows: ReactNode[] = [];
  for (const p of shown) {
    const need = p.sessions.filter(s => s.state === 'waiting_input').length, work = p.sessions.filter(s => s.state === 'working').length;
    const done = p.sessions.filter(s => (mode === 'today' ? finishedToday(s) : s.state === 'exited')).length;
    const tally: Array<[string, number]> = [['t-need', need], ['t-work', work], ['t-done', mode === 'all' ? done : 0]].filter(([, n]) => (n as number) > 0) as Array<[string, number]>;
    const has = p.sessions.length > 0;
    rows.push(<ProjectRow key={p.id} p={p} open={has ? true : null} tally={tally} />);
    if (!has) continue;
    const hide = (s: S) => mode === 'today' ? finishedToday(s) : mode === 'active' ? s.state === 'exited' : false;
    for (const s of p.sessions.filter(s => !hide(s))) rows.push(<SessionRow key={p.id + s.name} s={s} done={mode === 'today' ? finishedToday(s) : s.state === 'exited'} sel={s.name === 'Pim'} />);
    const n = p.sessions.filter(hide).length;
    if (n > 0) rows.push(<More key={p.id + 'more'} depth={1} text={`+${plural(n, 'terminée', 'terminées')}`} />);
  }
  return (
    <aside className="sidebar st mk-sidebar">
      <div className="st-scroll">
        <section aria-label="Projets">
          <div className="st-label">
            <span>Projets</span><span className="st-fill" />
            <span className="mk-eye-wrap">
              <button type="button" className={'st-icon' + (pressed ? ' on' : '')} aria-pressed={pressed} aria-label={label} title={label}><Icon d={EYE_OFF} size={14} /></button>
            </span>
            <button type="button" className={'st-icon' + (dense ? ' on' : '')} aria-pressed={dense}><Icon d={DENSE} size={14} /></button>
            <button type="button" className="st-icon"><Icon d={FOLD} size={14} /></button>
            <button type="button" className="st-icon"><Icon d={ICONS.plus.d} size={14} /></button>
          </div>
          {mode === 'active' && shown.length === 0
            ? <div className="st-empty" role="status">
                <strong>Aucun agent actif.</strong>
                <p>Aucun projet n’a d’agent en marche. H affiche tous les projets.</p>
                <button type="button" className="st-empty-btn">Afficher tous les projets</button>
              </div>
            : <div role="tree" aria-label="Projets et sessions" className={'st-tree' + (dense ? ' st-dense' : '')}>
                {rows}
                {mode === 'active' && hidden > 0 && <More depth={0} mark text={`+${plural(hidden, 'projet', 'projets')} sans agent actif`} />}
              </div>}
        </section>
      </div>
    </aside>
  );
}

function Panel({ title, sub, children, rec, eye }: { title: string; sub: string; children: ReactNode; rec?: boolean; eye: string }) {
  return (
    <figure className="mk-panel">
      <figcaption><strong>{title}</strong><span className={'mk-badge' + (rec ? '' : ' was')}>{rec ? 'proposé' : 'actuel'}</span><span>{sub}</span></figcaption>
      {children}
      <p className="mk-eye-note"><b>Œil</b> · {eye}</p>
    </figure>
  );
}

function App() {
  const read = (k: string) => new URLSearchParams(location.hash.slice(1)).get(k);
  const [th, setTh] = useState<'dark' | 'light'>((read('theme') as 'dark' | 'light') ?? 'dark');
  const [dense, setDense] = useState(read('dense') === '1');
  document.documentElement.dataset.theme = th;
  React.useEffect(() => { history.replaceState(null, '', `#theme=${th}&dense=${dense ? 1 : 0}`); }, [th, dense]);
  return (
    <div className="mk">
      <header className="mk-bar">
        <strong>Maquette · l’œil de « Projets »</strong>
        <span className="mk-fill" />
        <div className="mk-seg" role="radiogroup" aria-label="Lignes">
          <button type="button" role="radio" aria-checked={!dense} onClick={() => setDense(false)}>Confortable</button>
          <button type="button" role="radio" aria-checked={dense} onClick={() => setDense(true)}>Compact</button>
        </div>
        <div className="mk-seg" role="radiogroup" aria-label="Thème">
          <button type="button" role="radio" aria-checked={th === 'dark'} onClick={() => setTh('dark')}>Sombre</button>
          <button type="button" role="radio" aria-checked={th === 'light'} onClick={() => setTh('light')}>Clair</button>
        </div>
      </header>
      <main className="mk-main">
        <div className="mk-panels">
          <Panel title="Aujourd’hui" sub="œil enfoncé : sessions terminées masquées" eye="« Masquer les sessions terminées (H) », aria-pressed=true"><Projects mode="today" dense={dense} /></Panel>
          <Panel title="Après · œil enfoncé" sub="seulement les projets avec un agent actif" rec eye="« Seulement les projets avec un agent actif (H) », aria-pressed=true"><Projects mode="active" dense={dense} /></Panel>
          <Panel title="Après · œil relâché" sub="tous les projets" rec eye="même libellé, aria-pressed=false"><Projects mode="all" dense={dense} /></Panel>
          <Panel title="Après · aucun agent actif" sub="œil enfoncé, rien à montrer" rec eye="enfoncé ; le bouton de la boîte le relâche"><Projects mode="active" dense={dense} projects={QUIET} /></Panel>
        </div>
        <section className="mk-cards">
          <div className="mk-card">
            <p className="mk-kicker">Ce qui change</p>
            <h3>L’œil filtre les projets, plus les sessions</h3>
            <ul>
              <li><b>Œil enfoncé</b> (par défaut, comme aujourd’hui) : seulement les projets qui ont <b>au moins un agent actif</b>. En dessous, une ligne <b>« +3 projets sans agent actif »</b> dit ce qui est caché ; un clic relâche l’œil.</li>
              <li><b>Œil relâché</b> : <b>tous les projets</b> du registre de Ledge (ceux de la page Projets), y compris ceux qui n’ont aucune session : ils s’affichent sans chevron, comme aujourd’hui pendant un glisser-déposer. Rien n’est cherché sur le disque. « Sans projet » n’apparaît que s’il a des sessions, comme aujourd’hui.</li>
              <li><b>Agent actif</b> = une session ni terminée (<code>exited</code>) ni archivée : au travail, en attente d’accord ou de réponse, en erreur, inactive ou hors ligne. Une session <b>inactive compte</b> : l’agent est là et peut reprendre.</li>
              <li><b>Sièges de rig</b> (OMP arrêtés compris) : jamais dans « Projets », qui les exclut déjà ; ils vivent dans la vue « Rigs ». La règle ne les concerne pas.</li>
              <li><b>Dans un projet affiché</b> : en mode « actifs », ses sessions terminées restent repliées derrière « +N terminées », la ligne qui existe déjà. Une session inactive n’y est plus repliée. En mode « tous », tout est déplié, et le compteur gris des terminées revient sur la ligne du projet, comme aujourd’hui œil relâché.</li>
              <li><b>Même état, même touche</b> : la préférence <code>hideDone</code> (enregistrée, vraie par défaut) et la touche <b>H</b> deviennent ce filtre. Pas de nouveau réglage, pas de refonte.</li>
              <li><b>Accessibilité</b> : bouton à bascule, libellé fixe « Seulement les projets avec un agent actif (H) », état porté par <code>aria-pressed</code> (true = filtre actif). Infobulle = libellé. La ligne « +N projets… » est une ligne de l’arbre, que les flèches atteignent comme « +N terminées ».</li>
            </ul>
          </div>
          <div className="mk-card">
            <h3>Ce qui se perd</h3>
            <ul>
              <li>Replier les sessions <b>inactives</b> d’un projet. Aujourd’hui, l’œil range une session inactive avec les terminées ; demain, elle reste visible, puisqu’elle compte comme agent actif. Pour la ranger : l’archiver (E).</li>
              <li>Voir tous les projets <b>tout en</b> repliant les terminées : en mode « tous », tout est déplié.</li>
            </ul>
          </div>
          <div className="mk-card">
            <h3>À trancher</h3>
            <ul>
              <li>« Agent actif » inclut-il bien un agent <b>inactif</b> (au repos, prêt à reprendre) ? C’est ma recommandation. Sinon, « actif » voudrait dire « au travail ou en attente », et Payment Service (Zoe, inactive) disparaîtrait en mode enfoncé.</li>
              <li>Une session <b>hors ligne</b> (machine injoignable) compte comme active : ce qu’on ne voit pas n’est pas fini. À confirmer.</li>
            </ul>
          </div>
        </section>
        <section className="mk-card mk-texts">
          <h3>Textes FR / EN</h3>
          <table><tbody>
            {[
              ['side.hideDone (remplacé)', 'Seulement les projets avec un agent actif (H)', 'Only projects with a live agent (H)'],
              ['side.showDone', 'retiré (inutilisé aujourd’hui)', 'removed (unused today)'],
              ['side.moreProjects(n)', '+N projet(s) sans agent actif', '+N project(s) with no live agent'],
              ['side.empty.noActive', 'Aucun agent actif.', 'No live agent.'],
              ['side.empty.noActiveBody', 'Aucun projet n’a d’agent en marche. H affiche tous les projets.', 'No project has an agent running. H shows every project.'],
              ['side.empty.showAll', 'Afficher tous les projets', 'Show every project'],
              ['side.moreDone(n) (inchangé)', '+N terminée(s)', '+N finished']
            ].map(([k, fr, en]) => <tr key={k}><td><code>{k}</code></td><td>{fr}</td><td>{en}</td></tr>)}
          </tbody></table>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot, type BotProps } from '../bots/Bot';
import type { BotState } from '../bots/poseFor';
import { useUiCopy } from '../i18n/copy';
import { LogoBot } from './LogoBot';
import '../styles/tokens.css';
import '../bots/bots.css';
import './mascots.css';
import './mascots-logos.css';

const FAMILY: { tool: BotProps['tool']; name: string; title: string; detail: string; source: string }[] = [
  { tool: 'claude', name: 'Claude Code', title: 'Clawd, version Ledge', detail: 'Le corps en pixels, les pattes et les petits bras de Clawd. La visière et les yeux arrondis de Ledge, sans changer sa silhouette.', source: 'https://github.com/Vvkmnn/clawd' },
  { tool: 'codex', name: 'Codex', title: 'Le nuage terminal', detail: 'Le nuage de l’app Codex accueille la visière et le regard expressif de Ledge.', source: 'https://openai.com/index/introducing-the-codex-app/' },
  { tool: 'cursor', name: 'Cursor', title: 'Le cube adouci', detail: 'Le volume du logo, avec des coins arrondis, des facettes douces et une visière Ledge. Un petit cube moins anguleux, plus accueillant.', source: 'https://cursor.com/brand' },
  { tool: 'omp', name: 'omp', title: 'Le petit pi', detail: 'La barre du π porte la visière. Ses deux jambes restent asymétriques.', source: 'https://omp.sh/' }
];
const STATES: BotState[] = ['starting', 'working', 'approval', 'question', 'idle', 'error', 'done', 'readonly'];
const SIZES = [12, 16, 20, 22, 32, 48, 92];

function LogoStudy() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [state, setState] = useState<BotState>('working');
  const [tool, setTool] = useState<BotProps['tool']>('claude');
  const [branded, setBranded] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [nod, setNod] = useState(0);
  const copy = useUiCopy();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const shared = { theme, state, reducedMotion: reduced, frozen, nodKey: nod, askKey: state };
  const selected = FAMILY.find(item => item.tool === tool)!;

  return <main className="logo-study">
    <header>
      <a className="wordmark" href="/mascots.html">ledge<span>.</span></a>
      <span className="eyebrow">Étude visuelle · non appliquée</span>
      <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</button>
    </header>
    <section className="study-intro">
      <p className="eyebrow">Même famille. Un peu plus de leur identité.</p>
      <h1>Et si les logos prenaient vie ?</h1>
      <p>Les bots actuels restent intacts. En dessous, quatre propositions qui reprennent les signes des harnesses, avec les visages et les matières de Ledge.</p>
      <a className="original-link" href="/mascots.html">Voir la version existante →</a>
    </section>
    <section className="controls" aria-label="Contrôles de la proposition">
      <label>Expression <select value={state} onChange={e => setState(e.target.value as BotState)}>{STATES.map(s => <option key={s} value={s}>{copy.stateLabel[s]}</option>)}</select></label>
      <label><input type="checkbox" checked={branded} onChange={e => setBranded(e.target.checked)} /> Teintes des logos</label>
      <label><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /> Mouvements réduits</label>
      <label><input type="checkbox" checked={frozen} onChange={e => setFrozen(e.target.checked)} /> Connexion perdue</label>
      <button onClick={() => setNod(n => n + 1)} disabled={reduced || frozen || state === 'readonly' || state === 'done'}>Acquiescer</button>
    </section>
    <section className="comparison-grid" aria-label="Bots actuels et propositions inspirées des logos">
      {FAMILY.map(item => <article key={item.tool}>
        <h2>{item.name}</h2>
        <div className="before"><span className="comparison-label">Actuel · conservé</span><Bot {...shared} tool={item.tool} size={62} pose={1} seed={`compare-${item.tool}`} /></div>
        <div className="after"><span className="comparison-label">Proposition</span><LogoBot {...shared} tool={item.tool} size={128} seed={`compare-${item.tool}`} branded={branded} /></div>
        <div className="concept-copy"><h3>{item.title}</h3><p>{item.detail}</p><a href={item.source} target="_blank" rel="noreferrer">Référence visuelle ↗</a></div>
      </article>)}
    </section>
    <section className="detail-study" aria-labelledby="detail-title">
      <div className="section-heading"><h2 id="detail-title">Expressions · {selected.title}</h2><label>Harness <select value={tool} onChange={e => setTool(e.target.value as BotProps['tool'])}>{FAMILY.map(item => <option key={item.tool} value={item.tool}>{item.name}</option>)}</select></label></div>
      <div className="state-grid">{STATES.map(s => <button key={s} aria-label={`${selected.name} : ${copy.stateLabel[s]}`} aria-pressed={state === s} onClick={() => setState(s)}>
        <LogoBot {...shared} tool={tool} state={s} size={60} seed={`${tool}-${s}`} askKey={s} branded={branded} />
        <span>{copy.stateLabel[s]}</span>
      </button>)}</div>
    </section>
    <section className="sizes" aria-labelledby="sizes-title">
      <div><h2 id="sizes-title">L’épreuve des petites tailles.</h2><p>{selected.name} · contours et regard avant les détails.</p></div>
      <div className="size-list">{SIZES.map(size => <div key={size}><div className="size-bot"><LogoBot {...shared} tool={tool} size={size} seed={`size-${tool}-${size}`} branded={branded} /></div><span>{size} px</span></div>)}</div>
    </section>
    <footer>Interprétations graphiques, pas des logos officiels. Proposition isolée dans la galerie : aucun changement des mascottes utilisées par Ledge ni de la version précédente.</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<LogoStudy />);

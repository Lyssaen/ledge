import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot, type BotProps } from '../bots/Bot';
import type { BotState } from '../bots/poseFor';
import { useUiCopy } from '../i18n/copy';
import '../styles/tokens.css';
import '../bots/bots.css';
import './mascots.css';

const FAMILY: { tool: BotProps['tool']; name: string; shape: string }[] = [
  { tool: 'claude', name: 'Claude Code', shape: 'Le galet' },
  { tool: 'codex', name: 'Codex', shape: 'L’orbe' },
  { tool: 'cursor', name: 'Cursor Agent', shape: 'La pointe' },
  { tool: 'omp', name: 'omp', shape: 'Le noyau' }
];
const STATES: BotState[] = ['starting', 'working', 'approval', 'question', 'idle', 'error', 'done', 'readonly'];
const SIZES = [12, 16, 20, 22, 32, 48, 92];

function Mascots() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [state, setState] = useState<BotState>('working');
  const [reduced, setReduced] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [nod, setNod] = useState(0);
  const copy = useUiCopy();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const shared = { theme, state, reducedMotion: reduced, frozen, pose: 1 as const, askKey: state, nodKey: nod };

  return <main>
    <header>
      <a className="wordmark" href="/mascots.html">ledge<span>.</span></a>
      <span className="eyebrow">Compagnons de session</span>
      <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</button>
    </header>
    <section className="introduction">
      <div><p className="eyebrow">Une nouvelle silhouette</p><h1>omp rejoint la famille.</h1><p>Un noyau hexagonal aux angles doux. La même visière, les mêmes matières, le même calme.</p></div>
      <div className="hero-bot"><Bot {...shared} tool="omp" size={160} seed="omp-preview" /></div>
    </section>
    <section className="controls" aria-label="Contrôles des mascottes">
      <label>Expression <select value={state} onChange={e => setState(e.target.value as BotState)}>{STATES.map(s => <option key={s} value={s}>{copy.stateLabel[s]}</option>)}</select></label>
      <label><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /> Mouvements réduits</label>
      <label><input type="checkbox" checked={frozen} onChange={e => setFrozen(e.target.checked)} /> Connexion perdue</label>
      <button onClick={() => setNod(n => n + 1)} disabled={reduced || frozen || state === 'readonly' || state === 'done'}>Acquiescer</button>
    </section>
    <section className="family" aria-label="Comparaison des silhouettes">
      {FAMILY.map(({ tool, name, shape }) => <article key={tool} className={tool === 'omp' ? 'featured' : ''}>
        <div className="portrait"><Bot {...shared} tool={tool} size={104} seed={`family-${tool}`} /></div>
        <h2>{name}</h2><p>{shape}</p>
      </article>)}
    </section>
    <section className="expressions" aria-labelledby="expressions-title">
      <div className="section-heading"><h2 id="expressions-title">Chaque état, une expression.</h2><span>Matière {theme === 'dark' ? 'Signal' : 'Galet'}</span></div>
      <div className="state-grid">{STATES.map(s => <button key={s} aria-pressed={state === s} onClick={() => setState(s)}>
        <Bot tool="omp" theme={theme} state={s} pose={1} size={60} seed={`omp-${s}`} reducedMotion={reduced} frozen={frozen} askKey={s} />
        <span>{copy.stateLabel[s]}</span>
      </button>)}</div>
    </section>
    <section className="sizes" aria-labelledby="sizes-title">
      <div><h2 id="sizes-title">De l’îlot à l’atelier.</h2><p>La silhouette reste. Les détails s’effacent.</p></div>
      <div className="size-list">{SIZES.map(size => <div key={size}><div className="size-bot"><Bot {...shared} tool="omp" size={size} seed={`omp-size-${size}`} /></div><span>{size} px</span></div>)}</div>
    </section>
    <footer>Composants réels de @ledge/ui · Aperçu visuel uniquement : le lancement d’omp et son intégration RPC ne sont pas activés ici.</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Mascots />);

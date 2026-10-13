import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResidentMascot } from '../../../apps/overlay/src/bots/ResidentMascot';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { LangProvider } from '../../../apps/overlay/src/i18n/lang';
import { LaunchCard } from '../../../apps/overlay/src/surface/LaunchCard';
import { Shoulders } from '../../../apps/overlay/src/surface/Shoulders';
import '../../../apps/overlay/src/styles/base.css';
import './preview.css';

type Machine = 'local' | 'server';
type Scenario = 'ambiguous' | 'explicit' | 'offline';
const names = { local: 'Cette machine', server: 'gch-agent-dev' };
const paths = { local: '/home/gch/development/github.com/Paradow-dev/ledge', server: '/home/gch/projects/ledge' };
const monitor = { d: ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8'] };
const server = { d: ['M4 3h16v7H4z', 'M4 14h16v7H4z', 'M7 6.5h.01', 'M7 17.5h.01', 'M16 6.5h1', 'M16 17.5h1'] };

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [scenario, setScenario] = useState<Scenario>('ambiguous');
  const [choice, setChoice] = useState<Machine | null>(null);
  const [sent, setSent] = useState(false);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [folded, setFolded] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }); }, [choice, sent]);
  const reset = (next: Scenario = scenario) => { setScenario(next); setChoice(next === 'ambiguous' ? null : 'server'); setSent(false); setDraft(''); setFeedback(''); setFolded(false); };
  const choose = (machine: Machine) => { setChoice(machine); setSent(false); setFeedback(''); };
  const unavailable = scenario === 'offline' && choice === 'server';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    if (/local|ici|cette machine/i.test(draft)) choose('local');
    else if (/serveur|server|gch-agent-dev/i.test(draft)) choose('server');
    else setFeedback('Pour essayer la maquette, réponds « ici » ou « sur le serveur ».');
    setDraft('');
  };
  const mascot = (size: number) => <ResidentMascot size={size} theme={theme} reducedMotion />;

  return <LangProvider lang="fr"><div className="design-page">
    <header className="studio-head"><span className="wordmark">Ledge<span>.</span></span><span className="studio-label">ÉTUDE DU CHAT / MULTI-MACHINE</span><Button variant="ghost" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon {...ICONS.dnd} />{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</Button></header>
    <div className="studio-layout">
      <aside className="notes"><div className="eyebrow">UNE CONVERSATION, PARTOUT</div><h1>Le bon projet.<br />La bonne machine.</h1><p>Tu parles à Ledge comme d’habitude.<br />S’il hésite sur la destination, il te la demande.</p>
        <nav aria-label="Scénarios de la maquette">{([['ambiguous', '01', 'La cible est ambiguë', 'Un choix dans la conversation.'], ['explicit', '02', 'Tu précises le serveur', 'La proposition indique sa destination.'], ['offline', '03', 'Le serveur est hors ligne', 'La demande garde sa cible.']] as const).map(([id, number, title, hint]) => <button key={id} aria-pressed={scenario === id} onClick={() => reset(id)}><span className="step-number">{number}</span><span><strong>{title}</strong><small>{hint}</small></span><Icon {...ICONS.chevronRight} size={14} /></button>)}</nav>
        <div className="design-note"><span className="note-rule" /><strong>Un choix léger.</strong><p>Deux réponses courtes dans le fil, puis la carte de lancement habituelle. La destination reste lisible avant de démarrer.</p></div>
        <small className="simulation">Maquette interactive · chemins illustratifs<br />Les lancements sont simulés.</small>
      </aside>
      <section className="preview-area" aria-label="Aperçu du chat Ledge"><div className="desktop-bar"><span>PROJET / ledge</span><span>APERÇU À TAILLE RÉELLE · 480 PX</span></div><div className="desktop">
        <div className="island-frame" style={{ width: folded ? 90 : undefined }}><Shoulders left={0} w={folded ? 90 : 480} transition="none" opacity={1}/>
          {folded ? <button className="folded" onClick={() => setFolded(false)} aria-label="Rouvrir le chat">{mascot(36)}</button> : <main data-surface className="chat-panel">
            <header className="chat-header"><Button variant="ghost" size="icon" aria-label="Replier" onClick={() => setFolded(true)}><Icon {...ICONS.chevronLeft}/></Button>{mascot(28)}<div className="chat-brand"><strong>Ledge<span>.</span></strong><small>2 projets · {scenario === 'offline' ? '1 machine joignable' : '2 machines'}</small></div><Button variant="ghost" size="icon" aria-label="Recommencer la conversation" title="Recommencer" onClick={() => reset()}><Icon {...ICONS.plus}/></Button><Button variant="ghost" size="icon" aria-label="Fermer le chat" onClick={() => setFolded(true)}><Icon {...ICONS.close}/></Button></header>
            <div className="conversation" ref={scroll}>
              <div className="user-message">Lance une session {scenario !== 'ambiguous' && 'sur le serveur '}pour corriger le build de ledge.</div>
              {scenario === 'ambiguous' && <div className="answer">{mascot(24)}<div className="answer-content"><p>J’ai trouvé <strong>ledge</strong> sur les deux machines.<br />Où veux-tu lancer la session ?</p>
                {!choice && <div className="choices" aria-label="Choisir la machine"><Button variant="outline" size="sm" onClick={() => choose('local')}><Icon {...monitor} size={14}/>Cette machine</Button><Button variant="outline" size="sm" onClick={() => choose('server')}><Icon {...server} size={14}/>gch-agent-dev</Button></div>}
                {!choice && <small className="response-hint">Tu peux aussi répondre dans le chat.</small>}
              </div></div>}
              {choice && <>{scenario === 'ambiguous' && <div className="user-message short-message">{choice === 'local' ? 'Sur cette machine.' : 'Sur gch-agent-dev.'}</div>}
                <div className="answer">{mascot(24)}<div className="answer-content">
                  <p>{unavailable ? <><strong>gch-agent-dev</strong> est hors ligne.<br />Le lancement sera disponible à son retour.</> : sent ? <>La session de démonstration est prête sur <strong>{names[choice]}</strong>.</> : <>Voici la session pour corriger le build de <strong>ledge</strong>.</>}</p>
                  <div className="destination"><Icon {...(choice === 'server' ? server : monitor)} size={14}/><span>{names[choice]}</span>{unavailable && <span className="offline">Hors ligne</span>}{!sent && <button onClick={() => { setChoice(null); setScenario('ambiguous'); }} className="change-target">Changer</button>}</div>
                  <LaunchCard proposal={{ project: 'ledge', cwd: paths[choice], tool: 'claude', prompt: 'Diagnostiquer et corriger le build de ledge.', ...(sent ? { launchedId: 'demo' } : {}) }} busy={false} disabled={unavailable} onLaunch={() => setSent(true)} onOpenSession={() => {}} onTerminal={() => setFeedback('Ouverture du terminal simulée sur ' + names[choice] + '.')} />
                  {unavailable && <small className="response-hint">La cible reste gch-agent-dev. Aucun lancement en local.</small>}
                  {sent && <small className="response-hint" role="status">Démonstration : aucune session réelle n’a été créée.</small>}
                </div></div></>}
            </div>
            <form className="composer" onSubmit={submit}>{feedback && <span role="status" className="feedback">{feedback}</span>}<div><input aria-label="Message à Ledge" value={draft} onChange={e => setDraft(e.target.value)} placeholder={!choice ? 'Répondre à Ledge…' : 'Demander à Ledge…'} className="ledge-field"/><Button variant="primary" size="icon" type="submit" aria-label="Envoyer" disabled={!draft.trim()}><Icon {...ICONS.send}/></Button></div></form>
          </main>}
        </div>
        <div className="desktop-caption"><span className="caption-line" />{!choice ? 'Choisis une machine pour continuer la conversation.' : unavailable ? 'Le bouton de lancement reste désactivé.' : sent ? 'Le parcours est terminé. Tu peux essayer un autre scénario.' : 'La carte reprend les composants de l’application.'}</div>
      </div></section>
    </div>
  </div></LangProvider>;
}
createRoot(document.getElementById('root')!).render(<App/>);

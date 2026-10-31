import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { BotProps } from '../bots/Bot';
import { Icon, ICONS } from '../ui/icons';
import { LogoBot } from './LogoBot';
import '../styles/tokens.css';
import '../bots/bots.css';
import './mascots-logos.css';
import './launch-harness.css';

type Harness = BotProps['tool'];
const HARNESSES: { id: Harness; name: string; detail: string }[] = [
  { id: 'omp', name: 'omp', detail: 'Un harness, plusieurs fournisseurs' },
  { id: 'claude', name: 'Claude Code', detail: 'Le harness d’Anthropic' },
  { id: 'codex', name: 'Codex', detail: 'Le harness d’OpenAI' },
  { id: 'cursor', name: 'Cursor', detail: 'Le harness de Cursor' },
];
const label = (id: Harness) => HARNESSES.find(h => h.id === id)!.name;
const STORAGE_KEY = 'ledge.preview.launch-harness.default.v1';
const INITIAL_PROMPT = 'Ajoute le choix du harness au démarrage d’une session, en conservant les composants existants de Ledge.';
// Example choices only. The implementation must use the target machine's catalog.
const MODELS: Record<Harness, string[]> = {
  omp: ['Anthropic · Claude', 'OpenAI Codex · GPT', 'Cursor · Auto'],
  claude: ['Sonnet', 'Opus'], codex: ['GPT'], cursor: ['Auto', 'Sonnet'],
};
function savedDefault(): Harness {
  try { const saved = localStorage.getItem(STORAGE_KEY); return HARNESSES.find(h => h.id === saved)?.id ?? 'omp'; }
  catch { return 'omp'; }
}

type LaunchPreview = { tool: Harness; project: string; prompt: string; model: string };

function LaunchHarnessStudy() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [preferred, setPreferred] = useState<Harness>(savedDefault);
  const [tool, setTool] = useState<Harness>(preferred);
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState(INITIAL_PROMPT);
  const [project, setProject] = useState('Ledge');
  const [model, setModel] = useState('');
  const [ompAvailable, setOmpAvailable] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [launched, setLaunched] = useState<LaunchPreview | null>(null);
  const selector = useRef<HTMLButtonElement>(null);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const preferences = useRef<HTMLDialogElement>(null);
  const [preferenceDraft, setPreferenceDraft] = useState<Harness>(preferred);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const available = tool !== 'omp' || ompAvailable;
  const custom = tool !== preferred;
  const mascot = (id: Harness, size = 40) => <span aria-hidden="true"><LogoBot tool={id} state="working" size={size} theme={theme} seed={`launch-${id}`} reducedMotion /></span>;

  const selectHarness = (next: Harness) => {
    if (next === tool) return;
    setTool(next); setModel(''); setError('');
    setNotice(`${label(next)} pour cette session. Projet et instruction conservés ; modèle remis au défaut du harness.`);
  };
  const remember = (next: Harness) => {
    setPreferred(next);
    try { localStorage.setItem(STORAGE_KEY, next); setNotice(`${label(next)} sera présélectionné pour vos prochaines sessions. Le choix de cette session ne change pas.`); }
    catch { setNotice('Préférence conservée pour cette page seulement : le stockage du navigateur est indisponible.'); }
  };
  const freshSession = () => {
    setTool(preferred); setModel(''); setPrompt(''); setExpanded(false); setLaunched(null); setError('');
    setNotice(`Nouvelle session : ${label(preferred)} est présélectionné.`);
    requestAnimationFrame(() => promptField.current?.focus());
  };
  const launch = (event: FormEvent) => {
    event.preventDefault();
    if (!available) { setError('omp est indisponible sur cette machine. Choisissez un autre harness.'); return; }
    if (!prompt.trim()) { setError('Ajoutez une instruction avant de lancer la session.'); promptField.current?.focus(); return; }
    setError(''); setExpanded(false);
    setLaunched({ tool, project, prompt: prompt.trim(), model: model || `Par défaut ${label(tool)}` });
    setNotice('Simulation uniquement : aucun processus n’a été lancé.');
  };
  const openPreferences = () => { setPreferenceDraft(preferred); preferences.current?.showModal(); };

  return <div className="launch-study">
    <header className="study-bar">
      <a className="study-brand" href="/mascots-logos.html">ledge<span>.</span></a>
      <span className="study-caption">Étude interactive <span>/</span> Nouveau départ</span>
      <div className="study-actions">
        <label className="scenario-toggle"><input type="checkbox" checked={!ompAvailable} onChange={e => setOmpAvailable(!e.target.checked)} />Simuler omp indisponible</label>
        <button type="button" className="quiet-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</button>
      </div>
    </header>

    <div className="study-heading"><span className="small-label">Proposition · lancement de session</span><h1>Votre habituel. Ou un autre, cette fois.</h1><p>Un défaut pour aller vite. Le choix reste ouvert avant de lancer.</p></div>

    <main className="launch-window">
      <aside className="launch-sidebar" aria-label="Contexte de la maquette">
        <div className="sidebar-brand">ledge<span>.</span><span className="workspace-tag">PERSONNEL</span></div>
        <button type="button" className="sidebar-new" onClick={freshSession}><Icon d={ICONS.plus.d} />Nouvelle session</button>
        <div className="side-label">ESPACE DE TRAVAIL</div>
        <div className="sidebar-project"><Icon d={ICONS.folder.d} />Ledge <span className="side-count">2</span></div>
        <div className="sidebar-session">{mascot('claude', 28)}<span>Otto<small>Revoir la navigation</small></span></div>
        <div className="sidebar-session">{mascot('cursor', 28)}<span>Nova<small>Affiner les composants</small></span></div>
        <div className="sidebar-project muted-project"><Icon d={ICONS.folder.d} />Site personnel</div>
        <div className="sidebar-bottom"><span className="connection-dot" />WSL · Machine locale<button type="button" aria-label="Préférences de lancement" onClick={openPreferences}><Icon d={ICONS.gear.d} /></button></div>
      </aside>

      <section className="launch-workspace" aria-labelledby="launch-title">
        <div className="workspace-top"><span>Sessions <span>/</span> Nouvelle session</span><span className="mockup-chip">MAQUETTE</span></div>
        <div className="launch-content">
          <div className="launch-title-row"><div><span className="small-label">Un nouveau compagnon</span><h2 id="launch-title">Qu’allons-nous faire ?</h2></div><div className="title-mascot">{mascot(tool, 66)}</div></div>

          {launched ? <section className="launch-receipt" aria-labelledby="receipt-title">
            <span className="receipt-icon"><Icon d={ICONS.check.d} size={22} /></span>
            <h3 id="receipt-title">Prêt à partir avec {label(launched.tool)}</h3>
            <p>Aperçu du lancement. Aucun agent n’a été exécuté.</p>
            <dl><div><dt>Projet</dt><dd>{launched.project}</dd></div><div><dt>Harness</dt><dd>{label(launched.tool)}</dd></div><div><dt>Modèle</dt><dd>{launched.model}</dd></div></dl>
            <blockquote>{launched.prompt}</blockquote>
            <p className="next-default">Prochaine session : <strong>{label(preferred)}</strong> reste votre défaut.</p>
            <div className="receipt-actions"><button type="button" className="quiet-button" onClick={() => setLaunched(null)}>Revenir au brouillon</button><button type="button" className="primary-button" onClick={freshSession}>Nouvelle session<Icon d={ICONS.plus.d} /></button></div>
          </section> : <form onSubmit={launch}>
            <div className="context-row">
              <label><span>Projet</span><span className="context-select"><Icon d={ICONS.folder.d} /><select aria-label="Projet" value={project} onChange={e => setProject(e.target.value)}><option>Ledge</option><option>Site personnel</option></select></span></label>
              <div className="machine-context"><span>Machine</span><strong><span className="connection-dot" />WSL · locale</strong></div>
            </div>
            <label className="instruction"><span>Votre instruction</span><textarea ref={promptField} value={prompt} onChange={e => { setPrompt(e.target.value); setError(''); }} placeholder="Décrivez ce que vous souhaitez confier à votre agent…" rows={3} aria-invalid={!!error && !prompt.trim()} /></label>
            <div className="harness-section">
              <div className="field-heading"><span>Harness</span><span>Le moteur qui pilote votre session</span></div>
              <button type="button" ref={selector} className={`harness-trigger ${expanded ? 'is-open' : ''}`} aria-expanded={expanded} aria-controls="harness-choices" onClick={() => setExpanded(!expanded)}>
                {mascot(tool, 42)}<span className="harness-selected"><strong>{label(tool)}</strong><small>{tool === 'omp' ? 'Contrôle natif dans Ledge' : HARNESSES.find(h => h.id === tool)!.detail}</small></span>
                <span className={`selection-badge ${custom ? 'is-override' : ''}`}>{custom ? 'Cette session' : 'Par défaut'}</span><span className="change-label">Changer</span><span className={`disclosure-arrow ${expanded ? 'open' : ''}`}><Icon d={ICONS.chevronRight.d} /></span>
              </button>
              {expanded && <div id="harness-choices" className="harness-picker" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setExpanded(false); selector.current?.focus(); } }}>
                <fieldset><legend>Choisir pour cette session</legend><div className="harness-options">{HARNESSES.map(h => {
                  const disabled = h.id === 'omp' && !ompAvailable;
                  return <label key={h.id} className={`harness-option ${tool === h.id ? 'selected' : ''} ${disabled ? 'unavailable' : ''}`}>
                    <input type="radio" name="harness" value={h.id} checked={tool === h.id} disabled={disabled} onChange={() => selectHarness(h.id)} />
                    {mascot(h.id, 38)}<span><strong>{h.name}{preferred === h.id && <span className="default-mark">Défaut</span>}</strong><small>{disabled ? 'Indisponible sur WSL' : h.detail}</small></span><span className="radio-indicator">{tool === h.id && <Icon d={ICONS.check.d} size={12} />}</span>
                  </label>;
                })}</div></fieldset>
                <div className="picker-preference"><p>{custom ? <>Le choix est ponctuel. Votre défaut reste <strong>{label(preferred)}</strong>.</> : <>Ce harness est déjà votre choix par défaut.</>}</p>{custom && available && <button type="button" className="text-button" onClick={() => remember(tool)}>Définir {label(tool)} par défaut</button>}</div>
                <button type="button" className="picker-close text-button" onClick={() => { setExpanded(false); selector.current?.focus(); }}>Terminer le choix<Icon d={ICONS.check.d} size={13} /></button>
              </div>}
              {!expanded && custom && <div className="override-note"><span>Pour cette session uniquement. Défaut : {label(preferred)}.</span><button type="button" className="text-button" onClick={() => selectHarness(preferred)}>Revenir au défaut</button></div>}
              {!available && <p className="availability-warning" role="alert">omp est indisponible sur cette machine. Choisissez un autre harness ; votre préférence sera conservée.</p>}
            </div>
            <div className="model-row"><label><span>Modèle</span><select aria-label="Modèle" value={model} onChange={e => setModel(e.target.value)}><option value="">Par défaut {label(tool)}</option>{MODELS[tool].map(m => <option key={m}>{m}</option>)}</select></label><span className="model-note">Exemples de modèles.<br />Le catalogue réel viendra du harness.</span></div>
            <div className="shell-note"><span className="shell-glyph" aria-hidden="true">&gt;_</span><p>{tool === 'omp' ? <>Un <strong>shell libre</strong> reste accessible. La conversation est pilotée dans Ledge, sans suivi terminal.</> : <>Le terminal habituel du harness et un shell libre restent accessibles.</>}</p></div>
            {error && <p role="alert" className="launch-error">{error}</p>}
            <div className="launch-submit"><div>{mascot(tool, 30)}<span><strong>Un compagnon rejoindra {project}</strong><small>avec {label(tool)} · {model || 'modèle par défaut'}</small></span></div><button type="submit" className="primary-button" disabled={!available}>Lancer la session<Icon d={ICONS.send.d} size={16} /></button></div>
          </form>}
          <div className="persistent-preference"><Icon d={ICONS.gear.d} size={14} /><span>Votre harness par défaut : <strong>{label(preferred)}</strong></span><button type="button" className="text-button" onClick={openPreferences}>Modifier</button></div>
        </div>
        <div className="workspace-footer">Aucun lancement réel · Préférence enregistrée uniquement dans cette maquette</div>
      </section>
    </main>
    <div className="study-status" role="status" aria-live="polite">{notice || 'À essayer : changez de harness, puis ouvrez une nouvelle session pour retrouver votre défaut.'}</div>
    <footer className="study-footer"><span>Le changement ponctuel ne modifie jamais votre préférence.</span><a href="/mascots-logos.html">Voir les mascottes retenues <Icon d={ICONS.external.d} size={13} /></a></footer>

    <dialog ref={preferences} className="preference-dialog" aria-labelledby="preference-title" onClick={e => { if (e.target === e.currentTarget) preferences.current?.close(); }}>
      <form onSubmit={e => { e.preventDefault(); remember(preferenceDraft); preferences.current?.close(); }}>
        <div className="preference-title"><Icon d={ICONS.gear.d} size={19} /><h2 id="preference-title">Préférences de lancement</h2><button type="button" className="icon-button" aria-label="Fermer les préférences" onClick={() => preferences.current?.close()}><Icon d={ICONS.close.d} /></button></div>
        <p>Le harness présélectionné pour vos prochaines sessions. Vous pourrez toujours en choisir un autre avant de lancer.</p>
        <fieldset><legend>Harness par défaut</legend>{HARNESSES.map(h => <label className={`preference-option ${preferenceDraft === h.id ? 'selected' : ''}`} key={h.id}><input type="radio" name="defaultHarness" checked={preferenceDraft === h.id} onChange={() => setPreferenceDraft(h.id)} />{mascot(h.id, 32)}<span>{h.name}</span></label>)}</fieldset>
        <p className="preference-scope">Le brouillon et le harness de la session en préparation ne changent pas. Si votre défaut est indisponible sur une machine, Ledge vous demandera de choisir.</p>
        <div className="preference-actions"><button type="button" className="quiet-button" onClick={() => preferences.current?.close()}>Annuler</button><button className="primary-button" type="submit">Enregistrer le défaut</button></div>
      </form>
    </dialog>
  </div>;
}

createRoot(document.getElementById('root')!).render(<LaunchHarnessStudy />);

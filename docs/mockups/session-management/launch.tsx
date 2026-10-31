import React, { useEffect, useRef, useState } from 'react';
import { HarnessBot as Bot, HARNESSES, HARNESS_LABELS, type PreviewTool } from './harness';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { ModelPick, type ModelChoice } from './model-pick';

type Tool = PreviewTool;
type Project = { id: string; name: string; repos: string; branch: string };
type Machine = { name: string; online: boolean; kind: string; omp: boolean };
export type LaunchRequest = { tool: Tool; prompt: string; project: string; machine: string; repos: string[]; name: string; model?: string; effort?: string };
const NAMES = ['Néo', 'Ada', 'Lux', 'Pia', 'Sol', 'Taz', 'Uma', 'Yan'];
const SUGGESTIONS = ['Relire la dernière pull request', 'Corriger les tests qui échouent', 'Mettre à jour la documentation'];

/** Starting a session: the instruction first, the harness picked by its bot, then where it runs; the preview shows who joins which table. */
export function LaunchComposer(p: {
  projects: Project[]; machines: Machine[]; takenNames: string[]; initialProject: string; seats: (project: string) => number;
  theme: 'dark' | 'light'; paused: boolean; defaultTool: Tool; onDefaultTool: (tool: Tool) => void;
  onLaunch: (r: LaunchRequest) => void; onCancel: () => void;
}) {
  const [tool, setTool] = useState<Tool>(p.defaultTool);
  const [choosing, setChoosing] = useState(false);
  const [pick, setPick] = useState<ModelChoice>({ model: null, effort: null });
  const [feedback, setFeedback] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const [prompt, setPrompt] = useState('');
  const [project, setProject] = useState(p.initialProject);
  const [machine, setMachine] = useState(p.machines.find(m => m.online)!.name);
  const repoList = (id: string) => (p.projects.find(x => x.id === id)?.repos ?? '').split(' · ').filter(r => r && r !== 'aucun dépôt');
  const [repos, setRepos] = useState<string[]>(repoList(p.initialProject).slice(0, 1));
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  const name = NAMES.find(n => !p.takenNames.includes(n)) ?? 'Néo';
  const current = p.projects.find(x => x.id === project)!;
  const selectedHarness = HARNESSES.find(h => h.id === tool)!;
  const available = tool !== 'omp' || p.machines.find(m => m.name === machine)?.omp === true;
  const missing = !available ? 'Choisissez un harness disponible sur cette machine' : !prompt.trim() ? 'Écrivez la consigne' : !repos.length ? 'Choisissez au moins un dépôt' : null;
  const submit = () => { setTried(true); if (missing) return; p.onLaunch({ tool, prompt: prompt.trim(), project, machine, repos, name, ...(pick.model ? { model: pick.model } : {}), ...(pick.effort ? { effort: pick.effort } : {}) }); };
  const choose = (next: Tool) => {
    if (next === tool) return;
    setTool(next); setPick({ model: null, effort: null });
    setFeedback(`${HARNESS_LABELS[next]} pour cette session. Consigne, projet et dépôts conservés ; modèle remis au défaut du harness.`);
  };
  const pickProject = (id: string) => { setProject(id); setRepos(repoList(id).slice(0, 1)); };
  return (
    <form className="composer" onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
      <div className="composer-body">
        <label className="composer-prompt">
          <span className="composer-label">Consigne</span>
          <textarea ref={field} value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="Que doit faire l’agent ? Décrivez le résultat attendu." aria-invalid={tried && !prompt.trim()} />
        </label>
        {!prompt && <div className="composer-suggestions" aria-label="Suggestions">{SUGGESTIONS.map(s => <button type="button" key={s} onClick={() => { setPrompt(s); field.current?.focus(); }}>{s}</button>)}</div>}

        <section className="integrated-harness" aria-label="Harness de cette session">
          <div className="harness-field-label"><span className="composer-label">Harness</span><span>Le moteur de cette session</span></div>
          <button type="button" className="harness-current" ref={trigger} aria-expanded={choosing} aria-controls="integrated-harness-choices" onClick={() => setChoosing(!choosing)}>
            <span aria-hidden="true"><Bot tool={tool} state="working" pose={1} size={36} theme={p.theme} seed={`launch-${tool}`} paused /></span>
            <span className="harness-current-copy"><strong>{selectedHarness.label}</strong><small>{selectedHarness.hint}</small></span>
            <span className="harness-choice-tag">{tool === p.defaultTool ? 'Par défaut' : 'Cette session'}</span>
            <span className="harness-change">Changer</span><span className={choosing ? 'harness-chevron open' : 'harness-chevron'}><Icon d={ICONS.chevronRight.d} size={14} /></span>
          </button>
          {choosing && <div id="integrated-harness-choices" className="harness-choice-panel" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setChoosing(false); trigger.current?.focus(); } }}>
            <fieldset className="composer-tools">
              <legend className="composer-label">Choisir pour cette session</legend>
              {HARNESSES.map(t => {
                const disabled = t.id === 'omp' && !p.machines.find(m => m.name === machine)?.omp;
                return <label key={t.id} className={`tool-tile ${tool === t.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}>
                  <input type="radio" name="tool" value={t.id} checked={tool === t.id} disabled={disabled} onChange={() => choose(t.id)} />
                  <span aria-hidden="true"><Bot tool={t.id} state="working" pose={1} size={36} theme={p.theme} seed={`pick-${t.id}`} paused /></span>
                  <span><strong>{t.label}{p.defaultTool === t.id && <span className="harness-default-mark">Défaut</span>}</strong><small>{disabled ? 'Indisponible sur cette machine' : t.hint}</small></span>
                </label>;
              })}
            </fieldset>
            <div className="harness-default-action"><span>{tool === p.defaultTool ? 'Présélectionné pour vos prochaines sessions.' : `Votre défaut reste ${HARNESS_LABELS[p.defaultTool]}.`}</span>
              {tool !== p.defaultTool && available && <Button type="button" variant="ghost" size="sm" onClick={() => { p.onDefaultTool(tool); setFeedback(`${selectedHarness.label} sera présélectionné pour les prochaines sessions.`); }}>Définir {selectedHarness.label} par défaut</Button>}
              <Button type="button" variant="ghost" size="sm" onClick={() => { setChoosing(false); trigger.current?.focus(); }}>Terminer le choix</Button>
            </div>
          </div>}
          {!choosing && tool !== p.defaultTool && <div className="harness-override"><span>Pour cette session uniquement. Défaut : {HARNESS_LABELS[p.defaultTool]}.</span><button type="button" onClick={() => choose(p.defaultTool)}>Revenir au défaut</button></div>}
          {!available && <p className="harness-unavailable" role="alert">omp n’est pas disponible sur {machine} dans ce scénario. Choisissez un autre harness ou PC local ; votre défaut reste inchangé.</p>}
          <div className="harness-model"><span className="composer-label">Modèle et effort</span><ModelPick key={tool} tool={tool} pick={pick} onPick={setPick} disabled={!available} /><small>Catalogue d’exemple · même sélecteur dans le chat.</small></div>
          {tool === 'omp' && <p className="harness-native">Conversation pilotée dans Ledge. Seul le shell libre reste disponible, sans suivi terminal OMP.</p>}
          <p className="harness-live" role="status">{feedback}</p>
        </section>

        <div className="composer-where">
          <fieldset className="chip-group">
            <legend className="composer-label">Projet</legend>
            {p.projects.map(x => <label key={x.id} className={`chip ${project === x.id ? 'selected' : ''}`}><input type="radio" name="project" checked={project === x.id} onChange={() => pickProject(x.id)} /><i className={`side-swatch swatch-${x.id}`} />{x.name}</label>)}
          </fieldset>
          <fieldset className="chip-group">
            <legend className="composer-label">Machine</legend>
            {p.machines.map(m => <label key={m.name} className={`chip ${machine === m.name ? 'selected' : ''} ${m.online ? '' : 'disabled'}`} title={m.online ? m.kind : 'Hors ligne : reconnectez la machine dans les réglages'}><input type="radio" name="machine" disabled={!m.online} checked={machine === m.name} onChange={() => setMachine(m.name)} /><i className={`machine-dot ${m.online ? '' : 'off'}`} />{m.name}{!m.online && <small>hors ligne</small>}</label>)}
          </fieldset>
          <fieldset className="chip-group" aria-invalid={tried && !repos.length}>
            <legend className="composer-label">Dépôts sur {machine}</legend>
            {repoList(project).map(r => <label key={r} className={`chip ${repos.includes(r) ? 'selected' : ''}`}><input type="checkbox" checked={repos.includes(r)} onChange={e => setRepos(e.target.checked ? [...repos, r] : repos.filter(x => x !== r))} /><Icon d={repos.includes(r) ? ICONS.check.d : ICONS.folder.d} size={12} />{r}</label>)}
            <span className="chip-note">⎇ {current.branch}</span>
          </fieldset>
        </div>
      </div>

      <footer className="composer-footer">
        <div className="composer-preview" aria-live="polite">
          <Bot tool={tool} state="starting" pose={1} size={30} theme={p.theme} seed={'preview-' + tool} paused={p.paused} />
          <span><span className="preview-line"><strong>{name}</strong> rejoindra la table <strong>{current.name}</strong></span><small>{selectedHarness.label} · {pick.model || 'modèle par défaut'}{pick.effort ? ` · ${pick.effort}` : ''} · {machine} · {repos.join(', ') || 'aucun dépôt'}</small></span>
        </div>
        {tried && missing && <span className="composer-missing" role="alert">{missing}</span>}
        <Button variant="ghost" type="button" onClick={p.onCancel}>Annuler</Button>
        <Button variant="primary" type="submit" disabled={!available} aria-disabled={!!missing}><Icon d={ICONS.plus.d} size={14} />Lancer<Kbd>Ctrl ↵</Kbd></Button>
      </footer>
      <p className="composer-demo">Simulation : aucun agent réel lancé. Défaut partagé avec Réglages → Général.</p>
    </form>
  );
}

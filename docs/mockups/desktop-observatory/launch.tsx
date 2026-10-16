import React, { useEffect, useRef, useState } from 'react';
import { Bot } from '../../../apps/overlay/src/bots/Bot';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';

type Tool = 'claude' | 'codex' | 'cursor';
type Project = { id: string; name: string; repos: string; branch: string };
type Machine = { name: string; online: boolean; kind: string };
export type LaunchRequest = { tool: Tool; prompt: string; project: string; machine: string; repos: string[]; name: string };

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'claude', label: 'Claude Code', hint: 'Conception, revue' },
  { id: 'codex', label: 'Codex', hint: 'Code et tests' },
  { id: 'cursor', label: 'Cursor Agent', hint: 'Dans l’éditeur' }
];
const NAMES = ['Néo', 'Ada', 'Lux', 'Pia', 'Sol', 'Taz', 'Uma', 'Yan'];
const SUGGESTIONS = ['Relire la dernière pull request', 'Corriger les tests qui échouent', 'Mettre à jour la documentation'];

/** Starting a session: the instruction first, the harness picked by its bot, then where it runs; the preview shows who joins which table. */
export function LaunchComposer(p: {
  projects: Project[]; machines: Machine[]; takenNames: string[]; initialProject: string; seats: (project: string) => number;
  theme: 'dark' | 'light'; paused: boolean; onLaunch: (r: LaunchRequest) => void; onCancel: () => void;
}) {
  const [tool, setTool] = useState<Tool | null>(null);
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
  const missing = !tool ? 'Choisissez un agent' : !prompt.trim() ? 'Écrivez la consigne' : !repos.length ? 'Choisissez au moins un dépôt' : null;
  const submit = () => { setTried(true); if (missing || !tool) return; p.onLaunch({ tool, prompt: prompt.trim(), project, machine, repos, name }); };
  const pickProject = (id: string) => { setProject(id); setRepos(repoList(id).slice(0, 1)); };
  return (
    <form className="composer" onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
      <div className="composer-body">
        <label className="composer-prompt">
          <span className="composer-label">Consigne</span>
          <textarea ref={field} value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="Que doit faire l’agent ? Décrivez le résultat attendu." aria-invalid={tried && !prompt.trim()} />
        </label>
        {!prompt && <div className="composer-suggestions" aria-label="Suggestions">{SUGGESTIONS.map(s => <button type="button" key={s} onClick={() => { setPrompt(s); field.current?.focus(); }}>{s}</button>)}</div>}

        <fieldset className="composer-tools" aria-invalid={tried && !tool}>
          <legend className="composer-label">Agent</legend>
          {TOOLS.map(t => <label key={t.id} className={`tool-tile ${tool === t.id ? 'selected' : ''}`}>
            <input type="radio" name="tool" value={t.id} checked={tool === t.id} onChange={() => setTool(t.id)} />
            <Bot tool={t.id} state={tool === t.id ? 'working' : 'idle'} pose={1} size={46} theme={p.theme} seed={'pick-' + t.id} paused={p.paused} />
            <span><strong>{t.label}</strong><small>{t.hint}</small></span>
          </label>)}
        </fieldset>

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
          {tool ? <Bot tool={tool} state="starting" pose={1} size={30} theme={p.theme} seed={'preview-' + tool} paused={p.paused} /> : <span className="preview-empty" aria-hidden="true" />}
          <span><span className="preview-line"><strong>{tool ? name : 'Un nouvel agent'}</strong> rejoindra la table <strong>{current.name}</strong></span><small>Place {p.seats(project) + 1} · {machine} · {repos.join(', ') || 'aucun dépôt'}</small></span>
        </div>
        {tried && missing && <span className="composer-missing" role="alert">{missing}</span>}
        <Button variant="ghost" type="button" onClick={p.onCancel}>Annuler</Button>
        <Button variant="primary" type="submit" aria-disabled={!!missing}><Icon d={ICONS.plus.d} size={14} />Lancer<Kbd>Ctrl ↵</Kbd></Button>
      </footer>
      <p className="composer-demo">Démonstration : aucun agent réel ne sera lancé.</p>
    </form>
  );
}

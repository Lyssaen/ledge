import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import type { DaemonClient, Fleet, MachineState } from '@ledge/fleet';
import { normalizePath, PROJECT_COLORS, type Projects, type Repo, type RepoInfo, type Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { ruleFor } from '../atelier/filing';
import { isUp } from '../launch/model';
import { useRepoInfo } from '../launch/useRepoInfo';
import { SessionBot } from '../shell/SessionBot';
import { afterSave, alsoIn, COLOR_ORDER, draftProblem, saved, type ProjectDraft } from './draft';
import { FolderPicker } from './FolderPicker';
import { ProjectSwatch } from './ProjectSwatch';
import { useProjectSave } from './useProjectSave';

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path;
const repoKey = (machine: string, path: string) => `${machine}\n${normalizePath(path)}`;
type Known = { exists: boolean; branch: string | null };

/** One machine's saved repositories, inspected (useRepoInfo, lot 7): the answer goes up to the editor. */
function Inspect({ client, machine, paths, onInfos }: { client: DaemonClient; machine: string; paths: readonly string[]; onInfos(machine: string, infos: ReadonlyMap<string, RepoInfo>): void }): null {
  const infos = useRepoInfo(client, machine, paths);
  const report = useRef(onInfos);
  report.current = onInfos;
  useEffect(() => { if (infos.size > 0) report.current(machine, infos); }, [machine, infos]);
  return null;
}

/** The mockup's ProjectEditor (without Ledge's scan nor its proposals): the name, the colour, the description, the working repositories
 *  with their machine and branch (added from the folder browser or a typed path), the agents to file too. Saving sends the whole state
 *  and waits for the daemon's broadcast that holds it: nothing changes before, and a refusal or a silence is said here, the values kept. */
export function ProjectEditor(p: {
  mode: 'new' | 'edit'; initial: ProjectDraft; projects: Projects; sessions: readonly Session[]; machines: readonly MachineState[];
  client: DaemonClient; fleet: Pick<Fleet, 'setProjects'>; projectIdOf(s: Session): string | null; onClose(): void;
  onSaved(id: string, created: boolean, filed: Session[]): void;
  /** Task 5: deleting the project (« Supprimer le projet »), its agents moved to `moveTo` or left without project. */
  onDeleted(id: string, moveTo: string | null, agents: number): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.projects;
  const { machines, projects } = p;
  const [d, setD] = useState<ProjectDraft>(p.initial);
  const [tried, setTried] = useState(false);
  // A new project without repository opens on the folder browser.
  const [adding, setAdding] = useState(p.mode === 'new' && p.initial.repos.length === 0);
  // What is known of each repository (by machine and path): from the browser when added, from repos.inspect for the saved ones.
  const [known, setKnown] = useState<ReadonlyMap<string, Known>>(() => new Map());
  const { state, send } = useProjectSave(p.fleet, projects);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);
  // The confirmation comes in an effect after the broadcast's render: it reaches the props of that render.
  const latest = useRef(p);
  latest.current = p;
  const ids = useId();

  const machineOf = (id: string) => machines.find(m => m.id === id);
  const labelOf = (id: string) => machineOf(id)?.label ?? id;
  // The saved repositories, by machine online: one inspection each (a machine offline would answer « not found » for every path).
  const groups = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const r of p.initial.repos) {
      const m = machines.find(x => x.id === r.machine);
      if (m && isUp(m)) by.set(r.machine, [...(by.get(r.machine) ?? []), r.path]);
    }
    return [...by];
  }, [p.initial.repos, machines]);
  const onInfos = useCallback((machine: string, infos: ReadonlyMap<string, RepoInfo>) => setKnown(prev => {
    const next = new Map(prev);
    for (const [path, info] of infos) next.set(repoKey(machine, path), { exists: info.exists, branch: info.branch });
    return next;
  }), []);

  const set = (patch: Partial<ProjectDraft>) => setD(x => ({ ...x, ...patch }));
  const taken = (machine: string, path: string) => d.repos.some(r => r.machine === machine && normalizePath(r.path) === path);
  const onAdd = ({ branch, ...repo }: Repo & { branch: string | null }) => {
    setD(x => ({ ...x, repos: [...x.repos, repo] }));
    setKnown(prev => new Map(prev).set(repoKey(repo.machine, repo.path), { exists: true, branch }));
  };
  // « Ranger aussi »: the sessions the editor was opened to file (« Ranger dans… › Nouveau projet… »), still listed.
  const candidates = p.initial.file.map(id => p.sessions.find(s => s.id === id)).filter((s): s is Session => s !== undefined);

  const problem = draftProblem(d, projects);
  const nameProblem = problem && (problem.code === 'name_empty' || problem.code === 'name_taken') ? c.problems[problem.code] : null;
  const saving = state.status === 'saving';
  const save = () => {
    setTried(true);
    if (problem) { if (nameProblem) nameRef.current?.focus(); return; }
    if (saving) return;
    const { next, id } = afterSave(projects, d, p.sessions);
    const sent = next.projects.find(x => x.id === id)!;
    const filed = p.sessions.filter(s => d.file.includes(s.id));
    const rules = filed.map(s => ruleFor(s, id));
    const created = p.mode === 'new';
    send(next,
      st => saved(st, sent) && rules.every(r => st.rules.some(x => x.machine === r.machine && x.path === r.path && x.project === r.project)),
      () => latest.current.onSaved(id, created, filed));
  };
  // Only Ctrl / ⌘ ↵ and the main button save: a plain Enter in a field or on a radio would submit the form implicitly.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); save(); }
    else if (e.target instanceof HTMLInputElement) e.preventDefault();
  };

  const showName = tried && nameProblem;
  const machinesShown = [...new Set(d.repos.map(r => labelOf(r.machine)))].join(', ');

  return (
    <form className="pe" onSubmit={e => { e.preventDefault(); save(); }} onKeyDown={onKeyDown}>
      {groups.map(([machine, paths]) => <Inspect key={machine} client={p.client} machine={machine} paths={paths} onInfos={onInfos} />)}
      <div className="pe-body">
        <div className="pe-identity">
          <div className="pe-field">
            <label className="composer-label" htmlFor={`${ids}-name`}>{c.name}</label>
            <input id={`${ids}-name`} ref={nameRef} value={d.name} maxLength={60} placeholder={c.namePlaceholder} onChange={e => set({ name: e.target.value })}
              aria-invalid={!!showName} aria-describedby={showName ? `${ids}-name-error` : undefined} />
            {showName && <span id={`${ids}-name-error`} className="set-error" role="alert">{nameProblem}</span>}
          </div>
          <fieldset className="pe-colors">
            <legend className="composer-label">{c.color}</legend>
            {COLOR_ORDER.map(k => (
              <label key={k} title={c.colors[k]} className={d.color === k ? 'on' : ''} style={{ '--c': PROJECT_COLORS[k] } as CSSProperties}>
                <input type="radio" name="pe-color" aria-label={c.colors[k]} checked={d.color === k} onChange={() => set({ color: k })} />
              </label>
            ))}
          </fieldset>
        </div>
        <div className="pe-field">
          <label className="composer-label" htmlFor={`${ids}-description`}>{c.description} <small>{c.optional}</small></label>
          <input id={`${ids}-description`} value={d.description} maxLength={120} placeholder={c.descriptionPlaceholder} onChange={e => set({ description: e.target.value })} />
        </div>
        <section className="pe-repos" aria-labelledby={`${ids}-repos`}>
          <div className="pe-repos-head"><span className="composer-label" id={`${ids}-repos`}>{c.repos(d.repos.length)}</span></div>
          {d.repos.length > 0 ? (
            <ul className="pe-repo-list">
              {d.repos.map((r, i) => {
                const m = machineOf(r.machine);
                const online = !!m && isUp(m);
                const label = labelOf(r.machine);
                const info = known.get(repoKey(r.machine, r.path));
                const owner = alsoIn(r, d, projects);
                return (
                  <li key={`${r.machine}:${r.path}:${i}`}>
                    <span className="pe-repo-main">
                      <span className="pe-repo-line">
                        <strong>{baseName(r.path)}</strong>
                        <span className="pe-machine"><i className={`machine-dot ${online ? '' : 'off'}`} />{label}</span>
                        {!online ? <span className="pe-branch">{c.offline}</span>
                          : info === undefined ? null
                          : !info.exists ? <small className="set-warn">{c.notFound}</small>
                          : info.branch ? <span className="pe-branch mono" title={c.branchTitle}>⎇ {info.branch}</span>
                          : <span className="pe-branch">{c.noGit}</span>}
                      </span>
                      <code className="mono">{r.path}</code>
                      {owner && <small className="set-warn">{c.alsoIn(owner.name)}</small>}
                    </span>
                    <Button size="icon" variant="ghost" aria-label={c.remove(baseName(r.path), label)} onClick={() => setD(x => ({ ...x, repos: x.repos.filter((_, j) => j !== i) }))}>
                      <Icon d={ICONS.close.d} size={14} />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : !adding && <p className="pe-empty">{c.empty}</p>}
          {candidates.length > 0 && (
            <div className="pe-agents">
              <span className="composer-label">{c.fileToo}</span>
              {candidates.map(s => {
                const on = d.file.includes(s.id);
                return (
                  <label key={s.id} className={`chip ${on ? 'selected' : ''}`}>
                    <input type="checkbox" checked={on} onChange={e => set({ file: e.target.checked ? [...d.file, s.id] : d.file.filter(x => x !== s.id) })} />
                    <span className="pe-agent-bot" aria-hidden="true"><SessionBot session={s} size={18} paused /></span>{s.name}
                  </label>
                );
              })}
            </div>
          )}
          {adding ? <FolderPicker client={p.client} machines={machines} taken={taken} onAdd={onAdd} />
            : <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Icon d={ICONS.plus.d} size={14} />{c.addRepo}</Button>}
        </section>
      </div>
      <footer className="composer-footer">
        {/* Task 5: in edit mode, « Supprimer le projet » (.pe-delete-btn) comes first, on the left, and leads to p.onDeleted. */}
        <span className="composer-preview">
          <ProjectSwatch project={{ color: d.color }} />
          <span>
            <span className="preview-line"><strong>{d.name.trim() || c.newName}</strong></span>
            <small>{c.preview(d.repos.length, machinesShown)}{p.mode === 'new' ? c.firstSession : ''}</small>
          </span>
        </span>
        {tried && problem ? <span className="composer-missing" role={nameProblem ? undefined : 'alert'}>{c.problems[problem.code]}</span>
          : state.status === 'refused' ? <p className="composer-missing" role="alert">{c.refused[state.reason]}</p> : null}
        <Button variant="ghost" onClick={p.onClose}>{c.cancel}</Button>
        <Button variant="primary" type="submit" aria-disabled={!!problem || saving}>
          {saving ? c.saving : p.mode === 'new' ? c.create : c.save}<Kbd>Ctrl ↵</Kbd>
        </Button>
      </footer>
    </form>
  );
}

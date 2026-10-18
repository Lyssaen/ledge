import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Projects as ProjectsState, RepoInfo, Rule } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { isUp } from '../launch/model';
import { useRepoInfo } from '../launch/useRepoInfo';
import { ProjectSwatch } from '../projects/ProjectSwatch';
import { useProjectSave } from '../projects/useProjectSave';
import { Card } from './controls';
import type { SettingsContext } from './SettingsPage';
import { Suggestions } from './Suggestions';

const NO_STATE: ProjectsState = { projects: [], rules: [] };
const keyOf = (r: { machine: string; path: string }) => `${r.machine}\n${r.path}`;
const sameFolder = (a: { machine: string; path: string }, b: { machine: string; path: string }) => a.machine === b.machine && a.path === b.path;
const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

/** One machine's repositories, inspected (useRepoInfo, lot 7): the answer goes up to the list. */
function Inspect({ client, machine, paths, onInfos }: { client: DaemonClient; machine: string; paths: readonly string[]; onInfos(machine: string, infos: ReadonlyMap<string, RepoInfo>): void }): null {
  const infos = useRepoInfo(client, machine, paths);
  const report = useRef(onInfos);
  report.current = onInfos;
  useEffect(() => { if (infos.size > 0) report.current(machine, infos); }, [machine, infos]);
  return null;
}

/** Settings › Projects (settings.tsx, `projects`, with Ledge's proposals on top, lot 11): the projects, then the remembered folders. */
export function Projects({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.projects;
  const state = ctx.projects ?? NO_STATE;
  const { machines, sessions, projectIdOf, dispatch } = ctx;
  const labelOf = (id: string) => machines.find(m => m.id === id)?.label ?? id;

  // The repositories' branches, asked of each machine online (one offline would answer « not found » for every path).
  const groups = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const p of state.projects) for (const r of p.repos) {
      const m = machines.find(x => x.id === r.machine);
      if (m && isUp(m)) by.set(r.machine, [...(by.get(r.machine) ?? []), r.path]);
    }
    return [...by];
  }, [state.projects, machines]);
  const [branches, setBranches] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const onInfos = useCallback((machine: string, infos: ReadonlyMap<string, RepoInfo>) => setBranches(prev => {
    const next = new Map(prev);
    for (const [path, info] of infos) next.set(keyOf({ machine, path }), info.exists ? info.branch : null);
    return next;
  }), []);

  return (
    <>
      {groups.map(([machine, paths]) => <Inspect key={machine} client={ctx.client} machine={machine} paths={paths} onInfos={onInfos} />)}
      <Suggestions ctx={ctx} />
      <Card title={c.title} hint={c.note}>
        {state.projects.map(p => {
          const agents = sessions.filter(s => projectIdOf(s) === p.id).length;
          return (
            <article key={p.id} className="project-entry" aria-label={p.name}>
              <ProjectSwatch project={p} />
              <div className="project-main">
                <strong title={p.name}>{p.name}</strong>
                <span className="repo-chips">
                  {p.repos.length === 0 ? <span className="set-hint">{c.noRepo}</span> : p.repos.map(r => {
                    const branch = branches.get(keyOf(r)) ?? null;
                    return (
                      <span key={keyOf(r)} className="set-tag" title={`${r.path} · ${labelOf(r.machine)}${branch ? ` · ⎇ ${branch}` : ''}`}>
                        <Icon d={branch ? ICONS.branch.d : ICONS.folder.d} size={11} />{basename(r.path)}<span className="tag-machine">{labelOf(r.machine)}</span>
                      </span>
                    );
                  })}
                </span>
              </div>
              <span className="set-hint project-count">{t.side.agents(agents)}</span>
              <span className="project-actions">
                <Button size="sm" variant="ghost" aria-label={c.editLabel(p.name)} onClick={() => dispatch({ type: 'modal', modal: { kind: 'project', edit: p.id } })}>{c.edit}</Button>
                <Button size="sm" variant="ghost" aria-label={c.deleteLabel(p.name)} onClick={() => dispatch({ type: 'modal', modal: { kind: 'project', edit: p.id, delete: true } })}>{c.delete}</Button>
              </span>
            </article>
          );
        })}
        <div className="set-row">
          <Button size="sm" onClick={() => dispatch({ type: 'modal', modal: { kind: 'project' } })}><Icon d={ICONS.plus.d} size={14} />{c.add}</Button>
        </div>
      </Card>
      <RememberedFolders ctx={ctx} state={state} labelOf={labelOf} />
    </>
  );
}

/** The folder rules: each one re-pointed to another project or forgotten through `useProjectSave` (lot 8). Nothing optimistic: the
 *  rule shows what the daemon holds until its broadcast; one change at a time; a refusal shows under the rule it was for, and
 *  « Setting saved » comes once the broadcast holds the change. */
function RememberedFolders({ ctx, state, labelOf }: { ctx: SettingsContext; state: ProjectsState; labelOf(id: string): string }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.projects;
  const { state: save, send } = useProjectSave(ctx.fleet, ctx.projects);
  // The rule the last change was for: its refusal shows under it.
  const [tried, setTried] = useState<string | null>(null);
  const saving = save.status === 'saving';

  const change = (r: Rule, next: ProjectsState, confirm: (p: ProjectsState) => boolean, what: string) => {
    setTried(keyOf(r));
    send(next, confirm, () => ctx.saved(what));
  };
  const repoint = (r: Rule, project: string) => {
    if (project === r.project) return;
    const name = state.projects.find(p => p.id === project)?.name ?? project;
    change(r, { ...state, rules: state.rules.map(x => (sameFolder(x, r) ? { ...x, project } : x)) },
      p => p.rules.some(x => sameFolder(x, r) && x.project === project), c.repointed(r.path, name));
  };
  const forget = (r: Rule) => change(r, { ...state, rules: state.rules.filter(x => !sameFolder(x, r)) }, p => !p.rules.some(x => sameFolder(x, r)), c.forgotten(r.path));

  return (
    <Card title={c.rules} hint={c.rulesNote}>
      {state.rules.length === 0 ? <p className="set-hint empty">{c.empty}</p> : state.rules.map(r => {
        const key = keyOf(r);
        return (
          <article key={key} className="rule-entry" aria-label={c.rule(r.path, labelOf(r.machine))} aria-busy={(saving && tried === key) || undefined}>
            <code className="mono" title={r.path}>{r.path}</code>
            <span className="set-hint">{labelOf(r.machine)}</span>
            <span className="rule-arrow" aria-hidden="true">→</span>
            <select className="set-input" aria-label={c.target(r.path)} value={r.project} disabled={saving} onChange={e => repoint(r, e.target.value)}>
              {state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button size="sm" variant="ghost" aria-label={c.forgetLabel(r.path)} disabled={saving} onClick={() => forget(r)}>{c.forget}</Button>
            {save.status === 'refused' && tried === key && <p className="set-error" role="alert">{c.refused[save.reason]}</p>}
          </article>
        );
      })}
    </Card>
  );
}

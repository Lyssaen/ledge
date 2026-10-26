import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { OmpApproval, Project, Role, Session } from '@ledge/protocol';
import { Bot } from '@ledge/ui/bots/Bot';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { isUp, launchDefaults, launchMessage, missingOf, MULTI_REPO_TOOLS, NO_PICK, previewOf, reposOn, toggleRepo, withMachine, withPick, withProject, withTool, type LaunchForm, type LaunchMessage, type Tool } from './model';
import { useRepoInfo } from './useRepoInfo';
import { useModels } from './useModels';
import { loadPick, savePick } from './modelPrefs';
import { effective, ModelPicker } from './ModelPicker';
import type { LaunchState } from './useLaunch';
import { cls } from '../shell/cls';
import { ProjectSwatch } from '../projects/ProjectSwatch';
import { useDefaultTool } from '../settings/tool';

const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor', 'omp'];
const APPROVALS: readonly OmpApproval[] = ['always-ask', 'write', 'yolo'];
const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

/** A message with two strong parts (« {name} will join the {table} table »), whatever their order in the language. */
function emphasized(text: (a: string, b: string) => string, a: string, b: string): ReactNode {
  const parts = text('\u0001', '\u0002').split(/([\u0001\u0002])/);
  return parts.map((part, i) => (part === '\u0001' ? <strong key={i}>{a}</strong> : part === '\u0002' ? <strong key={i}>{b}</strong> : part));
}

/** Starting a session (the mockup's LaunchComposer, ledge-harness-integration #launch): the instruction first, then the agent, preselected as
 *  the default (Settings › General) and changed for this session only behind « Change », then the project, the machine and the repositories
 *  there; the preview shows who joins which table. Nothing is sent while a field is missing: it is named instead. From the
 *  catalog (#97), `wanted` brings a role, whose defaults fill the agent, its model and effort, and the folder it was read in, on its machine (#99). */
export function LaunchComposer(p: {
  client: DaemonClient; projects: readonly Project[]; machines: readonly MachineState[]; sessions: readonly Session[];
  projectIdOf(s: Session): string | null; wanted: { project?: string; filter?: string; cwd?: string; machine?: string; role?: Pick<Role, 'id' | 'label' | 'tool' | 'model' | 'effort'> };
  onEditProject(id: string): void; onNewProject(): void;
  /** The launch in flight or its outcome (useLaunch): « Launching… » sends nothing more; a refusal or a silence is said here. */
  launch: LaunchState; onLaunch(msg: LaunchMessage, preview: { name: string; project: string; projectId: string }): void; onCancel(): void;
  /** The app's « Freeze animations »: the form's bots hold still. */
  paused?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { projects, machines } = p;
  const [defaultTool, setDefaultTool] = useDefaultTool();
  const [form, setForm] = useState<LaunchForm>(() => {
    const { role, cwd, machine } = p.wanted;
    let f = launchDefaults(projects, machines, p.wanted, role?.tool ?? defaultTool);
    // A folder « Équipes » read on another machine (#99) is launched there.
    if (machine && machine !== 'local') f = withMachine(f, projects, machine);
    // The role's model, with its effort or none; a role naming only an effort keeps the model remembered for the agent.
    const memo = loadPick(f.project, f.tool);
    f = withPick(f, role?.model ? { model: role.model, effort: role.effort ?? null } : role?.effort ? { model: memo.model, effort: role.effort } : memo);
    return cwd && reposOn(projects.find(x => x.id === f.project), f.machine).some(r => r.path === cwd) ? { ...f, repos: [cwd] } : f;
  });
  const [role, setRole] = useState(p.wanted.role);
  const [tried, setTried] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { field.current?.focus(); }, []);

  const project = projects.find(x => x.id === form.project);
  const chosen = machines.find(m => m.id === form.machine);
  const online = !!chosen && isUp(chosen);
  const here = reposOn(project, form.machine);
  // Asked only of a machine the fleet takes: another one would answer « not found » for every folder. One reconnecting (no snapshot yet)
  // is not online, so the inspection is asked again once it is.
  const infos = useRepoInfo(p.client, online ? form.machine : null, here.map(r => r.path));
  const infosNow = useRef(infos);
  infosNow.current = infos;
  // #58: the agent's models on that machine; a daemon too old for them takes no model, so none is offered or sent.
  const models = useModels(p.client, online ? form.machine : null, form.tool);
  const outdated = models.error === 'outdated';
  // OMP is launched by the daemon itself, with no fallback to another harness: where it cannot be reached (not installed, a daemon
  // that does not know it, no credentials), the launch is blocked with the reason (spec 2026-10-20 §3.1).
  const unavailable = form.tool === 'omp' && online && models.status === 'ready' && models.error ? models.error : null;
  const memo = loadPick(form.project, form.tool);
  const remembered = !!memo?.remembered && memo.model === form.model && memo.effort === form.effort;

  // A project removed, or the projects arriving after the form: the first one. The chosen machine going offline: the first one online, if any.
  useEffect(() => {
    const infos = infosNow.current;
    setForm(f => {
      let next = f;
      if (projects.length > 0 && !projects.some(x => x.id === next.project)) next = withProject(next, projects, projects[0]!.id, infos);
      const current = machines.find(m => m.id === next.machine);
      if (!current || !isUp(current)) {
        const up = machines.filter(isUp);
        const target = up.find(m => m.id === 'local') ?? up[0];
        if (target) next = withMachine(next, projects, target.id, infos);
      }
      return next;
    });
  }, [projects, machines]);
  // A chosen folder the machine does not find is let go; when none is left, the first one it finds is taken.
  useEffect(() => {
    setForm(f => {
      const kept = f.repos.filter(path => infos.get(path)?.exists !== false);
      if (kept.length === f.repos.length) return f;
      return kept.length > 0 ? { ...f, repos: kept } : f.machine === null ? { ...f, repos: [] } : withMachine(f, projects, f.machine, infos);
    });
  }, [infos]);

  const missing = missingOf(form, machines);
  const { name, seat } = previewOf(form, p.sessions, p.projectIdOf);
  // Without any project, the repositories are missing because the project is: the alert names the « No project yet » block.
  const alert = !missing ? null : missing === 'repos' && projects.length === 0 ? t.launch.noProjects : t.launch.missing[missing];
  const launching = p.launch.status === 'launching';
  const submit = () => {
    setTried(true);
    if (missing || launching || !project || unavailable) return;
    if (!outdated) savePick(project.id, form.tool, { model: form.model, effort: form.effort });
    const sent = { ...(outdated ? withPick(form, NO_PICK) : form), approval: approvable ? form.approval : 'always-ask' as const };
    p.onLaunch({ ...launchMessage(sent, name), ...(role ? { role: role.id } : {}) }, { name, project: project.name, projectId: project.id });
  };
  // Only Ctrl / ⌘ ↵ and « Launch » send: a plain Enter on a tile or a chip would submit the form implicitly (the textarea keeps its newline).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); submit(); }
    else if (e.target instanceof HTMLInputElement) e.preventDefault();
  };

  const multi = MULTI_REPO_TOOLS.has(form.tool);
  const run = !outdated ? effective(models.models, form) : {};
  // OMP's approval mode is chosen only where the daemon takes it; an older one launches it asking (its own policy, said under the field).
  const approvable = chosen?.daemon?.ompApproval === true;
  const label = (id: Tool) => t.launch.tools[id][0];
  const choose = (next: Tool) => {
    if (next === form.tool) return;
    setForm(f => withTool(f, next, loadPick(f.project, next)));
    setFeedback(t.launch.switched(label(next)));
  };
  const closeChoice = () => { setChoosing(false); trigger.current?.focus(); };
  const machineLabel = chosen?.label ?? form.machine ?? '—';
  const branch = form.repos[0] ? infos.get(form.repos[0])?.branch : null;
  // After a try, every field still incomplete is marked (the mockup); the message names the first one.
  const incomplete = { prompt: !form.prompt.trim(), machine: !online, repos: form.repos.length === 0 };
  const invalid = (k: keyof typeof incomplete) => tried && incomplete[k];

  return (
    <form className="composer" onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={onKeyDown}>
      <div className="composer-body">
        <label className="composer-prompt">
          <span className="composer-label">{t.launch.prompt}</span>
          <textarea ref={field} value={form.prompt} onChange={e => { const prompt = e.target.value; setForm(f => ({ ...f, prompt })); }} rows={4}
            placeholder={t.launch.placeholder} aria-invalid={invalid('prompt')} />
        </label>
        {role && (
          <div className="composer-role" role="note">
            <span className="composer-label">{t.launch.role}</span>
            <span className="role-pill">@{role.id}</span><strong>{role.label}</strong><small>{t.launch.roleHint}</small>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRole(undefined)}>{t.launch.roleRemove}</Button>
          </div>
        )}
        {!form.prompt && (
          <div className="composer-suggestions" role="group" aria-label={t.launch.suggestions}>
            {t.launch.ideas.map(s => <button type="button" key={s} onClick={() => { setForm(f => ({ ...f, prompt: s })); field.current?.focus(); }}>{s}</button>)}
          </div>
        )}

        <section className="integrated-harness" aria-label={t.launch.agent}>
          <div className="harness-field-label"><span className="composer-label">{t.launch.agent}</span><span>{t.launch.agentHint}</span></div>
          <button type="button" className="harness-current" ref={trigger} aria-expanded={choosing} aria-controls="harness-choices" onClick={() => setChoosing(c => !c)}>
            <span className="composer-bot" aria-hidden="true"><Bot tool={form.tool} state="working" pose={1} size={36} theme={theme} seed={'launch-' + form.tool} paused={p.paused} reducedMotion={reduced} /></span>
            <span className="harness-current-copy"><strong>{label(form.tool)}</strong><small>{t.launch.tools[form.tool][1]}</small></span>
            <span className="harness-choice-tag">{form.tool === defaultTool ? t.launch.byDefaultTag : t.launch.thisSession}</span>
            <span className="harness-change">{t.launch.change}</span>
            <span className={cls('harness-chevron', choosing && 'open')}><Icon d={ICONS.chevronRight.d} size={14} /></span>
          </button>
          {choosing && (
            <div id="harness-choices" className="harness-choice-panel" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChoice(); } }}>
              <fieldset className="composer-tools">
                <legend className="composer-label">{t.launch.chooseFor}</legend>
                {TOOLS.map(id => (
                  <label key={id} className={cls('tool-tile', form.tool === id && 'selected')}>
                    <input type="radio" name="tool" value={id} checked={form.tool === id} onChange={() => choose(id)} />
                    <span className="composer-bot" aria-hidden="true"><Bot tool={id} state="working" pose={1} size={36} theme={theme} seed={'pick-' + id} paused={p.paused} reducedMotion={reduced} /></span>
                    <span><strong>{label(id)}{defaultTool === id && <span className="harness-default-mark">{t.launch.defaultMark}</span>}</strong><small>{t.launch.tools[id][1]}</small></span>
                  </label>
                ))}
              </fieldset>
              <div className="harness-default-action">
                <span>{form.tool === defaultTool ? t.launch.isDefault : t.launch.defaultStays(label(defaultTool))}</span>
                {form.tool !== defaultTool && <Button type="button" variant="ghost" size="sm" onClick={() => { setDefaultTool(form.tool); setFeedback(t.launch.defaultSaved(label(form.tool))); }}>{t.launch.setDefault(label(form.tool))}</Button>}
                <Button type="button" variant="ghost" size="sm" onClick={closeChoice}>{t.launch.doneChoosing}</Button>
              </div>
            </div>
          )}
          {!choosing && form.tool !== defaultTool && (
            <div className="harness-override"><span>{t.launch.onlyThisOne(label(defaultTool))}</span><button type="button" onClick={() => choose(defaultTool)}>{t.launch.backToDefault}</button></div>
          )}
          {unavailable !== null && <p className="harness-unavailable" role="alert">{unavailable === 'outdated' ? t.launch.ompOutdated : t.launch.ompUnavailable(unavailable)}</p>}
          {online && !unavailable && (outdated ? <small className="models-note">{t.launch.modelsOutdated}</small>
            : <ModelPicker key={`${form.machine}|${form.tool}|${form.project}`} tool={form.tool} state={models} pick={form} remembered={remembered} onPick={pick => setForm(f => withPick(f, pick))} />)}
          {form.tool === 'omp' && !unavailable && (approvable ? (
            <fieldset className="chip-group harness-approval">
              <legend className="composer-label">{t.launch.approval}</legend>
              {APPROVALS.map(a => (
                <label key={a} className={cls('chip', form.approval === a && 'selected')} title={t.launch.approvals[a][1]}>
                  <input type="radio" name="approval" checked={form.approval === a} onChange={() => setForm(f => ({ ...f, approval: a }))} />{t.launch.approvals[a][0]}
                </label>
              ))}
              <small className="chip-hint">{t.launch.approvals[form.approval][1]}</small>
            </fieldset>
          ) : online && <small className="models-note">{t.launch.approvalOutdated}</small>)}
          {form.tool === 'omp' && <p className="harness-native">{t.launch.ompNative}</p>}
          <p className="harness-live" role="status">{feedback}</p>
        </section>

        {projects.length === 0 ? (
          <div className="composer-empty">
            <strong>{t.launch.noProjects}</strong>
            <p className="muted">{t.launch.noProjectsBody}</p>
            <Button variant="outline" size="sm" onClick={p.onNewProject}><Icon d={ICONS.plus.d} size={14} />{t.launch.newProject}</Button>
          </div>
        ) : (
          <div className="composer-where">
            <fieldset className="chip-group">
              <legend className="composer-label">{t.launch.project}</legend>
              {projects.map(x => (
                <label key={x.id} className={`chip ${form.project === x.id ? 'selected' : ''}`}>
                  <input type="radio" name="project" checked={form.project === x.id} onChange={() => setForm(f => { const g = withProject(f, projects, x.id, infos); return g.tool ? withPick(g, loadPick(x.id, g.tool)) : g; })} />
                  <ProjectSwatch project={x} />{x.name}
                </label>
              ))}
            </fieldset>
            <fieldset className="chip-group" aria-invalid={invalid('machine')}>
              <legend className="composer-label">{t.launch.machine}</legend>
              {machines.map(m => {
                const up = isUp(m);
                return (
                  <label key={m.id} className={`chip ${form.machine === m.id ? 'selected' : ''} ${up ? '' : 'disabled'}`} title={up ? undefined : t.launch.offlineTitle}>
                    <input type="radio" name="machine" disabled={!up} checked={form.machine === m.id} onChange={() => setForm(f => withMachine(f, projects, m.id, infos))} />
                    <i className={`machine-dot ${up ? '' : 'off'}`} />{m.label}{!up && <small>{t.launch.offline}</small>}
                  </label>
                );
              })}
            </fieldset>
            {form.machine !== null && project && (
              <fieldset className="chip-group" aria-invalid={invalid('repos')}>
                <legend className="composer-label">{t.launch.repos(machineLabel)}</legend>
                {here.length === 0 ? (
                  <div className="composer-norepo">
                    <p className="muted">{t.launch.noRepos(project.name, machineLabel)}</p>
                    <Button variant="outline" size="sm" onClick={() => p.onEditProject(project.id)}>{t.launch.editProject}</Button>
                  </div>
                ) : (
                  <>
                    {here.map(r => {
                      const info = infos.get(r.path);
                      const gone = info?.exists === false;
                      const on = form.repos.includes(r.path);
                      return (
                        <label key={r.path} className={`chip ${on ? 'selected' : ''} ${gone ? 'disabled' : ''}`} title={info && !gone ? info.branch ?? t.launch.noGit : undefined}>
                          <input type={multi ? 'checkbox' : 'radio'} name={multi ? undefined : 'repo'} disabled={gone} checked={on} onChange={() => setForm(f => toggleRepo(f, r.path))} />
                          <Icon d={on ? ICONS.check.d : ICONS.folder.d} size={12} />{folderName(r.path)}{gone && <small>{t.launch.notFound}</small>}
                        </label>
                      );
                    })}
                    {!multi && here.length > 1 && <small className="chip-hint">{t.launch.oneRepo(label(form.tool))}</small>}
                    {branch && <span className="chip-note">⎇ {branch}</span>}
                  </>
                )}
              </fieldset>
            )}
          </div>
        )}
      </div>

      <footer className="composer-footer">
        <div className="composer-preview" aria-live="polite">
          <span className="composer-bot" aria-hidden="true"><Bot tool={form.tool} state="starting" pose={1} size={30} theme={theme} seed={'preview-' + form.tool} paused={p.paused} reducedMotion={reduced} /></span>
          {project && (
            <span>
              <span className="preview-line">{emphasized(t.launch.joins, name, project.name)}</span>
              <small>{t.launch.seat(seat, machineLabel, form.repos.map(folderName).join(', ') || t.launch.noRepo)}{run.model && <span className="preview-model">{t.launch.pickSummary(run.model.label, run.effort && ((t.launch.efforts as Record<string, string | undefined>)[run.effort] ?? run.effort).toLowerCase())}</span>}</small>
            </span>
          )}
        </div>
        {tried && alert ? <span className="composer-missing" role="alert">{alert}</span>
          : p.launch.status === 'refused' ? <p className="composer-missing" role="alert">{t.launch.refused(p.launch.message)}</p>
          : p.launch.status === 'timeout' ? <p className="composer-missing" role="alert">{t.launch.timeout}</p> : null}
        <Button variant="ghost" type="button" onClick={p.onCancel}>{t.launch.cancel}</Button>
        <Button variant="primary" type="submit" aria-disabled={!!missing || launching || unavailable !== null}>
          <Icon d={ICONS.plus.d} size={14} />{launching ? t.launch.launching : t.launch.launch}<Kbd>Ctrl ↵</Kbd>
        </Button>
      </footer>
    </form>
  );
}

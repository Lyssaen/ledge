import { useEffect, useId, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { OmpApproval, Project, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n, type Messages } from '../i18n/lang';
import { cls } from '../shell/cls';
import { Menu, MenuItem } from '../shell/Menu';
import { PROVIDER_TITLES, ProviderLogo } from '../ide/ProviderLogo';
import { providerOf } from '../workspace/sessionTab';
import { tilde } from '../openrig/roles/model';
import { useDefaultTool } from '../settings/tool';
import { resetShort, type UsageGroup } from '../usage/model';
import { isUp, launchDefaults, missingOf, previewOf, reposOn, withMachine, withPick, withProject, withTool, type LaunchForm, type LaunchMessage, type Tool } from './model';
import { agentLimit, projectRows, type ProjectRow } from './modalModel';
import { useRepoInfo } from './useRepoInfo';
import { useModels } from './useModels';
import { loadPick } from './modelPrefs';
import { ModelPicker } from './ModelPicker';
import { launchKeys, ompBlocked, sentMessage } from './send';
import type { LaunchState } from './useLaunch';

export type LaunchWhere = 'active' | 'right';

const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor', 'omp'];
const APPROVALS: readonly OmpApproval[] = ['always-ask', 'write', 'yolo'];

const onRow = (f: LaunchForm, r: ProjectRow) => f.project === r.project && f.machine === r.machine && f.repos[0] === r.path;
/** A row taken: its project, its machine, its one folder (R3), and the model remembered for that project. */
function takeRow(f: LaunchForm, projects: readonly Project[], r: ProjectRow): LaunchForm {
  const g = { ...withMachine(withProject(f, projects, r.project), projects, r.machine), repos: [r.path] };
  return withPick(g, loadPick(r.project, g.tool));
}
/** The row to stand on when the current one is gone or offline: one online in the same project, else one online anywhere. */
const onlineRow = (rows: readonly ProjectRow[], project: string | null) => rows.find(r => r.project === project && r.up) ?? rows.find(r => r.up);

/** An agent's 5 h line: « Limite 5 h <b>84 %</b> · réinit. 14:20 », the percent amber past the threshold; none read, « Limite non lue ». */
function LimitLine({ limit, lang, m }: { limit: ReturnType<typeof agentLimit>; lang: string; m: Messages['launch']['modal'] }): JSX.Element {
  if (!limit) return <small>{m.limitUnread}</small>;
  const text = m.limit(limit.pct, limit.resetsAt ? resetShort(limit.resetsAt, Date.now(), lang) : null);
  const pct = `${limit.pct} %`;
  const at = text.indexOf(pct);
  if (at < 0) return <small>{text}</small>;
  return <small>{text.slice(0, at)}<b className={cls(limit.warn && 'amber')}>{pct}</b>{text.slice(at + pct.length)}</small>;
}

/** A sentence with one strong part (the branch), wherever the language puts it. */
function withPart(text: (x: string) => string, part: ReactNode): ReactNode {
  const [before, after] = text('\u0001').split('\u0001');
  return <>{before}{part}{after}</>;
}

/** The IDE's « Nouvelle session » form, in a Modal (docs/mockups/ledge-ide-interactive.html, launchPage()): one row per field, the project
 *  as one of its folders on a machine, each agent's 5 h limit on its tile, and where the session opens. It sends as LaunchComposer does
 *  (send.ts): nothing while a field is missing, a launch is in flight or OMP cannot run on the machine. */
export function LaunchModal(p: {
  client: DaemonClient; projects: readonly Project[]; machines: readonly MachineState[]; sessions: readonly Session[];
  projectIdOf(s: Session): string | null; wanted: { project?: string; filter?: string };
  usage: { groups: readonly UsageGroup[]; threshold: number };
  /** Where « Ouvrir » starts (openWhere); changed here for this session only. */
  where: LaunchWhere;
  launch: LaunchState;
  onLaunch(msg: LaunchMessage, preview: { name: string; project: string; projectId: string }, where: LaunchWhere): void;
  onNewProject(): void; onCancel(): void;
}): JSX.Element {
  const { t, lang } = useI18n();
  const m = t.launch.modal;
  const { projects, machines } = p;
  const [defaultTool] = useDefaultTool();
  const rows = useMemo(() => projectRows(projects, machines), [projects, machines]);
  const [form, setForm] = useState<LaunchForm>(() => {
    const f = launchDefaults(projects, machines, p.wanted, defaultTool);
    const r = rows.find(x => onRow(f, x) && x.up) ?? onlineRow(rows, f.project) ?? rows.find(x => x.project === f.project);
    return r ? takeRow(f, projects, r) : withPick(f, loadPick(f.project, f.tool));
  });
  const [where, setWhere] = useState<LaunchWhere>(p.where);
  const [tried, setTried] = useState(false);
  const [menu, setMenu] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  const id = useId();

  const project = projects.find(x => x.id === form.project);
  const chosen = machines.find(x => x.id === form.machine);
  const online = !!chosen && isUp(chosen);
  const infos = useRepoInfo(p.client, online ? form.machine : null, reposOn(project, form.machine).map(r => r.path));
  const models = useModels(p.client, online ? form.machine : null, form.tool);
  const outdated = models.error === 'outdated';
  const unavailable = ompBlocked(form, online, models);
  const approvable = chosen?.daemon?.ompApproval === true;
  const memo = loadPick(form.project, form.tool);
  const remembered = !!memo?.remembered && memo.model === form.model && memo.effort === form.effort;

  // A row gone (a project or a folder removed) or its machine going offline: a row online, in the same project first.
  useEffect(() => {
    setForm(f => {
      if (rows.find(r => onRow(f, r))?.up) return f;
      const to = onlineRow(rows, f.project);
      return to ? takeRow(f, projects, to) : f;
    });
  }, [rows, projects]);
  // The chosen folder not found on its machine is let go for the project's first one there that is (LaunchComposer's rule).
  useEffect(() => {
    setForm(f => (f.repos[0] !== undefined && infos.get(f.repos[0])?.exists === false && f.machine !== null ? withMachine(f, projects, f.machine, infos) : f));
  }, [infos, projects]);

  const missing = missingOf(form, machines);
  const { name } = previewOf(form, p.sessions, p.projectIdOf);
  const alert = !missing ? null : missing === 'repos' && projects.length === 0 ? t.launch.noProjects : t.launch.missing[missing];
  const launching = p.launch.status === 'launching';
  const submit = () => {
    setTried(true);
    if (missing || launching || !project || unavailable) return;
    p.onLaunch(sentMessage(form, project.id, name, { outdated, approvable }), { name, project: project.name, projectId: project.id }, where);
  };

  const row = rows.find(r => onRow(form, r));
  const branch = form.repos[0] ? infos.get(form.repos[0])?.branch : null;
  const lbl = (k: string) => `${id}-${k}`;

  return (
    <form className="launch-modal" onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={launchKeys(submit)}>
      <p className="launch-modal-sub">{`${m.opensIn[where]} ${m.keys}`}</p>
      <div className="launch-modal-fld">
        <span className="launch-modal-lbl" id={lbl('project')}>{m.project}</span>
        {projects.length === 0 ? (
          <div className="launch-modal-empty">
            <span>{t.launch.noProjects}</span>
            <Button variant="outline" size="sm" onClick={p.onNewProject}><Icon d={ICONS.plus.d} size={14} />{t.launch.newProject}</Button>
          </div>
        ) : (
          <Menu open={menu} onOpenChange={setMenu} label={m.project} className="launch-modal-menu" menuClassName="launch-modal-rows"
            trigger={tr => (
              <button type="button" id={lbl('row')} className="launch-modal-inp" aria-labelledby={`${lbl('project')} ${lbl('row')}`} {...tr}>
                <b>{project?.name ?? '—'}</b>
                <span className="mut">· {form.repos[0] ? tilde(form.repos[0]) : t.launch.noRepo} · {chosen?.label ?? form.machine ?? '—'}</span>
                <span className="car" aria-hidden="true">▾</span>
              </button>
            )}>
            {rows.map(r => (
              <MenuItem key={r.key} disabled={!r.up} aria-current={r === row || undefined} className={cls(r === row && 'on')}
                onSelect={() => setForm(f => takeRow(f, projects, r))}>
                <span>{r.projectName}</span><span className="mut">· {tilde(r.path)} · {r.machineLabel}</span>{!r.up && <small>{m.offline}</small>}
              </MenuItem>
            ))}
          </Menu>
        )}

        <span className="launch-modal-lbl">{m.where}</span>
        <div className="launch-modal-txt">{branch ? withPart(m.onBranch, <span className="mono">⎇ {branch}</span>) : m.inFolder}</div>

        <span className="launch-modal-lbl" id={lbl('agent')}>{m.agent}</span>
        <div>
          <div className="launch-modal-agents" role="group" aria-labelledby={lbl('agent')}>
            {TOOLS.map(tool => (
              <button type="button" key={tool} className={cls('launch-modal-agent', form.tool === tool && 'on')} aria-pressed={form.tool === tool}
                onClick={() => { if (tool !== form.tool) setForm(f => withTool(f, tool, loadPick(f.project, tool))); }}>
                <span className="an"><span aria-hidden="true"><ProviderLogo provider={providerOf(tool)} size={16} /></span>{t.launch.tools[tool][0]}</span>
                <small>{PROVIDER_TITLES[providerOf(tool)]}</small>
                <LimitLine limit={agentLimit(p.usage.groups, tool, form.machine, p.usage.threshold)} lang={lang} m={m} />
              </button>
            ))}
          </div>
          {unavailable !== null && <p className="launch-modal-alert" role="alert">{unavailable === 'outdated' ? t.launch.ompOutdated : t.launch.ompUnavailable(unavailable)}</p>}
        </div>

        <span className="launch-modal-lbl">{m.model}</span>
        <div className="launch-modal-model">
          {online && !unavailable && (outdated ? <small className="models-note">{t.launch.modelsOutdated}</small>
            : <ModelPicker key={`${form.machine}|${form.tool}|${form.project}`} tool={form.tool} state={models} pick={form} remembered={remembered} onPick={pick => setForm(f => withPick(f, pick))} />)}
        </div>

        {form.tool === 'omp' && !unavailable && <>
          <span className="launch-modal-lbl" id={lbl('perm')}>{m.permissions}</span>
          {approvable ? (
            <div className="launch-modal-segc" role="radiogroup" aria-labelledby={lbl('perm')}>
              {APPROVALS.map(a => (
                <label key={a} className={cls(form.approval === a && 'on')} title={t.launch.approvals[a][1]}>
                  <input type="radio" name={lbl('approval')} checked={form.approval === a} onChange={() => setForm(f => ({ ...f, approval: a }))} />{t.launch.approvals[a][0]}
                </label>
              ))}
            </div>
          ) : <small className="launch-modal-txt models-note">{online ? t.launch.approvalOutdated : null}</small>}
        </>}

        <label className="launch-modal-lbl" htmlFor={lbl('msg')}>{m.message}</label>
        <textarea id={lbl('msg')} ref={field} className="launch-modal-ta" value={form.prompt} aria-invalid={tried && !form.prompt.trim()}
          onChange={e => { const prompt = e.target.value; setForm(f => ({ ...f, prompt })); }} />

        <span className="launch-modal-lbl" id={lbl('open')}>{m.open}</span>
        <div className="launch-modal-radios" role="radiogroup" aria-labelledby={lbl('open')}>
          {(['active', 'right'] as const).map(w => (
            <label key={w} className="launch-modal-radio">
              <input type="radio" name={lbl('where')} checked={where === w} onChange={() => setWhere(w)} />{w === 'active' ? m.openActive : m.openRight}
            </label>
          ))}
        </div>

        <span />
        <div className="launch-modal-go">
          <Button variant="primary" type="submit" aria-disabled={!!missing || launching || unavailable !== null}>
            {launching ? t.launch.launching : m.launch}<Kbd>{m.launchKeys}</Kbd>
          </Button>
          <Button variant="outline" type="button" onClick={p.onCancel}>{m.cancel}</Button>
          {tried && alert ? <span className="launch-modal-alert" role="alert">{alert}</span>
            : p.launch.status === 'refused' ? <span className="launch-modal-alert" role="alert">{t.launch.refused(p.launch.message)}</span>
            : p.launch.status === 'timeout' ? <span className="launch-modal-alert" role="alert">{t.launch.timeout}</span> : null}
        </div>
      </div>
    </form>
  );
}

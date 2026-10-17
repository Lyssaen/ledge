import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { PROJECT_COLORS, type Project, type Session } from '@ledge/protocol';
import { Bot } from '@ledge/ui/bots/Bot';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { launchDefaults, launchMessage, missingOf, MULTI_REPO_TOOLS, previewOf, reposOn, toggleRepo, withMachine, withProject, withTool, type LaunchForm, type LaunchMessage, type Tool } from './model';
import { useRepoInfo } from './useRepoInfo';

/** Until the launch itself (task 5) says more. */
export type LaunchState = { status: 'idle' } | { status: 'launching' };

const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor'];
const isUp = (m: MachineState) => m.status === 'open';
const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

/** A message with two strong parts (« {name} will join the {table} table »), whatever their order in the language. */
function emphasized(text: (a: string, b: string) => string, a: string, b: string): ReactNode {
  const parts = text('\u0001', '\u0002').split(/([\u0001\u0002])/);
  return parts.map((part, i) => (part === '\u0001' ? <strong key={i}>{a}</strong> : part === '\u0002' ? <strong key={i}>{b}</strong> : part));
}

/** Starting a session (the mockup's LaunchComposer): the instruction first, the harness picked by its bot, then the project, the machine and
 *  the repositories there; the preview shows who joins which table. Nothing is sent while a field is missing: it is named instead. */
export function LaunchComposer(p: {
  client: DaemonClient; projects: readonly Project[]; machines: readonly MachineState[]; sessions: readonly Session[];
  projectIdOf(s: Session): string | null; wanted: { project?: string; filter?: string }; onEditProject(id: string): void; onNewProject(): void;
  launch: LaunchState; onLaunch(msg: LaunchMessage, preview: { name: string; project: string }): void; onCancel(): void;
}): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { projects, machines } = p;
  const [form, setForm] = useState<LaunchForm>(() => launchDefaults(projects, machines, p.wanted));
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);

  const project = projects.find(x => x.id === form.project);
  const chosen = machines.find(m => m.id === form.machine);
  const online = !!chosen && isUp(chosen);
  const here = reposOn(project, form.machine);
  // Asked only of a machine online: an offline one would answer « not found » for every folder.
  const infos = useRepoInfo(p.client, online ? form.machine : null, here.map(r => r.path));

  // A project removed, or the projects arriving after the form: the first one. The chosen machine going offline: the first one online, if any.
  useEffect(() => {
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
  const launching = p.launch.status === 'launching';
  const submit = () => {
    setTried(true);
    if (missing || launching || !project) return;
    p.onLaunch(launchMessage(form, name), { name, project: project.name });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  };

  const multi = form.tool === null || MULTI_REPO_TOOLS.has(form.tool);
  const machineLabel = chosen?.label ?? form.machine ?? '—';
  const branch = form.repos[0] ? infos.get(form.repos[0])?.branch : null;
  // After a try, every field still incomplete is marked (the mockup); the message names the first one.
  const incomplete = { tool: form.tool === null, prompt: !form.prompt.trim(), machine: !online, repos: form.repos.length === 0 };
  const invalid = (k: keyof typeof incomplete) => tried && incomplete[k];

  return (
    <form className="composer" onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={onKeyDown}>
      <div className="composer-body">
        <label className="composer-prompt">
          <span className="composer-label">{t.launch.prompt}</span>
          <textarea ref={field} value={form.prompt} onChange={e => { const prompt = e.target.value; setForm(f => ({ ...f, prompt })); }} rows={4}
            placeholder={t.launch.placeholder} aria-invalid={invalid('prompt')} />
        </label>
        {!form.prompt && (
          <div className="composer-suggestions" role="group" aria-label={t.launch.suggestions}>
            {t.launch.ideas.map(s => <button type="button" key={s} onClick={() => { setForm(f => ({ ...f, prompt: s })); field.current?.focus(); }}>{s}</button>)}
          </div>
        )}

        <fieldset className="composer-tools" aria-invalid={invalid('tool')}>
          <legend className="composer-label">{t.launch.agent}</legend>
          {TOOLS.map(id => {
            const [label, hint] = t.launch.tools[id];
            return (
              <label key={id} className={`tool-tile ${form.tool === id ? 'selected' : ''}`}>
                <input type="radio" name="tool" value={id} checked={form.tool === id} onChange={() => setForm(f => withTool(f, id))} />
                <Bot tool={id} state={form.tool === id ? 'working' : 'idle'} pose={1} size={46} theme={theme} seed={'pick-' + id} reducedMotion={reduced} />
                <span><strong>{label}</strong><small>{hint}</small></span>
              </label>
            );
          })}
        </fieldset>

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
                  <input type="radio" name="project" checked={form.project === x.id} onChange={() => setForm(f => withProject(f, projects, x.id, infos))} />
                  <i className="side-swatch" style={{ background: PROJECT_COLORS[x.color] }} />{x.name}
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
                    {!multi && here.length > 1 && <small className="chip-hint">{t.launch.oneRepo(t.launch.tools[form.tool!][0])}</small>}
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
          {form.tool ? <Bot tool={form.tool} state="starting" pose={1} size={30} theme={theme} seed={'preview-' + form.tool} reducedMotion={reduced} /> : <span className="preview-empty" aria-hidden="true" />}
          {project && (
            <span>
              <span className="preview-line">{emphasized(t.launch.joins, form.tool ? name : t.launch.newAgent, project.name)}</span>
              <small>{t.launch.seat(seat, machineLabel, form.repos.map(folderName).join(', ') || t.launch.noRepo)}</small>
            </span>
          )}
        </div>
        {tried && missing && <span className="composer-missing" role="alert">{t.launch.missing[missing]}</span>}
        <Button variant="ghost" type="button" onClick={p.onCancel}>{t.launch.cancel}</Button>
        <Button variant="primary" type="submit" aria-disabled={!!missing || launching}>
          <Icon d={ICONS.plus.d} size={14} />{launching ? t.launch.launching : t.launch.launch}<Kbd>Ctrl ↵</Kbd>
        </Button>
      </footer>
    </form>
  );
}

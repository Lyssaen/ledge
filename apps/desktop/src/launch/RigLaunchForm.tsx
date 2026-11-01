import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import type { MachineState, RigSpecsState } from '@ledge/fleet';
import type { OpenRigStatus, Project, RigSpecInfo } from '@ledge/protocol';
import { launchability, primaryAction, providers, recommendSpec, type RigForm, type RigMissing } from '@ledge/ui/launch/rigModel';
import { runtimeLabel } from '@ledge/ui/rigs/model';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { ProjectSwatch } from '../projects/ProjectSwatch';

const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
/** A spec by the name the form keeps (the Specs tab passes the name; a recommendation may name the id). */
export const specOf = (specs: readonly RigSpecInfo[], spec: string | null): RigSpecInfo | undefined => (spec === null ? undefined : specs.find(s => s.name === spec || s.id === spec));
/** « lead, advisor, build… »: a spec's members, when it has no summary. */
const members = (s: RigSpecInfo) => s.seats.map(x => x.member).join(', ');

export type FormMissing = RigMissing | 'machine';

/** Step 1 of « Nouveau rig » (mockups l-1 and w-1): the goal, the spec (recommended by Ledge, « Changer » to choose), the providers it
 *  needs, then where: a project, its machine and repository with the new branch and the copy, or a space off any project.
 *  The window owns the form (it outlives this step); this step only edits it. */
export function RigLaunchForm(p: {
  form: RigForm; projects: readonly Project[]; machines: readonly MachineState[]; openrig: readonly OpenRigStatus[]; specs: RigSpecsState;
  missing: readonly FormMissing[]; tried: boolean; busy: 'preparing' | 'launching' | null; refused: string | null;
  onGoal(goal: string): void; onSpec(spec: string): void; onProject(id: string | null): void; onMachine(id: string): void;
  onRepo(path: string): void; onBranch(branch: string): void; onCopy(): void; onName(name: string): void;
  onCancel(): void; onPlan(): void; onLaunch(): void; onRefreshSpecs(): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.rigLaunch;
  const { form, projects, machines } = p;
  const [choosing, setChoosing] = useState(false);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const workspaceId = useId();
  useEffect(() => { field.current?.focus(); }, []);

  const specs = p.specs.specs;
  const spec = specOf(specs, form.spec);
  const rec = recommendSpec(form.goal, specs);
  const recommended = specOf(specs, rec?.spec ?? null);
  const machine = machines.find(m => m.id === form.machine);
  const machineLabel = machine?.label ?? form.machine;
  const project = form.place.kind === 'project' ? projects.find(x => x.id === (form.place as { projectId: string }).projectId) : undefined;
  const repos = project ? project.repos.filter(r => r.machine === form.machine) : [];
  const action = primaryAction(form);
  const seats = spec?.seats.length ?? 0;
  const off = form.place.kind === 'off';
  const ideas = off ? c.ideasOff : c.ideas;
  const first = p.missing[0];
  const nameBad = form.place.kind === 'off' && p.missing.includes('name') && (p.tried || form.place.name !== '');
  const busy = p.busy !== null;
  const run = action === 'plan' ? p.onPlan : p.onLaunch;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); if (!busy) run(); }
    else if (e.target instanceof HTMLInputElement) e.preventDefault();
  };
  const where = form.place.kind === 'project' ? c.inProject(project?.name ?? form.place.projectId) : `~/.ledge/rigs/${form.place.name}`;
  const provided = spec ? providers(spec.seats) : [];

  return (
    <form className="composer rig-launch-form" onSubmit={e => { e.preventDefault(); if (!busy) run(); }} onKeyDown={onKeyDown}>
      <div className="composer-body">
        <label className="composer-prompt">
          <span className="composer-label">{c.goal}</span>
          <textarea ref={field} value={form.goal} rows={4} onChange={e => p.onGoal(e.target.value)} aria-invalid={p.tried && p.missing.includes('goal')} />
        </label>
        {!form.goal && (
          <div className="composer-suggestions" role="group" aria-label={c.suggestions}>
            {ideas.map(s => <button type="button" key={s} onClick={() => { p.onGoal(s); field.current?.focus(); }}>{s}</button>)}
          </div>
        )}

        <section className="integrated-harness rig-spec" aria-label={c.spec}>
          <div className="harness-field-label"><span className="composer-label">{c.spec}</span><span>{c.specHint}</span></div>
          <div className="harness-current rig-spec-current">
            <span className="rig-flag" aria-hidden="true">⚑</span>
            <span className="harness-current-copy">
              <strong>{spec?.name ?? c.noSpec}</strong>
              {spec && <small>{c.seatsOf(seats, members(spec))}</small>}
              {!spec && p.specs.status !== 'ready' && <small>{c.specsLoading}</small>}
              {!spec && p.specs.error && <small>{c.specsFailed}</small>}
            </span>
            {spec && recommended && spec.name === recommended.name && <span className="harness-choice-tag">{c.recommended}</span>}
            <button type="button" className="rig-spec-change" aria-expanded={choosing} aria-controls="rig-spec-choices" onClick={() => setChoosing(x => !x)}>
              {c.change}
            </button>
            <span className={cls('harness-chevron', choosing && 'open')} aria-hidden="true"><Icon d={ICONS.chevronRight.d} size={14} /></span>
          </div>
          {choosing && (
            <div id="rig-spec-choices" className="harness-choice-panel">
              <div className="rig-spec-choice-heading"><span className="composer-label">{c.chooseFor}</span>
                <button type="button" className="rig-spec-change" onClick={p.onRefreshSpecs} disabled={p.specs.status === 'loading'}>{c.refreshSpecs}</button></div>
              <div className="composer-tools rig-spec-tiles">
                {specs.map(s => (
                  <button type="button" key={s.id} className={cls('tool-tile', spec?.id === s.id && 'selected')} aria-pressed={spec?.id === s.id}
                    onClick={() => { p.onSpec(s.name); setChoosing(false); }}>
                    <span className="rig-flag" aria-hidden="true">⚑</span>
                    <span><strong>{s.name}</strong><small>{c.seatsOf(s.seats.length, s.summary ?? members(s))}</small></span>
                  </button>
                ))}
                <button type="button" className="tool-tile disabled" disabled title={c.soon}>
                  <Icon d={ICONS.plus.d} size={14} />
                  <span><strong>{c.registry}</strong><small>{c.registryWhat}</small></span>
                </button>
              </div>
              {rec && <p className="rig-recommends">{c.recommends(recommended?.name ?? rec.spec, rec.why)}</p>}
            </div>
          )}
        </section>

        {provided.length > 0 && (
          <section className="rig-providers" aria-label={c.providers}>
            <span className="composer-label">{c.providers}</span>
            <p><strong>{provided.map(x => runtimeLabel(x.runtime)).join(' + ')}</strong>
              <span>{provided.map(x => c.providerSeats(x.count, runtimeLabel(x.runtime))).join(', ')}</span></p>
          </section>
        )}

        <div className="composer-where">
          <fieldset className="chip-group">
            <legend className="composer-label">{c.where}</legend>
            {projects.map(x => (
              <label key={x.id} className={cls('chip', project?.id === x.id && 'selected')}>
                <input type="radio" name="rig-place" checked={project?.id === x.id} onChange={() => p.onProject(x.id)} />
                <ProjectSwatch project={x} />{x.name}
              </label>
            ))}
            <label className={cls('chip', off && 'selected')}>
              <input type="radio" name="rig-place" checked={off} onChange={() => p.onProject(null)} />{c.offProject}
            </label>
          </fieldset>

          {form.place.kind === 'off' && (
            <div className="rig-workspace">
              <span className="composer-label" id={workspaceId}>{c.workspace}</span>
              <div className="rig-workspace-field" aria-invalid={nameBad}>
                <span aria-hidden="true">~/.ledge/rigs/</span>
                <input aria-labelledby={workspaceId} value={form.place.name} spellCheck={false} onChange={e => p.onName(e.target.value)} />
              </div>
              {nameBad ? <small className="composer-missing" role="alert">{c.invalidName}</small> : <small className="chip-hint">{c.workspaceHelp}</small>}
            </div>
          )}

          <fieldset className="chip-group" aria-invalid={p.tried && p.missing.includes('machine')}>
            <legend className="composer-label">{c.machine}</legend>
            {machines.map(m => {
              const ok = launchability(m, p.openrig.find(s => s.machine === m.id));
              const why = ok.ok ? null : ok.why === 'absent' ? c.why.absent(m.label) : ok.why === 'unsupported' ? c.why.unsupported(p.openrig.find(s => s.machine === m.id)?.version ?? '?') : c.why[ok.why];
              return (
                <label key={m.id} className={cls('chip', form.machine === m.id && 'selected', !ok.ok && 'disabled')}>
                  <input type="radio" name="rig-machine" disabled={!ok.ok} checked={form.machine === m.id} onChange={() => p.onMachine(m.id)} />
                  <i className={cls('machine-dot', m.status !== 'open' && 'off')} />{m.label}{why && <small>{why}</small>}
                </label>
              );
            })}
          </fieldset>
          {machines.map(m => {
            const ok = launchability(m, p.openrig.find(s => s.machine === m.id));
            if (ok.ok || !ok.install) return null;
            const install = ok.install;
            return (
              <p key={m.id} className="rig-install">
                <code>{install}</code>
                <Button type="button" variant="ghost" size="sm" onClick={() => { try { void navigator.clipboard?.writeText(install).then(() => setCopied(true), () => undefined); } catch { /* nothing copied */ } }}>
                  {copied ? c.copied : c.copyInstall}
                </Button>
              </p>
            );
          })}

          {form.place.kind === 'project' && project && (
            <fieldset className="chip-group" aria-invalid={p.tried && (p.missing.includes('repo') || p.missing.includes('branch'))}>
              <legend className="composer-label">{c.repos(machineLabel)}</legend>
              {repos.length === 0 ? <p className="muted rig-norepo">{c.noRepo(project.name, machineLabel)}</p> : repos.map(r => {
                const on = form.place.kind === 'project' && form.place.repo === r.path;
                return (
                  <label key={r.path} className={cls('chip', on && 'selected')}>
                    <input type="radio" name="rig-repo" checked={on} onChange={() => p.onRepo(r.path)} />
                    <Icon d={on ? ICONS.check.d : ICONS.folder.d} size={12} />{folderName(r.path)}
                  </label>
                );
              })}
              <label className="rig-branch">
                <Icon d={ICONS.branch.d} size={12} /><span>{c.branch}</span>
                <input value={form.place.branch} spellCheck={false} onChange={e => p.onBranch(e.target.value)} />
              </label>
              <div className="rig-copy">
                <button type="button" className={cls('chip', form.place.copy && 'selected')} aria-pressed={form.place.copy} onClick={p.onCopy}>
                  {form.place.copy && <Icon d={ICONS.check.d} size={12} />}{c.copy}
                </button>
                {form.place.copy && spec && <code className="chip-note">.worktrees/rig-{spec.name}</code>}
              </div>
            </fieldset>
          )}
        </div>
      </div>

      <footer className="composer-footer rig-launch-footer">
        <div className="composer-preview" aria-live="polite">
          <span className="rig-flag" aria-hidden="true">⚑</span>
          {spec && (
            <span>
              <span className="preview-line"><strong>{spec.name}</strong> {off ? c.opensOff : c.opens}</span>
              <small>{c.summary(seats, where, machineLabel)}</small>
            </span>
          )}
        </div>
        <Button variant="ghost" type="button" onClick={p.onCancel}>{c.cancel}</Button>
        <Button variant={action === 'plan' ? 'primary' : 'outline'} type="button" aria-disabled={busy} onClick={() => { if (!busy) p.onPlan(); }}>{c.seePlan}</Button>
        {action === 'launch' && (
          <Button variant="primary" type="submit" aria-disabled={busy}>
            {p.busy === 'launching' ? c.launching : c.launch}<Kbd>Ctrl ↵</Kbd>
          </Button>
        )}
      </footer>
      {p.busy === 'preparing' ? <p className="rig-launch-status" role="status">{c.preparing}</p>
        : p.refused ? <p className="composer-missing rig-launch-status" role="alert">{c.refused(p.refused)}</p>
        : p.tried && first ? <p className="composer-missing rig-launch-status" role="alert">{c.missing[first]}</p> : null}
    </form>
  );
}

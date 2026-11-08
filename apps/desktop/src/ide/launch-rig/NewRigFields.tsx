import { useId, useState, type JSX, type ReactNode } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { launchRig } from '@ledge/fleet/openrig';
import { RIG_POLICIES, type OpenRigAction, type OpenRigLaunched, type OpenRigState, type RigPolicy, type RigSpec } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../../i18n/lang';
import { builtinOf, bypasses, emptyForm, multiplies, rolesOf, seatTotal, type LaunchForm } from '../../openrig/model';
import { Outcome } from '../../openrig/RigLaunchForm';
import { cls } from '../../shell/cls';
import { PermSegment } from '../PermSegment';
import { rigErrorText } from '../rig/errors';
import type { PermLevel } from '../rig/model';
import { emptySeats, launchProblem, liveCommand, newLaunch } from './model';
import { Command, GoRow, Row, RuntimeLogo, useGo, type GoRef } from './parts';

export interface NewRigFieldsProps {
  client: DaemonClient; machine: string; machineLabel: string; state: OpenRigState;
  /** The spec the rig is made from; `empty`: the empty rig (R4), made from `factory`. */ spec: RigSpec; empty: boolean;
  folders: ReadonlyArray<{ label: string; path: string }>; level: PermLevel; startAction: OpenRigAction;
  machineRow: ReactNode; go: GoRef; onLaunched(machine: string, rig: string): void; onClose(): void;
}

/** A new rig (R3): from a library spec or the empty rig. The command follows the form live; « Lancer » launches it, « Vérifier » (under
 *  « Plus d'options ») runs its plan. Mounted per machine and card, so nothing of another machine's form is ever sent (Review Focus 1). */
export function NewRigFields({ client, machine, machineLabel, state, spec, empty, folders, level: start, startAction, machineRow, go, onLaunched, onClose }: NewRigFieldsProps): JSX.Element {
  const { t } = useI18n();
  const L = t.ide.launchRig, l = t.openrig.launch;
  const id = useId();
  const [form, setForm] = useState<LaunchForm>(() => ({ ...emptyForm(spec, folders[0]?.path ?? ''), name: empty ? 'nouveau-rig' : spec.name, ...(empty ? { seats: emptySeats(spec) } : {}) }));
  const [level, setLevel] = useState<PermLevel>(start);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<'check' | 'launch' | null>(null);
  const [checked, setChecked] = useState<OpenRigLaunched | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const set = (patch: Partial<LaunchForm>) => { setForm(f => ({ ...f, ...patch })); setChecked(null); setFailed(null); };

  const problem = launchProblem(form, state, spec);
  const launch = newLaunch(spec, form, level, false);
  const withLevel: LaunchForm = { ...form, policy: level === 'spec' ? null : level as RigPolicy };
  const total = seatTotal(spec, form);
  const send = async (plan: boolean) => {
    if (problem || busy) return;
    setBusy(plan ? 'check' : 'launch'); setChecked(null); setFailed(null);
    const r = await launchRig(client, machine, newLaunch(spec, form, level, plan));
    setBusy(null);
    if (plan) setChecked(r);
    else if (r.ok) onLaunched(machine, launch.name);
    else setFailed(r.error ?? '');
  };
  useGo(go, problem || busy ? null : () => void send(false));

  const roles = rolesOf(spec);
  const stepper = (role: string, n: number) => (
    <span className="ide-rl-step">
      <button type="button" aria-label={l.fewer(role)} disabled={n <= 0} onClick={() => set({ seats: { ...form.seats, [role]: n - 1 } })}>−</button>
      <span aria-live="polite">{n}</span>
      <button type="button" aria-label={l.more(role)} disabled={n >= 9} onClick={() => set({ seats: { ...form.seats, [role]: n + 1 } })}>+</button>
    </span>
  );
  const problemText = problem === 'exists' ? L.problems.exists(machineLabel) : problem ? L.problems[problem] : null;

  return <>
    <Row label={L.name} htmlFor={`${id}-name`}>
      <input id={`${id}-name`} className="ide-rl-input mono" value={form.name} spellCheck={false} aria-invalid={problem === 'name' || problem === 'exists'} onChange={e => set({ name: e.target.value })} />
    </Row>
    {machineRow}
    <Row label={L.folder} htmlFor={`${id}-cwd`}>
      <span className="ide-rl-cwd">
        <input id={`${id}-cwd`} className="ide-rl-input mono" list={`${id}-folders`} value={form.cwd} placeholder="~/Workspace/mon-projet" spellCheck={false} aria-invalid={problem === 'cwd'} onChange={e => set({ cwd: e.target.value })} />
        <datalist id={`${id}-folders`}>{folders.map(f => <option key={f.path} value={f.path}>{f.label}</option>)}</datalist>
      </span>
    </Row>
    <Row label={<>{L.seats} <span className="mono">{total}</span></>}>
      <div className="ide-rl-seats">
        {roles.map(r => {
          const n = form.seats[r.role] ?? 1;
          return <div key={r.role} className="ide-rl-seat"><RuntimeLogo runtime={form.runtimes[r.role] ?? r.runtime} /><span className="mono">{r.role}</span>{empty && n === 0 && <span className="ide-rl-mut">{L.toFill}</span>}{stepper(r.role, n)}</div>;
        })}
      </div>
    </Row>
    <Row label={L.permissions}><PermSegment value={level} label={L.permissions} onChange={l2 => { setLevel(l2); setChecked(null); setFailed(null); }} /></Row>
    <Command text={liveCommand({ daemonUp: true, startAction, launch, spec })} />
    <span />
    <details className="ide-rl-more" open={more}>
      <summary onClick={e => { e.preventDefault(); setMore(m => !m); }}>{L.more}</summary>
      {more && <div className="ide-rl-more-body">
        <div className="ide-rl-roles">
          <div className="ide-rl-role ide-rl-role-head" aria-hidden="true"><span>{l.role}</span><span>{l.runtime}</span><span>{l.model}</span><span>{l.permsColumn}</span></div>
          {roles.map(r => {
            const runtime = form.runtimes[r.role] ?? r.runtime;
            const own = builtinOf(spec.pods.find(p => p.id === r.pod)?.members.find(m => m.id === r.id)?.policy);
            return (
              <div key={r.role} className="ide-rl-role">
                <span className="mono">{r.role}</span>
                <select aria-label={`${l.runtime} · ${r.role}`} value={runtime} onChange={e => set({ runtimes: { ...form.runtimes, [r.role]: e.target.value as 'claude-code' | 'codex' } })}>
                  {[...new Set(['claude-code', 'codex', r.runtime])].map(x => <option key={x} value={x}>{x}</option>)}
                </select>
                <input className="mono" aria-label={`${l.model} · ${r.role}`} value={form.models[r.role] ?? (runtime === r.runtime ? r.model ?? '' : '')} placeholder={l.modelPlaceholder} spellCheck={false}
                  onChange={e => set({ models: { ...form.models, [r.role]: e.target.value } })} />
                <select aria-label={`${l.permsColumn} · ${r.role}`} value={form.policies[r.role] ?? ''}
                  onChange={e => { const { [r.role]: _drop, ...rest } = form.policies; set({ policies: e.target.value ? { ...rest, [r.role]: e.target.value as RigPolicy } : rest }); }}>
                  <option value="">{l.permsRole}{own ? ` · ${l.policy[own]}` : ''}</option>
                  {RIG_POLICIES.map(x => <option key={x} value={x}>{l.policy[x]}</option>)}
                </select>
              </div>
            );
          })}
        </div>
        {multiplies(form) && (
          <div className="ide-rl-seg" role="radiogroup" aria-label={l.delegation}>
            {(['pairs', 'all'] as const).map(d => <button key={d} type="button" role="radio" aria-checked={form.delegation === d} className={cls(form.delegation === d && 'on')} onClick={() => set({ delegation: d })}>{l[d]}</button>)}
          </div>
        )}
        {bypasses(withLevel) && <label className="ide-rl-check"><input type="checkbox" checked={form.nonInterruptive} onChange={e => set({ nonInterruptive: e.target.checked })} />{l.nonInterruptive}<code>--non-interruptive</code></label>}
        <label className="ide-rl-check"><input type="checkbox" checked={form.save} onChange={e => set({ save: e.target.checked })} />{l.save(form.name.trim() || spec.name)}</label>
        <div className="ide-rl-go">
          <Button variant="outline" disabled={problem !== null || busy !== null} onClick={() => void send(true)}>{busy === 'check' ? l.checking : l.check}</Button>
        </div>
        <Outcome result={checked} name={form.name.trim()} />
        {checked?.yaml && <pre className="ide-rl-yaml">{checked.yaml}</pre>}
      </div>}
    </details>
    <GoRow text={busy === 'launch' ? l.launching : L.go} disabled={problem !== null || busy !== null} onGo={() => void send(false)} onClose={onClose}
      alert={failed !== null ? l.errors[failed] ?? rigErrorText(t, failed) : problemText} note={L.opensTab(form.name.trim())} />
  </>;
}

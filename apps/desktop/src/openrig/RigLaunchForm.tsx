import { useEffect, useId, useMemo, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { launchRig, useRigSpecs } from '@ledge/fleet/openrig';
import { RIG_POLICIES, type OpenRigLaunched, type Projects, type RigPolicy, type RigSpec } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { builtinOf, bypasses, emptyForm, folderChoices, launchable, launchOf, multiplies, rolesOf, seatTotal, type LaunchForm } from './model';

/** The warning OpenRig gives for each seat without a permission policy: summed up in one line. */
const NO_POLICY = /permission_policy absent/;

/**
 * Launching a rig (docs/mockups/ledge-openrig.html, view 6): a spec of the machine's library, a folder and a name, how many
 * seats per role and their harness and model, how the added seats delegate, and whether to keep the composed spec. « Vérifier »
 * runs `rig up --plan` and shows the spec that would launch; « Lancer » launches it.
 */
export function RigLaunchForm({ client, machine, machineLabel, projects, onClose, onLaunched }: {
  client: DaemonClient; machine: string; machineLabel: string; projects: Projects | null; onClose: () => void; onLaunched: (name: string) => void;
}) {
  const { t } = useI18n();
  const l = t.openrig.launch;
  const specs = useRigSpecs(client, machine);
  const folders = useMemo(() => folderChoices(projects, machine), [projects, machine]);
  const [specName, setSpecName] = useState<string | null>(null);
  const spec = specs.specs.find(s => s.name === specName) ?? specs.specs[0];
  const [form, setForm] = useState<LaunchForm>(() => emptyForm(undefined, folders[0]?.path ?? ''));
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState<'check' | 'launch' | null>(null);
  const [result, setResult] = useState<OpenRigLaunched | null>(null);
  const listId = useId();
  // A new spec starts from its own roles, and from its name unless the person typed one.
  useEffect(() => { setForm(f => ({ ...emptyForm(spec, f.cwd), name: named ? f.name : spec?.name ?? '', save: f.save })); setResult(null); }, [spec?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<LaunchForm>) => { setForm(f => ({ ...f, ...patch })); setResult(null); };
  const send = async (plan: boolean) => {
    if (!spec || !launchable(form) || busy) return;
    setBusy(plan ? 'check' : 'launch');
    const r = await launchRig(client, machine, launchOf(spec, form, plan));
    setBusy(null); setResult(r);
    if (r.ok && !r.plan) onLaunched(form.name.trim());
  };
  const total = spec ? seatTotal(spec, form) : 0;
  return (
    <div className="or-launch" aria-label={l.title}>
      <div className="or-launch-main">
        <section className="or-fsec" aria-label={l.spec}>
          <h3>{l.spec}</h3>
          <p className="or-hint">{l.specHint}</p>
          {specs.status !== 'ready' ? <p className="or-empty" role="status">{l.loadingSpecs}</p>
            : specs.error ? <p className="or-empty" role="status">{l.errors[specs.error] ?? specs.error}</p>
            : specs.specs.length === 0 ? <p className="or-empty">{l.noSpecs}</p>
            : <div className="or-specs" role="radiogroup" aria-label={l.spec}>
              {specs.specs.map(s => (
                <button key={s.name} type="button" role="radio" aria-checked={s.name === spec?.name} className={cls('or-spec', s.name === spec?.name && 'sel')} onClick={() => setSpecName(s.name)} title={s.summary}>
                  <b>{s.name}<span className="or-src">{s.source === 'user' ? l.mine : l.builtin}</span></b>
                  <span>{rolesOf(s).map(r => r.id).join(', ')} · {l.seatsOf(rolesOf(s).length)}</span>
                </button>
              ))}
            </div>}
        </section>
        {spec && <>
          <section className="or-fsec" aria-label={l.where}>
            <h3>{l.where}</h3>
            <div className="or-row3">
              <label className="or-fld">{l.folder}
                <input className="ledge-field mono" list={listId} value={form.cwd} placeholder="~/Workspace/mon-projet" spellCheck={false} onChange={e => set({ cwd: e.target.value })} />
                <datalist id={listId}>{folders.map(f => <option key={f.path} value={f.path}>{f.label}</option>)}</datalist>
              </label>
              <label className="or-fld">{l.machine}<span className="or-static"><span className="or-dot or-ok" />{machineLabel}</span></label>
              <label className="or-fld">{l.name}<input className="ledge-field mono" value={form.name} spellCheck={false} onChange={e => { setNamed(true); set({ name: e.target.value }); }} /></label>
            </div>
            <p className="or-hint or-under">{l.folderHint}</p>
          </section>
          <section className="or-fsec" aria-label={l.roles}>
            <h3>{l.roles}</h3>
            <p className="or-hint">{l.rolesHint}</p>
            <div className="or-roles">
              <div className="or-role or-role-head" aria-hidden><span>{l.role}</span><span>{l.runtime}</span><span>{l.model}</span><span>{l.permsColumn}</span><span>{l.count}</span></div>
              {spec.pods.map(p => (
                <div key={p.id}>
                  <div className="or-pod">pod {p.id}{p.label ? ` · ${p.label}` : ''}</div>
                  {rolesOf({ ...spec, pods: [p] } as RigSpec).map(r => {
                    const n = form.seats[r.role] ?? 1;
                    const runtime = form.runtimes[r.role] ?? r.runtime;
                    return (
                      <div key={r.role} className="or-role">
                        <span className="mono">{r.id}<small>{r.agent}</small></span>
                        <select className="ledge-field" aria-label={`${l.runtime} · ${r.role}`} value={runtime} onChange={e => set({ runtimes: { ...form.runtimes, [r.role]: e.target.value as 'claude-code' | 'codex' } })}>
                          {[...new Set(['claude-code', 'codex', r.runtime])].map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                        <input className="ledge-field mono" aria-label={`${l.model} · ${r.role}`} value={form.models[r.role] ?? (runtime === r.runtime ? r.model ?? '' : '')} placeholder={l.modelPlaceholder} spellCheck={false}
                          onChange={e => set({ models: { ...form.models, [r.role]: e.target.value } })} />
                        <select className="ledge-field" aria-label={`${l.permsColumn} · ${r.role}`} value={form.policies[r.role] ?? ''}
                          onChange={e => { const { [r.role]: _drop, ...rest } = form.policies; set({ policies: e.target.value ? { ...rest, [r.role]: e.target.value as RigPolicy } : rest }); }}>
                          <option value="">{l.permsRole}{(() => { const own = builtinOf(spec.pods.find(p => p.id === r.pod)?.members.find(m => m.id === r.id)?.policy); return own ? ` · ${l.policy[own]}` : ''; })()}</option>
                          {RIG_POLICIES.map(x => <option key={x} value={x}>{l.policy[x]}</option>)}
                        </select>
                        <span className={cls('or-step', n !== 1 && 'changed')}>
                          <button type="button" aria-label={l.fewer(r.role)} disabled={n <= 0} onClick={() => set({ seats: { ...form.seats, [r.role]: n - 1 } })}>−</button>
                          <span aria-live="polite">{n}</span>
                          <button type="button" aria-label={l.more(r.role)} disabled={n >= 9} onClick={() => set({ seats: { ...form.seats, [r.role]: n + 1 } })}>+</button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
          <section className="or-fsec" aria-label={l.perms}>
            <h3>{l.perms}</h3>
            <p className="or-hint">{l.permsHint}</p>
            <div className="or-seg or-seg-wrap" role="radiogroup" aria-label={l.perms}>
              <button type="button" role="radio" aria-checked={form.policy === null} onClick={() => set({ policy: null })}>{l.permsSpec(builtinOf(spec.policy) ? l.policy[builtinOf(spec.policy)!]! : spec.policy ?? '')}</button>
              {RIG_POLICIES.map(x => <button key={x} type="button" role="radio" aria-checked={form.policy === x} className={x === 'yolo' ? 'or-risky' : undefined} onClick={() => set({ policy: x })}>{l.policy[x]}</button>)}
            </div>
            <p className="or-hint or-under">{l.policyHint[form.policy ?? builtinOf(spec.policy) ?? 'none']}</p>
            {bypasses(form) && <>
              <label className="or-check or-check-top"><input type="checkbox" checked={form.nonInterruptive} onChange={e => set({ nonInterruptive: e.target.checked })} />{l.nonInterruptive}<code>--non-interruptive</code></label>
              <p className="or-hint or-indent">{l.nonInterruptiveHint}</p>
            </>}
          </section>
          {multiplies(form) && (
            <section className="or-fsec" aria-label={l.delegation}>
              <h3>{l.delegation}</h3>
              <div className="or-seg" role="radiogroup" aria-label={l.delegation}>
                {(['pairs', 'all'] as const).map(d => <button key={d} type="button" role="radio" aria-checked={form.delegation === d} onClick={() => set({ delegation: d })}>{l[d]}</button>)}
              </div>
            </section>
          )}
          <div className="or-factions">
            <label className="or-check"><input type="checkbox" checked={form.save} onChange={e => set({ save: e.target.checked })} />{l.save(form.name.trim() || spec.name)}</label>
            <span className="or-fill" />
            <Button size="sm" variant="ghost" onClick={onClose}>{l.cancel}</Button>
            <Button size="sm" disabled={!launchable(form) || busy !== null} onClick={() => void send(true)}>{busy === 'check' ? l.checking : l.check}</Button>
            <Button size="sm" variant="primary" disabled={!launchable(form) || busy !== null || total === 0} onClick={() => void send(false)}>{busy === 'launch' ? l.launching : l.go(total)}</Button>
          </div>
        </>}
      </div>
      <aside className="or-launch-aside">
        <Outcome result={result} name={form.name.trim()} />
        <div className="or-yaml-box">
          <h4>{l.preview}</h4>
          {result?.yaml ? <pre className="or-yaml">{result.yaml}</pre> : <p className="or-hint">{l.previewHint}</p>}
        </div>
        <div className="or-where">
          <h4>{l.where2}</h4>
          <ul><li>{l.whereBuiltin}</li><li>{l.whereMine}</li><li>{l.whereLedge}</li></ul>
        </div>
      </aside>
    </div>
  );
}

/** How the last check or launch ended (also under the IDE launch modal's « Plus d'options »). */
export function Outcome({ result, name }: { result: OpenRigLaunched | null; name: string }) {
  const { t } = useI18n();
  const l = t.openrig.launch;
  if (!result) return null;
  if (!result.ok) return (
    <div className="or-status or-err" role="alert">
      <p>{l.errors[result.error ?? ''] ?? t.openrig.failed(result.error ?? '')}</p>
      {result.commands.length > 0 && <code>{result.commands.join(' && ')}</code>}
    </div>
  );
  const check = result.check;
  const blocked = check && check.errors.length > 0;
  const policy = check?.warnings.filter(w => NO_POLICY.test(w)).length ?? 0;
  const others = check?.warnings.filter(w => !NO_POLICY.test(w)) ?? [];
  return (
    <div className={cls('or-status', blocked ? 'or-err' : 'or-ok')} role="status">
      <p><Icon d={blocked ? ICONS.close.d : ICONS.check.d} size={13} />{blocked ? l.planBlocked(check!.status) : result.plan ? l.planOk(result.seats ?? 0) : l.launched(name)}</p>
      {check?.errors.map(e => <p key={e} className="or-line">{e}</p>)}
      {policy > 0 && <p className="or-line">{l.noPolicy(policy)}</p>}
      {others.map(w => <p key={w} className="or-line">{w}</p>)}
      <code>{result.commands.join(' && ')}</code>
    </div>
  );
}

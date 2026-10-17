import { useId, useState, type FormEvent, type JSX, type ReactNode } from 'react';
import { sshProblem, type MachineState, type ProbeResult } from '@ledge/fleet';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Card } from './controls';
import { ALIAS, checkDraft, configsOf, MAX_MACHINES, sameMachines, without, withDraft, type MachineDraft } from './machines';
import { useMachineEditor, type SaveOutcome } from './useMachineEditor';
import type { SettingsContext } from './SettingsPage';

type Shown = 'online' | 'connecting' | 'offline';
/** « En ligne » is `ready`; a machine whose last try ended in an error is offline even while its client waits to try again. */
const shownOf = (m: MachineState): Shown => (m.ready ? 'online' : m.error || m.status === 'unreachable' ? 'offline' : 'connecting');
const SERVER_GLYPH = ['M4 3h16v7H4z', 'M4 14h16v7H4z', 'M7 6.5h.01', 'M7 17.5h.01'];
const LOCAL_GLYPH = ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8'];

/** The form: adding (`editing` null) or editing a machine, its draft, and whether « Before adding a server » is open. */
interface FormState { editing: string | null; draft: MachineDraft; help: boolean }
/** A failure to show under a machine (its id) or in the form ('form'). */
interface Failure { key: string; text: string }

/** Settings › Machines (settings.tsx, `MachinesSection`; logic of origin/feat/desktop's MachinesPanel). The list is the local
 *  daemon's: every change goes through `machines.set` and shows, with « Setting saved », only once its broadcast brings the
 *  same list back. The local machine comes first and has no action. A test's result shows under the machine (or the form)
 *  it ran from, and nowhere else. */
export function Machines({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.machines;
  const { machines, fleet, saved } = ctx;
  const editor = useMachineEditor(fleet, machines);
  const [form, setForm] = useState<FormState | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const ids = useId();
  const list = configsOf(machines);
  const localUp = machines.find(m => m.id === 'local')?.ready === true;
  const probeBusy = editor.probing !== null && editor.probing.result === null;
  const frozen = editor.saving;

  const probeText = (r: ProbeResult) => (r.ok ? c.probeOk(r.version, r.sessions) : c.problem[sshProblem(r.error)]);
  const probeWell = (key: string): ReactNode => {
    const p = editor.probing;
    if (p?.key !== key) return null;
    if (!p.result) return <div role="status" className="set-well"><span className="ledge-spin"><Icon d={ICONS.refresh.d} size={14} /></span><span>{c.probing}<code>{p.alias}</code>…</span></div>;
    return <div role="status" className={`set-well ${p.result.ok ? 'ok' : 'bad'}`}><Icon d={p.result.ok ? ICONS.check.d : ICONS.close.d} size={14} /><span>{probeText(p.result)}</span></div>;
  };
  const failureWell = (key: string): ReactNode => (failure?.key === key ? <div role="alert" className="set-well bad"><Icon d={ICONS.close.d} size={14} /><span>{failure.text}</span></div> : null);
  const failed = (o: Exclude<SaveOutcome, 'saved'>) => c.errors[o];

  const openForm = (m?: MachineState) => {
    editor.clearProbe(); setConfirming(null); setFailure(null);
    setForm({ editing: m?.id ?? null, draft: { label: m?.label ?? '', ssh: m?.ssh ?? '' }, help: !m });
  };
  const closeForm = () => { editor.clearProbe(); setForm(null); setFailure(null); };
  const setDraft = (patch: Partial<MachineDraft>) => setForm(f => (f ? { ...f, draft: { ...f.draft, ...patch } } : f));

  const editing = form?.editing ? machines.find(m => m.id === form.editing) : undefined;
  const alias = form?.draft.ssh.trim() ?? '';
  const aliasBad = alias !== '' && !ALIAS.test(alias);
  const duplicate = form !== null && list.some(m => m.id !== form.editing && m.ssh === alias);
  const problem = form ? checkDraft(list, form.draft, form.editing) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || editor.saving) return;
    // A duplicate, a malformed alias or a full list already says so beside its field; the rest (an empty name) says it here.
    if (problem) { if (problem === 'invalid' && !aliasBad) setFailure({ key: 'form', text: c.errors.invalid }); return; }
    const next = withDraft(list, form.draft, form.editing);
    if (sameMachines(list, next)) { closeForm(); return; }   // nothing changed: nothing to save, nothing to say
    setFailure(null);
    const outcome = await editor.save(next);
    if (outcome !== 'saved') { setFailure({ key: 'form', text: failed(outcome) }); return; }
    const label = form.draft.label.trim();
    closeForm();
    saved(form.editing ? c.edited(label) : c.added(label));
  };
  const remove = async (m: MachineState) => {
    setFailure(null);
    const outcome = await editor.save(without(list, m.id));
    setConfirming(null);
    if (outcome === 'saved') saved(c.removed(m.label));
    else setFailure({ key: m.id, text: failed(outcome) });
  };
  const testDraft = () => {
    if (!form) return;
    const ssh = form.draft.ssh.trim();
    if (ALIAS.test(ssh)) editor.probe(`draft:${ssh}`, ssh);
  };

  return (
    <Card title={c.title} hint={<>{c.noteLead}<strong>{c.noteShared}</strong>{c.noteRest}</>}>
      {!localUp && <div role="status" className="set-well"><span>{t.offline}</span></div>}
      {machines.map(m => {
        if (form?.editing === m.id) return null;
        const shown = shownOf(m);
        return (
          <article key={m.id} className="machine-entry" aria-label={m.label}>
            <span className="machine-glyph" aria-hidden="true"><Icon d={m.ssh ? SERVER_GLYPH : LOCAL_GLYPH} size={16} /></span>
            <div className="machine-main">
              <div className="machine-top">
                <strong>{m.label}</strong>{m.id === 'local' && <span className="set-tag">{c.local}</span>}<span className="spacer" />
                <span className={`set-status ${shown}`}><i aria-hidden="true" />{c.status[shown]}</span>
              </div>
              <span className="set-hint mono">{m.ssh ? c.ssh(m.ssh) : c.localKind} · {c.version(m.daemon?.version ?? m.version)} · {c.sessions(m.sessions.length)}</span>
              {probeWell(m.id)}
              {failureWell(m.id)}
              {m.ssh && m.id !== 'local' && (confirming === m.id
                ? (
                  <div role="alert" className="set-well warn">
                    <span>{c.confirm.before}<strong>{m.label}</strong>{c.confirm.after}</span>
                    <div className="set-actions">
                      <Button size="sm" variant="primary" disabled={frozen} onClick={() => void remove(m)}>{c.remove}</Button>
                      <Button size="sm" variant="ghost" disabled={frozen} onClick={() => setConfirming(null)}>{c.cancel}</Button>
                    </div>
                  </div>
                )
                : (
                  <div className="set-actions">
                    {shown === 'offline' && <Button size="sm" variant="outline" onClick={() => fleet.retry(m.id)}><Icon d={ICONS.refresh.d} size={14} />{c.reconnect}</Button>}
                    <Button size="sm" variant="ghost" disabled={probeBusy} onClick={() => editor.probe(m.id, m.ssh!)}>{c.test}</Button>
                    <Button size="sm" variant="ghost" disabled={frozen} onClick={() => openForm(m)}>{c.edit}</Button>
                    <Button size="sm" variant="ghost" disabled={frozen} onClick={() => { setFailure(null); setConfirming(m.id); }}>{c.remove}</Button>
                  </div>
                ))}
            </div>
          </article>
        );
      })}
      {form ? (
        <form className="machine-form" noValidate aria-labelledby={`${ids}t`} onSubmit={e => void submit(e)}>
          <h3 id={`${ids}t`}>{editing ? c.editTitle(editing.label) : c.addTitle}</h3>
          <div className="form-grid">
            <label>{c.label}<span className="set-hint" id={`${ids}lh`}>{c.labelHint}</span>
              <input autoFocus aria-label={c.labelAria} aria-describedby={`${ids}lh`} value={form.draft.label} maxLength={80} placeholder={c.labelPlaceholder} onChange={e => setDraft({ label: e.target.value })} />
            </label>
            <label>{c.alias}<span className="set-hint" id={`${ids}ah`}>{c.aliasHint}</span>
              <input className="mono" aria-label={c.alias} aria-describedby={`${ids}ah`} value={form.draft.ssh} maxLength={64} spellCheck={false} placeholder={c.aliasPlaceholder}
                aria-invalid={aliasBad || duplicate} onChange={e => setDraft({ ssh: e.target.value })} />
              {duplicate && <span role="alert" className="set-error">{c.errors.duplicate}</span>}
              {aliasBad && <span role="alert" className="set-error">{c.aliasInvalid}</span>}
            </label>
          </div>
          <button type="button" className="set-disclosure" aria-expanded={form.help} onClick={() => setForm(f => (f ? { ...f, help: !f.help } : f))}>
            <span aria-hidden="true" style={{ transform: form.help ? 'rotate(90deg)' : undefined }}><Icon d={ICONS.chevronRight.d} size={12} /></span>{c.before}
          </button>
          {form.help && <ol className="set-well steps">{c.checklist.map(item => <li key={item}>{item}</li>)}</ol>}
          {probeWell(`draft:${alias}`)}
          {problem === 'full' && <div role="alert" className="set-well bad"><Icon d={ICONS.close.d} size={14} /><span>{c.errors.full}</span></div>}
          {failureWell('form')}
          <div className="set-actions">
            <Button size="sm" disabled={aliasBad || duplicate || alias === '' || probeBusy} onClick={testDraft}>{c.probe}</Button>
            <span className="spacer" />
            <Button size="sm" variant="ghost" disabled={frozen} onClick={closeForm}>{c.cancel}</Button>
            <Button size="sm" variant="primary" type="submit" disabled={frozen || problem !== null}>{frozen ? c.saving : c.save}</Button>
          </div>
          <span className="set-hint">{c.optional}</span>
        </form>
      ) : (
        <div className="set-row">
          <Button size="sm" disabled={list.length >= MAX_MACHINES} onClick={() => openForm()}><Icon d={ICONS.plus.d} size={14} />{c.add}</Button>
          <span className="set-hint">{c.count(list.length, MAX_MACHINES)}</span>
        </div>
      )}
    </Card>
  );
}

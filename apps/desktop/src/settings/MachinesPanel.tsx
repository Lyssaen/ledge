import { useState, type FormEvent } from 'react';
import { sshProblem, type MachineState, type ProbeResult } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { ALIAS, checkDraft, configsOf, without, withDraft, type MachineDraft } from './machines';
import { useMachineEditor, type MachineFleet, type SaveOutcome } from './useMachineEditor';

interface FormState { editing: string | null; draft: MachineDraft }
export interface MachinesPanelProps { machines: readonly MachineState[]; fleet: MachineFleet; localDown: boolean; saveTimeoutMs?: number }

/** Settings › Machines (spec §6, §9.4; mockup settings.js `machineSettings`). The list is the daemon's; every change
 *  goes through `machines.set` and shows once it comes back. The local machine is first and has no actions. */
export function MachinesPanel({ machines, fleet, localDown, saveTimeoutMs }: MachinesPanelProps) {
  const { t } = useI18n();
  const c = t.settings.machines;
  const editor = useMachineEditor(fleet, machines, saveTimeoutMs);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const list = configsOf(machines);
  const frozen = localDown || editor.saving;
  const probeBusy = editor.probing?.result === null;
  const failure = (o: Exclude<SaveOutcome, 'saved'>) => c.errors[o];
  const probeText = (r: ProbeResult) => (r.ok ? c.probeOk(r.version, r.sessions) : c.problem[sshProblem(r.error)]);
  const probeLine = (key: string) => (editor.probing?.key === key
    ? <p className="settings-note" role="status">{editor.probing.result ? probeText(editor.probing.result) : c.probing(editor.probing.alias)}</p>
    : null);
  const setDraft = (patch: Partial<MachineDraft>) => setForm(f => (f ? { ...f, draft: { ...f.draft, ...patch } } : f));
  const openForm = (editing: string | null, draft: MachineDraft) => { editor.clearProbe(); setForm({ editing, draft }); setFormError(null); setFeedback(null); setRemoval(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || editor.saving) return;
    const problem = checkDraft(list, form.draft, form.editing);
    if (problem) { setFormError(c.errors[problem]); return; }
    setFormError(null);
    const outcome = await editor.save(withDraft(list, form.draft, form.editing));
    if (outcome === 'saved') { editor.clearProbe(); setForm(null); setFeedback({ text: c.saved(form.draft.label.trim()), error: false }); }
    else setFormError(failure(outcome));
  };
  const remove = async (m: MachineState) => {
    setRemoval(null);
    const outcome = await editor.save(without(list, m.id));
    setFeedback(outcome === 'saved' ? { text: c.removed(m.label), error: false } : { text: failure(outcome), error: true });
  };
  const testDraft = () => {
    if (!form) return;
    const ssh = form.draft.ssh.trim();
    if (!ALIAS.test(ssh)) { setFormError(c.errors.invalid); return; }
    setFormError(null);
    editor.probe(`draft:${ssh}`, ssh);
  };
  const editingLabel = form?.editing ? machines.find(m => m.id === form.editing)?.label ?? '' : '';

  return (
    <>
      <h3>{c.title}</h3>
      <p className="settings-note">{c.note}</p>
      {machines.map(m => (
        <article key={m.id} className="settings-machine" aria-label={m.label}>
          <div><strong>{m.label}</strong><span className="machine-status"><i className={m.status === 'open' ? 'dot green' : 'dot'} aria-hidden="true" />{c.status[m.status]}</span></div>
          <p>{m.ssh ? c.ssh(m.ssh) : c.localKind} · {c.version(m.daemon?.version ?? m.version)} · {t.status.sessions(m.sessions.length)}</p>
          {m.ssh && (
            <div className="settings-actions">
              <button type="button" className="settings-button" disabled={frozen || probeBusy} onClick={() => editor.probe(m.id, m.ssh!)}>{c.test}</button>
              {m.status !== 'open' && <button type="button" className="settings-button" disabled={localDown} onClick={() => fleet.retry(m.id)}>{c.retry}</button>}
              <button type="button" className="settings-button" disabled={frozen} onClick={() => openForm(m.id, { label: m.label, ssh: m.ssh! })}>{c.edit}</button>
              <button type="button" className="settings-button" disabled={frozen} onClick={() => setRemoval(m.id)}>{c.remove}</button>
            </div>
          )}
          {probeLine(m.id)}
          {removal === m.id && (
            <div className="machine-confirm" role="alert">
              {c.confirm(m.label)}
              <div className="settings-actions">
                <button type="button" className="settings-button" disabled={frozen} onClick={() => void remove(m)}>{c.remove}</button>
                <button type="button" className="settings-button" onClick={() => setRemoval(null)}>{c.cancel}</button>
              </div>
            </div>
          )}
        </article>
      ))}
      {form ? (
        <form className="machine-form" noValidate onSubmit={e => void submit(e)}>
          <h4>{form.editing ? c.editTitle(editingLabel) : c.addTitle}</h4>
          <label>{c.label}<input name="label" aria-label={c.labelAria} required maxLength={80} value={form.draft.label} placeholder={c.labelPlaceholder} onChange={e => setDraft({ label: e.target.value })} /></label>
          <label>{c.alias}<input name="ssh" aria-label={c.alias} required maxLength={64} spellCheck={false} value={form.draft.ssh} placeholder="my-server" onChange={e => setDraft({ ssh: e.target.value })} /><small>{c.aliasHint}</small></label>
          <details><summary>{c.before}</summary><ol>{c.checklist.map(item => <li key={item}>{item}</li>)}</ol></details>
          {formError && <p className="setting-error" role="alert">{formError}</p>}
          {probeLine(`draft:${form.draft.ssh.trim()}`)}
          <div className="settings-actions">
            <button type="button" className="settings-button" disabled={frozen || probeBusy} onClick={testDraft}>{c.probe}</button>
            <button type="button" className="settings-button" disabled={editor.saving} onClick={() => { editor.clearProbe(); setForm(null); setFormError(null); }}>{c.cancel}</button>
            <button type="submit" className="primary" disabled={frozen}>{editor.saving ? c.saving : c.save}</button>
          </div>
          <p className="settings-note">{c.optional}</p>
        </form>
      ) : (
        <div className="settings-actions">
          <button type="button" className="settings-button" disabled={localDown} onClick={() => openForm(null, { label: '', ssh: '' })}>{c.add}</button>
        </div>
      )}
      {feedback && <p className={feedback.error ? 'setting-error' : 'settings-note'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    </>
  );
}

import { useState, type JSX } from 'react';
import type { Task } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { ANSWER_SILENT, decisionOptions, type TeamsApi } from './useTeamsApi';

/**
 * « Répondre » to a decision a session put to the user: a free text, empty at first (the options the session offered fill it
 * on a click, never chosen for the user), then the answer shown whole with an explicit confirmation, since an answer cannot be
 * taken back; only then `task.answer`. A refusal stays on screen with its reason.
 */
export function DecisionAnswer({ task, teams, onClose }: { task: Task; teams: Pick<TeamsApi, 'answer'>; onClose(): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.decision;
  const [draft, setDraft] = useState('');
  const [step, setStep] = useState<'write' | 'confirm' | 'sending'>('write');
  const [error, setError] = useState<string | null>(null);
  const options = decisionOptions(task.text);
  const text = draft.trim();
  const send = async () => {
    setStep('sending'); setError(null);
    const reason = await teams.answer(task.id, text);
    if (reason === undefined) return onClose();
    setError(reason === ANSWER_SILENT ? c.silent : c.failed(reason));
    setStep('confirm');
  };
  return (
    <form className="decision-answer" aria-label={c.form(task.title)} onSubmit={e => { e.preventDefault(); if (step === 'write' && text) setStep('confirm'); }}>
      {step === 'write' ? <>
        {options.length > 0 && (
          <div className="decision-options" role="group" aria-label={c.options}>
            {options.map(o => <button key={o} type="button" className="st-qa" onClick={() => setDraft(o)}>{o}</button>)}
          </div>
        )}
        <textarea aria-label={c.field} placeholder={c.placeholder} rows={2} value={draft} autoFocus onChange={e => setDraft(e.target.value)} />
        <div className="decision-actions">
          <Button type="submit" variant="primary" size="sm" disabled={!text}>{c.send}</Button>
          <Button variant="ghost" size="sm" onClick={onClose}>{c.cancel}</Button>
        </div>
      </> : <>
        <p className="decision-review">{c.review(task.giverName)}</p>
        <blockquote className="decision-text">{text}</blockquote>
        {error && <p className="decision-error" role="alert">{error}</p>}
        <div className="decision-actions">
          <Button variant="primary" size="sm" disabled={step === 'sending'} onClick={() => { void send(); }}>{step === 'sending' ? c.sending : c.confirm}</Button>
          <Button variant="ghost" size="sm" disabled={step === 'sending'} onClick={() => { setError(null); setStep('write'); }}>{c.edit}</Button>
        </div>
      </>}
    </form>
  );
}

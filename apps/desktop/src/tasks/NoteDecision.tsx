import { useId, useState, type JSX } from 'react';
import type { Task } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { ANSWER_SILENT, type TasksApi } from './useTasksApi';

/**
 * A proposal about the user's notes in « À toi » (docs/mockups/ledge-brain-notes.html, part 1): the fact as it will be written and
 * where the session has it from, then « Ajouter », « Modifier », « Refuser » (a flag: « Marquer à revoir », « Ignorer »; a new note:
 * its title and « quand la lire », correctable, then « Créer la note »). Nothing is written before a « yes » button.
 */
export function NoteDecision({ task, api }: { task: Task & { brain: NonNullable<Task['brain']> }; api: Pick<TasksApi, 'answerNote'> }): JSX.Element {
  const { t } = useI18n();
  const c = t.decision.note;
  const p = task.brain;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.fact);
  const [title, setTitle] = useState(p.title ?? p.note);
  const [when, setWhen] = useState(p.when ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const one = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const send = async (yes: boolean) => {
    setSending(true); setError(null);
    const fact = one(text);
    const choice = !yes ? { yes } : {
      yes, ...(fact && fact !== p.fact ? { text: fact } : {}),
      ...(p.create && one(title) ? { title: one(title) } : {}), ...(p.create && one(when) ? { when: one(when) } : {})
    };
    const reason = await api.answerNote(task.id, choice);
    setSending(false);
    if (reason !== undefined) setError(reason === ANSWER_SILENT ? t.decision.silent : c.failed(reason));
  };
  const head = p.kind === 'flag' ? c.flag(task.giverName, p.note) : p.create ? c.create(task.giverName, p.note) : c.add(task.giverName, p.note);
  return (
    <div className="lp-decision note-decision" data-decision={task.id}>
      <div className="lp-row">
        <span className={p.kind === 'flag' ? 'lp-mark nd-flag' : 'lp-mark lp-asked'} aria-hidden>{p.kind === 'flag' ? '!' : '+'}</span>
        <span className="lp-text">{head}</span>
      </div>
      {p.create && (
        <>
          <label className="nd-field" htmlFor={`${id}t`}>{c.titleField}<input id={`${id}t`} value={title} disabled={sending} onChange={e => setTitle(e.target.value)} /></label>
          <label className="nd-field" htmlFor={`${id}w`}>{c.whenField}<input id={`${id}w`} value={when} disabled={sending} onChange={e => setWhen(e.target.value)} /></label>
        </>
      )}
      {editing
        ? <label className="nd-field" htmlFor={`${id}f`}>{c.field}<textarea id={`${id}f`} rows={3} value={text} autoFocus disabled={sending} onChange={e => setText(e.target.value)} /></label>
        : <blockquote className="nd-quote">{p.fact}</blockquote>}
      {p.source && !editing && <span className="nd-source">{c.source(p.source)}</span>}
      {error && <p className="decision-error" role="alert">{error}</p>}
      <div className="decision-actions">
        {p.kind === 'flag' ? <>
          <button type="button" className="st-qa pri" disabled={sending} onClick={() => { void send(true); }}>{sending ? c.sending : c.mark}</button>
          <button type="button" className="st-qa" disabled={sending} onClick={() => { void send(false); }}>{c.ignore}</button>
        </> : editing ? <>
          <button type="button" className="st-qa pri" disabled={sending || !one(text)} onClick={() => { void send(true); }}>{sending ? c.sending : c.editYes}</button>
          <button type="button" className="st-qa" disabled={sending} onClick={() => { setEditing(false); setText(p.fact); }}>{c.cancel}</button>
        </> : <>
          <button type="button" className="st-qa pri" disabled={sending} onClick={() => { void send(true); }}>{sending ? c.sending : p.create ? c.createYes : c.yes}</button>
          <button type="button" className="st-qa" disabled={sending} onClick={() => setEditing(true)}>{c.edit}</button>
          <button type="button" className="st-qa" disabled={sending} onClick={() => { void send(false); }}>{c.no}</button>
        </>}
      </div>
    </div>
  );
}

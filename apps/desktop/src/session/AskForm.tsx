import { useState, type JSX } from 'react';
import type { AskQuestion } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';

type Answer = { selected: string[]; text: string };
const EMPTY: Answer = { selected: [], text: '' };

/** The questions of one OMP `ask` call, all on one card: a choice each (several where the question takes them), a free answer
 *  beside the choices, sent together; or declined. Nothing is sent until every question has an answer. */
export function AskForm(p: { questions: readonly AskQuestion[]; busy: boolean; onSend(answers: Array<{ id: string; selected: string[]; text?: string }>, cancel?: boolean): void }): JSX.Element {
  const { t } = useI18n();
  const ta = t.session.pending.ask;
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const get = (id: string): Answer => answers[id] ?? EMPTY;
  const set = (id: string, a: Answer) => setAnswers(x => ({ ...x, [id]: a }));
  const done = p.questions.every(q => get(q.id).selected.length > 0 || get(q.id).text.trim() !== '');
  const send = () => { if (done && !p.busy) p.onSend(p.questions.map(q => { const a = get(q.id); const text = a.text.trim(); return { id: q.id, selected: a.selected, ...(text ? { text } : {}) }; })); };
  return (
    <form className="ask-form" onSubmit={e => { e.preventDefault(); send(); }}>
      {p.questions.map(q => {
        const a = get(q.id);
        return (
          <fieldset key={q.id} className="ask-question" disabled={p.busy}>
            <legend>{q.header && <small>{q.header}</small>}<strong>{q.question}</strong></legend>
            {q.options.map(o => {
              const on = a.selected.includes(o.label);
              return (
                <label key={o.label} className={on ? 'selected' : ''}>
                  <input type={q.multi ? 'checkbox' : 'radio'} name={q.id} checked={on}
                    onChange={() => set(q.id, { ...a, selected: q.multi ? (on ? a.selected.filter(x => x !== o.label) : [...a.selected, o.label]) : [o.label] })} />
                  <span><strong>{o.label}</strong>{o.description && <small>{o.description}</small>}</span>
                </label>
              );
            })}
            <input type="text" className="ask-other" aria-label={ta.other(q.question)} placeholder={ta.otherPlaceholder} value={a.text} onChange={e => set(q.id, { ...a, text: e.target.value })} />
          </fieldset>
        );
      })}
      <div className="pending-actions">
        <Button variant="primary" size="sm" type="submit" disabled={!done || p.busy}>{ta.send}</Button>
        <Button variant="ghost" size="sm" type="button" disabled={p.busy} onClick={() => p.onSend([], true)}>{ta.decline}</Button>
      </div>
    </form>
  );
}

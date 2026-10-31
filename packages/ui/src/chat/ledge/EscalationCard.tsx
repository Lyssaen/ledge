import { useState, type FormEvent } from 'react';
import { ALWAYS_USER, type Escalation } from '@ledge/protocol';
import { CategoryChip } from './CategoryChip';
import { useLedgeThreadCopy } from './copy';
import { relativeAge } from './threadModel';

/** Where the answer to this card stands (`useAnswerState` of `@ledge/fleet`). */
export interface EscalationAnswerState { state: 'idle' | 'sending' | 'done' | 'refused'; code?: string; reason?: string }

/** The answer's words: each question's option label, or the free value as is (an ask's `text`). */
export function answerLabel(e: Escalation, answers: Record<string, string>): string {
  if (e.questions.length === 0) return answers.text ?? Object.values(answers).join(' · ');
  return e.questions.flatMap(q => {
    const v = answers[q.id];
    return v === undefined ? [] : [q.options.find(o => o.id === v)?.label ?? v];
  }).join(' · ');
}

/** The decision in message (`c-A.png`, `nn-open.png`): category, origin and age, the question, Ledge's advice, an option
 *  per button (the recommended one filled), and « En parler ». An update has a single « Vu »; an ask a one-line field (R16). */
export function EscalationCard(p: { escalation: Escalation; answer: EscalationAnswerState; onAnswer(answers: Record<string, string>): void; onTalk(): void; compact?: boolean; now?: string }) {
  const copy = useLedgeThreadCopy(), w = copy.escalation, e = p.escalation;
  // Picks and the ask's text belong to one escalation: a card reused for another one starts blank.
  const [draft, setDraft] = useState<{ id: string; picks: Record<string, string>; text: string }>({ id: e.id, picks: {}, text: '' });
  const own = draft.id === e.id ? draft : { id: e.id, picks: {}, text: '' };
  const picks = own.picks, text = own.text;
  const setText = (t: string) => setDraft({ ...own, text: t });
  const now = p.now ?? new Date().toISOString();
  const already = p.answer.state === 'refused' && p.answer.code === 'already_answered';
  const failed = p.answer.state === 'refused' && !already ? w.refused(p.answer.code ?? 'failed', p.answer.reason) : null;
  // « Déjà répondu » alone (the escalation back to pending or grace) keeps the buttons: the note says it, a new answer may follow.
  const settled = e.state === 'answered' || e.state === 'closed';
  const busy = p.answer.state === 'sending' || p.answer.state === 'done';
  const ask = e.intent === 'decision' && e.questions.length === 0;
  const title = e.summary || e.questions[0]?.question || '';

  const pick = (qid: string, option: string) => {
    const next = { ...picks, [qid]: option };
    setDraft({ ...own, picks: next });
    if (e.questions.every(q => next[q.id] !== undefined)) p.onAnswer(next);
  };
  const submit = (ev: FormEvent) => { ev.preventDefault(); const t = text.trim(); if (t && !busy) p.onAnswer({ text: t }); };

  // « Déjà répondu » first when this device's answer lost the race, then who won (Review Focus 1).
  const outcomes: string[] = [];
  if (already) outcomes.push(w.alreadyAnswered);
  if (e.state === 'answered' && e.answer) {
    const label = e.intent === 'update' ? w.seen : answerLabel(e, e.answer.answers);
    outcomes.push(e.answer.by === 'user' ? w.answeredByYou(label) : w.answeredByLedge(label));
  } else if (!already && (e.state === 'closed' || e.state === 'answered')) outcomes.push(w.closed);

  return (
    <article className="lt-card" data-compact={p.compact || undefined} data-tone={e.category && ALWAYS_USER.includes(e.category) ? 'amber' : undefined}>
      <header className="lt-card-head">
        {e.category && <CategoryChip category={e.category} />}
        <span className="lt-card-from mono">{e.from}</span>
        <span className="lt-card-dot" aria-hidden>·</span>
        <span className="lt-card-age mono">{relativeAge(e.createdAt, now, copy.age, { bare: p.compact })}</span>
      </header>
      <p className="lt-card-title">{title}</p>
      {e.advice && <p className="lt-card-advice">{w.advice(e.advice)}</p>}
      {!settled && e.state === 'grace' && <p className="lt-card-note">{w.grace}</p>}
      {failed && <p className="lt-card-note" data-tone="danger" role="alert">{failed}</p>}
      {outcomes.map(o => <p key={o} className="lt-card-outcome">{o}</p>)}
      {!settled && (
        <div className="lt-card-actions">
          {e.intent === 'update' ? (
            <div className="lt-options"><button type="button" className="ledge-btn lt-btn" data-variant="outline" disabled={busy} onClick={() => p.onAnswer({})}>{w.seen}</button></div>
          ) : ask ? (
            <form className="lt-ask" onSubmit={submit}>
              <input className="ledge-field lt-ask-field" aria-label={w.askLabel} placeholder={w.askPlaceholder} value={text} disabled={busy} onChange={ev => setText(ev.target.value)} />
              <button type="submit" className="ledge-btn lt-btn" data-variant="primary" disabled={busy || !text.trim()}>{w.send}</button>
            </form>
          ) : (
            <div className="lt-questions">
              {e.questions.map(q => (
                <div key={q.id} className="lt-question">
                  {e.questions.length > 1 && <span className="lt-question-text">{q.question}</span>}
                  <div className="lt-options">
                    {q.options.map(o => {
                      const chosen = e.questions.length > 1 ? picks[q.id] === o.id : undefined;
                      return (
                        <button key={o.id} type="button" className="ledge-btn lt-btn" data-variant={o.recommended ? 'primary' : 'outline'}
                          data-recommended={o.recommended || undefined} aria-pressed={chosen} disabled={busy} onClick={() => pick(q.id, o.id)}>{o.label}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="lt-link lt-card-talk" onClick={p.onTalk}>{w.talk}</button>
        </div>
      )}
    </article>
  );
}
